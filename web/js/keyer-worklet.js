// AudioWorklet: runs the Rust iambic keyer one 128-sample block at a time,
// so sidetone and element timing are sample-accurate. Paddle state comes in
// over the port; finished elements go back out with keyer-clock frames.

class KeyerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const mod = new WebAssembly.Module(options.processorOptions.wasm);
    this.x = new WebAssembly.Instance(mod, {}).exports;
    this.x.keyer_init(sampleRate);
    this.down = 0;
    this.synced = false;
    this.port.onmessage = (e) => this.message(e.data);
  }

  message(d) {
    const x = this.x;
    if (d.t === 'cfg') x.keyer_config(d.wpm, d.freq, 5, d.modeB ? 1 : 0, d.vol);
    else if (d.t === 'pad') x.keyer_paddles(d.dit ? 1 : 0, d.dah ? 1 : 0);
    else if (d.t === 'str') x.keyer_straight(d.down ? 1 : 0);
    else if (d.t === 'rel') x.keyer_release();
  }

  process(_inputs, outputs) {
    const x = this.x;
    const out = outputs[0];
    const n = out[0].length;
    if (!this.synced) {
      // Tell the page how keyer frames map onto AudioContext time.
      this.port.postMessage({ t: 'sync', offset: currentTime - x.keyer_frame() / sampleRate, sr: sampleRate });
      this.synced = true;
    }
    const p = x.keyer_process(n);
    const block = new Float32Array(x.memory.buffer, p, n);
    for (const ch of out) ch.set(block);
    const ne = x.keyer_take_events();
    if (ne) {
      const ev = Array.from(new Float64Array(x.memory.buffer, x.keyer_events_ptr(), ne * 3));
      this.port.postMessage({ t: 'ev', ev });
    }
    // Heartbeat on the keyer's own clock (~every 21 ms at 48 kHz). The page
    // measures silence from this, not from AudioContext.currentTime, which
    // can run ahead of the keyer by the output buffer (210 ms seen headless).
    if ((this.blocks = (this.blocks || 0) + 1) % 8 === 0) this.port.postMessage({ t: 'tick', frame: x.keyer_frame() });
    const down = x.keyer_down();
    if (down !== this.down) {
      this.down = down;
      this.port.postMessage({ t: 'key', down, frame: x.keyer_frame() });
    }
    return true;
  }
}

registerProcessor('cw-keyer', KeyerProcessor);
