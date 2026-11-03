import { C, FONT } from '../gfx.js';
import { backdrop, accColor, drawPattern } from './common.js';
import { CHAPTERS, MORSE, sayPattern } from '../content.js';

export function bossReady(p) {
  const ch = CHAPTERS[p.chapter];
  return !!ch && p.unlocked >= ch.letters;
}

export function startRun(game) {
  const p = game.store.p;
  game.run = { queue: ['intercept', 'relay', bossReady(p) ? 'faux' : 'rush'], i: 0 };
  launch(game, game.run.queue[0]);
}

const MISSIONS = ['intercept', 'relay', 'rush', 'contact', 'faux', 'drill', 'blind', 'echo', 'pileup', 'headcopy'];

export function launch(game, mission) {
  if (mission === 'faux') game.go('intercept', { boss: true });
  else if (mission === 'blind' || mission === 'echo') game.go('relay', { mode: mission });
  else game.go(mission);
}

export class Hub {
  constructor(game) {
    this.game = game;
    this.summary = null;
    this.t = 0;
  }

  enter() {
    const game = this.game;
    game.run = null;
    game.audio.music('continual');
    game.store.summary().then((s) => { this.summary = s; });
  }

  onKey(e, down) {
    if (!down) return false;
    const k = e.key;
    if (k >= '0' && k <= '9') {
      const m = MISSIONS[(+k + 9) % 10];
      if (this.available(m)) launch(this.game, m);
      return true;
    }
    if (k === 'r' || k === 'R') { startRun(this.game); return true; }
    if (k === 's' || k === 'S') { this.game.go('settings'); return true; }
    if (k === 'c' || k === 'C') { this.game.go('coach'); return true; }
    return false;
  }

  available(m) {
    const p = this.game.store.p;
    if (m === 'contact') return p.unlocked >= 8;
    if (m === 'faux') return bossReady(p);
    if (m === 'drill') return this.game.store.topPairs(3).length > 0;
    return true;
  }

  update(dt) {
    this.t += dt;
    if (this.peek) { this.peek.t -= dt; if (this.peek.t <= 0) this.peek = null; }
  }

