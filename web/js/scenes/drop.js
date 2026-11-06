// DEAD DROP: one message a day, the same for every operator on that date
// (seeded by the date), so scores can be compared. It plays once, one more
// time on request, then it burns. The first try of the day is the one that
// counts; later tries are practice. p.drops keeps the scored days for the
// streak.

import { C, FONT } from '../gfx.js';
import { backdrop } from './common.js';
import { Fields } from './fields.js';
import { localDay } from '../store.js';

const PLAYS = 2;

const POOL = {
  VERB: ['MEET', 'WAIT', 'WATCH', 'CALL', 'SIGNAL', 'LISTEN', 'HIDE', 'RUN'],
  PLACE: ['TOWER', 'DOCK', 'TUNNEL', 'ROOF', 'ALLEY', 'STATION', 'BRIDGE', 'MARKET', 'SHACK', 'FENCE'],
  OBJ: ['KEY', 'TAPE', 'LOG', 'MAP', 'CODE', 'RADIO', 'BADGE', 'FILE', 'COIL', 'LENS'],
  STATE: ['NEAR', 'AWAKE', 'LISTENING', 'MOVING', 'BLIND', 'LATE', 'ANGRY', 'CLOSE'],
  TIME: ['0200', '2300', '0100', '0400', '0300', '2200'],
};
const TEMPLATES = [
  '{VERB} AT THE {PLACE} {TIME} BRING THE {OBJ} FAUX IS {STATE}',
  'DROP IS AT THE {PLACE} {OBJ} UNDER THE {PLACE} {VERB} AT {TIME}',
  'NIGHTOP {VERB} AT {TIME} {PLACE} ONLY FAUX IS {STATE} BURN THIS',
  'THE {OBJ} IS IN THE {PLACE} VERA WILL {VERB} AT {TIME}',
  'FAUX IS {STATE} MOVE THE {OBJ} TO THE {PLACE} BY {TIME}',
];

