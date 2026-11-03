// HEAD COPY: hear a whole word with nothing to type, then pick it from four.
// Trains hearing words as sounds instead of spelling letter by letter. The
// wrong choices lean on his recorded mix-ups, so they are the hard ones.

import { C, FONT } from '../gfx.js';
import { backdrop, drawPattern } from './common.js';
import { CW_WORDS, WORDS, MORSE, canSay, rand } from '../content.js';

const ROUNDS = 12;

export class HeadCopy {
  constructor(game) {
    this.game = game;
    const p = game.store.p;
    this.letters = game.core.koch.slice(0, p.unlocked);
    this.set = new Set(this.letters);
    this.pool = [...new Set([...CW_WORDS, ...WORDS])].filter((w) => w.length >= 2 && canSay(w, this.set));
    this.round = -1;
    this.results = [];
    this.score = 0;
    this.state = 'intro';
    this.t = 0;
    this.startedAt = performance.now();
  }

  enter() { this.game.audio.music(null); }

  /** Rounds grow from short words to longer ones, then two-word phrases. */
  makeWord() {
    const r = this.round;
    const [lo, hi] = r < 4 ? [2, 3] : r < 8 ? [3, 4] : [4, 6];
    const fit = this.pool.filter((w) => w.length >= lo && w.length <= hi);
    if (r >= 9 && this.pool.length >= 8 && Math.random() < 0.6) {
      const short = this.pool.filter((w) => w.length <= 4);
      return `${rand(short)} ${rand(short)}`;
    }
    if (fit.length >= 3) return rand(fit);
    let s = '';
    const n = lo + Math.floor(Math.random() * (hi - lo + 1));
    for (let i = 0; i < n; i++) s += rand(this.letters);
    return s;
  }

  /** A letter he tends to confuse with ch, else any other unlocked letter. */
  lookalike(ch) {
    const conf = this.game.store.p.confusions || {};
    const near = Object.keys(conf).filter((k) => k[0] === ch || k[2] === ch).map((k) => (k[0] === ch ? k[2] : k[0])).filter((c) => this.set.has(c));
    if (near.length && Math.random() < 0.7) return rand(near);
    const others = this.letters.filter((c) => c !== ch);
    return others.length ? rand(others) : ch;
  }

  /** Near-miss: swap one letter for a look-alike, swap two neighbors, or reuse a real word. */
  distractor(w) {
    const chars = w.split('');
    const idx = chars.map((c, i) => (c === ' ' ? -1 : i)).filter((i) => i >= 0);
    const roll = Math.random();
    if (roll < 0.55) {
      const i = rand(idx);
      chars[i] = this.lookalike(chars[i]);
    } else if (roll < 0.8 && idx.length >= 2) {
      const k = Math.floor(Math.random() * (idx.length - 1));
      const [a, b] = [idx[k], idx[k + 1]];
      [chars[a], chars[b]] = [chars[b], chars[a]];
    } else {
      const same = this.pool.filter((x) => x.length === w.length && x !== w);
      if (same.length) return rand(same);
      const i = rand(idx);
      chars[i] = this.lookalike(chars[i]);
    }
    return chars.join('');
  }

  nextRound() {
    this.round++;
    if (this.round >= ROUNDS) { this.finish(false); return; }
    const w = this.makeWord();
    const choices = new Set([w]);
    for (let tries = 0; choices.size < 4 && tries < 60; tries++) choices.add(this.distractor(w));
    this.cur = { w, choices: [...choices].sort(() => Math.random() - 0.5), replayed: false, pick: null };
    this.play();
    this.state = 'listen';
  }

  play() {
    const game = this.game;
    const s = game.audio.say(this.cur.w, { effWpm: game.store.p.effWpm, delay: 0.4 });
    this.cur.t0 = s.t0;
    this.cur.end = s.end;
    this.cur.marks = s.r.marks;
  }

  replay() {
    if (this.state !== 'listen' && this.state !== 'choose') return;
    if (!this.cur.replayed) this.cur.replayed = true;
    this.play();
    this.state = 'listen';
  }

  choose(i) {
    if (this.state !== 'choose') return;
    const game = this.game, g = game.gfx, cur = this.cur;
    const pick = cur.choices[i];
    if (pick == null) return;
    cur.pick = pick;
    const ok = pick === cur.w;
    this.results.push({ w: cur.w, pick, ok });
    if (ok) {
      this.score += Math.round(150 * cur.w.replace(/ /g, '').length * (cur.replayed ? 0.5 : 1));
      game.audio.sfx('ok');
      game.particles.burst(g.W / 2, g.H * 0.4, C.green, 40, 300);
      this.wait = 0.9;
    } else {
      game.audio.sfx('bad');
      g.glitch(0.6);
      this.wait = Infinity;
      setTimeout(() => { if (game.scene === this && this.cur === cur) this.hearBoth(); }, 450);
    }
    this.age = 0;
    this.state = 'verdict';
  }

  /** The right word, then the one he picked on a lower pitch. */
  hearBoth() {
    const game = this.game, cur = this.cur, st = game.store.p.settings;
    const a = game.audio.say(cur.w, { effWpm: game.store.p.effWpm, delay: 0.1 });
    this.cur.t0 = a.t0; this.cur.marks = a.r.marks;
    const gap = (a.end - game.audio.now()) * 1000 + 700;
    setTimeout(() => { if (game.scene === this && this.cur === cur) game.audio.say(cur.pick, { effWpm: game.store.p.effWpm, freq: st.tone * 0.8 }); }, gap);
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const r = this.results;
    this.game.go('results', {
      mission: 'headcopy', aborted, total: r.length, correct: r.filter((x) => x.ok).length,
      score: this.score, seconds: (performance.now() - this.startedAt) / 1000,
    });
  }

