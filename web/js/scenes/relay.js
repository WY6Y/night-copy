// RELAY: send to Vera. Paddle (guarded), keyboard or touch keying through
// the Rust iambic keyer; the Rust decoder reads it back and grades spacing.
// Two more modes share all of it:
//   blind: only the character is shown; no demo, no pattern, sent from memory.
//   echo:  the target is only heard; key back what you heard.

import { C, FONT } from '../gfx.js';
import { backdrop, meter, drawPattern } from './common.js';
import { CW_WORDS, WORDS, MORSE, canSay, rand, sayPattern } from '../content.js';
import { myCall } from '../store.js';

const TRIES = 3;
const SCOPE_MS = 6000;

export class Relay {
  constructor(game, args = {}) {
    this.game = game;
    const p = game.store.p;
    this.letters = game.core.koch.slice(0, p.unlocked);
    this.set = new Set(this.letters);
    this.mode = args.mode || 'relay';
    this.targets = args.targets || (this.mode === 'relay' ? this.makeTargets() : this.modeTargets());
    this.i = -1;
    this.decoded = '';
    this.marks = [];          // [startMs, endMs|null] on the keyer clock
    this.gaps = [];
    this.results = [];
    this.tries = 0;
    this.lastActivity = 0;
    this.args = args;
    this.vera = args.vera || {
      relay: 'Authenticate, NightOp. Send your call.',
      blind: 'Faux is on this channel. I can\'t send it in the clear. Send me what you see.',
      echo: 'I send it, you send it back. No paper. Just ears and hands.',
    }[this.mode];
    this.reveal = null;
    this.state = 'ready';
    this.t = 0;
    this.ignoredFlash = 0;
    this.startedAt = performance.now();
    this.touch = { dit: false, dah: false };
    this.kb = { dit: false, dah: false };
  }

  makeTargets() {
    const p = this.game.store.p;
    const weak = (p.weak || []).filter((c) => this.set.has(c));
    const pickLetter = () => (weak.length && Math.random() < 0.5 ? rand(weak) : rand(this.letters));
    const words = [...new Set([...CW_WORDS, ...WORDS])].filter((w) => w.length >= 2 && w.length <= 5 && canSay(w, this.set));
    const t = [myCall(p.settings)];
    for (let i = 0; i < 3; i++) t.push(pickLetter());
    for (let i = 0; i < 2; i++) t.push(pickLetter() + pickLetter() + (this.letters.length > 4 ? pickLetter() : ''));
    for (let i = 0; i < 2; i++) t.push(words.length ? rand(words) : pickLetter() + pickLetter());
    return t;
  }

  get maxTries() { return this.mode === 'relay' ? TRIES : 2; }

  /** Blind and echo: letters first, then pairs and short words, leaning on weak ones. */
  modeTargets() {
    const store = this.game.store;
    const L = this.letters;
    // Blind leans on letters he sends badly; echo on letters he hears badly.
    const weight = (c) => (this.mode === 'blind'
      ? 1 + 3 * (1 - store.sendAcc(c)) + (store.topSendMix(5).some((m) => m.want === c) ? 2 : 0)
      : 1 + 4 * (1 - (store.p.stats[c]?.acc ?? 0.5)));
    const pick = (last) => {
      let tot = 0;
      const w = L.map((c) => { const v = c === last ? 0.2 : weight(c); tot += v; return v; });
      let r = Math.random() * tot;
      for (let i = 0; i < L.length; i++) { r -= w[i]; if (r <= 0) return L[i]; }
      return L[L.length - 1];
    };
    const t = [];
    let last = null;
    for (let i = 0; i < 6; i++) { last = pick(last); t.push(last); }
    for (let i = 0; i < 2; i++) t.push(pick() + pick());
    const words = [...new Set([...CW_WORDS, ...WORDS])].filter((w) => w.length >= 2 && w.length <= 4 && canSay(w, this.set));
    for (let i = 0; i < 2; i++) t.push(words.length ? rand(words) : pick() + pick() + pick());
    return t;
  }

  enter() {
    const game = this.game;
    game.audio.music(null);
    game.audio.configKeyer();
    this.resetDecoder();
    const onKeyer = (d) => this.keyerMsg(d);
    game.audio.keyerListeners.add(onKeyer);
    this.unsub = () => game.audio.keyerListeners.delete(onKeyer);
    this.unpad = game.paddle.on((type, data) => {
      if (type === 'lever' && (data.dit || data.dah) && !game.paddle.paddleAllowed()) this.ignoredFlash = 1.2;
    });
    game.paddle.arm(true);
    this.nextTarget();
  }

