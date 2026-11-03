// PILEUP: two or three stations at once on different pitches and speeds.
// Copy the one on your pitch (the marker on the waterfall); the others are
// there to pull your ear away. Type it, Enter. A miss waits for Enter.

import { C, FONT } from '../gfx.js';
import { backdrop, meter, drawPattern } from './common.js';
import { CW_WORDS, WORDS, MORSE, canSay, rand, callsign } from '../content.js';

const ROUNDS = 10;
const F_LO = 300, F_HI = 1100;

export class Pileup {
  constructor(game) {
    this.game = game;
    const p = game.store.p;
    this.set = new Set(game.core.koch.slice(0, p.unlocked));
    this.pool = [...new Set([...CW_WORDS, ...WORDS])].filter((w) => w.length >= 2 && w.length <= 5 && canSay(w, this.set));
    this.round = -1;
    this.typed = '';
    this.results = [];
    this.score = 0;
    this.state = 'intro';
    this.t = 0;
    this.startedAt = performance.now();
    this.fall = document.createElement('canvas');
    this.fall.width = 400;
    this.fall.height = 160;
  }

  enter() {
    this.game.audio.music(null);
    this.game.wantText(true);
  }

  exit() { this.game.wantText(false); }

  /** Something to send: a real-looking call once he has the letters, else words or groups. */
  copyText() {
    for (let i = 0; i < 40; i++) { const c = callsign(); if (canSay(c, this.set)) return c; }
    if (this.pool.length >= 4 && Math.random() < 0.7) return rand(this.pool);
    const L = [...this.set];
    let s = '';
    for (let i = 0; i < 3; i++) s += rand(L);
    return s;
  }

