// QSO LADDER: copy a real contact one field at a time. Every over follows the
// script hams actually use, so the whole transcript is on screen with only
// some fields blanked, and the word sounding right now lights up. Rung 1
// blanks the RST; each rung blanks one more field (NAME, QTH, then the other
// station's CALL) until it's a full contact. Two clean QSOs in a row climb a
// rung (p.ladder); two poor ones step back down. A clean QSO earns a QSL card.

import { C, FONT } from '../gfx.js';
import { backdrop } from './common.js';
import { Fields } from './fields.js';
import { NAMES, QTHS, callsign, rand } from '../content.js';
import { localDay, myCall } from '../store.js';

const QSOS = 4;
const AGN_MAX = 2;
export const RUNGS = [['RST'], ['RST', 'NAME'], ['RST', 'NAME', 'QTH'], ['RST', 'NAME', 'QTH', 'CALL']];
const UP_AFTER = 2, DOWN_AFTER = 2;

// Overs as he'd hear them answering a CQ. {F} marks a field.
const OVERS = [
  '{ME} DE {CALL} GE TNX FER CALL UR RST {RST} {RST} NAME {NAME} {NAME} QTH {QTH} {QTH} HW? {ME} DE {CALL} K',
  '{ME} DE {CALL} R GM OM UR RST {RST} {RST} QTH {QTH} {QTH} NAME {NAME} {NAME} BK',
  'R {ME} DE {CALL} FB TNX RST {RST} {RST} OP {NAME} {NAME} QTH {QTH} {QTH} {ME} DE {CALL} KN',
  '{ME} DE {CALL} TU UR {RST} {RST} NAME HR {NAME} {NAME} QTH NR {QTH} {QTH} HW CPY? {ME} DE {CALL} K',
];

export function ladderState(p) {
  return (p.ladder ||= { rung: 0, clean: 0, poor: 0 });
}

export class Ladder {
  constructor(game) {
    this.game = game;
    const p = game.store.p;
    this.set = new Set(game.core.koch.slice(0, p.unlocked));
    this.lad = ladderState(p);
    this.n = 0;
    this.results = [];
    this.qsls = [];
    this.score = 0;
    this.notes = [];
    this.startedAt = performance.now();
  }

  enter() {
    this.game.audio.music(null);
    this.next();
  }

  exit() { this.game.wantText(false); }

  get rung() { return RUNGS[this.lad.rung]; }

  next() {
    if (this.n >= QSOS) { this.finish(false); return; }
    this.n++;
    const me = myCall(this.game.store.p.settings);
    const q = { CALL: callsign(), RST: rand(['599', '579', '559', '589', '569', '5NN', '449']), NAME: rand(NAMES), QTH: rand(QTHS) };
    this.q = q;
    // Tokens of the over; each knows which field (if any) it belongs to.
    this.tokens = rand(OVERS).split(' ').map((t) => {
      const m = t.match(/^\{(\w+)\}$/);
      if (!m) return { text: t };
      if (m[1] === 'ME') return { text: me };
      return { text: q[m[1]], field: m[1] };
    });
    this.text = this.tokens.map((t) => t.text).join(' ');
    // Blank only fields on this rung that have something left to copy.
    this.blanks = this.rung.filter((f) => [...q[f]].some((ch) => this.set.has(ch)));
    this.fields = new Fields(this.blanks.map((f) => [f, q[f]]), this.set);
    // Where each sounding character sits in the token list, for the highlight.
    this.charTok = [];
    this.tokens.forEach((t, i) => { for (let k = 0; k < t.text.length; k++) this.charTok.push(i); });
    this.agn = 0;
    this.seed = (Math.random() * 2 ** 31) | 1;
    this.state = 'rx';
    this.verdict = null;
    this.play(0.6);
    this.game.wantText(this.blanks.length > 0);
  }

  play(delay = 0.05) {
    const p = this.game.store.p;
    const lvl = this.lad.rung / (RUNGS.length - 1);
    const s = this.game.audio.say(this.text, { effWpm: p.effWpm, noise: 0.05 + 0.12 * lvl, qsb: 0.1 * lvl, delay, seed: this.seed });
    this.rx = { t0: s.t0, end: s.end, chars: s.r.chars };
  }