  exit() {
    this.unsub?.();
    this.unpad?.();
    this.game.paddle.setKeys(false, false);
    this.game.audio.releaseKeys();
    this.game.paddle.arm(false);
  }

  resetDecoder() {
    const s = this.game.store.p.settings;
    this.game.core.decReset(1200 / s.keyerWpm);
  }

  keyerMsg(d) {
    const sr = this.game.audio.keyerSr || 48000;
    if (d.t === 'ev') {
      for (let k = 0; k < d.ev.length; k += 3) {
        this.game.core.decElement(d.ev[k], (d.ev[k + 1] / sr) * 1000, (d.ev[k + 2] / sr) * 1000);
      }
      this.lastActivity = this.game.audio.keyerNowMs();
    } else if (d.t === 'key') {
      const ms = (d.frame / sr) * 1000;
      // A held element isn't silence: keep the decoder from closing the letter.
      this.keyDown = !!d.down;
      this.game.core.decKey(this.keyDown);
      if (d.down) { this.marks.push([ms, null]); if (this.state === 'send') this.reveal = null; }
      else if (this.marks.length && this.marks[this.marks.length - 1][1] == null) this.marks[this.marks.length - 1][1] = ms;
      this.lastActivity = ms;
    }
  }

  get target() { return this.targets[this.i]; }

  nextTarget() {
    this.i++;
    this.tries = 0;
    this.decoded = '';
    this.resetDecoder();
    if (this.i >= this.targets.length) { this.finish(false); return; }
    this.reveal = null;
    if (this.mode === 'blind') {
      if (this.i > 0) this.vera = rand(['Next. From memory.', 'Again. No help this time.', 'Send it like you mean it.', 'He is listening. Keep it clean.']);
      this.showPattern = false;
      this.state = 'send';
      this.demoAt = null;
      return;
    }
    if (this.mode === 'echo') {
      if (this.i > 0) this.vera = rand(['Next one. Listen.', 'Here it comes.', 'Ears on. Send it back.', 'Copy, then key it.']);
      this.showPattern = false;
      this.state = 'send';
      this.demoAt = 0.7;
      return;
    }
    if (this.i > 0 && !this.args.targets) {
      this.vera = rand(['Next one. Send me', 'Copy that. Now send', 'Good. Give me', 'Keep it steady. Send']) + ` ${this.target}.`;
    }
    // Teach before asking: show the pattern for any letter he has rarely sent,
    // and have Vera send the target first so he hears what to copy back.
    const p = this.game.store.p;
    const fresh = [...this.target.replace(/ /g, '')].filter((ch) => (p.sendStats[ch]?.ok || 0) < 3 && MORSE[ch]);
    this.showPattern = fresh.length > 0;
    if (fresh.length === 1 && this.target.length === 1) this.vera += ` It goes ${sayPattern(fresh[0])}.`;
    else if (fresh.length) this.vera += ' Patterns are on screen. Listen first.';
    this.state = 'send';
    this.demoAt = 0.7;
  }

  evaluate() {
    const game = this.game, g = game.gfx;
    const want = this.target.replace(/ /g, '');
    const got = this.decoded.replace(/ /g, '');
    const ok = got === want;
    for (const ch of want) game.store.recordSend(ch, ok);
    if (!ok && this.mode !== 'relay' && got.length === want.length) {
      for (let k = 0; k < want.length; k++) game.store.recordSendMix(want[k], got[k]);
    }
    if (ok) {
      this.results.push({ target: this.target, ok: true, tries: this.tries + 1 });
      game.audio.sfx('ok');
      game.particles.burst(g.W / 2, g.H * 0.3, C.green, 50, 340);
      g.flash(0.1);
      this.vera = this.i === 0 ? 'That is your fist. I would know it anywhere.' : rand(['Copy. Clean.', 'Got it. Nice spacing.', 'Solid copy.', 'Loud and clear.']);
      this.state = 'good';
      this.wait = 1.1;
    } else {
      this.tries++;
      game.audio.sfx('bad');
      g.glitch(0.6);
      if (this.mode !== 'relay') this.reveal = { want, got };
      if (this.tries >= this.maxTries) {
        this.results.push({ target: this.target, ok: false, tries: this.tries });
        this.vera = this.mode === 'relay' ? `I kept getting ${got || 'nothing'}. Listen to how ${this.target} should sound.`
          : `It was ${this.target}. You sent ${got || 'nothing'}. Hear the difference.`;
        this.compare(want, got);
        this.state = this.mode === 'relay' ? 'good' : 'review';
        this.wait = 2.6;
      } else if (this.mode === 'blind') {
        // One more try, still blind. The comparison stays up until he keys.
        this.vera = `I copied ${got || 'nothing'}. Not it. One more, from memory.`;
        this.decoded = '';
        this.resetDecoder();
      } else if (this.mode === 'echo') {
        this.vera = `I copied ${got || 'nothing'}. Listen again.`;
        this.decoded = '';
        this.resetDecoder();
        this.demoAt = 0.9;
      } else {
        const gap = this.gaps.length && Math.max(...this.gaps.slice(-4)) > 6 ? ' Tighten the gaps.' : '';
        this.vera = `I copied ${got || 'nothing'}. Listen again.${gap}`;
        this.decoded = '';
        this.resetDecoder();
        this.showPattern = true;
        this.demoAt = 0.9;
      }
    }
  }

