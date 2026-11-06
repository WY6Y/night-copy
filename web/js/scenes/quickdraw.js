// QUICK DRAW: a reaction duel on his slowest letters. Each round waits a
// random beat, plays one letter, and Faux's gunslinger draws when the window
// closes. Answer inside it to win the round. Every win shrinks the window,
// so counting dits stops being fast enough and the letter has to land whole.

import { C, FONT } from '../gfx.js';
import { backdrop, tiles, meter, accColor } from './common.js';
import { rand } from '../content.js';

const ROUNDS = 15;
const LIVES = 3;
const WINDOW_START = 1600; // ms after the letter ends
const WINDOW_MIN = 450;
const WINDOW_STEP = 80;

export class QuickDraw {
  constructor(game) {
    this.game = game;
    const p = game.store.p;
    this.letters = game.core.koch.slice(0, p.unlocked);
    this.targets = this.slowSet();
    this.window = WINDOW_START;
    this.lives = LIVES;
    this.round = 0;
    this.results = [];
    this.score = 0;
    this.streak = 0;
    this.state = 'intro';
    this.t = 0;
    this.startedAt = performance.now();
  }

  /** Letters weighted by how slowly (and how unreliably) he answers them. */
  slowSet() {
    const st = this.game.store.p.stats;
    const scored = this.letters.map((c) => {
      const s = st[c];
      const lat = s?.lat || 1200;
      return { c, w: (s?.seen || 0) < 3 ? 1 : Math.max(0.3, lat / 700) + 2 * (1 - (s.acc ?? 0.5)) };
    });
    return scored.sort((a, b) => b.w - a.w);
  }

  pick() {
    const top = this.targets.slice(0, Math.max(6, Math.ceil(this.targets.length / 3)));
    let tot = top.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * tot;
    for (const x of top) { r -= x.w; if (r <= 0 && x.c !== this.last) return x.c; }
    return rand(top.filter((x) => x.c !== this.last)).c;
  }

  get slowest() { return this.targets.slice(0, 6).map((x) => x.c); }

  enter() { this.game.audio.music(null); }

  onKey(e, down) {
    if (!down) return false;
    if (e.key === 'Escape') { this.finish(true); return true; }
    if (this.state === 'intro' && (e.key === 'Enter' || e.key === ' ')) { this.begin(); return true; }
    if (e.key.length === 1 && /^[a-z0-9.,?/=]$/i.test(e.key)) { this.answer(e.key.toUpperCase()); return true; }
    return false;
  }

  begin() {
    this.state = 'wait';
    this.t = 0;
    this.waitFor = 0.9 + Math.random() * 1.6;
  }

  draw_() {
    const ch = this.pick();
    this.last = ch;
    const s = this.game.audio.say(ch, { delay: 0.02 });
    this.cur = { ch, t0: s.t0, end: s.end, done: false };
    this.state = 'draw';
    this.round++;
  }

  answer(key) {
    const game = this.game;
    if (this.state === 'wait') {
      // Jumped the gun: nothing has played yet.
      this.lives--;
      this.streak = 0;
      this.verdict = { kind: 'early', t: 1.4 };
      game.audio.sfx('bad');
      game.gfx.shake(0.5);
      this.state = 'verdict';
      return;
    }
    if (this.state !== 'draw' || this.cur.done) return;
    const cur = this.cur;
    const now = game.audio.now();
    const lat = Math.max(0, (now - cur.end) * 1000);
    const ok = key === cur.ch;
    this.resolve(ok, ok ? lat : null, key);
  }

  resolve(ok, lat, typed) {
    const game = this.game, g = game.gfx, cur = this.cur;
    cur.done = true;
    const inTime = ok && lat <= this.window;
    game.store.record(cur.ch, ok, lat);
    if (!ok && typed) game.store.recordConfusion(cur.ch, typed);
    this.results.push({ ch: cur.ch, ok: inTime, lat, typed });
    if (inTime) {
      this.streak++;
      this.score += Math.round(100 + Math.max(0, this.window - lat) / 2) * (1 + Math.floor(this.streak / 3) * 0.5);
      this.window = Math.max(WINDOW_MIN, this.window - WINDOW_STEP);
      game.audio.sfx(this.streak % 3 === 0 ? 'combo' : 'ok');
      g.flash(0.25);
      game.particles.burst(g.W * 0.7, g.H * 0.42, C.amber, 50, 380);
      this.verdict = { kind: 'win', ch: cur.ch, lat, t: 1.0 };
    } else {
      this.lives--;
      this.streak = 0;
      this.window = Math.min(WINDOW_START, this.window + WINDOW_STEP);
      game.audio.sfx('bad');
      g.glitch(0.9);
      g.shake(0.7);
      this.verdict = { kind: ok ? 'late' : typed ? 'wrong' : 'slow', ch: cur.ch, typed, lat, t: 1.8 };
      // Hear the one that beat him, with the letter on screen.
      setTimeout(() => { if (this.game.scene === this) this.game.audio.say(cur.ch); }, 420);
    }
    this.state = 'verdict';
  }

