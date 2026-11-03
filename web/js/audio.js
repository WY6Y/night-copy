// Audio: CW playback (WASM-rendered buffers), the keyer worklet, synthesized
// sound effects, rain ambience and the two CyberPacketPeril tracks. Music
// ducks whenever CW plays, so it never competes with copying.

export class Audio {
  constructor(core, settings) {
    this.core = core;
    this.settings = settings;
    this.ctx = null;
    this.keyerListeners = new Set();
    this.cwPlaying = 0;
  }

  async start() {
    if (this.ctx) { this.unlock(); return; }
    // iOS: a 'playback' session ignores the ringer switch, like a music app.
    // Without it, the switch mutes Web Audio unless an <audio> element plays.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older WebKit */ }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.unlock();
    this.sr = ctx.sampleRate;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.cwGain = ctx.createGain(); this.cwGain.connect(this.master);
    this.sfxGain = ctx.createGain(); this.sfxGain.connect(this.master);
    this.musicGain = ctx.createGain(); this.musicGain.connect(this.master);
    this.ambGain = ctx.createGain(); this.ambGain.connect(this.master);
    this.applyVolumes();
    this.startRain();
    try {
      await ctx.audioWorklet.addModule('js/keyer-worklet.js');
      this.keyer = new AudioWorkletNode(ctx, 'cw-keyer', {
        numberOfInputs: 0, outputChannelCount: [2], processorOptions: { wasm: this.core.bytes },
      });
      this.keyer.connect(this.cwGain);
      this.keyer.port.onmessage = (e) => this.onKeyer(e.data);
      this.configKeyer();
    } catch (err) {
      console.error('keyer worklet failed', err);
      this.keyerError = String(err);
    }
  }

  /**
   * Call from every user gesture. iOS (Safari and Chrome, both WebKit) only
   * unlocks Web Audio on a finished tap, and can later leave the context
   * 'suspended' or 'interrupted' (a call, Siri, the app in the background).
   * Music plays through an <audio> element and can keep going meanwhile,
   * which hides the problem: the CW buffers and sound effects go silent.
   */
  unlock() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (!this.unlocked) {
      // A one-sample silent buffer started inside the gesture is the
      // classic iOS unlock.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
      src.onended = () => { if (ctx.state === 'running') this.unlocked = true; };
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings();
    const t = this.ctx.currentTime;
    this.cwGain.gain.setTargetAtTime(s.cwVol, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(s.sfxVol * 0.6, t, 0.02);
    this.ambGain.gain.setTargetAtTime(s.rainVol * 0.08, t, 0.2);
    this.musicGain.gain.setTargetAtTime(this.cwPlaying > 0 ? s.musicVol * 0.12 : s.musicVol * 0.5, t, 0.25);
  }

  configKeyer() {
    const s = this.settings();
    this.keyer?.port.postMessage({ t: 'cfg', wpm: s.keyerWpm, freq: s.tone, modeB: s.modeB, vol: 0.45 });
  }

  onKeyer(d) {
    if (d.t === 'sync') { this.keyerOffset = d.offset; this.keyerSr = d.sr; }
    else if (d.t === 'tick') { this.tickFrame = d.frame; this.tickAt = performance.now(); return; }
    for (const f of this.keyerListeners) f(d);
  }

  /** Keyer-clock milliseconds now (same clock as element events). */
  keyerNowMs() {
    // Last keyer heartbeat plus time since it arrived. Delivery delay can
    // only make this read late (a letter closes a touch later), never early.
    if (this.tickFrame == null) return 0;
    return (this.tickFrame / this.keyerSr) * 1000 + Math.min(performance.now() - this.tickAt, 100);
  }

  paddles(dit, dah) { this.keyer?.port.postMessage({ t: 'pad', dit, dah }); }
  straight(down) { this.keyer?.port.postMessage({ t: 'str', down }); }
  releaseKeys() { this.keyer?.port.postMessage({ t: 'rel' }); }

  // ---- CW playback ---------------------------------------------------------

  stopCW() {
    if (this.cwSrc) { try { this.cwSrc.stop(); } catch { /* already stopped */ } this.cwSrc = null; }
  }

  /** Play rendered CW now. Returns { t0, end } in AudioContext seconds. */
  playCW(r, delay = 0.04) {
    this.stopCW();
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, r.samples.length, r.sr);
    b.copyToChannel(r.samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(this.cwGain);
    const t0 = ctx.currentTime + delay;
    src.start(t0);
    this.cwSrc = src;
    this.cwPlaying++;
    this.applyVolumes();
    src.onended = () => { this.cwPlaying--; this.applyVolumes(); };
    return { t0, end: t0 + r.duration };
  }

  /** Render and play text with the current settings. */
  say(text, o = {}) {
    const s = this.settings();
    const r = this.core.render(text, {
      sr: this.sr, charWpm: o.charWpm ?? s.charWpm, effWpm: o.effWpm ?? s.effWpm, freq: o.freq ?? s.tone,
      noise: o.noise ?? 0, qsb: o.qsb ?? 0, qrm: o.qrm ?? 0, seed: o.seed,
    });
    const p = this.playCW(r, o.delay);
    return { ...p, r };
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  // ---- music ---------------------------------------------------------------

  music(name) {
    if (!this.ctx || this.musicName === name) return;
    this.musicName = name;
    // Never pause a track: fade it to silence and leave it playing. On iOS,
    // pausing the last playing <audio> element releases the page's audio
    // session and Web Audio goes silent with it (CW, rain, effects), while
    // the context still reports 'running'. Seen live 2026-11-01: INTERCEPT
    // went quiet 2.5 s in, exactly when the old code paused the hub music.
    this.tracks ||= {};
    for (const [n, el] of Object.entries(this.tracks)) {
      if (n !== name) el._gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
    }
    if (!name) return;
    let el = this.tracks[name];
    if (!el) {
      el = new window.Audio(`assets/audio/${name}.mp3`);
      el.loop = true;
      el.crossOrigin = 'anonymous';
      const g = this.ctx.createGain();
      g.gain.value = 0;
      this.ctx.createMediaElementSource(el).connect(g).connect(this.musicGain);
      el._gain = g;
      this.tracks[name] = el;
    }
    if (el.paused) el.play().catch(() => {});
    el._gain.gain.setTargetAtTime(1, this.ctx.currentTime, 1.2);
    this.musicEl = el;
  }

  // ---- ambience and effects ---------------------------------------------

  noiseBuffer(sec = 2) {
    const n = Math.floor(this.sr * sec);
    const b = this.ctx.createBuffer(1, n, this.sr);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = 0.97 * last + 0.03 * (Math.random() * 2 - 1); d[i] = last * 6; }
    return b;
  }

  startRain() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(3);
    src.loop = true;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
    src.connect(hp).connect(lp).connect(this.ambGain);
    src.start();
  }

