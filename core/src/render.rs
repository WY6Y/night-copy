//! Render text to CW audio: exact Farnsworth timing, raised-cosine edges,
//! and optional band noise, QSB (fading) and QRM (a second station).

use crate::morse;
use crate::rng::Rng;

pub const PRE_ROLL_S: f64 = 0.12;
const TAIL_S: f64 = 0.25;

#[derive(Clone, Copy)]
pub struct Opts {
    pub sr: f64,
    pub char_wpm: f64,
    pub eff_wpm: f64,
    pub freq: f64,
    pub rise_ms: f64,
    pub noise: f64,
    pub qsb: f64,
    pub qrm: f64,
    pub seed: u32,
}

/// One keyed element, in seconds from the start of the buffer.
#[derive(Clone, Copy, Debug)]
pub struct Mark {
    pub start: f64,
    pub end: f64,
}

/// Where each character sits in time (for reveal sync and the scope).
#[derive(Clone, Debug)]
pub struct CharSpan {
    pub text: Vec<u8>,
    pub start: f64,
    pub end: f64,
}

pub struct Timeline {
    pub marks: Vec<Mark>,
    pub chars: Vec<CharSpan>,
    pub length: f64,
}

/// Gap lengths in seconds: (unit, between characters, between words).
/// ARRL Farnsworth: characters keep `char_wpm` timing, only the gaps stretch.
pub fn gaps(char_wpm: f64, eff_wpm: f64) -> (f64, f64, f64) {
    let u = 1.2 / char_wpm;
    if eff_wpm >= char_wpm {
        return (u, 3.0 * u, 7.0 * u);
    }
    let ta = (60.0 * char_wpm - 37.2 * eff_wpm) / (char_wpm * eff_wpm);
    (u, 3.0 * ta / 19.0, 7.0 * ta / 19.0)
}

pub fn timeline(text: &[u8], char_wpm: f64, eff_wpm: f64, start: f64) -> Timeline {
    let (u, cg, wg) = gaps(char_wpm, eff_wpm);
    let mut t = start;
    let mut marks = Vec::new();
    let mut chars = Vec::new();
    let parsed = morse::parse(text);
    for (idx, item) in parsed.iter().enumerate() {
        match item {
            None => t += wg - cg, // a word gap replaces the character gap already added
            Some((label, els)) => {
                let cs = t;
                for (k, &dah) in els.iter().enumerate() {
                    let len = if dah { 3.0 * u } else { u };
                    marks.push(Mark { start: t, end: t + len });
                    t += len;
                    if k + 1 < els.len() {
                        t += u;
                    }
                }
                chars.push(CharSpan { text: label.clone(), start: cs, end: t });
                if idx + 1 < parsed.len() {
                    t += cg;
                }
            }
        }
    }
    Timeline { marks, chars, length: t }
}

/// Raised-cosine keying envelope. The rise starts at the mark's start and the
/// fall starts at its end, so the half-amplitude width equals the mark length.
fn envelope(env: &mut [f32], marks: &[Mark], sr: f64, rise_s: f64) {
    let rise_n = (rise_s * sr).max(1.0);
    for m in marks {
        let a = (m.start * sr) as usize;
        let b = ((m.end + rise_s) * sr).ceil() as usize;
        let fall0 = m.end * sr;
        for i in a..b.min(env.len()) {
            let x = i as f64;
            let up = ((x - m.start * sr) / rise_n).clamp(0.0, 1.0);
            let down = 1.0 - ((x - fall0) / rise_n).clamp(0.0, 1.0);
            let p = up.min(down);
            let v = 0.5 - 0.5 * (core::f64::consts::PI * p).cos();
            if (v as f32) > env[i] {
                env[i] = v as f32;
            }
        }
    }
}

struct Biquad {
    b0: f64, b1: f64, b2: f64, a1: f64, a2: f64,
    x1: f64, x2: f64, y1: f64, y2: f64,
}

impl Biquad {
    fn bandpass(sr: f64, f: f64, q: f64) -> Self {
        let w = 2.0 * core::f64::consts::PI * f / sr;
        let alpha = w.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        Biquad {
            b0: alpha / a0, b1: 0.0, b2: -alpha / a0,
            a1: -2.0 * w.cos() / a0, a2: (1.0 - alpha) / a0,
            x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0,
        }
    }
    fn run(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1; self.x1 = x; self.y2 = self.y1; self.y1 = y;
        y
    }
}

pub struct Rendered {
    pub samples: Vec<f32>,
    pub timeline: Timeline,
}

