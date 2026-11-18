// FREE KEY: a blank page. He keys whatever is in his head and the decoder
// writes it down as he goes. There is no target, so nothing is graded for
// right or wrong letters; only his spacing is scored (letter gaps near 3
// units, word gaps near 7), and that goes to COACH. The last ten pages are
// kept so he can look back at where the copy broke up.

import { C, FONT } from '../gfx.js';
import { backdrop, meter, guardOverlay } from './common.js';

const KEEP = 10;
const MAX_TEXT = 4000;
const THINKING_U = 12; // longer gaps are him thinking, not spacing

/** A gap in dit units: what it was meant to be and whether it landed clean. */
export function gradeGap(u) {
  if (u > THINKING_U) return null;
  if (u <= 4.8) return { kind: 'LETTER', ok: u >= 2.2 };
  if (u < 5.5) return { kind: 'LETTER OR WORD?', ok: false };
  return { kind: 'WORD', ok: u <= 9.5 };
}

/** Decoded text with unreadable letters ('*') in red. */
function marked(g, text, x, y, size, color = C.white) {
  for (const part of text.split(/(\*)/)) {
    if (!part) continue;
    g.text(part, x, y, { size, color: part === '*' ? C.red : color, glow: part === '*' ? 8 : 4 });
    x += g.measure(part, size, FONT.big);
  }
}

export class FreeKey {
  constructor(game) {
    this.game = game;
    this.text = '';
    this.scored = 0;
    this.clean = 0;
    this.lastGap = null;
    this.keyed = 0;
    this.history = false;
    this.ignoredFlash = 0;
    this.lastActivity = 0;
    this.startedAt = performance.now();
    this.touch = { dit: false, dah: false };
    this.kb = { dit: false, dah: false };
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
  }

  exit() {
    this.unsub?.();
    this.unpad?.();
    this.game.paddle.setKeys(false, false);
    this.game.audio.releaseKeys();
    this.game.paddle.arm(false);
  }

  resetDecoder() {
    this.game.core.decReset(1200 / this.game.store.p.settings.keyerWpm);
  }

  keyerMsg(d) {
    const sr = this.game.audio.keyerSr || 48000;
    if (d.t === 'ev') {
      for (let k = 0; k < d.ev.length; k += 3) {
        this.game.core.decElement(d.ev[k], (d.ev[k + 1] / sr) * 1000, (d.ev[k + 2] / sr) * 1000);
      }
    } else if (d.t === 'key') {
      // A held element isn't silence: keep the decoder from closing the letter.
      this.keyDown = !!d.down;
      this.game.core.decKey(this.keyDown);
      this.lastActivity = performance.now();
    }
  }

  /** Keep the page: on to the front of his last ten. */
  keep() {
    const text = this.text.trim();
    if (!text) return;
    const p = this.game.store.p;
    p.freeKeys = [{ at: Date.now(), text }, ...(p.freeKeys || [])].slice(0, KEEP);
    this.game.store.save();
  }

  newPage() {
    this.keep();
    this.text = '';
    this.resetDecoder();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.keep();
    if (!this.keyed) { this.game.go('hub'); return; }
    this.game.go('results', {
      mission: 'freekey', aborted: false, total: 0, correct: 0, keyed: this.keyed,
      timing: this.scored ? this.clean / this.scored : null,
      seconds: (performance.now() - this.startedAt) / 1000,
      headline: ['PAGE FILED', C.green],
    });
  }

  // ---- input ---------------------------------------------------------------

  applyKeys() {
    this.game.paddle.setKeys(this.kb.dit || this.touch.dit, this.kb.dah || this.touch.dah);
  }