  /** Index of the token sounding now, or -1. */
  sounding() {
    if (!this.rx) return -1;
    const t = this.game.audio.now() - this.rx.t0;
    if (t < 0 || this.game.audio.now() > this.rx.end) return -1;
    let ci = -1;
    this.rx.chars.forEach((c, i) => { if (t >= c.start) ci = i; });
    return ci >= 0 ? this.charTok[ci] ?? -1 : -1;
  }

  again() {
    if (this.state !== 'rx' || this.agn >= AGN_MAX) return;
    this.agn++;
    this.play();
  }

  submit() {
    if (this.state !== 'rx') return;
    const game = this.game, g = game.gfx;
    const gr = this.fields.grade();
    const clean = gr.ok === gr.total;
    this.results.push({ ok: gr.ok, total: gr.total });
    this.score += gr.ok * 250 + gr.charsOk * 20 - this.agn * 60 + (clean && gr.total ? 200 * (this.lad.rung + 1) : 0);
    // Ladder: clean climbs, poor (under half the fields) slides.
    const lad = this.lad;
    let move = null;
    if (gr.total && clean) { lad.clean++; lad.poor = 0; } else if (gr.total && gr.ok / gr.total < 0.5) { lad.poor++; lad.clean = 0; } else { lad.clean = 0; lad.poor = 0; }
    if (lad.clean >= UP_AFTER && lad.rung < RUNGS.length - 1) { lad.rung++; lad.clean = 0; move = 'up'; }
    else if (lad.poor >= DOWN_AFTER && lad.rung > 0) { lad.rung--; lad.poor = 0; move = 'down'; }
    if (clean) {
      const q = this.q;
      this.qsls.push({ call: q.CALL, rst: q.RST, name: q.NAME, qth: q.QTH, day: localDay(), copied: `${gr.ok}/${gr.total}` });
      game.audio.sfx('win');
      game.particles.burst(g.W / 2, g.H * 0.5, C.amber, 50, 360);
      g.flash(0.15);
    } else {
      game.audio.sfx('bad');
      g.glitch(0.6);
    }
    if (move === 'up') { game.audio.sfx('unlock'); this.notes.push(`RUNG ${lad.rung + 1}: NOW COPY ${RUNGS[lad.rung].join(' + ')}`); }
    if (move === 'down') this.notes.push(`BACK TO RUNG ${lad.rung + 1}`);
    this.verdict = { clean, gr, move };
    this.state = 'reveal';
    this.revealAge = 0;
    game.wantText(false);
    game.store.save();
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const r = this.results;
    this.game.go('results', {
      mission: 'ladder', aborted,
      total: r.reduce((s, x) => s + x.total, 0), correct: r.reduce((s, x) => s + x.ok, 0),
      score: Math.max(0, this.score), qsls: this.qsls,
      ladderNote: `QSO LADDER: RUNG ${this.lad.rung + 1}/${RUNGS.length} (${RUNGS[this.lad.rung].join(' + ')})`,
      seconds: (performance.now() - this.startedAt) / 1000,
    });
  }

  onKey(e, down) {
    if (!down) return false;
    if (e.key === 'Escape') { this.finish(true); return true; }
    if (this.state === 'reveal') {
      if ((e.key === 'Enter' || e.key === ' ') && this.revealAge > 0.4) this.next();
      return true;
    }
    if (e.key === '?' || (e.key === 'Tab' && e.shiftKey)) { this.again(); return true; }
    const r = this.fields.key(e);
    if (r === 'submit') { this.submit(); return true; }
    if (r === 'typed') this.game.audio.sfx('type');
    return !!r;
  }

  update(dt) {
    if (this.state === 'reveal') this.revealAge += dt;
  }