  nextRound() {
    this.round++;
    this.typed = '';
    if (this.round >= ROUNDS) { this.finish(false); return; }
    const game = this.game, st = game.store.p.settings, eff = game.store.p.effWpm;
    const T = st.tone;
    const n = this.round < 3 ? 2 : 3;
    // Rivals get louder as the rounds go on.
    const rivalGain = 0.5 + 0.45 * (this.round / (ROUNDS - 1));
    const offsets = [-260, -190, -130, 130, 190, 260].sort(() => Math.random() - 0.5);
    const stations = [{ text: this.copyText(), freq: T, gain: 1, char: st.charWpm, eff, start: 0.3 + Math.random() * 0.6, you: true }];
    for (let k = 1; k < n; k++) {
      let text = this.copyText();
      if (text === stations[0].text) text = this.copyText();
      const char = Math.max(12, Math.min(28, st.charWpm + Math.round((Math.random() - 0.5) * 8)));
      stations.push({
        text, freq: Math.max(F_LO + 40, Math.min(F_HI - 40, T + offsets[k - 1])), gain: rivalGain * (0.85 + Math.random() * 0.3),
        char, eff: Math.max(5, Math.min(char, eff + Math.round((Math.random() - 0.5) * 6))), start: Math.random() * 1.1,
      });
    }
    // Render each station and mix them into one buffer with light band noise.
    const sr = game.audio.sr;
    let len = 0;
    for (const s of stations) {
      s.r = game.core.render(s.text, { sr, charWpm: s.char, effWpm: s.eff, freq: s.freq });
      len = Math.max(len, Math.ceil((s.start + s.r.duration) * sr));
    }
    len += Math.ceil(0.3 * sr);
    const mix = new Float32Array(len);
    for (const s of stations) {
      const off = Math.floor(s.start * sr);
      const a = s.r.samples;
      for (let i = 0; i < a.length; i++) mix[off + i] += a[i] * s.gain * 0.55;
    }
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += 0.08 * ((Math.random() * 2 - 1) - lp); mix[i] += lp * 0.12; }
    this.mix = { samples: mix, sr, duration: len / sr };
    this.stations = stations;
    this.cur = { w: stations[0].text, replayed: false };
    this.play();
    this.state = 'listen';
  }

  /** Reference beep on his pitch, then the whole pileup. */
  play() {
    const game = this.game, T = game.store.p.settings.tone;
    game.audio.tone(T, 0.3, { vol: 0.1, type: 'sine' });
    const p = game.audio.playCW(this.mix, 0.6);
    this.cur.t0 = p.t0;
    this.cur.end = p.end;
    this.cur.window = 8 + this.cur.w.length * 0.7;
  }

  /** The station he should have copied, alone. */
  solo() {
    const game = this.game, s = this.stations[0];
    const p = game.audio.say(s.text, { effWpm: s.eff });
    this.soloAt = { t0: p.t0, chars: p.r.chars };
  }

  submit() {
    const game = this.game, g = game.gfx, cur = this.cur;
    const ok = this.typed.trim() === cur.w;
    const late = Math.max(0, game.audio.now() - cur.end);
    this.results.push({ w: cur.w, typed: this.typed, ok });
    if (ok) {
      const pts = Math.round((100 * cur.w.length * this.stations.length / 2 + Math.max(0, 300 - late * 50)) * (cur.replayed ? 0.5 : 1));
      this.score += pts;
      game.audio.sfx(this.stations.length > 2 ? 'combo' : 'ok');
      game.particles.burst(g.W / 2, g.H * 0.3, C.green, 50, 340);
      g.flash(0.1);
    } else {
      game.audio.sfx('bad');
      g.glitch(0.8);
      game.audio.stopCW();
      setTimeout(() => { if (game.scene === this && this.verdict && !this.verdict.ok) this.solo(); }, 500);
    }
    this.verdict = { ok, w: cur.w, typed: this.typed, t: ok ? 1.0 : Infinity, age: 0 };
    this.state = 'verdict';
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const r = this.results;
    this.game.go('results', {
      mission: 'pileup', aborted, total: r.length, correct: r.filter((x) => x.ok).length,
      score: this.score, seconds: (performance.now() - this.startedAt) / 1000,
    });
  }

  onKey(e, down) {
    if (!down) return false;
    const game = this.game;
    if (e.key === 'Escape') { this.finish(true); return true; }
    if (this.state === 'intro') { if (e.key === 'Enter' || e.key === ' ') this.nextRound(); return true; }
    if (this.state === 'verdict') {
      if (e.key === 'Enter' && this.verdict.age > 0.4) this.verdict.t = 0;
      else if (e.key === ' ' && !this.verdict.ok) this.solo();
      else if ((e.key === 'p' || e.key === 'P') && !this.verdict.ok) this.play();
      return true;
    }
    if (this.state !== 'listen') return e.key.length === 1;
    if (e.key === 'Enter') { if (this.typed) this.submit(); return true; }
    if (e.key === 'Backspace') { this.typed = this.typed.slice(0, -1); return true; }
    if (e.key === 'Tab') {
      if (!this.cur.replayed) { this.cur.replayed = true; this.play(); }
      return true;
    }
    if (e.key.length === 1 && /[a-z0-9.,?/= ]/i.test(e.key) && this.typed.length < 12) {
      this.typed += e.key.toUpperCase();
      game.audio.sfx('type');
      return true;
    }
    return false;
  }

  update(dt) {
    this.t += dt;
    if (this.state === 'listen') {
      const left = this.cur.end + this.cur.window - this.game.audio.now();
      if (left <= 0) this.submit();
    }
    if (this.state === 'verdict') {
      this.verdict.age += dt;
      this.verdict.t -= dt;
      if (this.verdict.t <= 0) { this.soloAt = null; this.nextRound(); }
    }
    this.scrollFall();
  }

  /** Waterfall: one new row per frame, a bright trace where a station is keyed. */
  scrollFall() {
    const c = this.fall.getContext('2d'), W = this.fall.width, H = this.fall.height;
    c.drawImage(this.fall, 0, 0, W, H - 2, 0, 2, W, H - 2);
    c.fillStyle = '#05040d';
    c.fillRect(0, 0, W, 2);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(60,90,160,${Math.random() * 0.25})`;
      c.fillRect(Math.random() * W, 0, 2, 2);
    }
    if (!this.stations || !this.cur?.t0) return;
    const now = this.game.audio.now() - this.cur.t0;
    for (const s of this.stations) {
      const x = ((s.freq - F_LO) / (F_HI - F_LO)) * W;
      const lt = now - s.start;
      const on = s.r.marks.some(([a, b]) => lt >= a && lt <= b);
      if (!on) continue;
      c.fillStyle = s.you ? '#3cff9a' : `rgba(255,190,80,${0.5 + 0.5 * s.gain})`;
      c.shadowColor = c.fillStyle;
      c.shadowBlur = 8;
      c.fillRect(x - 3, 0, 6, 2);
      c.shadowBlur = 0;
    }
  }

  draw(g) {
    const game = this.game;
    backdrop(game, 'scene-07-overlook', { dark: 0.6, rainAlpha: 0.2 });
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text('PILEUP', 22, 32, { size: 38, color: C.amber, spacing: 3 });
    const n = this.stations?.length || 2;
    g.text(`${Math.max(1, Math.min(this.round + 1, ROUNDS))}/${ROUNDS}  //  ${n} STATIONS  //  COPY THE ONE ON YOUR PITCH`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    g.text(String(this.score).padStart(6, '0'), g.W - 22, 32, { size: 40, color: C.amber, align: 'right' });

    const cx = g.W / 2;
    // Waterfall with the marker on his pitch.
    const fw = Math.min(760, g.W - 40), fh = g.portrait ? 260 : 210;
    const fx = cx - fw / 2, fy = 100;
    g.panel(fx - 6, fy - 6, fw + 12, fh + 40, { color: C.cyan, fillAlpha: 0.9 });
    g.ctx.save();
    g.ctx.imageSmoothingEnabled = false;
    g.ctx.drawImage(this.fall, fx, fy, fw, fh);
    g.ctx.restore();
    const T = game.store.p.settings.tone;
    const mx = fx + ((T - F_LO) / (F_HI - F_LO)) * fw;
    g.rect(mx - 1, fy, 2, fh, C.green, 0.35);
    g.text('YOUR PITCH', mx, fy + fh + 22, { size: 14, font: FONT.ui, color: C.green, align: 'center' });
    g.text(`${F_LO} HZ`, fx + 4, fy + fh + 22, { size: 12, font: FONT.ui, color: C.grey, glow: 0 });
    g.text(`${F_HI} HZ`, fx + fw - 4, fy + fh + 22, { size: 12, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });

    const cy = fy + fh + 110;
    if (this.state === 'intro') {
      g.text('THE BAND IS CROWDED', cx, cy, { size: 48, color: C.amber, align: 'center', spacing: 3 });
      const lines = ['A beep on your pitch plays first. Lock onto it and ignore the rest.',
        'TYPE WHAT YOUR STATION SENT, THEN ENTER  //  TAB: HEAR AGAIN (HALF POINTS)  //  ESC: QUIT'];
      g.text(lines[0], cx, cy + 44, { size: 18, font: FONT.ui, color: C.white, align: 'center' });
      g.text(lines[1], cx, cy + 76, { size: 14, font: FONT.ui, color: C.grey, align: 'center' });
      if (game.button('go', cx - 160, cy + 100, 320, 50, 'START [ENTER]', { size: 26, color: C.amber })) this.nextRound();
      return;
    }
    if (this.state === 'listen') {
      const playing = game.audio.cwPlaying > 0;
      const bw = Math.min(640, g.W - 40);
      g.panel(cx - bw / 2, cy - 60, bw, 120, { color: playing ? C.amber : C.cyan, fillAlpha: 0.85 });
      const blink = Math.sin(g.time * 8) > 0 ? '_' : ' ';
      g.text(this.typed ? this.typed + blink : (playing ? 'RECEIVING...' : '_'), cx, cy, { size: 72, color: this.typed ? C.white : C.grey, align: 'center', spacing: 8 });
      const left = Math.max(0, this.cur.end + this.cur.window - game.audio.now());
      meter(g, cx - bw / 2, cy + 74, bw, 6, left / this.cur.window, left < 2 ? C.red : C.cyan);
      const hb = Math.min(300, (bw - 12) / 2);
      if (game.button('pile-again', cx - hb - 6, cy + 92, hb, 44, this.cur.replayed ? 'HEARD AGAIN' : 'HEAR AGAIN [TAB]', { size: 20, color: C.cyan, disabled: this.cur.replayed })) { this.cur.replayed = true; this.play(); }
      if (game.button('pile-send', cx + 6, cy + 92, hb, 44, 'SEND [ENTER]', { size: 20, color: C.amber, disabled: !this.typed })) this.submit();
    }
    if (this.state === 'verdict') {
      const v = this.verdict;
      g.text(v.w, cx, cy - 10, { size: 84, color: v.ok ? C.green : C.red, align: 'center', glow: 30, spacing: 8 });
      if (!v.ok) {
        g.text(`YOU TYPED ${v.typed || '(NOTHING)'}`, cx, cy + 46, { size: 22, color: C.red, align: 'center' });
        // His station alone, letter by letter.
        const now = game.audio.now();
        let lit = -1;
        if (this.soloAt) this.soloAt.chars.forEach((c, i) => { if (now - this.soloAt.t0 >= c.start) lit = i; });
        if (game.audio.cwPlaying === 0) lit = -1;
        const letters = v.w.split('');
        const slot = Math.min(130, (g.W - 40) / letters.length);
        const unit = Math.max(4, Math.min(9, slot / 14));
        letters.forEach((ch, i) => {
          const x = cx + (i - (letters.length - 1) / 2) * slot;
          const col = i === lit ? C.white : C.cyan;
          g.text(ch, x, cy + 92, { size: 30, color: col, align: 'center' });
          if (MORSE[ch]) drawPattern(g, MORSE[ch], x, cy + 122, unit, col);
        });
        const by = cy + 150, bw = Math.min(220, (g.W - 80) / 3);
        if (game.button('solo', cx - bw * 1.5 - 12, by, bw, 44, 'SOLO [SPACE]', { size: 20, color: C.cyan })) this.solo();
        if (game.button('pile', cx - bw / 2, by, bw, 44, 'PILEUP [P]', { size: 20, color: C.amber })) this.play();
        if (game.button('next', cx + bw / 2 + 12, by, bw, 44, 'NEXT [ENTER]', { size: 20, color: C.green })) v.t = 0;
      }
    }
  }
}
