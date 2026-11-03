// MIX-UP DRILL: the letters Stephen confuses, taught as pairs. For each pair:
// a contrast round (both letters, labeled, back to back), then a two-choice
// round where one plays and he picks which. Counts toward letter stats; does
// not unlock letters.

import { C, FONT } from '../gfx.js';
import { backdrop, meter } from './common.js';

const TRIALS = 10;
const CONTRAST_PLAYS = 6; // A B A B A B

export class Drill {
  constructor(game) {
    this.game = game;
    this.pairs = game.store.topPairs(3);
    this.pi = 0;
    this.results = [];
    this.perPair = [];
    this.startedAt = performance.now();
    this.t = 0;
  }

  enter() {
    this.game.audio.music(null);
    if (!this.pairs.length) { this.game.go('hub'); return; }
    this.startPair();
  }

  get pair() { return this.pairs[this.pi]; }

  startPair() {
    this.phase = 'contrast';
    this.plays = 0;
    this.nextAt = 0.8;
    this.trial = 0;
    this.ok = 0;
    this.lit = null;
    this.answer = null;
  }

  play(ch) {
    const s = this.game.audio.say(ch, { delay: 0.02 });
    this.current = { ch, t0: s.t0, end: s.end };
    return s;
  }

  nextTrial() {
    if (this.trial >= TRIALS) {
      this.perPair.push({ pair: this.pair, ok: this.ok });
      this.pi++;
      if (this.pi >= this.pairs.length) { this.finish(false); return; }
      this.startPair();
      return;
    }
    this.trial++;
    const ch = Math.random() < 0.5 ? this.pair.a : this.pair.b;
    this.target = ch;
    this.answer = null;
    this.phase = 'test';
    this.play(ch);
  }

  choose(ch) {
    if (this.phase !== 'test' || this.answer) return;
    const game = this.game, g = game.gfx;
    const right = ch === this.target;
    const lat = Math.max(0, (game.audio.now() - this.current.end) * 1000);
    game.store.record(this.target, right, right ? lat : null);
    if (!right) game.store.recordConfusion(this.target, ch);
    this.results.push({ ch: this.target, ok: right, lat: right ? lat : null, typed: ch });
    this.answer = { ch, right, t: right ? 0.6 : 2.6 };
    if (right) {
      this.ok++;
      game.audio.sfx('ok');
      game.particles.burst(this.sideX(ch), g.H * 0.45, C.green, 30, 260);
    } else {
      game.audio.sfx('bad');
      g.glitch(0.7);
      // Contrast again: the right one, then the one he picked.
      setTimeout(() => { if (game.scene === this) { this.lit = this.target; this.play(this.target); } }, 450);
      setTimeout(() => { if (game.scene === this) { this.lit = ch; this.play(ch); } }, 1350);
    }
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const r = this.results;
    const lats = r.filter((x) => x.ok && x.lat != null).map((x) => x.lat);
    this.game.go('results', {
      mission: 'drill', aborted, total: r.length, correct: r.filter((x) => x.ok).length,
      avgLat: lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0,
      score: r.filter((x) => x.ok).length * 100,
      seconds: (performance.now() - this.startedAt) / 1000,
      perChar: r,
    });
  }

  onKey(e, down) {
    if (!down) return false;
    if (e.key === 'Escape') { this.finish(true); return true; }
    if (this.phase === 'contrast' && (e.key === 'Enter' || e.key === ' ')) { this.plays = CONTRAST_PLAYS; return true; }
    if (this.phase === 'test' && e.key === ' ' && !this.answer && this.current) { this.play(this.target); return true; }
    if (e.key.length === 1) { this.choose(e.key.toUpperCase()); return true; }
    return false;
  }

  update(dt) {
    this.t += dt;
    if (this.phase === 'contrast') {
      this.nextAt -= dt;
      if (this.nextAt <= 0) {
        if (this.plays >= CONTRAST_PLAYS) { this.lit = null; this.nextTrial(); return; }
        const ch = this.plays % 2 === 0 ? this.pair.a : this.pair.b;
        this.lit = ch;
        const s = this.play(ch);
        this.plays++;
        this.nextAt = (s.end - s.t0) + 0.9;
      }
    } else if (this.phase === 'test' && this.answer) {
      this.answer.t -= this.game.audio.cwPlaying ? 0 : dt;
      if (this.answer.t <= 0) { this.lit = null; this.nextTrial(); }
    }
  }

  sideX(ch) {
    const g = this.game.gfx;
    return ch === this.pair.a ? g.W * 0.3 : g.W * 0.7;
  }

  draw(g) {
    const game = this.game;
    backdrop(game, 'scene-14-fragment-crt', { dark: 0.55, rainAlpha: 0.15 });
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text('MIX-UP DRILL', 22, 32, { size: 38, color: C.amber, spacing: 3 });
    const pairsTxt = this.pairs.map((p, i) => (i === this.pi ? `[${p.a}/${p.b}]` : `${p.a}/${p.b}`)).join('  ');
    g.text(`PAIR ${Math.min(this.pi + 1, this.pairs.length)}/${this.pairs.length}: ${pairsTxt}`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    if (!this.pair) return;
    const { a, b } = this.pair;
    const playing = game.audio.cwPlaying > 0;
    const testing = this.phase === 'test';
    const cy = g.H * 0.45;
    for (const ch of [a, b]) {
      const x = this.sideX(ch);
      const w = Math.min(300, g.W * 0.36), h = 260;
      const isLit = this.lit === ch && playing;
      let col = C.green;
      if (testing && this.answer) col = ch === this.target ? C.green : (ch === this.answer.ch ? C.red : C.grey);
      else if (isLit) col = C.white;
      if (game.button(`pick-${ch}`, x - w / 2, cy - h / 2, w, h, '', { color: col, disabled: !testing || !!this.answer })) this.choose(ch);
      g.text(ch, x, cy - 10, { size: 170, color: col, align: 'center', glow: isLit ? 50 : 20, alpha: testing && !this.answer ? 0.85 : 1 });
      if (isLit) g.text('NOW PLAYING', x, cy + 100, { size: 16, font: FONT.ui, color: C.white, align: 'center' });
    }
    if (this.phase === 'contrast') {
      g.text('LISTEN TO THE DIFFERENCE', g.W / 2, g.H * 0.78, { size: 34, color: C.amber, align: 'center', spacing: 3 });
      if (game.button('skip', g.W / 2 - 130, g.H * 0.78 + 20, 260, 40, 'SKIP TO THE TEST', { size: 20, color: C.grey })) this.plays = CONTRAST_PLAYS;
    } else {
      const msg = !this.answer ? 'WHICH ONE?'
        : this.answer.right ? 'RIGHT' : `THAT WAS ${this.target}. HEAR BOTH AGAIN.`;
      g.text(msg, g.W / 2, g.H * 0.78, { size: 34, color: !this.answer ? C.amber : this.answer.right ? C.green : C.red, align: 'center', spacing: 3 });
      meter(g, g.W / 2 - 200, g.H * 0.78 + 34, 400, 8, this.trial / TRIALS, C.cyan, '');
      g.text(`${this.ok}/${this.trial - (this.answer ? 0 : 1)}`, g.W / 2 + 214, g.H * 0.78 + 38, { size: 18, color: C.cyan });
      if (!this.answer && game.button('again', g.W / 2 - 130, g.H * 0.78 + 56, 260, 42, 'HEAR AGAIN [SPACE]', { size: 20, color: C.cyan, disabled: playing })) this.play(this.target);
    }
  }
}