  draw(g) {
    const game = this.game, lad = this.lad;
    backdrop(game, 'bg-contact', { dark: 0.5, zoom: 1.06 });
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text('QSO LADDER', 22, 32, { size: 38, color: C.cyan, spacing: 3 });
    g.text(`QSO ${this.n}/${QSOS}  //  RUNG ${lad.rung + 1}/${RUNGS.length}: COPY ${this.rung.join(' + ')}  //  ${game.store.p.effWpm} WPM EFF`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    g.text(String(Math.max(0, this.score)).padStart(5, '0'), g.W - 22, 32, { size: 40, color: C.amber, align: 'right' });
    // Rung pips: filled to the current rung, the clean count as a half step.
    for (let i = 0; i < RUNGS.length; i++) {
      const x = g.W - 22 - (RUNGS.length - i) * 30;
      g.rect(x, 52, 24, 10, i <= lad.rung ? C.cyan : C.indigo, i <= lad.rung ? 0.9 : 0.5);
    }

    // Transcript of the over: blanks for the fields to copy, the sounding word lit.
    const tx = 30, tw = g.W - 60, ty = 104;
    g.panel(tx - 10, ty - 6, tw + 20, g.portrait ? 360 : 230, { color: C.greenDim, fillAlpha: 0.88 });
    g.text(this.state === 'rx' && game.audio.now() < this.rx.end ? 'RECEIVING' : 'THE OVER', tx + 4, ty + 16, { size: 14, font: FONT.ui, color: C.grey, glow: 0 });
    const lit = this.sounding();
    const size = g.portrait ? 30 : 32, sp = 2;
    let x = tx + 4, y = ty + 52;
    const reveal = this.state === 'reveal';
    this.tokens.forEach((t, i) => {
      const blank = t.field && this.blanks.includes(t.field);
      const shown = blank && !reveal ? '_'.repeat(t.text.length) : t.text;
      const w = g.measure(shown, size, 'VT323', sp);
      if (x + w > tx + tw) { x = tx + 4; y += size + 10; }
      const col = i === lit ? C.white : blank ? (reveal ? (this.fields.list.find((f) => f.label === t.field)?.good ? C.green : C.red) : C.amber) : C.cyan;
      g.text(shown, x, y, { size, color: col, spacing: sp, glow: i === lit ? 22 : 4 });
      x += w + g.measure(' ', size, 'VT323', sp) + 6;
    });

    // The log: one field per blank.
    const ly = g.portrait ? 500 : 360;
    g.text(this.blanks.length ? 'YOUR LOG' : 'NOTHING TO COPY ON THIS RUNG YET: JUST FOLLOW ALONG', tx, ly, { size: 18, font: FONT.ui, color: C.amber, glow: 3 });
    const bottom = this.fields.draw(g, tx, ly + 26, tw, { box: g.portrait ? 44 : 46, reveal, fieldGap: 40 });

    const by = Math.max(bottom + 10, g.H - 110);
    if (this.state === 'rx') {
      if (game.button('lad-log', tx, by, 220, 46, 'LOG IT [ENTER]', { size: 24, color: C.amber })) this.submit();
      if (game.button('lad-agn', tx + 232, by, 220, 46, this.agn >= AGN_MAX ? 'NO MORE AGN' : `AGN? [?] (${AGN_MAX - this.agn})`, { size: 22, color: C.cyan, disabled: this.agn >= AGN_MAX })) this.again();
      if (!g.portrait) g.text('TYPE AS IT COMES IN  //  TAB: NEXT FIELD  //  FIELDS FILL LEFT TO RIGHT', tx + 470, by + 28, { size: 13, font: FONT.ui, color: C.grey, glow: 0 });
    } else if (this.verdict) {
      const v = this.verdict;
      const msg = v.clean ? (this.blanks.length ? 'CLEAN COPY. QSL CARD EARNED.' : 'QSO LOGGED. QSL CARD EARNED.')
        : `COPIED ${v.gr.ok}/${v.gr.total} FIELDS (${v.gr.charsOk}/${v.gr.chars} LETTERS)`;
      g.text(msg, tx, by - 16, { size: 26, color: v.clean ? C.green : C.amber, spacing: 2 });
      if (v.move) g.text(v.move === 'up' ? `CLIMBED TO RUNG ${lad.rung + 1}: NOW COPY ${this.rung.join(' + ')}` : `STEPPED BACK TO RUNG ${lad.rung + 1}. LOCK THESE IN.`, g.W - 30, by - 16, { size: 22, color: v.move === 'up' ? C.amber : C.cyan, align: 'right' });
      if (game.button('lad-hear', tx, by + 6, 220, 46, 'HEAR IT AGAIN', { size: 22, color: C.cyan })) this.play();
      if (game.button('lad-next', tx + 232, by + 6, 260, 46, this.n >= QSOS ? 'FINISH [ENTER]' : 'NEXT QSO [ENTER]', { size: 22, color: C.amber })) this.next();
    }
  }
}
