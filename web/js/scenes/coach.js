// COACH: reads his saved stats and mission log and says what to work on next.
// Receive accuracy and response time per letter, send mix-ups sorted into
// "extra element" / "dropped element" / "swapped", trends across missions,
// and up to three prescriptions, each with a button that starts the fix.

import { C, FONT } from '../gfx.js';
import { backdrop, accColor, drawPattern } from './common.js';
import { MORSE } from '../content.js';
import { launch } from './hub.js';

const NAMES = { intercept: 'INTERCEPT', relay: 'RELAY', rush: 'WORD RUSH', drill: 'MIX-UP DRILL', blind: 'BLIND RELAY', echo: 'ECHO', headcopy: 'HEAD COPY', pileup: 'PILEUP' };
const SLOW_MS = 1500;

const EL = { '.': 'DIT', '-': 'DAH' };

/**
 * How a sent pattern went wrong, compared with the one he wanted. An extra
 * element that only lengthens a run (A .- sent as U ..-) means the paddle was
 * held a beat too long; one that lands elsewhere is a stray touch.
 */
export function sendFault(want, got) {
  const a = MORSE[want] || '', b = MORSE[got] || '';
  if (got === '*') return { kind: 'other', text: 'NOT READABLE' };
  if (!a || !b) return { kind: 'other', text: 'DIFFERENT SHAPE' };
  const where = (i, n) => (i === 0 ? 'AT THE START' : i === n ? 'AT THE END' : 'IN THE MIDDLE');
  for (const [long, short, kind] of [[b, a, 'extra'], [a, b, 'missing']]) {
    if (long.length !== short.length + 1) continue;
    for (let i = 0; i < long.length; i++) {
      if (long.slice(0, i) + long.slice(i + 1) !== short) continue;
      const e = long[i];
      const run = long[i - 1] === e || long[i + 1] === e;
      if (kind === 'extra') return run ? { kind: 'held', text: `ONE ${EL[e]} TOO MANY` } : { kind: kind + (i === long.length - 1 ? '-end' : ''), text: `EXTRA ${EL[e]} ${where(i, long.length - 1)}` };
      return run ? { kind: 'short', text: `ONE ${EL[e]} SHORT` } : { kind, text: `${EL[e]} DROPPED ${where(i, long.length - 1)}` };
    }
  }
  if (a.length === b.length) return { kind: 'swap', text: 'DIT AND DAH SWAPPED' };
  return { kind: 'other', text: 'DIFFERENT SHAPE' };
}

/** Everything the screen shows, from progress and the mission log. */
export function analyze(p, koch, sessions) {
  const letters = koch.slice(0, p.unlocked);
  const rx = letters.map((ch) => ({ ch, ...(p.stats[ch] || { acc: 0, lat: 0, seen: 0, ok: 0 }) }));
  const heard = rx.filter((r) => r.seen >= 8);
  const weak = heard.filter((r) => r.acc < 0.9).sort((a, b) => a.acc - b.acc);
  const slow = heard.filter((r) => r.acc >= 0.9 && r.lat > SLOW_MS).sort((a, b) => b.lat - a.lat);
  const mix = Object.entries(p.sendMix || {}).filter(([, w]) => w >= 0.3)
    .map(([k, w]) => ({ want: k[0], got: k[2], w, fault: sendFault(k[0], k[2]) }))
    .sort((a, b) => b.w - a.w);
  const kinds = (...ks) => mix.filter((m) => ks.includes(m.fault.kind));
  const conf = Object.entries(p.confusions || {}).filter(([, w]) => w >= 0.3).map(([k, w]) => ({ a: k[0], b: k[2], w }));
  const done = sessions.filter((s) => !s.detail?.aborted && s.total > 0);
  const of = (m) => done.filter((s) => s.mission === m);
  const ic = of('intercept');
  const lat = ic.map((s) => s.detail?.avgLat || 0).filter((x) => x > 0);
  const trend = lat.length >= 6 ? avg(lat.slice(-3)) / avg(lat.slice(0, 3)) : 1;
  return {
    letters, rx, weak, slow, mix, conf, trend,
    held: kinds('held'), tail: kinds('extra-end'), stray: kinds('extra'), short: kinds('short', 'missing'),
    icLat: lat, icAcc: ic.map((s) => s.correct / s.total),
    rushAcc: of('rush').map((s) => s.correct / s.total),
    unlockedAt: done.map((s) => s.detail?.unlocked || 0),
    missions: done.length, minutes: Math.round(sessions.reduce((t, s) => t + (s.seconds || 0), 0) / 60),
    played: new Set(sessions.map((s) => s.mission)),
  };
}

