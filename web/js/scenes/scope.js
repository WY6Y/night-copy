// KEYING SCOPE pieces: grade a try's rhythm against ideal timing, and draw
// the two traces (ideal over his fist) on an oscilloscope graticule.
//
// With an iambic keyer the dits and dahs are always the right length; what
// the operator controls is when the next lever goes down. So the grade is
// about gaps: a pause inside a letter (over 2.5 units the decoder splits it,
// M becomes TT), letters run together (under 2.5 units), and elements that
// came out wrong (held lever = extra element, early release = missing one).

import { C, FONT } from '../gfx.js';
import { MORSE } from '../content.js';

const SPLIT = 2.5;     // units: the decoder's letter break
const HITCH = 1.6;     // units: a gap inside a letter this long is a hesitation
const LONG = 6;        // units: a gap between letters this long reads as a word break

const name = (k) => (k === '.' ? 'dit' : 'dah');

/** marks: [[downMs, upMs]] for one try; u: unit ms. Returns { score, issues, gaps, expected, got }. */
export function analyzeFist(want, marks, u) {
  const exp = [];
  [...want].forEach((ch, li) => {
    const pat = MORSE[ch] || '';
    [...pat].forEach((k, j) => exp.push({ k, li, end: j === pat.length - 1 }));
  });
  const els = marks.map(([a, b]) => ({ a, b, k: (b - a) / u < 2 ? '.' : '-' }));
  const expS = exp.map((e) => e.k).join('');
  const gotS = els.map((e) => e.k).join('');
  const gaps = [];
  for (let i = 1; i < els.length; i++) gaps.push({ i, units: (els[i].a - els[i - 1].b) / u, cls: 'ok' });
  const issues = [];
  if (!els.length) return { score: 0, issues: ['Nothing keyed.'], gaps, expS, gotS };

  if (gotS === expS) {
    for (const gp of gaps) {
      const prev = exp[gp.i - 1];
      const letter = want[prev.li];
      if (!prev.end) {
        if (gp.units > SPLIT) { gp.cls = 'split'; issues.push(`You paused inside ${letter} (${gp.units.toFixed(1)} units), so it split in two. Keep the levers moving.`); }
        else if (gp.units > HITCH) { gp.cls = 'hitch'; issues.push(`A hitch inside ${letter} (${gp.units.toFixed(1)} units). Close to splitting.`); }
      } else if (gp.units < SPLIT) {
        gp.cls = 'merge'; issues.push(`${letter} and ${want[prev.li + 1]} ran together (${gp.units.toFixed(1)} units). Leave a beat between letters.`);
      } else if (gp.units > LONG) {
        gp.cls = 'long'; issues.push(`Long gap after ${letter} (${gp.units.toFixed(1)} units). That reads as a word break.`);
      }
    }
    const bad = gaps.filter((x) => x.cls === 'split' || x.cls === 'merge').length;
    const soft = gaps.filter((x) => x.cls === 'hitch' || x.cls === 'long').length;
    const score = gaps.length ? Math.max(0, 1 - (bad + soft * 0.4) / gaps.length) : 1;
    return { score, issues, gaps, expS, gotS };
  }

  // The elements themselves are wrong: say where it first went off.
  let k = 0;
  while (k < gotS.length && k < expS.length && gotS[k] === expS[k]) k++;
  const at = exp[Math.min(k, exp.length - 1)];
  const letter = want[at?.li ?? 0] ?? '';
  if (gotS.length > expS.length && k === expS.length) issues.push(`An extra ${name(gotS[k])} after ${letter}: let go of the paddle sooner.`);
  else if (k === gotS.length) issues.push(`${letter} came up short: the ${name(expS[k])} never went out. Hold the lever a beat longer.`);
  else issues.push(`In ${letter}: a ${name(gotS[k])} where a ${name(expS[k])} belongs.`);
  for (const gp of gaps) if (gp.units > SPLIT && gp.i - 1 < k && !exp[gp.i - 1]?.end) gp.cls = 'split';
  return { score: 0.5 * (k / expS.length), issues, gaps, expS, gotS, wrongAt: k };
}

/** Ideal timing for `want` from 0: [[startU, endU, letterIndex]], total units. */
function ideal(want) {
  const out = [];
  let t = 0;
  [...want].forEach((ch, li) => {
    const pat = MORSE[ch] || '';
    [...pat].forEach((k, j) => {
      const len = k === '.' ? 1 : 3;
      out.push([t, t + len, li]);
      t += len + (j === pat.length - 1 ? 0 : 1);
    });
    t += 3;
  });
  return { els: out, total: Math.max(1, t - 3) };
}

