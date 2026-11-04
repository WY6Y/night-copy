// Shared scene pieces: backgrounds, headers, dialogue, answer tiles.

import { C, FONT } from '../gfx.js';

export const PORTRAIT = { VERA: 'vera-radio', NIGHTOP: 'nightop-key', FAUX: 'faux-screen', RUNNER: 'char-operator' };
export const SPEAKER_COLOR = { VERA: C.cyan, NIGHTOP: C.green, FAUX: C.red, RUNNER: C.amber };

/** Full-screen art with a slow drift, darkened toward the UI. */
export function backdrop(game, name, o = {}) {
  const g = game.gfx;
  const t = g.time * (o.speed ?? 0.02);
  const img = game.art[name];
  const view = {
    zoom: (o.zoom ?? 1.08) + Math.sin(t) * 0.02,
    panX: 0.5 + Math.sin(t * 0.7) * 0.08,
    panY: o.panY ?? 0.5,
    alpha: o.alpha ?? 1,
  };
  g.cover(img, 0, 0, g.W, g.H, view);
  g.rect(0, 0, g.W, g.H, C.bg, o.dark ?? 0.35);
  if (o.rain !== false) game.rain.draw(g, o.rainAlpha ?? 0.5);
  // Map a point in the art (0..1) to the screen, to hang effects on it.
  return (u, v) => {
    if (!img) return { x: u * g.W, y: v * g.H, s: 1 };
    const s = Math.max(g.W / img.width, g.H / img.height) * view.zoom;
    const iw = img.width * s, ih = img.height * s;
    return { x: (g.W - iw) * view.panX + u * iw, y: (g.H - ih) * view.panY + v * ih, s };
  };
}

export function header(g, title, sub, color = C.green) {
  g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
  g.text(title, 24, 34, { size: 44, color, spacing: 3 });
  if (sub) g.text(sub, 26, 66, { size: 16, font: FONT.ui, color: C.cyan, glow: 4, spacing: 1 });
}

/** A dialogue box with portrait; `chars` is how much text is revealed. */
export function dialogue(game, speaker, text, chars, o = {}) {
  const g = game.gfx;
  const portrait = game.art[PORTRAIT[speaker]] || game.art['char-operator'];
  const col = SPEAKER_COLOR[speaker] || C.green;
  const ph = g.portrait ? 180 : 210;
  const bw = g.portrait ? g.W - 40 : Math.min(980, g.W - 80);
  const bx = (g.W - bw) / 2, by = o.y ?? g.H - ph - 60;
  g.panel(bx, by, bw, ph, { color: col, fillAlpha: 0.88 });
  const pw = ph * 0.78;
  g.cover(portrait, bx + 10, by + 10, pw, ph - 20, { panY: 0.25 });
  g.ctx.strokeStyle = col; g.ctx.lineWidth = 1; g.ctx.strokeRect(bx + 10.5, by + 10.5, pw, ph - 21);
  g.text(speaker, bx + pw + 30, by + 30, { size: 28, color: col, spacing: 3 });
  const lines = g.wrap(text.slice(0, chars), bw - pw - 60, 21);
  lines.slice(0, 5).forEach((l, i) => g.text(l, bx + pw + 30, by + 66 + i * 28, { size: 21, font: FONT.ui, color: C.white, glow: 3 }));
  if (chars >= text.length && Math.sin(g.time * 6) > 0) g.text('>>', bx + bw - 20, by + ph - 22, { size: 22, color: col, align: 'right' });
}

/** On-screen answer tiles (for touch). Returns the tapped character or null. */
export function tiles(game, letters, o = {}) {
  const g = game.gfx;
  const n = letters.length;
  const size = o.size || (g.portrait ? 64 : 52);
  const gap = 8;
  const perRow = Math.max(1, Math.min(n, Math.floor((g.W - 40 + gap) / (size + gap))));
  const rows = Math.ceil(n / perRow);
  const y0 = (o.y ?? g.H - 40) - rows * (size + gap);
  let hit = null;
  letters.forEach((ch, i) => {
    const r = Math.floor(i / perRow), k = i % perRow;
    const inRow = Math.min(perRow, n - r * perRow);
    const x = g.W / 2 - (inRow * (size + gap) - gap) / 2 + k * (size + gap);
    const y = y0 + r * (size + gap);
    const col = o.colorOf ? o.colorOf(ch) : C.green;
    if (game.button(`tile-${ch}`, x, y, size, size, ch, { size: size * 0.62, color: col, spacing: 0 })) hit = ch;
  });
  return hit;
}

/** Accuracy -> color, for the signal map and tiles. */
export function accColor(s) {
  if (!s || !s.seen) return C.grey;
  if (s.acc >= 0.9) return C.green;
  if (s.acc >= 0.7) return C.cyan;
  if (s.acc >= 0.5) return C.amber;
  return C.red;
}

/** Big glowing meter bar. */
export function meter(g, x, y, w, h, frac, color, label) {
  g.rect(x, y, w, h, C.ink, 0.8);
  g.ctx.save();
  g.ctx.shadowColor = color; g.ctx.shadowBlur = 14;
  g.rect(x, y, w * Math.max(0, Math.min(1, frac)), h, color, 0.9);
  g.ctx.restore();
  g.ctx.strokeStyle = color; g.ctx.lineWidth = 1; g.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (label) g.text(label, x, y - 12, { size: 14, font: FONT.ui, color, glow: 3 });
}

/** Draw a letter's pattern as glowing dits and dahs, centered at (cx, cy). */
export function drawPattern(g, pattern, cx, cy, unit = 18, color = C.cyan, alpha = 1) {
  if (!pattern) return; // '*' (unreadable) and other non-Morse marks have no pattern
  const els = pattern.split('');
  const w = els.reduce((s, e) => s + (e === '.' ? unit : unit * 3), 0) + (els.length - 1) * unit;
  let x = cx - w / 2;
  const c = g.ctx;
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.shadowColor = color;
  c.shadowBlur = 14;
  for (const e of els) {
    const len = e === '.' ? unit : unit * 3;
    if (e === '.') { c.beginPath(); c.arc(x + unit / 2, cy, unit / 2, 0, Math.PI * 2); c.fill(); }
    else { const r = unit / 2; c.beginPath(); c.roundRect(x, cy - r, len, unit, r); c.fill(); }
    x += len + unit;
  }
  c.restore();
}