function avg(a) { return a.reduce((s, x) => s + x, 0) / Math.max(1, a.length); }
const pct = (x) => `${Math.round(x * 100)}%`;
const secs = (ms) => `${(ms / 1000).toFixed(1)} S`;

/** Up to three things to do next, most useful first. */
export function prescribe(a, p) {
  const out = [];
  const ex = (list) => list.slice(0, 3).map((m) => `${m.want} CAME OUT ${m.got}`).join(', ');
  const kw = p.settings.keyerWpm;
  if (a.held.length >= 2) {
    out.push(kw > 10
      ? { title: 'YOU HOLD THE PADDLE A BEAT TOO LONG', why: `${ex(a.held.slice(0, 2))}. The lever stays down one element too long. A slower keyer gives you time to let go.`, act: `KEYER TO ${kw - 2} WPM`, mode: 'slower' }
      : { title: 'YOU HOLD THE PADDLE A BEAT TOO LONG', why: `${ex(a.held)}. Count the elements and let go on the last one.`, act: 'BLIND RELAY', mission: 'blind' });
  } else if (a.tail.length >= 2 && p.settings.modeB) {
    out.push({ title: 'AN EXTRA ELEMENT AT THE END', why: `${ex(a.tail)}. Mode B adds one more element after a squeeze. Mode A stops when you let go.`, act: 'SWITCH TO MODE A', mode: 'modeA' });
  } else if (a.stray.length + a.short.length >= 2) {
    out.push({ title: 'YOUR FIST NEEDS REPS', why: `${ex([...a.stray, ...a.short])}. Send from memory and hear what came out.`, act: 'BLIND RELAY', mission: 'blind' });
  }
  if (a.weak.length) {
    const w = a.weak[0];
    const pair = a.conf.find((c) => c.a === w.ch || c.b === w.ch);
    out.push(pair
      ? { title: `${w.ch} IS YOUR WEAK SPOT (${pct(w.acc)})`, why: `You mix it up with ${pair.a === w.ch ? pair.b : pair.a}. Hear them side by side until the difference is obvious.`, act: 'MIX-UP DRILL', mission: 'drill' }
      : { title: `${w.ch} IS YOUR WEAK SPOT (${pct(w.acc)})`, why: `Right ${pct(w.acc)} of the time. INTERCEPT sends your weak letters more often.`, act: 'INTERCEPT', mission: 'intercept' });
  }
  if (a.slow.length || a.trend > 1.5) {
    const names = a.slow.slice(0, 3).map((r) => r.ch).join(' ');
    out.push({
      title: a.trend > 1.5 ? 'YOU ARE THINKING, NOT HEARING' : `${names} ARE RIGHT BUT SLOW`,
      why: a.trend > 1.5
        ? `INTERCEPT replies went from ${secs(avg(a.icLat.slice(0, 3)))} to ${secs(avg(a.icLat.slice(-3)))}. Slow letters fill your buffer. Short, frequent INTERCEPT runs make them reflex.`
        : `Over ${secs(SLOW_MS)} each. Speed comes from reps, not effort: short INTERCEPT runs.`,
      act: 'INTERCEPT', mission: 'intercept',
    });
  }
  if ((p.rushLen || 2) <= 3) {
    out.push({ title: `WORDS: ${p.rushLen || 2} LETTERS SO FAR`, why: 'Type each letter as it lands. Three clean words in a row adds a letter.', act: 'WORD RUSH', mission: 'rush' });
  }
  for (const m of ['headcopy', 'echo', 'pileup']) {
    if (!a.played.has(m)) out.push({ title: `NOT TRIED YET: ${NAMES[m]}`, why: 'A different angle on the same letters.', act: NAMES[m], mission: m });
  }
  if (!out.length) out.push({ title: 'CLEAN ACROSS THE BOARD', why: 'Push for the next letter.', act: 'INTERCEPT', mission: 'intercept' });
  return out.slice(0, 3);
}

export class Coach {
  constructor(game) {
    this.game = game;
    this.sessions = null;
    this.t = 0;
  }

  enter() {
    this.game.audio.music('continual');
    this.game.store.sessions().then((s) => { this.sessions = s || []; });
  }

  onKey(e, down) {
    if (!down) return false;
    if (e.key === 'Escape' || e.key === 'Backspace') { this.game.go('hub'); return true; }
    const k = +e.key;
    if (k >= 1 && k <= 3 && this.rx?.[k - 1]) { this.act(this.rx[k - 1]); return true; }
    return false;
  }