pub fn render(text: &[u8], o: &Opts) -> Rendered {
    let tl = timeline(text, o.char_wpm, o.eff_wpm, PRE_ROLL_S);
    let total = tl.length + TAIL_S;
    let n = (total * o.sr).ceil() as usize;
    let rise = o.rise_ms / 1000.0;
    let mut rng = Rng::new(o.seed);

    let mut env = vec![0f32; n];
    envelope(&mut env, &tl.marks, o.sr, rise);

    // Main signal with optional slow fading.
    let qsb_rate = 0.08 + 0.12 * rng.f64();
    let qsb_phase = rng.f64() * 6.283;
    let mut out = vec![0f32; n];
    let w = 2.0 * core::f64::consts::PI * o.freq / o.sr;
    for i in 0..n {
        if env[i] == 0.0 {
            continue;
        }
        let t = i as f64 / o.sr;
        let fade = if o.qsb > 0.0 {
            let s = 0.5 + 0.5 * (6.283 * qsb_rate * t + qsb_phase).sin();
            1.0 - 0.85 * o.qsb * s * s
        } else {
            1.0
        };
        out[i] = (0.5 * fade * env[i] as f64 * (w * i as f64).sin()) as f32;
    }

    // QRM: another station a few hundred Hz away sending its own traffic.
    if o.qrm > 0.0 {
        let mut junk = Vec::new();
        for g in 0..40 {
            if g > 0 {
                junk.push(b' ');
            }
            for _ in 0..(2 + rng.below(4)) {
                junk.push(morse::KOCH[rng.below(26) as usize]);
            }
        }
        let wpm = 14.0 + 14.0 * rng.f64();
        let off = (120.0 + 230.0 * rng.f64()) * if rng.f64() < 0.5 { -1.0 } else { 1.0 };
        let qtl = timeline(&junk, wpm, wpm, -rng.f64() * 3.0);
        let mut qenv = vec![0f32; n];
        envelope(&mut qenv, &qtl.marks, o.sr, rise);
        let qw = 2.0 * core::f64::consts::PI * (o.freq + off) / o.sr;
        for i in 0..n {
            if qenv[i] > 0.0 {
                out[i] += (0.5 * 0.7 * o.qrm * qenv[i] as f64 * (qw * i as f64).sin()) as f32;
            }
        }
    }

    // Band noise, shaped like a CW filter around the tone.
    if o.noise > 0.0 {
        let mut bp = Biquad::bandpass(o.sr, o.freq, 1.6);
        let mut bp2 = Biquad::bandpass(o.sr, o.freq, 1.6);
        let mut crackle = 0.0f64;
        for s in out.iter_mut() {
            let mut x = bp2.run(bp.run(rng.gauss()));
            if rng.f64() < 0.0004 {
                crackle = 1.5 + rng.f64() * 2.0;
            }
            crackle *= 0.995;
            x += crackle * (rng.f64() - 0.5) * 0.15;
            *s += (x * 0.9 * o.noise) as f32;
        }
    }

    for s in out.iter_mut() {
        *s = s.clamp(-0.98, 0.98);
    }
    Rendered { samples: out, timeline: tl }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> Opts {
        Opts { sr: 48000.0, char_wpm: 20.0, eff_wpm: 20.0, freq: 600.0, rise_ms: 5.0, noise: 0.0, qsb: 0.0, qrm: 0.0, seed: 1 }
    }

    /// Half-amplitude crossings of keyed elements, measured on the rendered
    /// audio: coherent demodulation at the tone, then a one-cycle centered
    /// moving average (removes the 2f term without shifting the crossings).
    fn measure(samples: &[f32], sr: f64, freq: f64) -> Vec<(f64, f64)> {
        let w = 2.0 * core::f64::consts::PI * freq / sr;
        let demod: Vec<f64> = samples.iter().enumerate().map(|(i, &s)| 4.0 * s as f64 * (w * i as f64).sin()).collect();
        let half = (sr / freq / 2.0).round() as usize; // one tone period total
        let mut out = Vec::new();
        let mut on = false;
        let mut start = 0.0;
        let mut prev = 0.0;
        for i in half..demod.len() - half {
            let e: f64 = demod[i - half..i + half].iter().sum::<f64>() / (2 * half) as f64;
            let t = |p: f64, e: f64| ((i as f64 - 1.0) + (0.5 - p) / (e - p)) / sr;
            if !on && e >= 0.5 {
                on = true;
                start = t(prev, e);
            } else if on && e < 0.5 {
                on = false;
                out.push((start, t(prev, e)));
            }
            prev = e;
        }
        out
    }

    #[test]
    fn timing_at_20_wpm_is_exact() {
        let r = render(b"PARIS", &opts());
        let els = measure(&r.samples, 48000.0, 600.0);
        assert_eq!(els.len(), r.timeline.marks.len());
        for (m, (s, e)) in r.timeline.marks.iter().zip(els.iter()) {
            let want = (m.end - m.start) * 1000.0;
            assert!((want - 60.0).abs() < 1e-6 || (want - 180.0).abs() < 1e-6, "unexpected ideal {want}");
            let got = (e - s) * 1000.0;
            assert!((got - want).abs() <= 1.0, "element {want} ms measured {got:.3} ms");
            let drift = (s - (m.start + 0.0025)) * 1000.0;
            assert!(drift.abs() <= 0.5, "start drift {drift:.3} ms");
        }
        // Element gaps inside P (.--.) are one unit.
        let g = (els[1].0 - els[0].1) * 1000.0;
        assert!((g - 60.0).abs() <= 1.0, "intra-element gap {g:.3} ms");
    }

    #[test]
    fn paris_is_fifty_units() {
        // PARIS plus a word gap is the 50-unit standard word.
        let tl = timeline(b"PARIS PARIS", 20.0, 20.0, 0.0);
        let second = tl.chars[5].start;
        assert!((second - 50.0 * 0.06).abs() < 1e-9, "second PARIS starts at {second}");
    }

    #[test]
    fn farnsworth_stretches_only_gaps() {
        let (u, cg, wg) = gaps(20.0, 8.0);
        assert!((u - 0.06).abs() < 1e-12);
        assert!(cg > 3.0 * u && wg > 7.0 * u);
        // 5 PARIS words at 8 wpm effective take 37.5 s.
        let mut s = Vec::new();
        for i in 0..5 {
            if i > 0 { s.push(b' '); }
            s.extend_from_slice(b"PARIS");
        }
        let tl = timeline(&s, 20.0, 8.0, 0.0);
        let total = tl.length + wg; // include the trailing word gap
        assert!((total - 37.5).abs() < 0.01, "5 words took {total}");
    }

    #[test]
    fn noise_and_qrm_render_bounded() {
        let mut o = opts();
        o.noise = 1.0; o.qrm = 1.0; o.qsb = 1.0;
        let r = render(b"CQ CQ DE WY6Y K", &o);
        assert!(r.samples.iter().all(|s| s.is_finite() && s.abs() <= 0.98));
    }
}