const GAP_COLOR = { split: C.red, merge: C.red, hitch: C.amber, long: C.amber };

/** The bench: graticule, ideal trace on top, his fist below, gaps flagged. */
export function drawFist(g, x, y, w, h, want, marks, u, a) {
  const c = g.ctx;
  g.panel(x, y, w, h, { color: C.green, fillAlpha: 0.92 });
  g.text('KEYING SCOPE', x + 14, y + 22, { size: 20, color: C.green, spacing: 3 });
  const id = ideal(want);
  const t0 = marks.length ? marks[0][0] : 0;
  const gotU = marks.length ? (marks[marks.length - 1][1] - t0) / u : 0;
  const span = Math.max(id.total, gotU) + 2;
  const px = x + 16, pw = w - 32, top = y + 40, ph = h - 120;
  const sx = (units) => px + (units / span) * pw;
  // Graticule: a line per unit when there's room, brighter every 5.
  c.save();
  c.beginPath(); c.rect(px, top, pw, ph); c.clip();
  const step = pw / span >= 6 ? 1 : 5;
  for (let k = 0; k <= span; k += step) {
    c.fillStyle = k % 5 === 0 ? 'rgba(60,255,154,0.18)' : 'rgba(60,255,154,0.07)';
    c.fillRect(Math.round(sx(k)), top, 1, ph);
  }
  for (let k = 0; k <= 4; k++) { c.fillStyle = 'rgba(60,255,154,0.1)'; c.fillRect(px, top + (ph * k) / 4, pw, 1); }

  const trace = (els, base, hi, col, glow) => {
    c.strokeStyle = col; c.lineWidth = 2.5; c.shadowColor = col; c.shadowBlur = glow;
    c.beginPath(); c.moveTo(px, base);
    for (const [s, e] of els) { c.lineTo(sx(s), base); c.lineTo(sx(s), hi); c.lineTo(sx(e), hi); c.lineTo(sx(e), base); }
    c.lineTo(px + pw, base); c.stroke();
  };
  const r1 = top + ph * 0.42, r2 = top + ph * 0.92, amp = ph * 0.3;
  trace(id.els, r1, r1 - amp, C.cyan, 6);
  // Flag gaps on his trace before drawing it.
  const mine = marks.map(([s, e]) => [(s - t0) / u, (e - t0) / u]);
  if (a) {
    for (const gp of a.gaps) {
      const col = GAP_COLOR[gp.cls];
      if (!col || !mine[gp.i]) continue;
      const s = sx(mine[gp.i - 1][1]), e = sx(mine[gp.i][0]);
      c.shadowBlur = 0;
      c.fillStyle = col; c.globalAlpha = 0.28; c.fillRect(s, r2 - amp - 6, Math.max(2, e - s), amp + 12); c.globalAlpha = 1;
    }
  }
  trace(mine, r2, r2 - amp, a && a.score < 0.6 ? C.amber : C.green, 12);
  c.restore();
  // Letter names over the ideal trace.
  let li = -1;
  for (const [s, , l] of id.els) if (l !== li) { li = l; g.text(want[l], sx(s), top + 12, { size: 18, color: C.cyan, glow: 4 }); }
  g.text('IDEAL', px + pw, r1 - amp - 4, { size: 11, font: FONT.ui, color: C.cyan, align: 'right', glow: 0 });
  g.text(marks.length ? 'YOUR FIST' : 'KEY IT...', px + pw, r2 - amp - 4, { size: 11, font: FONT.ui, color: C.green, align: 'right', glow: 0 });

  // Verdict lines.
  const vy = top + ph + 22;
  if (a) {
    const pct = Math.round(a.score * 100);
    g.text(`RHYTHM ${pct}%`, x + 14, vy, { size: 28, color: pct >= 85 ? C.green : pct >= 60 ? C.amber : C.red });
    const msg = a.issues[0] || 'Every gap where it belongs.';
    g.wrap(msg, w - 190, 15).slice(0, 3).forEach((l, i) => g.text(l, x + 180, vy - 8 + i * 19, { size: 15, font: FONT.ui, color: a.issues.length ? C.amber : C.green, glow: 2 }));
    if (a.issues.length > 1) g.text(`+${a.issues.length - 1} MORE`, x + w - 14, y + 22, { size: 13, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
  } else {
    g.text('THE KEYER TIMES THE DITS AND DAHS. THE GAPS ARE YOURS.', x + 14, vy, { size: 14, font: FONT.ui, color: C.grey, glow: 0 });
  }
}