  act(r) {
    const game = this.game;
    const s = game.store.p.settings;
    if (r.mode) {
      if (r.mode === 'modeA') s.modeB = false;
      else s.keyerWpm = Math.max(8, s.keyerWpm - 2);
      game.audio.configKeyer();
      game.store.save();
      game.audio.sfx('ok');
      this.flash = { msg: r.mode === 'modeA' ? 'KEYER IS NOW MODE A' : `KEYER IS NOW ${s.keyerWpm} WPM`, t: 2.5 };
      this.done = { ...this.done, [r.act]: true };
      return;
    }
    launch(game, r.mission);
  }

  update(dt) {
    this.t += dt;
    if (this.flash) { this.flash.t -= dt; if (this.flash.t <= 0) this.flash = null; }
  }

  draw(g) {
    const game = this.game, p = game.store.p;
    backdrop(game, 'bg-shack-hub', { dark: 0.78, rainAlpha: 0.2 });
    g.shade(0, 0, g.W, 100, 'rgba(5,4,13,0.95)', 'rgba(5,4,13,0)');
    g.text('COACH', 24, 40, { size: 52, color: C.amber, spacing: 5 });
    if (game.button('back', g.W - 170, 18, 150, 40, 'BACK [ESC]', { size: 20, color: C.cyan })) { game.go('hub'); return; }
    if (!this.sessions) {
      g.text('READING YOUR LOG...', g.W / 2, g.H / 2, { size: 30, color: C.cyan, align: 'center' });
      return;
    }
    const a = analyze(p, game.core.koch, this.sessions);
    this.rx = prescribe(a, p);
    g.text(`${a.missions} MISSIONS  //  ${a.minutes} MIN  //  ${p.unlocked} LETTERS  //  ${p.settings.charWpm} WPM @ ${p.effWpm} EFF`, 26, 76, { size: 16, font: FONT.ui, color: C.cyan, glow: 4 });

    const L = g.portrait
      ? { rx: [20, 104, 680, 300], recv: [20, 416, 680, 250], send: [20, 678, 680, 250], trend: [20, 940, 680, 300] }
      : { rx: [24, 104, 600, 330], recv: [640, 104, 616, 330], send: [24, 446, 600, 250], trend: [640, 446, 616, 250] };
    this.drawRx(g, a, ...L.rx);
    this.drawRecv(g, a, ...L.recv);
    this.drawSend(g, a, ...L.send);
    this.drawTrend(g, a, ...L.trend);
    if (this.flash) g.text(this.flash.msg, g.W / 2, g.H / 2, { size: 44, color: C.green, align: 'center', glow: 30, alpha: Math.min(1, this.flash.t * 2) });
  }

  drawRx(g, a, x, y, w, h) {
    const game = this.game;
    g.panel(x, y, w, h, { color: C.amber, fillAlpha: 0.85 });
    g.text('WORK ON THIS NEXT', x + 16, y + 26, { size: 24, color: C.amber, spacing: 2 });
    const rowH = (h - 44) / 3;
    this.rx.forEach((r, i) => {
      const yy = y + 44 + i * rowH;
      g.text(`${i + 1}  ${r.title}`, x + 16, yy + 16, { size: 21, color: C.white, glowColor: C.amber });
      wrap(g, r.why, x + 40, yy + 40, w - 230, 15, C.grey);
      const set = this.done?.[r.act];
      if (game.button(`coach-${i}`, x + w - 182, yy + 22, 166, 40, set ? 'DONE' : r.act, { size: 17, color: C.amber, disabled: !!set })) this.act(r);
    });
  }

