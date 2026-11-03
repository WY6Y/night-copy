//! CyberCW timing core. Compiled to WASM with a plain C ABI (no bindgen), so
//! the same module loads in the page and inside the AudioWorklet.
//!
//! Strings cross the boundary through one shared byte buffer (`buf_ptr`).
//! JS must rebuild its typed-array views after every call that can allocate,
//! because memory growth detaches the old ArrayBuffer.

pub mod decoder;
pub mod keyer;
pub mod morse;
pub mod render;
pub mod rng;
pub mod sched;

use decoder::Decoder;
use keyer::{Keyer, Kind};
use sched::{Sched, Stat};

const BUF: usize = 16384;

struct Globals {
    buf: [u8; BUF],
    samples: Vec<f32>,
    marks: Vec<f64>,
    chars: Vec<f64>,
    keyer: Keyer,
    kout: Vec<f32>,
    kev: Vec<f64>,
    dec: Decoder,
    gaps: Vec<f64>,
    sched: Sched,
    labels_len: u32,
}

static mut G: Option<Globals> = None;

#[allow(static_mut_refs)]
fn g() -> &'static mut Globals {
    // Single-threaded: each WASM instance (page, worklet) owns its own copy.
    unsafe {
        G.get_or_insert_with(|| Globals {
            buf: [0; BUF],
            samples: Vec::new(),
            marks: Vec::new(),
            chars: Vec::new(),
            keyer: Keyer::new(48000.0),
            kout: Vec::new(),
            kev: Vec::new(),
            dec: Decoder::new(60.0),
            gaps: Vec::new(),
            sched: Sched::new(1),
            labels_len: 0,
        })
    }
}

fn input(len: u32) -> Vec<u8> {
    g().buf[..(len as usize).min(BUF)].to_vec()
}

fn output(bytes: &[u8]) -> u32 {
    let n = bytes.len().min(BUF);
    g().buf[..n].copy_from_slice(&bytes[..n]);
    n as u32
}

#[no_mangle]
pub extern "C" fn buf_ptr() -> *mut u8 {
    g().buf.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn buf_size() -> u32 {
    BUF as u32
}

// ---- Rendering ---------------------------------------------------------

/// Render the text in the buffer. Returns the sample count; read samples
/// at `render_ptr`, marks at `marks_ptr` (start,end pairs in seconds),
/// character spans at `chars_ptr` (start,end), and the character labels
/// (newline-separated) back in the buffer, length from `render_labels`.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn render(len: u32, sr: f64, char_wpm: f64, eff_wpm: f64, freq: f64, rise_ms: f64,
                         noise: f64, qsb: f64, qrm: f64, seed: u32) -> u32 {
    let text = input(len);
    let o = render::Opts { sr, char_wpm, eff_wpm, freq, rise_ms, noise, qsb, qrm, seed };
    let r = render::render(&text, &o);
    let gl = g();
    gl.marks = r.timeline.marks.iter().flat_map(|m| [m.start, m.end]).collect();
    gl.chars = r.timeline.chars.iter().flat_map(|c| [c.start, c.end]).collect();
    let labels: Vec<u8> = r.timeline.chars.iter().map(|c| c.text.clone()).collect::<Vec<_>>().join(&b'\n');
    gl.samples = r.samples;
    gl.labels_len = output(&labels);
    gl.samples.len() as u32
}

#[no_mangle]
pub extern "C" fn render_labels_len() -> u32 {
    g().labels_len
}

#[no_mangle]
pub extern "C" fn render_ptr() -> *const f32 {
    g().samples.as_ptr()
}

#[no_mangle]
pub extern "C" fn marks_ptr() -> *const f64 {
    g().marks.as_ptr()
}

#[no_mangle]
pub extern "C" fn marks_len() -> u32 {
    (g().marks.len() / 2) as u32
}

#[no_mangle]
pub extern "C" fn chars_ptr() -> *const f64 {
    g().chars.as_ptr()
}

#[no_mangle]
pub extern "C" fn chars_len() -> u32 {
    (g().chars.len() / 2) as u32
}

/// Seconds of audio the text in the buffer takes (no pre-roll or tail).
#[no_mangle]
pub extern "C" fn duration(len: u32, char_wpm: f64, eff_wpm: f64) -> f64 {
    render::timeline(&input(len), char_wpm, eff_wpm, 0.0).length
}

#[no_mangle]
pub extern "C" fn pre_roll() -> f64 {
    render::PRE_ROLL_S
}