  /** Play the right answer, then what he sent, so he hears the difference. */
  compare(want, got) {
    const game = this.game, s = game.store.p.settings;
    const a = game.audio.say(want, { effWpm: s.charWpm, delay: 0.3 });
    if (got && got !== want) {
      const gap = (a.end - game.audio.now()) * 1000 + 700;
      setTimeout(() => { if (game.scene === this) game.audio.say(got, { effWpm: s.charWpm, freq: s.tone * 0.8 }); }, gap);
    }
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const r = this.results;
    const clean = this.gaps.filter((x) => x >= 2.2 && x <= 4.8).length;
    if (this.args.then) { this.args.then({ aborted, ok: r.length > 0 && r.every((x) => x.ok), results: r }); return; }
    this.game.go('results', {
      mission: this.mode, aborted, total: r.length, correct: r.filter((x) => x.ok).length,
      score: r.filter((x) => x.ok).reduce((s, x) => s + (x.tries === 1 ? 300 : 150), 0),
      timing: this.gaps.length ? clean / this.gaps.length : null,
      seconds: (performance.now() - this.startedAt) / 1000,
    });
  }

  // ---- input ---------------------------------------------------------------

  applyKeys() {
    this.game.paddle.setKeys(this.kb.dit || this.touch.dit, this.kb.dah || this.touch.dah);
  }

  onKey(e, down) {
    const game = this.game;
    const k = e.key;
    if (down && k === 'Escape') { this.finish(true); return true; }
    if (k === 'z' || k === 'Z' || k === '[') { if (!e.repeat) { this.kb.dit = down; this.applyKeys(); } return true; }
    if (k === 'x' || k === 'X' || k === ']') { if (!e.repeat) { this.kb.dah = down; this.applyKeys(); } return true; }
    if (k === ' ') { if (!e.repeat) game.paddle.straight(down); return true; }
    if (!down) return false;
    if (this.state === 'review') {
      if (k === 'Enter') { this.nextTarget(); return true; }
      if (k === 'h' || k === 'H') { this.compare(this.reveal.want, this.reveal.got); return true; }
      return false;
    }
    if (k === 'h' || k === 'H') { if (this.mode !== 'blind') this.hear(); return true; }
    if (k === 's' || k === 'S') { if (this.mode === 'relay') this.showPattern = !this.showPattern; return true; }
    if (k === '-' || k === '+' || k === '=') {
      const s = game.store.p.settings;
      s.keyerWpm = Math.max(8, Math.min(30, s.keyerWpm + (k === '-' ? -1 : 1)));
      game.audio.configKeyer();
      this.resetDecoder();
      game.store.save();
      return true;
    }
    if (k === 'Backspace') { this.decoded = ''; this.resetDecoder(); return true; }
    return false;
  }

  onBlur() { this.kb = { dit: false, dah: false }; this.touch = { dit: false, dah: false }; this.applyKeys(); }

  pads() {
    const g = this.game.gfx;
    const h = g.portrait ? 200 : 110, w = g.portrait ? (g.W - 60) / 2 : 220;
    const y = g.H - h - 40;
    return { dit: { x: g.W / 2 - w - 10, y, w, h }, dah: { x: g.W / 2 + 10, y, w, h } };
  }