  draw(g) {
    const game = this.game, p = game.store.p;
    backdrop(game, 'bg-shack-hub', { dark: 0.5, rainAlpha: 0.25 });
    const ci = Math.min(p.chapter, CHAPTERS.length - 1);
    const ch = CHAPTERS[ci];
    const done = p.chapter >= CHAPTERS.length;

    // Header
    g.shade(0, 0, g.W, 110, 'rgba(5,4,13,0.95)', 'rgba(5,4,13,0)');
    g.text('NIGHT COPY', 24, 36, { size: 52, color: C.green, spacing: 5 });
    g.text(done ? 'ALL CHAPTERS CLEARED // THE CITY IS LISTENING' : `CHAPTER ${ci + 1} // ${ch.title}`, 26, 74, { size: 18, font: FONT.ui, color: C.cyan, spacing: 2, glow: 5 });
    if (game.button('settings', g.W - 150, 18, 130, 40, 'SETUP', { size: 22, color: C.cyan })) game.go('settings');
    if (game.button('coach', g.W - 290, 18, 130, 40, 'COACH', { size: 22, color: C.amber })) game.go('coach');

    const portrait = g.portrait;
    const L = portrait ? { x: 20, w: g.W - 40 } : { x: 24, w: 744 };
    let y = 104;

    // Tonight's run
    const runLabel = this.summary?.practiced_today ? 'RUN IT AGAIN' : "TONIGHT'S RUN";
    if (game.button('run', L.x, y, L.w, 64, runLabel, { size: 38, color: C.amber, spacing: 6 })) startRun(game);
    g.text('[R]  INTERCEPT > RELAY > ' + (bossReady(p) ? 'FAUX' : 'WORD RUSH') + '  //  ABOUT 12 MIN', L.x + L.w / 2, y + 80, { size: 14, font: FONT.ui, color: C.amber, align: 'center', glow: 3 });
    y += 98;

    // Mission cards
    const cards = [
      ['intercept', 'INTERCEPT', 'COPY HIS TONES', 'card-intercept'],
      ['relay', 'RELAY', 'SEND TO VERA', 'card-relay'],
      ['rush', 'WORD RUSH', 'WHOLE WORDS, FAST', 'card-rush'],
      ['contact', 'CONTACT', p.unlocked >= 8 ? 'WORK A FULL QSO' : `NEEDS 8 LETTERS (${p.unlocked})`, 'card-contact'],
      ['faux', 'FAUX', bossReady(p) ? 'BREAK THE SPOOF' : `AFTER ${ch?.letters ?? 41} LETTERS`, 'card-faux'],
      ['drill', 'MIX-UP DRILL', (() => { const tp = game.store.topPairs(3); return tp.length ? tp.map((x) => `${x.a}/${x.b}`).join('  ') : 'NO MIX-UPS YET'; })(), 'scene-14-fragment-crt'],
      ['blind', 'BLIND RELAY', 'SEND FROM MEMORY', 'nightop-key'],
      ['echo', 'ECHO', 'HEAR IT, KEY IT BACK', 'vera-radio'],
      ['pileup', 'PILEUP', 'FIND YOUR STATION', 'scene-07-overlook'],
      ['headcopy', 'HEAD COPY', 'WORDS, NO PAPER', 'scene-03-cabinet'],
    ];
    const cols = portrait ? 3 : 4;
    const gap = 10;
    const cw = (L.w - gap * (cols - 1)) / cols;
    const chh = portrait ? 112 : 136;
    cards.forEach(([id, label, sub, art], i) => {
      const cx = L.x + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (chh + gap);
      const ok = this.available(id);
      const boss = id === 'faux' && ok;
      const best = p.best[id];
      if (game.button(id, cx, cy, cw, chh, label, {
        art: game.art[art], sub, disabled: !ok, size: 26,
        color: boss ? C.red : C.green,
        badge: best ? `BEST ${best}` : `[${(i + 1) % 10}]`, badgeColor: boss ? C.red : C.amber,
      })) launch(game, id);
      if (boss) g.panel(cx - 3, cy - 3, cw + 6, chh + 6, { color: C.red, fillAlpha: 0, glow: 10 + 10 * Math.sin(this.t * 5) });
    });
    y += Math.ceil(cards.length / cols) * (chh + gap);

    // Signal map
    const R = portrait ? { x: 20, y: y + 6, w: g.W - 40, h: g.H - y - 46 } : { x: 792, y: 104, w: g.W - 816, h: g.H - 104 - 44 };
    g.panel(R.x, R.y, R.w, R.h, { color: C.greenDim, fillAlpha: 0.78 });
    g.text('SIGNAL MAP', R.x + 16, R.y + 24, { size: 26, color: C.green, spacing: 3 });
    g.text(`${p.unlocked}/41 LETTERS`, R.x + R.w - 16, R.y + 24, { size: 16, font: FONT.ui, color: C.cyan, align: 'right', glow: 3 });
    const koch = game.core.koch;
    const perRow = 7;
    const ts = Math.min(52, (R.w - 32 - (perRow - 1) * 6) / perRow);
    const gx = R.x + (R.w - (perRow * ts + (perRow - 1) * 6)) / 2;
    const gy = R.y + 48;
    koch.forEach((c, i) => {
      const x = gx + (i % perRow) * (ts + 6), yy = gy + Math.floor(i / perRow) * (ts + 6);
      const open = i < p.unlocked;
      const st = p.stats[c];
      const col = open ? accColor(st) : C.indigo;
      const newest = i === p.unlocked - 1;
      const chapterEdge = CHAPTERS.some((h) => h.letters === i + 1);
      g.rect(x, yy, ts, ts, open ? '#0c1f19' : '#0b0a1c', open ? 0.9 : 0.6);
      g.ctx.save();
      g.ctx.strokeStyle = col; g.ctx.lineWidth = newest ? 2.5 : 1;
      g.ctx.shadowColor = col; g.ctx.shadowBlur = newest ? 12 + 8 * Math.sin(this.t * 4) : open ? 6 : 0;
      g.ctx.strokeRect(x + 0.5, yy + 0.5, ts - 1, ts - 1);
      g.ctx.restore();
      g.text(c, x + ts / 2, yy + ts / 2 + 2, { size: ts * 0.62, color: open ? col : '#2a2850', align: 'center', glow: open ? 8 : 0 });
      if (chapterEdge) g.rect(x + ts + 1, yy + 4, 2, ts - 8, C.red, 0.7);
      // Code book: tap any letter to hear it and see how it is sent.
      const m = game.mouse;
      if (m.clicked && m.x >= x && m.x <= x + ts && m.y >= yy && m.y <= yy + ts) {
        game.wake().then(() => game.audio.say(c, { effWpm: p.settings.charWpm }));
        this.peek = { c, open, t: 3.5 };
      }
    });
    g.text('TAP A LETTER TO HEAR IT', R.x + 16, R.y + R.h - 14, { size: 12, font: FONT.ui, color: C.grey, glow: 0 });
    const rowsH = Math.ceil(koch.length / perRow) * (ts + 6);
    let sy = gy + rowsH + 22;
    const stat = (label, val, col = C.green) => {
      g.text(label, R.x + 18, sy, { size: 15, font: FONT.ui, color: C.grey, glow: 0 });
      g.text(val, R.x + R.w - 18, sy, { size: 24, color: col, align: 'right' });
      sy += 30;
    };
    const s = this.summary;
    stat('STREAK', s ? `${s.streak} DAY${s.streak === 1 ? '' : 'S'}` : '--', s?.streak ? C.amber : C.grey);
    stat('TONIGHT', s ? `${s.minutes_today} MIN / ${s.missions_today} MISSIONS` : '--', C.cyan);
    stat('SPEED', `${p.settings.charWpm} WPM CHARS @ ${p.effWpm} EFF`, C.green);
    {
      const ch = CHAPTERS[p.chapter];
      const next = game.core.koch[p.unlocked];
      const txt = !ch ? 'ALL 41 LETTERS' : p.unlocked >= ch.letters ? 'BEAT FAUX [5]' : `${next}: 90% IN INTERCEPT [1]`;
      stat('NEXT SIGNAL', txt, C.amber);
    }
    stat('WEAK SIGNALS', p.weak?.length ? p.weak.join(' ') : 'NONE YET', p.weak?.length ? C.red : C.green);
    if (this.peek) {
      const pk = this.peek, a = Math.min(1, pk.t * 3);
      const pw = Math.min(R.w - 20, 360), ph = 190, px = R.x + (R.w - pw) / 2, py = R.y + 60;
      g.panel(px, py, pw, ph, { color: C.amber, fillAlpha: 0.95 * a, alpha: a, glow: 18 });
      g.text(pk.c, px + pw / 2, py + 58, { size: 96, color: C.amber, align: 'center', alpha: a, glow: 30 });
      drawPattern(g, MORSE[pk.c] || '', px + pw / 2, py + 122, 18, game.audio.cwPlaying ? C.white : C.cyan, a);
      g.text(sayPattern(pk.c).toUpperCase() + (pk.open ? '' : '  //  NOT UNLOCKED YET'), px + pw / 2, py + 162, { size: 14, font: FONT.ui, color: C.grey, align: 'center', alpha: a, glow: 0 });
    }
    if (!portrait) g.text('1-9, 0 MISSIONS  //  R RUN  //  C COACH  //  S SETUP  //  ARROWS + ENTER', L.x, g.H - 52, { size: 14, font: FONT.ui, color: C.grey, glow: 0 });
  }
}
