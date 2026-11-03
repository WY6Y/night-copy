// Mission results: applies progression (Koch unlocks, Farnsworth speed,
// chapter clears), logs the session to the Pi, and continues the run.

import { C, FONT } from '../gfx.js';
import { backdrop } from './common.js';
import { CHAPTERS } from '../content.js';
import { launch } from './hub.js';

const UNLOCK_ACC = 0.9;
const UNLOCK_MIN = 30;

export class Results {
  constructor(game, r) {
    this.game = game;
    this.r = r;
    this.t = 0;
    this.notes = [];
    this.apply();
  }

  apply() {
    const game = this.game, store = game.store, p = store.p, r = this.r;
    const acc = r.total ? r.correct / r.total : 0;
    this.acc = acc;
    const receive = r.mission === 'intercept' || r.mission === 'rush' || r.mission === 'faux';
    if (r.total > 0) {
      p.xp += Math.round((r.score || r.correct * 50) / 10);
      p.best[r.mission] = Math.max(p.best[r.mission] || 0, r.score || 0);
    }
    if (!r.aborted && r.mission === 'intercept' && r.total >= UNLOCK_MIN) {
      const cap = CHAPTERS[p.chapter]?.letters ?? 41;
      if (acc >= UNLOCK_ACC) {
        if (p.unlocked < cap) {
          p.unlocked++;
          const ch = game.core.koch[p.unlocked - 1];
          this.notes.push([`NEW SIGNAL UNLOCKED: ${ch}`, C.amber]);
          this.unlockedNew = ch;
          if (p.unlocked >= cap) this.notes.push(['CHAPTER LETTERS COMPLETE. FAUX IS WAITING.', C.red]);
        } else {
          this.notes.push(['FAUX IS WAITING. BEAT HIM TO OPEN THE NEXT CHAPTER.', C.red]);
        }
      } else {
        this.notes.push([`${Math.round(UNLOCK_ACC * 100)}% UNLOCKS THE NEXT LETTER. YOU HIT ${Math.round(acc * 100)}%.`, C.cyan]);
      }
    }
    if (!r.aborted && receive && r.total >= 10) {
      const max = p.settings.charWpm;
      if (acc >= 0.9 && (r.avgLat || 0) < 900 && p.effWpm < max) {
        p.effWpm++;
        this.notes.push([`EFFECTIVE SPEED UP: ${p.effWpm} WPM`, C.green]);
      } else if (acc < 0.7 && p.effWpm > 5) {
        p.effWpm--;
        this.notes.push([`EFFECTIVE SPEED EASED TO ${p.effWpm} WPM`, C.amber]);
      }
    }
    if (!r.aborted && ['relay', 'rush', 'contact', 'blind', 'echo', 'pileup', 'headcopy'].includes(r.mission)) {
      const cap = CHAPTERS[p.chapter]?.letters ?? 41;
      const next = game.core.koch[p.unlocked];
      if (p.unlocked < cap && next) this.notes.push([`NEXT LETTER (${next}) UNLOCKS IN INTERCEPT AT 90%`, C.cyan]);
      else if (CHAPTERS[p.chapter]) this.notes.push(['BEAT FAUX TO OPEN THE NEXT CHAPTER', C.red]);
    }
    if (r.rushLen) this.notes.push([`WORD LENGTH: ${r.rushLen} LETTERS`, C.amber]);
    if (!r.aborted && r.mission === 'drill') {
      const left = store.topPairs(3);
      this.notes.push([left.length ? `MIX-UPS LEFT: ${left.map((x) => `${x.a}/${x.b}`).join('  ')}` : 'NO MIX-UPS LEFT. CLEAN EARS.', left.length ? C.amber : C.green]);
    }
    if (!r.aborted && r.mission === 'blind') {
      const mix = store.topSendMix(3);
      if (mix.length) this.notes.push([`SEND MIX-UPS: ${mix.map((x) => `${x.want} CAME OUT ${x.got}`).join('  //  ')}`, C.amber]);
    }
    if (r.mission === 'faux' && r.bossWon) {
      p.chapter++;
      this.chapterCleared = p.chapter - 1;
      this.notes.push([`CHAPTER ${p.chapter} CLEARED`, C.amber]);
    }
    if (r.qsl) {
      p.qsl = [...(p.qsl || []), r.qsl].slice(-200);
      this.notes.push([`QSL CARD #${p.qsl.length} ADDED TO THE LOG`, C.cyan]);
    }
    if (r.total > 0) {
      store.logSession({
        mission: r.mission, seconds: Math.round(r.seconds || 0), total: r.total, correct: r.correct,
        detail: { score: r.score || 0, avgLat: Math.round(r.avgLat || 0), unlocked: p.unlocked, eff: p.effWpm, aborted: !!r.aborted },
      });
    }
    store.save(true);

    // Headline
    if (r.mission === 'faux') this.headline = r.bossWon ? ['FAUX RELAY BROKEN', C.green] : r.traced ? ['TRACED', C.red] : ['HE GOT AWAY', C.red];
    else if (r.traced) this.headline = ['TRACED', C.red];
    else if (r.aborted) this.headline = ['SIGNAL DROPPED', C.amber];
    else this.headline = ['TRANSMISSION COPIED', C.green];
    game.audio.sfx(this.headline[1] === C.red ? 'lose' : this.unlockedNew || r.bossWon ? 'unlock' : 'win');
    if (this.headline[1] === C.red) game.gfx.glitch(1.2);
  }