  thunder() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.4 + Math.random() * 1.2;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(3);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.4, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
    src.connect(lp).connect(g).connect(this.ambGain);
    src.start(t);
    src.stop(t + 3);
  }

  tone(freq, dur, o = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (o.at || 0);
    const osc = this.ctx.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.vol ?? 0.25, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  sfx(name) {
    switch (name) {
      case 'click': this.tone(1800, 0.03, { vol: 0.12 }); break;
      case 'hover': this.tone(2400, 0.015, { vol: 0.05 }); break;
      case 'ok':
        this.tone(880, 0.07, { vol: 0.16, type: 'triangle' });
        this.tone(1320, 0.1, { vol: 0.16, type: 'triangle', at: 0.05 });
        break;
      case 'combo':
        [880, 1108, 1320, 1760].forEach((f, i) => this.tone(f, 0.09, { vol: 0.13, type: 'triangle', at: i * 0.04 }));
        break;
      case 'bad': {
        this.tone(140, 0.28, { vol: 0.3, type: 'sawtooth', to: 70 });
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer(0.25);
        const g = this.ctx.createGain(); g.gain.value = 0.25;
        src.connect(g).connect(this.sfxGain); src.start();
        break;
      }
      case 'alarm':
        this.tone(660, 0.12, { vol: 0.2, type: 'square' });
        this.tone(440, 0.12, { vol: 0.2, type: 'square', at: 0.14 });
        break;
      case 'unlock':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, { vol: 0.15, type: 'triangle', at: i * 0.09 }));
        break;
      case 'whoosh': this.tone(200, 0.35, { vol: 0.12, type: 'sawtooth', to: 1800 }); break;
      case 'type': this.tone(900 + Math.random() * 300, 0.02, { vol: 0.05 }); break;
      case 'win':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, { vol: 0.16, type: 'triangle', at: i * 0.12 }));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.4, { vol: 0.18, type: 'sawtooth', at: i * 0.16 }));
        break;
    }
  }
}