  onPointer(x, y, down) {
    const p = this.pads();
    const inside = (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (down) {
      if (inside(p.dit)) this.touch.dit = true;
      if (inside(p.dah)) this.touch.dah = true;
    } else {
      this.touch = { dit: false, dah: false };
    }
    this.applyKeys();
  }

  hear() {
    const game = this.game;
    if (this.target) game.audio.say(this.target, { effWpm: game.store.p.settings.charWpm });
  }

  update(dt) {
    const game = this.game, core = game.core;
    this.t += dt;
    this.ignoredFlash = Math.max(0, this.ignoredFlash - dt);
    if (this.demoAt != null) {
      this.demoAt -= dt;
      if (this.demoAt <= 0) { this.demoAt = null; this.hear(); }
    }
    core.decPoll(game.audio.keyerNowMs());
    const txt = core.decTake();
    if (txt) { this.decoded += txt; game.audio.sfx('type'); }
    this.gaps.push(...core.decGaps());
    if (this.state === 'send' && this.target) {
      const want = this.target.replace(/ /g, '');
      const got = this.decoded.replace(/ /g, '');
      const quiet = game.audio.keyerNowMs() - this.lastActivity;
      if (!this.keyDown && (got.length >= want.length || (got.length && quiet > 1800))) {
        if (quiet > 250) this.evaluate();
      }
    }
    if (this.state === 'good') {
      this.wait -= dt;
      if (this.wait <= 0) this.nextTarget();
    }
    // Trim the scope history.
    const now = game.audio.keyerNowMs();
    while (this.marks.length && this.marks[0][1] != null && this.marks[0][1] < now - SCOPE_MS) this.marks.shift();
  }

  draw(g) {
    const game = this.game, c = g.ctx, pad = game.paddle;
    backdrop(game, 'bg-relay', { dark: 0.45, rainAlpha: 0.15, zoom: 1.04 });
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text(this.args.title || { relay: 'RELAY', blind: 'BLIND RELAY', echo: 'ECHO' }[this.mode], 22, 32, { size: 38, color: C.green, spacing: 3 });
    g.text(`${Math.min(this.i + 1, this.targets.length)}/${this.targets.length}  //  KEYER ${game.store.p.settings.keyerWpm} WPM (- / +)  //  MODE ${game.store.p.settings.modeB ? 'B' : 'A'}`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });

    // Vera's channel.
    const vw = g.portrait ? g.W - 40 : 520, vx = g.portrait ? 20 : g.W - vw - 24, vy = 96;
    g.panel(vx, vy, vw, 120, { color: C.cyan, fillAlpha: 0.85 });
    g.cover(game.art['vera-radio'], vx + 8, vy + 8, 90, 104, { panY: 0.25 });
    g.text('VERA', vx + 112, vy + 24, { size: 24, color: C.cyan, spacing: 2 });
    g.wrap(this.vera, vw - 130, 18).slice(0, 3).forEach((l, i) => g.text(l, vx + 112, vy + 52 + i * 22, { size: 18, font: FONT.ui, color: C.white, glow: 2 }));

    // How the target is sent: one row per letter, beside Vera's channel.
    if (this.showPattern && this.target) {
      const letters = [...this.target.replace(/ /g, '')].filter((ch) => MORSE[ch]);
      const rowH = 44, ph = 46 + letters.length * rowH;
      const py = vy + 132;
      const playing = game.audio.cwPlaying > 0;
      g.panel(vx, py, vw, ph, { color: C.amber, fillAlpha: 0.85 });
      g.text('HOW IT GOES', vx + 16, py + 22, { size: 20, color: C.amber, spacing: 3 });
      g.text(playing ? 'LISTEN...' : 'H: HEAR IT AGAIN', vx + vw - 16, py + 22, { size: 13, font: FONT.ui, color: playing ? C.white : C.grey, align: 'right', glow: 0 });
      letters.forEach((ch, k) => {
        const y = py + 58 + k * rowH;
        g.text(ch, vx + 40, y, { size: 40, color: C.amber, align: 'center' });
        drawPattern(g, MORSE[ch], vx + 60 + (vw - 60) / 2, y, 16, playing ? C.white : C.cyan);
        g.text(sayPattern(ch).toUpperCase(), vx + vw - 16, y + 16, { size: 11, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
      });
    }

    // Blind/echo miss: what was wanted against what he sent, element by element.
    if (this.reveal) {
      const { want, got } = this.reveal;
      const rows = [['WANTED', want, C.green], ['YOU SENT', got || '-', C.red]];
      const py = vy + 132, ph = 46 + rows.length * 58;
      g.panel(vx, py, vw, ph, { color: C.red, fillAlpha: 0.88 });
      g.text('WHAT WENT WRONG', vx + 16, py + 22, { size: 20, color: C.red, spacing: 3 });
      g.text(this.state === 'review' ? 'H: HEAR BOTH' : 'KEY TO TRY AGAIN', vx + vw - 16, py + 22, { size: 13, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
      rows.forEach(([label, txt, col], r) => {
        const y = py + 64 + r * 58;
        g.text(label, vx + 16, y - 18, { size: 12, font: FONT.ui, color: C.grey, glow: 0 });
        const chars = [...txt].filter((ch) => MORSE[ch] || ch === '-');
        const slot = Math.min(150, (vw - 32) / Math.max(1, chars.length));
        chars.forEach((ch, k) => {
          const x = vx + 16 + k * slot;
          const bad = r === 1 && ch !== want[k];
          g.text(ch, x + 14, y + 4, { size: 34, color: r === 1 ? (bad ? C.red : C.green) : col, align: 'center' });
          if (MORSE[ch]) drawPattern(g, MORSE[ch], x + 32 + (slot - 32) / 2, y + 4, Math.min(10, (slot - 40) / 12), r === 1 ? (bad ? C.red : C.green) : C.cyan);
        });
      });
    }

    // Target and what Vera copied.
    const cx = g.portrait ? g.W / 2 : g.W * 0.32, ty = g.portrait ? 290 : 200;
    const label = { relay: 'SEND', blind: 'SEND FROM MEMORY', echo: 'SEND WHAT YOU HEAR' }[this.mode];
    g.text(label, cx, ty - 40, { size: 18, font: FONT.ui, color: C.grey, align: 'center', spacing: 6, glow: 0 });
    const target = this.target || '';
    const hidden = this.mode === 'echo' && this.state === 'send';
    g.text(hidden ? target.replace(/\S/g, '?') : target, cx, ty + 20, { size: 110, color: this.state === 'good' ? C.green : C.amber, align: 'center', glow: 30, spacing: 10 });
    g.text('VERA COPIES', cx, ty + 104, { size: 16, font: FONT.ui, color: C.grey, align: 'center', spacing: 4, glow: 0 });
    const want = target.replace(/ /g, '');
    const got = this.decoded.replace(/ /g, '');
    const gw = g.measure(got || '_', 64, 'VT323', 8);
    let x = cx - gw / 2;
    if (!got) g.text(Math.sin(g.time * 6) > 0 ? '_' : ' ', cx, ty + 150, { size: 64, color: C.grey, align: 'center' });
    for (let i = 0; i < got.length; i++) {
      const col = got[i] === want[i] ? C.green : C.red;
      g.text(got[i], x, ty + 150, { size: 64, color: col, spacing: 8 });
      x += g.measure(got[i], 64, 'VT323', 8);
    }
    g.text(`TRY ${Math.min(this.tries + 1, this.maxTries)}/${this.maxTries}  //  BACKSPACE: CLEAR`, cx, ty + 196, { size: 14, font: FONT.ui, color: C.cyan, align: 'center', glow: 2 });
    if (this.state === 'review') {
      if (game.button('hear', cx - 210, ty + 214, 200, 38, 'HEAR BOTH [H]', { size: 22, color: C.cyan })) this.compare(this.reveal.want, this.reveal.got);
      if (game.button('next', cx + 10, ty + 214, 200, 38, 'NEXT [ENTER]', { size: 22, color: C.amber })) this.nextTarget();
    } else if (this.mode === 'relay') {
      if (game.button('hear', cx - 210, ty + 214, 200, 38, 'HEAR IT [H]', { size: 22, color: C.cyan })) this.hear();
      if (game.button('show', cx + 10, ty + 214, 200, 38, this.showPattern ? 'HIDE [S]' : 'SHOW ME [S]', { size: 22, color: C.amber })) this.showPattern = !this.showPattern;
    } else if (this.mode === 'echo') {
      if (game.button('hear', cx - 100, ty + 214, 200, 38, 'HEAR AGAIN [H]', { size: 22, color: C.cyan })) this.hear();
    } else {
      g.text('NO SOUND, NO PATTERN. YOUR SIDETONE ONLY.', cx, ty + 236, { size: 14, font: FONT.ui, color: C.amber, align: 'center', glow: 2 });
    }

    // Scope: the last six seconds of keying.
    const sx = 40, sw = g.W - 80, sy = g.portrait ? ty + 240 : g.H - 230, sh = 54;
    g.panel(sx, sy, sw, sh, { color: C.greenDim, fillAlpha: 0.85 });
    g.text('YOUR FIST', sx + 8, sy - 10, { size: 13, font: FONT.ui, color: C.greenDim, glow: 0 });
    const now = game.audio.keyerNowMs();
    c.save();
    c.beginPath(); c.rect(sx, sy, sw, sh); c.clip();
    c.shadowColor = C.green; c.shadowBlur = 12;
    c.fillStyle = C.green;
    for (const [a, b] of this.marks) {
      const e = b ?? now;
      const x0 = sx + sw - ((now - a) / SCOPE_MS) * sw;
      const x1 = sx + sw - ((now - e) / SCOPE_MS) * sw;
      c.fillRect(x0, sy + 12, Math.max(1, x1 - x0), sh - 24);
    }
    c.restore();
    const fe = this.gaps.length ? this.gaps.filter((v) => v >= 2.2 && v <= 4.8).length / this.gaps.length : 1;
    meter(g, sx + sw - 200, sy - 14, 200, 6, fe, fe > 0.8 ? C.green : C.amber, '');
    g.text('SPACING', sx + sw - 208, sy - 11, { size: 12, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });

    // Touch pads + key hints.
    const pd = this.pads();
    const down = game.audio.cwPlaying;
    for (const [k, r] of Object.entries(pd)) {
      const on = this.touch[k] || this.kb[k];
      g.panel(r.x, r.y, r.w, r.h, { color: on ? C.white : C.green, fillAlpha: on ? 0.9 : 0.55, glow: on ? 24 : 6 });
      g.text(k.toUpperCase(), r.x + r.w / 2, r.y + r.h / 2 - 8, { size: 40, color: C.green, align: 'center' });
      g.text(k === 'dit' ? 'Z or [' : 'X or ]', r.x + r.w / 2, r.y + r.h / 2 + 24, { size: 13, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });
    }
    void down;
    g.text('PADDLE, Z/X KEYS, OR TAP THE PADS  //  SPACE = STRAIGHT KEY  //  ESC: QUIT', g.W / 2, pd.dit.y - 16, { size: 13, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });

    // TX guard overlay: only when a real paddle is present.
    const hasPaddle = pad.state === 'ok' || pad.state === 'silent';
    if (hasPaddle && !pad.paddleAllowed()) {
      const v = pad.guard.verdict;
      const col = v === 'locked' ? C.red : C.amber;
      const bw = Math.min(760, g.W - 40), bh = v === 'unknown' ? 190 : 150;
      const bx = g.W / 2 - bw / 2, by = g.H * 0.36;
      g.panel(bx, by, bw, bh, { color: col, fillAlpha: 0.95, glow: 20 + 10 * Math.sin(g.time * 6) });
      g.text(v === 'locked' ? 'TX GUARD: PADDLE LOCKED' : v === 'safe' ? 'TX GUARD: CHECKING...' : 'RADIO STATE UNKNOWN', g.W / 2, by + 34, { size: 40, color: col, align: 'center', spacing: 3 });
      g.wrap(pad.guard.reason || '', bw - 40, 18).slice(0, 2).forEach((l, i) => g.text(l, g.W / 2, by + 72 + i * 22, { size: 18, font: FONT.ui, color: C.white, align: 'center' }));
      g.text(v === 'locked' ? 'Turn CW Break-in OFF in AetherSDR (or close it). Z/X keys still work.' : 'Paddle input is ignored until the Pi can see AetherSDR.', g.W / 2, by + 120, { size: 15, font: FONT.ui, color: col, align: 'center' });
      if (v === 'unknown' && game.button('confirm', g.W / 2 - 230, by + bh - 52, 460, 40, 'I CONFIRM BREAK-IN IS OFF', { size: 22, color: C.amber })) pad.confirmUnknown();
    }
    if (this.ignoredFlash > 0) g.text('PADDLE IGNORED: TX GUARD', g.W / 2, g.H * 0.3, { size: 30, color: C.red, align: 'center', alpha: Math.min(1, this.ignoredFlash) });
  }
}