  next() {
    const game = this.game;
    const cont = () => {
      const run = game.run;
      if (run && run.i + 1 < run.queue.length) {
        run.i++;
        const keep = run;
        launch(game, run.queue[run.i]);
        game.run = keep;
      } else {
        game.go('hub');
      }
    };
    if (this.chapterCleared != null) {
      const ci = this.chapterCleared;
      game.go('story', {
        chapter: ci, part: 'outro',
        then: () => (CHAPTERS[ci + 1] ? game.go('story', { chapter: ci + 1, part: 'intro', then: cont }) : cont()),
      });
    } else cont();
  }

  onKey(e, down) {
    if (down && this.t > 0.8 && (e.key === 'Enter' || e.key === ' ')) { this.next(); return true; }
    if (down && e.key === 'Escape') { this.game.go('hub'); return true; }
    return false;
  }

  update(dt) { this.t += dt; }

  draw(g) {
    const game = this.game, r = this.r;
    backdrop(game, r.mission === 'faux' ? 'bg-faux' : 'bg-shack-hub', { dark: 0.7, rainAlpha: 0.3 });
    const [h, hc] = this.headline;
    const cx = g.W / 2;
    g.text(h, cx, 92, { size: g.portrait ? 64 : 86, color: hc, align: 'center', glow: 30, spacing: 6 });
    const k = Math.min(1, this.t / 1.2);
    const lines = [];
    if (r.total) lines.push(['COPIED', `${Math.round(r.correct * k)} / ${r.total}`, C.green]);
    if (r.total) lines.push(['ACCURACY', `${Math.round(this.acc * 100 * k)}%`, this.acc >= 0.9 ? C.green : this.acc >= 0.7 ? C.amber : C.red]);
    if (r.avgLat) lines.push(['AVG RESPONSE', `${Math.round(r.avgLat)} MS`, C.cyan]);
    if (r.score) lines.push(['SCORE', String(Math.round(r.score * k)), C.amber]);
    if (r.maxCombo) lines.push(['BEST COMBO', `x${r.maxCombo}`, C.cyan]);
    if (r.timing) lines.push(['CLEAN SPACING', `${Math.round(r.timing * 100)}%`, r.timing >= 0.8 ? C.green : C.amber]);
    const pw = Math.min(560, g.W - 40);
    let y = 160;
    g.panel(cx - pw / 2, y, pw, lines.length * 40 + 24, { color: C.greenDim, fillAlpha: 0.85 });
    y += 32;
    for (const [l, v, col] of lines) {
      g.text(l, cx - pw / 2 + 24, y, { size: 18, font: FONT.ui, color: C.grey, glow: 0 });
      g.text(v, cx + pw / 2 - 24, y, { size: 32, color: col, align: 'right' });
      y += 40;
    }
    y += 10;
    // Per-character chips.
    if (r.perChar?.length) {
      const by = {};
      for (const x of r.perChar) { (by[x.ch] ||= { n: 0, ok: 0 }); by[x.ch].n++; if (x.ok) by[x.ch].ok++; }
      const chars = Object.keys(by).sort((a, b) => game.core.koch.indexOf(a) - game.core.koch.indexOf(b));
      const s = 46, gap = 6;
      const per = Math.max(1, Math.floor((g.W - 40) / (s + gap)));
      const rows = Math.ceil(chars.length / per);
      chars.forEach((ch, i) => {
        const row = Math.floor(i / per), inRow = Math.min(per, chars.length - row * per);
        const x = cx - (inRow * (s + gap) - gap) / 2 + (i % per) * (s + gap);
        const yy = y + 10 + row * (s + gap + 14);
        const f = by[ch].ok / by[ch].n;
        const col = f >= 0.9 ? C.green : f >= 0.6 ? C.amber : C.red;
        g.panel(x, yy, s, s, { color: col, fillAlpha: 0.8, glow: 6 });
        g.text(ch, x + s / 2, yy + s / 2, { size: 30, color: col, align: 'center' });
        g.text(`${by[ch].ok}/${by[ch].n}`, x + s / 2, yy + s + 9, { size: 11, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });
      });
      y += rows * (s + gap + 14) + 20;
    }
    for (const [n, col] of this.notes) {
      const pulse = 0.8 + 0.2 * Math.sin(this.t * 6);
      g.text(n, cx, y + 8, { size: 26, color: col, align: 'center', alpha: pulse, spacing: 2 });
      y += 36;
    }
    const run = game.run;
    const more = run && run.i + 1 < run.queue.length;
    const label = this.chapterCleared != null ? 'CONTINUE STORY' : more ? `NEXT: ${run.queue[run.i + 1].toUpperCase()}` : 'BACK TO THE SHACK';
    const bw = Math.min(420, g.W - 40);
    const byy = Math.min(g.H - 120, Math.max(y + 16, g.H - 190));
    if (this.t > 0.8 && game.button('next', cx - bw / 2, byy, bw, 58, label, { size: 32, color: C.amber })) this.next();
    if (this.t > 0.8 && game.button('again', cx - bw / 2, byy + 66, bw, 40, 'RUN THIS MISSION AGAIN', { size: 20, color: C.cyan })) {
      launch(game, r.mission);
    }
  }
}