  update(dt) {
    this.t += dt;
    const game = this.game;
    if (this.state === 'wait' && this.t > this.waitFor) this.draw_();
    if (this.state === 'draw' && !this.cur.done) {
      // Faux draws when the window closes.
      if ((game.audio.now() - this.cur.end) * 1000 > this.window) {
        game.audio.sfx('alarm');
        this.resolve(false, null, null);
      }
    }
    if (this.state === 'verdict') {
      this.verdict.t -= dt;
      if (this.verdict.t <= 0) {
        if (this.lives <= 0 || this.round >= ROUNDS) this.finish(false);
        else this.begin();
      }
    }
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const r = this.results;
    const lats = r.filter((x) => x.ok && x.lat != null).map((x) => x.lat);
    this.game.go('results', {
      mission: 'quickdraw', aborted, total: r.length, correct: r.filter((x) => x.ok).length,
      score: Math.round(this.score), avgLat: lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0,
      headline: !aborted && this.lives <= 0 ? ['OUTDRAWN', C.red] : null,
      seconds: (performance.now() - this.startedAt) / 1000,
      perChar: r.map((x) => ({ ch: x.ch, ok: x.ok })),
    });
  }

  draw(g) {
    const game = this.game, p = game.store.p;
    backdrop(game, 'card-quickdraw', { dark: 0.3, zoom: 1.04, speed: 0.01, rainAlpha: 0.6 });
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text('QUICK DRAW', 22, 32, { size: 38, color: C.amber, spacing: 3 });
    g.text(`ROUND ${Math.min(Math.max(1, this.round), ROUNDS)}/${ROUNDS}  //  DRAW WINDOW ${this.window} MS`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    g.text(String(Math.round(this.score)).padStart(5, '0'), g.W - 22, 32, { size: 40, color: C.amber, align: 'right' });
    for (let i = 0; i < LIVES; i++) {
      const on = i < this.lives;
      g.rect(g.W - 22 - (i + 1) * 26, 54, 18, 18, on ? C.red : C.indigo, on ? 0.9 : 0.5);
    }
    if (this.streak >= 2) g.text(`STREAK x${this.streak}`, g.W - 22 - LIVES * 26 - 14, 68, { size: 18, color: C.cyan, align: 'right' });

    const cx = g.W / 2, cy = g.portrait ? g.H * 0.32 : g.H * 0.38;
    if (this.state === 'intro') {
      const pw = Math.min(760, g.W - 40);
      g.panel(cx - pw / 2, cy - 130, pw, 290, { color: C.amber, fillAlpha: 0.9 });
      g.text('HIGH NOON ON THE HILL', cx, cy - 92, { size: 40, color: C.amber, align: 'center', spacing: 4 });
      const lines = [
        'One letter. Then his gunslinger draws.',
        `Answer inside the window: ${WINDOW_START} ms, shrinking ${WINDOW_STEP} ms with every win.`,
        "Don't count the dits. You won't have time.",
        `${LIVES} lives. Typing before the letter plays costs one.`,
      ];
      lines.forEach((l, i) => g.text(l, cx, cy - 46 + i * 28, { size: 19, font: FONT.ui, color: C.white, align: 'center' }));
      g.text(`YOUR SLOWEST: ${this.slowest.join(' ')}`, cx, cy + 82, { size: 26, color: C.cyan, align: 'center', spacing: 3 });
      if (game.button('qd-go', cx - 140, cy + 110, 280, 46, 'DRAW [ENTER]', { size: 26, color: C.amber })) this.begin();
      return;
    }

    // The window: a fuse that burns down once the letter ends.
    const mw = Math.min(700, g.W - 60);
    if (this.state === 'draw' && !this.cur.done) {
      const now = game.audio.now();
      const playing = now < this.cur.end;
      const left = playing ? 1 : 1 - ((now - this.cur.end) * 1000) / this.window;
      meter(g, cx - mw / 2, cy + 120, mw, 14, left, left < 0.35 ? C.red : C.amber, playing ? 'LISTEN' : 'DRAW!');
      const pulse = playing ? 1.1 + 0.08 * Math.sin(g.time * 30) : 1;
      g.text(playing ? '((( )))' : 'DRAW!', cx, cy, { size: (playing ? 90 : 130) * pulse, color: playing ? C.cyan : C.red, align: 'center', glow: 40 });
    } else if (this.state === 'wait') {
      const a = 0.4 + 0.3 * Math.sin(g.time * 3);
      g.text('STEADY...', cx, cy, { size: 90, color: C.grey, align: 'center', alpha: a + 0.3, glow: 10 });
      meter(g, cx - mw / 2, cy + 120, mw, 14, 1, C.greenDim, 'HANDS OFF THE KEYS');
    } else if (this.state === 'verdict') {
      const v = this.verdict, a = Math.min(1, v.t * 3);
      if (v.kind === 'early') {
        g.text('JUMPED THE GUN', cx, cy, { size: 76, color: C.red, align: 'center', alpha: a, glow: 30 });
      } else {
        g.text(v.ch, cx, cy - 10, { size: 170, color: v.kind === 'win' ? C.green : C.red, align: 'center', alpha: a, glow: 40 });
        const msg = v.kind === 'win' ? `${Math.round(v.lat)} MS. CLEAN DRAW.`
          : v.kind === 'late' ? `RIGHT, BUT ${Math.round(v.lat)} MS. HE WAS FASTER.`
            : v.kind === 'wrong' ? `YOU DREW ${v.typed}. IT WAS ${v.ch}. LISTEN.` : `HE DREW FIRST. IT WAS ${v.ch}.`;
        g.text(msg, cx, cy + 100, { size: 24, font: FONT.ui, color: v.kind === 'win' ? C.green : C.amber, align: 'center', alpha: a });
      }
    }

    // Tiles (touch) for the whole unlocked set; color shows receive accuracy.
    if (this.state === 'draw' || this.state === 'wait') {
      const hit = tiles(game, this.letters, { colorOf: (ch) => accColor(p.stats[ch]), y: g.H - 34, size: g.portrait ? 62 : 44 });
      if (hit) this.answer(hit);
    }
  }
}