function seeded(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's message: the same text for anyone on this date. */
export function dropFor(day) {
  const r = seeded(`nightcopy-drop-${day}`);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const tpl = pick(TEMPLATES);
  return tpl.replace(/\{(\w+)\}/g, (_, k) => pick(POOL[k]));
}

/** Days in a row with a scored drop, counting back from today (or yesterday). */
export function dropStreak(drops, today = localDay()) {
  const d = new Date(`${today}T12:00:00Z`);
  if (!drops?.[today]) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  while (drops?.[d.toISOString().slice(0, 10)]) { n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}

export class Drop {
  constructor(game) {
    this.game = game;
    const p = game.store.p;
    this.day = localDay();
    this.text = dropFor(this.day);
    this.practice = !!p.drops?.[this.day];
    this.set = new Set(game.core.koch.slice(0, p.unlocked));
    this.fields = new Fields(this.text.split(' ').map((w, i) => [String(i + 1), w]), this.set);
    this.plays = 0;
    this.state = 'intro';
    this.startedAt = performance.now();
  }

  enter() { this.game.audio.music(null); }
  exit() { this.game.wantText(false); }

  canReplay() { return this.plays < PLAYS && !(this.rx && this.game.audio.now() < this.rx.end); }

  play() {
    if (this.plays >= PLAYS) return;
    this.plays++;
    const s = this.game.audio.say(this.text, { effWpm: this.game.store.p.effWpm, noise: 0.08, qsb: 0.12, seed: 7, delay: 0.5 });
    this.rx = { t0: s.t0, end: s.end };
    this.state = 'rx';
    this.game.wantText(true);
  }

  submit() {
    if (this.state !== 'rx') return;
    const game = this.game, p = game.store.p;
    const gr = this.fields.grade();
    this.gr = gr;
    this.pct = gr.chars ? Math.round((gr.charsOk / gr.chars) * 100) : 100;
    this.score = gr.charsOk * 40 + gr.ok * 120 + (this.plays === 1 ? 300 : 0);
    if (!this.practice) {
      p.drops = { ...(p.drops || {}), [this.day]: { pct: this.pct, score: this.score, plays: this.plays } };
      // Keep the last 120 days.
      const keys = Object.keys(p.drops).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete p.drops[k];
      game.store.save();
    }
    this.streak = dropStreak(p.drops, this.day);
    game.audio.sfx(this.pct >= 90 ? 'win' : this.pct >= 60 ? 'ok' : 'bad');
    if (this.pct >= 90) game.gfx.flash(0.15); else game.gfx.glitch(0.5);
    this.state = 'reveal';
    this.revealAge = 0;
    game.wantText(false);
  }

  get shareLine() {
    return `NIGHT COPY DEAD DROP ${this.day}: ${this.pct}% ${this.plays === 1 ? '(ONE PLAY)' : '(TWO PLAYS)'} // STREAK ${this.streak}`;
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const gr = this.gr || { ok: 0, total: 0 };
    this.game.go('results', {
      mission: 'drop', aborted, total: aborted ? 0 : gr.total, correct: gr.ok,
      score: aborted || this.practice ? 0 : this.score,
      seconds: (performance.now() - this.startedAt) / 1000,
      dropNote: aborted ? null : this.practice ? `PRACTICE COPY: ${this.pct}% (TODAY'S SCORE STANDS)` : `DEAD DROP ${this.pct}%  //  STREAK ${this.streak} DAY${this.streak === 1 ? '' : 'S'}`,
    });
  }

  onKey(e, down) {
    if (!down) return false;
    if (e.key === 'Escape') { this.finish(true); return true; }
    if (this.state === 'intro') { if (e.key === 'Enter' || e.key === ' ') this.play(); return true; }
    if (this.state === 'reveal') { if (e.key === 'Enter' && this.revealAge > 0.4) this.finish(false); return true; }
    if (e.key === '?') { if (this.canReplay()) this.play(); return true; }
    const r = this.fields.key(e);
    if (r === 'submit') { this.submit(); return true; }
    if (r === 'typed') this.game.audio.sfx('type');
    return !!r;
  }

  update(dt) { if (this.state === 'reveal') this.revealAge += dt; }

  draw(g) {
    const game = this.game;
    backdrop(game, 'card-deaddrop', { dark: 0.45, zoom: 1.05, speed: 0.012 });
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text('DEAD DROP', 22, 32, { size: 38, color: C.cyan, spacing: 3 });
    g.text(`${this.day}  //  ${this.practice ? 'PRACTICE: TODAY IS ALREADY SCORED' : 'FIRST COPY COUNTS'}  //  ${game.store.p.effWpm} WPM EFF`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    const cx = g.W / 2;
    if (this.state === 'intro') {
      const pw = Math.min(760, g.W - 40), py = g.portrait ? 300 : 160;
      g.panel(cx - pw / 2, py, pw, 300, { color: C.cyan, fillAlpha: 0.9 });
      g.text("TODAY'S DROP", cx, py + 42, { size: 44, color: C.cyan, align: 'center', spacing: 4 });
      const lines = [
        `One message, ${this.text.split(' ').length} words. Same message for every operator today.`,
        'It plays once. You can ask for it one more time. Then it burns.',
        'Type each word as it lands. Grey boxes are letters you haven\'t learned yet.',
        `Streak: ${dropStreak(game.store.p.drops)} day(s).`,
      ];
      lines.forEach((l, i) => g.text(l, cx, py + 92 + i * 30, { size: 18, font: FONT.ui, color: C.white, align: 'center' }));
      if (game.button('drop-go', cx - 150, py + 226, 300, 50, 'OPEN IT [ENTER]', { size: 28, color: C.amber })) this.play();
      return;
    }
    const playing = this.rx && game.audio.now() < this.rx.end;
    const tx = 30, tw = g.W - 60, ty = g.portrait ? 200 : 130;
    g.text(playing ? 'RECEIVING...' : this.state === 'reveal' ? 'THE DROP' : 'BURNING. FILL IT IN.', tx, ty - 14, { size: 26, color: playing ? C.amber : C.green, spacing: 2 });
    const bottom = this.fields.draw(g, tx, ty + 10, tw, { box: g.portrait ? 36 : 40, labels: false, reveal: this.state === 'reveal', fieldGap: 26 });
    const by = Math.max(bottom + 20, g.H - 130);
    if (this.state === 'rx') {
      if (game.button('drop-log', tx, by, 240, 46, 'DECODE [ENTER]', { size: 24, color: C.amber })) this.submit();
      if (game.button('drop-agn', tx + 252, by, 260, 46, this.plays < PLAYS ? 'PLAY IT AGAIN [?]' : 'IT BURNED', { size: 22, color: C.cyan, disabled: !this.canReplay() })) this.play();
    } else if (this.state === 'reveal') {
      g.text(`${this.pct}% COPIED  //  ${this.gr.ok}/${this.gr.total} WORDS CLEAN`, tx, by - 10, { size: 30, color: this.pct >= 90 ? C.green : this.pct >= 60 ? C.amber : C.red, spacing: 2 });
      g.text(this.shareLine, tx, by + 22, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
      if (game.button('drop-copy', tx, by + 40, 240, 44, this.copied ? 'COPIED' : 'COPY SCORE', { size: 22, color: C.cyan })) {
        navigator.clipboard?.writeText(this.shareLine).then(() => { this.copied = true; }).catch(() => {});
      }
      if (game.button('drop-done', tx + 252, by + 40, 240, 44, 'DONE [ENTER]', { size: 22, color: C.amber })) this.finish(false);
    }
  }
}