  onKey(e, down) {
    if (!down) return false;
    const k = e.key;
    if (k === 'Escape') { this.finish(true); return true; }
    if (this.state === 'intro') { if (k === 'Enter' || k === ' ') this.nextRound(); return true; }
    if (this.state === 'verdict') {
      if (k === 'Enter' && this.age > 0.4) this.wait = 0;
      else if ((k === 'h' || k === 'H' || k === ' ') && this.cur.pick !== this.cur.w) this.hearBoth();
      return true;
    }
    if (k === ' ') { this.replay(); return true; }
    if (k >= '1' && k <= '4') { this.choose(+k - 1); return true; }
    return k.length === 1;
  }

  update(dt) {
    this.t += dt;
    if (this.state === 'listen' && this.game.audio.now() > this.cur.end + 0.3) this.state = 'choose';
    if (this.state === 'verdict') {
      this.age += dt;
      this.wait -= dt;
      if (this.wait <= 0) this.nextRound();
    }
  }

  draw(g) {
    const game = this.game;
    backdrop(game, 'scene-11-nightop-watcher', { dark: 0.6, rainAlpha: 0.2 });
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text('HEAD COPY', 22, 32, { size: 38, color: C.cyan, spacing: 3 });
    g.text(`${Math.max(1, Math.min(this.round + 1, ROUNDS))}/${ROUNDS}  //  ${game.store.p.settings.charWpm} WPM @ ${game.store.p.effWpm} EFF  //  NO PAPER`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    g.text(String(this.score).padStart(6, '0'), g.W - 22, 32, { size: 40, color: C.amber, align: 'right' });
    const cx = g.W / 2, cy = g.portrait ? g.H * 0.3 : g.H * 0.32;

    if (this.state === 'intro') {
      g.text('HOLD IT IN YOUR HEAD', cx, cy, { size: 54, color: C.cyan, align: 'center', spacing: 3 });
      g.text('Hear the whole word. Nothing to type while it plays. Then pick it from four.', cx, cy + 48, { size: 18, font: FONT.ui, color: C.white, align: 'center' });
      g.text('1-4: PICK  //  SPACE: HEAR AGAIN (HALF POINTS)  //  ESC: QUIT', cx, cy + 80, { size: 14, font: FONT.ui, color: C.grey, align: 'center' });
      if (game.button('go', cx - 160, cy + 110, 320, 50, 'START [ENTER]', { size: 26, color: C.amber })) this.nextRound();
      return;
    }

    // A ring that pulses with the signal: something to watch, nothing to read.
    const now = game.audio.now() - (this.cur.t0 || 0);
    const on = (this.cur.marks || []).some(([a, b]) => now >= a && now <= b);
    const playing = game.audio.cwPlaying > 0;
    const R = 70 + (on ? 14 : 0);
    const c = g.ctx;
    c.save();
    c.strokeStyle = on ? C.white : playing ? C.cyan : C.greenDim;
    c.shadowColor = C.cyan; c.shadowBlur = on ? 40 : 12;
    c.lineWidth = on ? 6 : 3;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    c.restore();
    if (this.state === 'listen') {
      g.text(playing ? 'LISTEN' : '...', cx, cy + 10, { size: 40, color: C.cyan, align: 'center', spacing: 4 });
      return;
    }

    // Choices.
    const cols = g.portrait ? 1 : 2;
    const bw = g.portrait ? g.W - 80 : 360, bh = 70, gap = 16;
    const top = cy + 120;
    this.cur.choices.forEach((w, i) => {
      const x = cx - (cols * bw + (cols - 1) * gap) / 2 + (i % cols) * (bw + gap);
      const y = top + Math.floor(i / cols) * (bh + gap);
      let col = C.green;
      if (this.state === 'verdict') col = w === this.cur.w ? C.green : w === this.cur.pick ? C.red : C.grey;
      if (game.button(`hc-${i}`, x, y, bw, bh, `${i + 1}  ${w}`, { size: 40, color: col })) this.choose(i);
    });
    if (this.state === 'choose') {
      g.text('WHICH WAS IT?', cx, cy + 10, { size: 26, color: C.amber, align: 'center' });
      const by = top + Math.ceil(4 / cols) * (bh + gap) + 6;
      if (game.button('again', cx - 150, by, 300, 44, 'HEAR AGAIN [SPACE]', { size: 20, color: C.cyan })) this.replay();
    } else if (this.cur.pick === this.cur.w) {
      g.text('RIGHT', cx, cy + 14, { size: 44, color: C.green, align: 'center' });
    } else {
      g.text(this.cur.w, cx, cy + 14, { size: 48, color: C.green, align: 'center', spacing: 6 });
      // The right word's patterns, under the ring.
      const letters = this.cur.w.split('').filter((ch) => MORSE[ch]);
      const slot = Math.min(110, (g.W - 40) / Math.max(1, letters.length));
      letters.forEach((ch, i) => drawPattern(g, MORSE[ch], cx + (i - (letters.length - 1) / 2) * slot, cy + 102, Math.max(4, Math.min(8, slot / 14)), C.cyan));
      const by = top + Math.ceil(4 / cols) * (bh + gap) + 6;
      if (game.button('both', cx - 230, by, 220, 44, 'HEAR BOTH [H]', { size: 20, color: C.cyan })) this.hearBoth();
      if (game.button('next', cx + 10, by, 220, 44, 'NEXT [ENTER]', { size: 20, color: C.amber })) this.wait = 0;
    }
  }
}
