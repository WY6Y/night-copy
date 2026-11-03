// Page-side wrapper around the Rust/WASM core (render, decoder, scheduler).
// Views into WASM memory are rebuilt after every call that may allocate.

const enc = new TextEncoder();
const dec = new TextDecoder();

export class Core {
  static async load(url = 'core.wasm') {
    const bytes = await (await fetch(url)).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const c = new Core(instance.exports);
    c.bytes = bytes; // the keyer worklet compiles its own instance from these
    return c;
  }

  constructor(x) {
    this.x = x;
    const n = x.koch_len();
    this.koch = dec.decode(new Uint8Array(x.memory.buffer, x.buf_ptr(), n)).split('');
    x.sched_seed((Math.random() * 2 ** 31) | 1);
  }

  put(text) {
    const b = enc.encode(text).slice(0, this.x.buf_size());
    new Uint8Array(this.x.memory.buffer, this.x.buf_ptr(), b.length).set(b);
    return b.length;
  }

  get(len) {
    return dec.decode(new Uint8Array(this.x.memory.buffer, this.x.buf_ptr(), len));
  }

  /** Render text to CW. Returns samples (a copy), element marks and character spans in seconds. */
  render(text, o) {
    const x = this.x;
    const len = this.put(text);
    const n = x.render(len, o.sr, o.charWpm, o.effWpm ?? o.charWpm, o.freq ?? 600, 5, o.noise ?? 0, o.qsb ?? 0, o.qrm ?? 0, o.seed ?? ((Math.random() * 2 ** 31) | 1));
    const mem = x.memory.buffer;
    const samples = new Float32Array(mem, x.render_ptr(), n).slice();
    const m = new Float64Array(mem, x.marks_ptr(), x.marks_len() * 2);
    const marks = [];
    for (let i = 0; i < m.length; i += 2) marks.push([m[i], m[i + 1]]);
    const cs = new Float64Array(mem, x.chars_ptr(), x.chars_len() * 2);
    const labels = this.get(x.render_labels_len()).split('\n');
    const chars = [];
    for (let i = 0; i < cs.length; i += 2) chars.push({ text: labels[i / 2], start: cs[i], end: cs[i + 1] });
    return { samples, marks, chars, sr: o.sr, duration: n / o.sr };
  }

  duration(text, charWpm, effWpm) {
    return this.x.duration(this.put(text), charWpm, effWpm);
  }

  // Decoder (fed with keyer events, times in ms on the keyer's clock).
  decReset(unitMs) { this.x.dec_reset(unitMs); }
  decElement(kind, s, e) { this.x.dec_element(kind, s, e); }
  decKey(down) { this.x.dec_key(down ? 1 : 0); }
  decPoll(now) { this.x.dec_poll(now); }
  decTake() { const n = this.x.dec_take(); return n ? this.get(n) : ''; }
  decGaps() {
    const n = this.x.dec_take_gaps();
    return n ? Array.from(new Float64Array(this.x.memory.buffer, this.x.dec_gaps_ptr(), n)) : [];
  }

  /** Weighted next character among the first `unlocked` Koch letters. */
  pick(unlocked, stats, last) {
    for (let i = 0; i < unlocked; i++) {
      const s = stats[this.koch[i]] || {};
      this.x.sched_set(i, s.acc ?? 0, s.lat ?? 0, s.seen ?? 0);
    }
    const li = last ? this.koch.indexOf(last) : -1;
    return this.koch[this.x.sched_pick(unlocked, li)];
  }
}