  drawRecv(g, a, x, y, w, h) {
    g.panel(x, y, w, h, { color: C.greenDim, fillAlpha: 0.85 });
    g.text('RECEIVE', x + 16, y + 26, { size: 24, color: C.green, spacing: 2 });
    g.text('ACCURACY // SECONDS TO ANSWER', x + w - 16, y + 26, { size: 12, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
    const n = a.rx.length, per = Math.min(n, g.portrait ? 7 : 6);
    const rows = Math.ceil(n / per);
    const cw = (w - 32) / per, ch = Math.min(96, (h - 48) / rows);
    a.rx.forEach((r, i) => {
      const cx = x + 16 + (i % per) * cw, cy = y + 42 + Math.floor(i / per) * ch;
      const col = r.seen ? accColor(r) : C.grey;
      g.panel(cx + 3, cy + 3, cw - 6, ch - 6, { color: col, fillAlpha: 0.6, glow: 4 });
      g.text(r.ch, cx + 16, cy + ch * 0.42, { size: Math.min(40, ch * 0.42), color: col });
      g.text(r.seen ? pct(r.acc) : 'NEW', cx + cw - 12, cy + ch * 0.32, { size: 18, color: col, align: 'right' });
      if (r.seen) g.text(secs(r.lat), cx + cw - 12, cy + ch * 0.6, { size: 15, color: r.lat > SLOW_MS ? C.amber : C.cyan, align: 'right' });
      // Accuracy bar along the bottom of the tile.
      g.rect(cx + 10, cy + ch - 18, (cw - 20) * (r.seen ? r.acc : 0), 4, col, 0.9);
    });
  }

  drawSend(g, a, x, y, w, h) {
    g.panel(x, y, w, h, { color: C.cyan, fillAlpha: 0.85 });
    g.text('SEND MIX-UPS', x + 16, y + 26, { size: 24, color: C.cyan, spacing: 2 });
    g.text('ASKED FOR  >  CAME OUT', x + w - 16, y + 26, { size: 12, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
    if (!a.mix.length) {
      g.text('NONE ON RECORD. PLAY BLIND RELAY OR ECHO TO TEST YOUR FIST.', x + w / 2, y + h / 2, { size: 15, font: FONT.ui, color: C.grey, align: 'center' });
      return;
    }
    const rows = a.mix.slice(0, 5), rh = (h - 44) / 5;
    rows.forEach((m, i) => {
      const yy = y + 44 + i * rh + rh / 2;
      g.text(m.want, x + 26, yy, { size: 26, color: C.green });
      drawPattern(g, MORSE[m.want], x + 100, yy, 6, C.green);
      g.text('>', x + 160, yy, { size: 20, color: C.grey });
      g.text(m.got, x + 186, yy, { size: 26, color: C.red });
      drawPattern(g, MORSE[m.got], x + 260, yy, 6, C.red);
      g.text(m.fault.text, x + w - 16, yy, { size: 14, font: FONT.ui, color: m.fault.kind === 'held' ? C.amber : C.cyan, align: 'right' });
    });
  }

  drawTrend(g, a, x, y, w, h) {
    g.panel(x, y, w, h, { color: C.greenDim, fillAlpha: 0.85 });
    g.text('TRENDS', x + 16, y + 26, { size: 24, color: C.green, spacing: 2 });
    const sh = (h - 60) / 3;
    spark(g, x + 16, y + 44, w - 32, sh - 8, a.icLat, C.amber, secs, 'INTERCEPT: SECONDS TO ANSWER (LOWER IS BETTER)');
    spark(g, x + 16, y + 44 + sh, w - 32, sh - 8, a.icAcc, C.green, pct, 'INTERCEPT: ACCURACY', [0, 1]);
    spark(g, x + 16, y + 44 + sh * 2, w - 32, sh - 8, a.rushAcc, C.cyan, pct, 'WORD RUSH: WORDS COPIED', [0, 1]);
  }
}

/** A labeled glowing line of the last 30 values. */
function spark(g, x, y, w, h, vals, color, fmt, label, range) {
  g.text(label, x, y + 8, { size: 11, font: FONT.ui, color: C.grey, glow: 0 });
  const v = vals.slice(-30);
  if (v.length < 2) { g.text('NOT ENOUGH RUNS YET', x + w - 4, y + 8, { size: 11, font: FONT.ui, color: C.grey, align: 'right', glow: 0 }); return; }
  const lo = range ? range[0] : Math.min(...v), hi = range ? range[1] : Math.max(...v);
  const top = y + 16, bh = h - 18, gw = w - 90;
  const px = (i) => x + (i / (v.length - 1)) * gw;
  const py = (val) => top + bh - ((val - lo) / Math.max(1e-6, hi - lo)) * bh;
  const c = g.ctx;
  c.save();
  c.strokeStyle = color; c.lineWidth = 2; c.shadowColor = color; c.shadowBlur = 10;
  c.beginPath();
  v.forEach((val, i) => (i ? c.lineTo(px(i), py(val)) : c.moveTo(px(i), py(val))));
  c.stroke();
  c.fillStyle = color;
  c.beginPath(); c.arc(px(v.length - 1), py(v[v.length - 1]), 4, 0, Math.PI * 2); c.fill();
  c.restore();
  g.text(fmt(v[v.length - 1]), x + w, top + bh / 2, { size: 20, color, align: 'right' });
}

/** Word-wrapped UI text, at most three lines. */
function wrap(g, text, x, y, w, size, color) {
  const words = text.split(' ');
  let line = '', n = 0;
  for (const word of words) {
    const t = line ? `${line} ${word}` : word;
    if (g.measure(t, size, FONT.ui) > w && line) {
      g.text(line, x, y + n * (size + 5), { size, font: FONT.ui, color, glow: 0 });
      line = word;
      if (++n >= 3) return;
    } else line = t;
  }
  if (line && n < 3) g.text(line, x, y + n * (size + 5), { size, font: FONT.ui, color, glow: 0 });
}
