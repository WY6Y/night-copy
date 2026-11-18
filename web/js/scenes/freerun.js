// FREE RUN: no story, no score to chase. He picks the letters and the speed,
// then either copies them (INTERCEPT in free mode) or sends them (RELAY with
// free targets) for as long as he likes. Neither touches his letter stats.

import { C, FONT } from '../gfx.js';
import { backdrop } from './common.js';
import { rand } from '../content.js';

const SEND_TARGETS = 24;

export class FreeRun {
  constructor(game) {
    this.game = game;
    const p = game.store.p;
    const f = p.free || {};
    const koch = game.core.koch;
    const saved = (f.letters || []).filter((c) => koch.includes(c));
    this.sel = new Set(saved.length ? saved : koch.slice(0, p.unlocked));
    this.mode = f.mode === 'send' ? 'send' : 'listen';
    this.charWpm = f.charWpm || p.settings.charWpm;
  }

  enter() { this.game.audio.music('continual'); }

  get letters() { return this.game.core.koch.filter((c) => this.sel.has(c)); }

  toggle(c) {
    if (this.sel.has(c)) this.sel.delete(c); else this.sel.add(c);
    this.game.audio.say(c, { charWpm: this.speed, effWpm: this.speed });
  }

  setTo(list) { this.sel = new Set(list); }

  get speed() { return this.mode === 'listen' ? this.charWpm : this.game.store.p.settings.keyerWpm; }

  changeSpeed(dir) {
    const game = this.game, s = game.store.p.settings;
    if (this.mode === 'listen') {
      this.charWpm = Math.max(10, Math.min(40, this.charWpm + dir));
      game.audio.say('K M', { charWpm: this.charWpm, effWpm: this.charWpm });
    } else {
      s.keyerWpm = Math.max(8, Math.min(30, s.keyerWpm + dir));
      game.audio.configKeyer();
      game.store.save();
    }
  }

  start() {
    const game = this.game, p = game.store.p;
    const L = this.letters;
    if (!L.length) return;
    p.free = { letters: L, mode: this.mode, charWpm: this.charWpm === p.settings.charWpm ? 0 : this.charWpm };
    game.store.save();
    if (this.mode === 'listen') {
      game.go('intercept', { free: { letters: L, charWpm: this.charWpm } });
      return;
    }
    // Sends: mostly single letters, then pairs and threes as the run goes on.
    // No letter twice running, and no target the same as the one before.
    const targets = [];
    let last = '';
    for (let i = 0; i < SEND_TARGETS; i++) {
      const n = i < 10 ? 1 : i < 18 ? 2 : 3;
      let t = '';
      for (let tries = 0; tries < 20 && (!t || (t === targets[i - 1] && L.length > 1)); tries++) {
        t = '';
        for (let k = 0; k < n; k++) {
          const next = L.length > 1 ? rand(L.filter((c) => c !== (t.slice(-1) || last))) : L[0];
          t += next;
        }
      }
      last = t.slice(-1);
      targets.push(t);
    }
    game.go('relay', {
      mode: 'relay', free: true, targets, title: 'FREE RUN',
      vera: 'Open channel. Your letters, your pace. ESC when you have had enough.',
    });
  }

  onKey(e, down) {
    if (!down) return false;
    const k = e.key;
    if (k === 'Escape' || k === 'Backspace') { this.game.go('hub'); return true; }
    if (k === 'Enter') { this.start(); return true; }
    if (k === 'Tab') { this.mode = this.mode === 'listen' ? 'send' : 'listen'; return true; }
    if (k === 'ArrowLeft' || k === 'ArrowDown') { this.changeSpeed(-1); return true; }
    if (k === 'ArrowRight' || k === 'ArrowUp') { this.changeSpeed(1); return true; }
    const c = k.length === 1 ? k.toUpperCase() : '';
    if (c && this.game.core.koch.includes(c)) { this.toggle(c); return true; }
    return false;
  }