  onKey(e, down) {
    const game = this.game;
    const k = e.key;
    if (this.history && down) {
      if (k === 'Escape' || k === 'l' || k === 'L' || k === 'Enter') this.history = false;
      return true;
    }
    if (down && k === 'Escape') { this.finish(); return true; }
    if (k === 'z' || k === 'Z' || k === '[') { if (!e.repeat) { this.kb.dit = down; this.applyKeys(); } return true; }
    if (k === 'x' || k === 'X' || k === ']') { if (!e.repeat) { this.kb.dah = down; this.applyKeys(); } return true; }
    if (k === ' ') { if (!e.repeat) game.paddle.straight(down); return true; }
    if (!down) return false;
    if (k === 'Enter') { this.text += '\n'; return true; }
    if (k === 'Backspace') { this.text = this.text.slice(0, -1); return true; }
    if (k === 'l' || k === 'L') { this.history = true; return true; }
    if (k === 'p' || k === 'P') { this.newPage(); return true; }
    if (k === '-' || k === '+' || k === '=') {
      const s = game.store.p.settings;
      s.keyerWpm = Math.max(8, Math.min(30, s.keyerWpm + (k === '-' ? -1 : 1)));
      game.audio.configKeyer();
      this.resetDecoder();
      game.store.save();
      return true;
    }
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
    if (this.history) return;
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

  update(dt) {
    const game = this.game, core = game.core;
    this.ignoredFlash = Math.max(0, this.ignoredFlash - dt);
    core.decPoll(game.audio.keyerNowMs());
    let txt = core.decTake();
    if (txt) {
      // One space between words, none at the start of a line.
      if (/(^|[\s])$/.test(this.text)) txt = txt.replace(/^ +/, '');
      txt = txt.replace(/ {2,}/g, ' ');
      this.keyed += txt.replace(/\s/g, '').length;
      this.text = (this.text + txt).slice(-MAX_TEXT);
      if (txt.trim()) game.audio.sfx('type');
    }
    for (const u of core.decGaps()) {
      const gr = gradeGap(u);
      if (!gr) continue;
      this.scored++;
      if (gr.ok) this.clean++;
      this.lastGap = { u, ...gr, t: 3 };
    }
    if (this.lastGap) this.lastGap.t -= dt;
  }

  draw(g) {
    const game = this.game, p = game.store.p;
    backdrop(game, 'scene-02-shack', { dark: 0.72, rainAlpha: 0.2, zoom: 1.03 });
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text('FREE KEY', 22, 32, { size: 38, color: C.green, spacing: 3 });
    g.text(`KEYER ${p.settings.keyerWpm} WPM (- / +)  //  MODE ${p.settings.modeB ? 'B' : 'A'}  //  ${this.keyed} LETTERS`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    // Phones: the buttons get their own row under the title, clear of QUIT.
    const bw = g.portrait ? (g.W - 56) / 3 : 170, by = g.portrait ? 80 : 16;
    if (game.button('done', g.W - 20 - bw, by, bw, 40, 'DONE [ESC]', { size: 20, color: C.amber })) { this.finish(); return; }
    if (game.button('page', g.W - 20 - bw * 2 - 8, by, bw, 40, 'NEW PAGE [P]', { size: 20, color: C.cyan })) this.newPage();
    const kept = (p.freeKeys || []).length;
    if (game.button('earlier', g.W - 20 - bw * 3 - 16, by, bw, 40, `EARLIER (${kept}) [L]`, { size: 18, color: C.cyan, disabled: !kept })) this.history = true;

    // The page.
    const pd = this.pads();
    const px = 40, py = g.portrait ? 136 : 96, pw = g.W - 80, ph = pd.dit.y - py - 108;
    g.panel(px, py, pw, ph, { color: C.greenDim, fillAlpha: 0.88 });
    const size = g.portrait ? 40 : 44, lh = size + 4;
    const lines = [];
    for (const para of this.text.split('\n')) {
      // Word-wrap, then hard-break any run of letters keyed with no word gap.
      for (const l of para ? g.wrap(para, pw - 48, size, FONT.big) : ['']) {
        let rest = l;
        while (rest.length > 1 && g.measure(rest, size, FONT.big) > pw - 48) {
          let n = rest.length - 1;
          while (n > 1 && g.measure(rest.slice(0, n), size, FONT.big) > pw - 48) n--;
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        lines.push(rest);
      }
    }
    const fit = Math.max(1, Math.floor((ph - 24) / lh));
    const view = lines.slice(-fit);
    view.forEach((l, i) => {
      const last = i === view.length - 1;
      const cursor = last && Math.sin(g.time * 6) > 0 ? '_' : '';
      marked(g, l + cursor, px + 24, py + 20 + lh / 2 + i * lh, size);
    });
    if (!this.text) g.text('KEY ANYTHING. A NOTE, A POEM, WHAT YOU HAD FOR DINNER. IT GETS COPIED DOWN HERE.', px + pw / 2, py + ph / 2, { size: 18, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });

    // Spacing: the running score and the last gap.
    const my = py + ph + 26;
    const frac = this.scored ? this.clean / this.scored : 1;
    meter(g, px, my, Math.min(360, pw / 2), 8, frac, frac >= 0.8 ? C.green : C.amber, `CLEAN SPACING ${this.scored ? Math.round(frac * 100) + '%' : '--'}`);
    const lg = this.lastGap;
    if (lg && lg.t > 0) {
      const ideal = lg.kind === 'WORD' ? 7 : 3;
      g.text(`LAST GAP ${lg.u.toFixed(1)} UNITS: ${lg.kind}${lg.kind.endsWith('?') ? '' : ` (AIM ${ideal})`}`, px + pw, my + 4, { size: 18, font: FONT.ui, color: lg.ok ? C.green : C.amber, align: 'right', alpha: Math.min(1, lg.t) });
    }
    g.text('ENTER: NEW LINE  //  BACKSPACE: DELETE  //  PAUSES OVER 12 UNITS ARE NOT SCORED', px, my + 34, { size: 13, font: FONT.ui, color: C.grey, glow: 0 });

    // Touch pads + key hints.
    for (const [k, r] of Object.entries(pd)) {
      const on = this.touch[k] || this.kb[k];
      g.panel(r.x, r.y, r.w, r.h, { color: on ? C.white : C.green, fillAlpha: on ? 0.9 : 0.55, glow: on ? 24 : 6 });
      g.text(k.toUpperCase(), r.x + r.w / 2, r.y + r.h / 2 - 8, { size: 40, color: C.green, align: 'center' });
      g.text(k === 'dit' ? 'Z or [' : 'X or ]', r.x + r.w / 2, r.y + r.h / 2 + 24, { size: 13, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });
    }
    g.text('PADDLE, Z/X KEYS, OR TAP THE PADS  //  SPACE = STRAIGHT KEY', g.W / 2, pd.dit.y - 16, { size: 13, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });

    if (this.history) this.drawHistory(g);
    guardOverlay(game, this.ignoredFlash);
  }

  drawHistory(g) {
    const game = this.game;
    const list = game.store.p.freeKeys || [];
    const w = Math.min(1000, g.W - 40), x = (g.W - w) / 2, y = 80, h = g.H - 120;
    g.panel(x, y, w, h, { color: C.cyan, fillAlpha: 0.97, glow: 14 });
    g.text('EARLIER PAGES', x + 20, y + 30, { size: 30, color: C.cyan, spacing: 3 });
    g.text('RED * = A LETTER THE DECODER COULD NOT READ', x + w - 20, y + 30, { size: 13, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
    const rowH = (h - 110) / KEEP;
    list.forEach((pg, i) => {
      const yy = y + 62 + i * rowH;
      const d = new Date(pg.at);
      const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      g.text(when, x + 20, yy + 14, { size: 14, font: FONT.ui, color: C.grey, glow: 0 });
      const flat = pg.text.replace(/\s+/g, ' ');
      const two = g.wrap(flat, w - 170, 21, FONT.big).slice(0, 2);
      if (two.join(' ').length < flat.length) two[1] += ' ...';
      two.forEach((l, k) => marked(g, l, x + 130, yy + 12 + k * 21, 21));
    });
    if (game.button('close', x + w / 2 - 120, y + h - 50, 240, 40, 'CLOSE [L]', { size: 22, color: C.amber })) this.history = false;
  }
}