// ---- Keyer (AudioWorklet) ------------------------------------------------

#[no_mangle]
pub extern "C" fn keyer_init(sr: f64) {
    g().keyer = Keyer::new(sr);
}

#[no_mangle]
pub extern "C" fn keyer_config(wpm: f64, freq: f64, rise_ms: f64, mode_b: u32, volume: f64) {
    let k = &mut g().keyer;
    k.config(wpm, freq, rise_ms);
    k.mode_b = mode_b != 0;
    k.volume = volume;
}

#[no_mangle]
pub extern "C" fn keyer_paddles(dit: u32, dah: u32) {
    g().keyer.paddles(dit != 0, dah != 0);
}

#[no_mangle]
pub extern "C" fn keyer_straight(down: u32) {
    g().keyer.straight(down != 0);
}

#[no_mangle]
pub extern "C" fn keyer_release() {
    g().keyer.release_all();
}

/// Run `n` samples; returns a pointer to them.
#[no_mangle]
pub extern "C" fn keyer_process(n: u32) -> *const f32 {
    let gl = g();
    gl.kout.resize(n as usize, 0.0);
    gl.keyer.process(&mut gl.kout);
    gl.kout.as_ptr()
}

#[no_mangle]
pub extern "C" fn keyer_down() -> u32 {
    g().keyer.key_down() as u32
}

#[no_mangle]
pub extern "C" fn keyer_frame() -> f64 {
    g().keyer.frame() as f64
}

/// Move finished elements to `keyer_events_ptr` as (kind, start, end)
/// triples in samples; returns how many.
#[no_mangle]
pub extern "C" fn keyer_take_events() -> u32 {
    let gl = g();
    gl.kev = gl.keyer.events.drain(..).flat_map(|e| [e.kind as u32 as f64, e.start as f64, e.end as f64]).collect();
    (gl.kev.len() / 3) as u32
}

#[no_mangle]
pub extern "C" fn keyer_events_ptr() -> *const f64 {
    g().kev.as_ptr()
}

// ---- Decoder -------------------------------------------------------------

#[no_mangle]
pub extern "C" fn dec_reset(unit_ms: f64) {
    g().dec = Decoder::new(unit_ms);
}

#[no_mangle]
pub extern "C" fn dec_element(kind: u32, start_ms: f64, end_ms: f64) {
    let k = match kind {
        0 => Kind::Dit,
        1 => Kind::Dah,
        _ => Kind::Straight,
    };
    g().dec.element(k, start_ms, end_ms);
}

#[no_mangle]
pub extern "C" fn dec_key(down: u32) {
    g().dec.key(down != 0);
}

#[no_mangle]
pub extern "C" fn dec_poll(now_ms: f64) {
    g().dec.poll(now_ms);
}

/// Move newly decoded text into the buffer; returns its length.
#[no_mangle]
pub extern "C" fn dec_take() -> u32 {
    let out: Vec<u8> = g().dec.out.drain(..).collect();
    output(&out)
}

#[no_mangle]
pub extern "C" fn dec_unit() -> f64 {
    g().dec.unit_ms
}

/// Move recorded character gaps (in units) to `dec_gaps_ptr`; returns count.
#[no_mangle]
pub extern "C" fn dec_take_gaps() -> u32 {
    let gl = g();
    gl.gaps = gl.dec.char_gaps.drain(..).collect();
    gl.gaps.len() as u32
}

#[no_mangle]
pub extern "C" fn dec_gaps_ptr() -> *const f64 {
    g().gaps.as_ptr()
}

// ---- Koch scheduler ----------------------------------------------------

#[no_mangle]
pub extern "C" fn koch_len() -> u32 {
    output(morse::KOCH)
}

#[no_mangle]
pub extern "C" fn sched_seed(seed: u32) {
    g().sched.rng = rng::Rng::new(seed);
}

#[no_mangle]
pub extern "C" fn sched_set(i: u32, acc: f32, lat: f32, seen: u32) {
    if let Some(s) = g().sched.stats.get_mut(i as usize) {
        *s = Stat { acc, lat, seen };
    }
}

/// Next Koch index to drill; `last` < 0 means none.
#[no_mangle]
pub extern "C" fn sched_pick(unlocked: u32, last: i32) -> u32 {
    let last = if last < 0 { None } else { Some(last as usize) };
    g().sched.pick(unlocked as usize, last) as u32
}

#[no_mangle]
pub extern "C" fn rand_u32() -> u32 {
    g().sched.rng.u32()
}