  draw(g) {
    const game = this.game, p = game.store.p;
    backdrop(game, 'scene-06-cityscape', { dark: 0.72, rainAlpha: 0.25 });
    g.shade(0, 0, g.W, 100, 'rgba(5,4,13,0.95)', 'rgba(5,4,13,0)');
    g.text('FREE RUN', 24, 40, { size: 52, color: C.green, spacing: 5 });
    g.text('PICK YOUR LETTERS AND SPEED. NO SCORE, NO STATS, JUST REPS.', 26, 76, { size: 16, font: FONT.ui, color: C.cyan, glow: 4 });
    if (game.button('back', g.W - 170, 18, 150, 40, 'BACK [ESC]', { size: 20, color: C.cyan })) { game.go('hub'); return; }

    const cx = g.W / 2;
    let y = 104;
    // Listen or send.
    const mw = 220;
    for (const [m, label, x] of [['listen', 'LISTEN', cx - mw - 6], ['send', 'SEND', cx + 6]]) {
      const on = this.mode === m;
      if (game.button(`mode-${m}`, x, y, mw, 46, on ? `> ${label} <` : label, { size: 26, color: on ? C.amber : C.greenDim })) this.mode = m;
    }
    y += 56;
    g.text(this.mode === 'listen' ? 'COPY THEM BY EAR, TYPE OR TAP WHAT YOU HEAR' : 'SEND THEM ON THE PADDLE, Z/X KEYS OR THE PADS', cx, y + 4, { size: 14, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });
    y += 20;

    // Every letter in the Koch order; locked ones can be picked too.
    const koch = game.core.koch;
    const per = g.portrait ? 8 : 14, gap = 8;
    const ts = Math.min(56, (g.W - 40 - (per - 1) * gap) / per);
    const gx = cx - (per * (ts + gap) - gap) / 2;
    koch.forEach((c, i) => {
      const x = gx + (i % per) * (ts + gap), yy = y + Math.floor(i / per) * (ts + gap);
      const on = this.sel.has(c), open = i < p.unlocked;
      if (game.button(`fr-${c}`, x, yy, ts, ts, c, { size: ts * 0.6, color: on ? C.amber : open ? C.greenDim : C.indigo, spacing: 0 })) this.toggle(c);
    });
    y += Math.ceil(koch.length / per) * (ts + gap) + 6;
    g.text('TYPE OR TAP A LETTER TO ADD OR DROP IT  //  DIM = NOT UNLOCKED YET', cx, y + 4, { size: 13, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });
    y += 20;

    // Quick picks.
    const weak = (p.weak || []).filter((c) => koch.includes(c));
    const mix = [...new Set(game.store.topPairs(3).flatMap((x) => [x.a, x.b]))];
    const quick = [
      ['ALL UNLOCKED', koch.slice(0, p.unlocked)],
      ['NEWEST 5', koch.slice(Math.max(0, p.unlocked - 5), p.unlocked)],
      ['WEAK', weak],
      ['MIX-UPS', mix],
      ['CLEAR', []],
    ];
    const qw = Math.min(170, (g.W - 40 - 4 * 8) / 5);
    const qx = cx - (5 * qw + 4 * 8) / 2;
    quick.forEach(([label, list], i) => {
      const empty = !list.length && label !== 'CLEAR';
      if (game.button(`q-${i}`, qx + i * (qw + 8), y, qw, 38, label, { size: 18, color: C.cyan, disabled: empty })) this.setTo(list);
    });
    y += 54;

    // Speed.
    const sw = Math.min(560, g.W - 40), sx = cx - sw / 2;
    g.panel(sx, y, sw, 46, { color: C.greenDim, fillAlpha: 0.8 });
    g.text(this.mode === 'listen' ? 'CHARACTER SPEED' : 'KEYER SPEED', sx + 16, y + 23, { size: 24, color: C.green });
    if (game.button('slower', sx + sw - 200, y + 7, 40, 32, '<', { size: 24 })) this.changeSpeed(-1);
    g.text(`${this.speed} WPM`, sx + sw - 105, y + 23, { size: 28, color: C.white, align: 'center' });
    if (game.button('faster', sx + sw - 50, y + 7, 40, 32, '>', { size: 24 })) this.changeSpeed(1);
    y += 58;

    const L = this.letters;
    const shown = L.length ? `${L.length} LETTER${L.length === 1 ? '' : 'S'}: ${L.join(' ')}` : 'PICK AT LEAST ONE LETTER';
    g.wrap(shown, g.W - 80, 16).slice(0, 2).forEach((l, i) => g.text(l, cx, y + i * 20, { size: 16, font: FONT.ui, color: L.length ? C.cyan : C.amber, align: 'center' }));
    y += 46;
    const bw = Math.min(420, g.W - 40);
    if (game.button('start', cx - bw / 2, Math.min(y, g.H - 80), bw, 58, 'START [ENTER]', { size: 32, color: C.amber, disabled: !L.length })) this.start();
    if (!g.portrait) g.text('TAB: LISTEN / SEND  //  ARROWS: SPEED  //  ESC: BACK', g.W - 24, g.H - 40, { size: 13, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
  }
}
