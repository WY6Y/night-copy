// WORD RUSH: whole words and CW abbreviations at full character speed.
// Type what you heard and hit Enter. Every clean copy floors the Runner.
// Word length is a ladder that climbs with him (p.rushLen), and a missed word
// is rebuilt a letter at a time (RA, RAI, RAIN) to stretch his copy buffer.

import { C, FONT } from '../gfx.js';
import { meter, drawPattern } from './common.js';
import { CW_WORDS, WORDS, MORSE, canSay, rand } from '../content.js';

const COUNT = 14;
const MAX_LEN = 6;
const UP_AFTER = 3;   // clean copies in a row to climb a letter
const DOWN_AFTER = 2; // misses in a row to drop one

export class Rush {
  constructor(game) {
    this.game = game;
    const p = game.store.p;
    this.set = new Set(game.core.koch.slice(0, p.unlocked));
    this.pool = [...new Set([...CW_WORDS, ...WORDS])].filter((w) => w.length >= 2 && canSay(w, this.set));
    this.len = Math.max(2, Math.min(MAX_LEN, p.rushLen || 2));
    this.streak = 0;
    this.misses = 0;
    this.build = []; // prefixes queued after a miss
    this.i = -1;
    this.typed = '';
    this.results = [];
    this.score = 0;
    this.speed = 120;
    this.scroll = 0;
    this.state = 'countdown';
    this.t = 0;
    this.startedAt = performance.now();
  }

  group(n) {
    const L = [...this.set];
    let s = '';
    for (let i = 0; i < n; i++) s += rand(L);
    return s;
  }

  enter() {
    this.game.audio.music(null);
    this.game.wantText(true);
  }

  exit() { this.game.wantText(false); }

  /** A real word at the current length when there are enough, else letters. */
  pick() {
    const fit = this.pool.filter((w) => w.replace(/ /g, '').length === this.len && w !== this.last);
    const w = fit.length >= 3 && Math.random() < 0.75 ? rand(fit) : this.group(this.len);
    this.last = w;
    return w;
  }

  next() {
    this.typed = '';
    let w, build = null;
    if (this.build.length) {
      ({ w, step: build } = this.build.shift());
    } else {
      this.i++;
      if (this.i >= COUNT) { this.finish(false); return; }
      w = this.pick();
    }
    const s = this.game.audio.say(w, { effWpm: this.game.store.p.effWpm });
    this.cur = { w, build, t0: s.t0, end: s.end, window: 6 + w.length * 0.6, replayed: false };
    this.state = 'listen';
  }

  /** The ladder moves on graded words only, never on the rebuild steps. */
  climb(ok) {
    if (ok && !this.cur.replayed) { this.streak++; this.misses = 0; } else if (ok) { this.misses = 0; } else { this.streak = 0; this.misses++; }
    if (this.streak >= UP_AFTER && this.len < MAX_LEN) {
      this.len++; this.streak = 0;
      this.toast = { msg: `LEVEL UP: ${this.len} LETTERS`, col: C.amber, t: 2.2 };
      this.game.audio.sfx('unlock');
    } else if (this.misses >= DOWN_AFTER && this.len > 2) {
      this.len--; this.misses = 0;
      this.toast = { msg: `BACK TO ${this.len} LETTERS. LOCK THESE IN.`, col: C.cyan, t: 2.2 };
    }
  }

  submit() {
    const game = this.game, g = game.gfx;
    const cur = this.cur;
    const ok = this.typed.trim() === cur.w;
    const late = Math.max(0, game.audio.now() - cur.end);
    if (!cur.build) {
      this.results.push({ w: cur.w, typed: this.typed, ok });
      this.climb(ok);
      // Rebuild a missed word: first two letters, then one more each time.
      if (!ok && cur.w.length >= 3 && !cur.w.includes(' ')) {
        for (let n = 2; n <= cur.w.length; n++) this.build.push({ w: cur.w.slice(0, n), step: { n, of: cur.w.length } });
      }
    }
    if (ok) {
      const pts = Math.round((100 * cur.w.length + Math.max(0, 300 - late * 60)) * (cur.replayed ? 0.5 : 1) * (cur.build ? 0.5 : 1));
      this.score += pts;
      this.speed = Math.min(900, this.speed + 160);
      game.audio.sfx(cur.w.length >= 4 ? 'combo' : 'ok');
      game.particles.burst(g.W * 0.32, g.H * 0.72, C.cyan, 40, 360);
      g.flash(0.12);
    } else {
      this.speed = 60;
      game.audio.sfx('bad');
      g.glitch(1);
      g.shake(0.5);
    }
    // A clean copy rolls on by itself. A miss waits for him: the word plays
    // again with its patterns shown, and he moves on when he's ready.
    this.verdict = { ok, w: cur.w, typed: this.typed, t: ok ? 0.8 : Infinity, age: 0, rebuild: !ok && this.build.length > 0 };
    this.state = 'verdict';
    if (!ok) setTimeout(() => { if (game.scene === this && this.verdict.w === cur.w) this.hearAgain(); }, 450);
  }

  /** One replay while listening, for half points. */
  replayListen() {
    if (this.state !== 'listen' || this.cur.replayed) return;
    this.cur.replayed = true;
    const s = this.game.audio.say(this.cur.w, { effWpm: this.game.store.p.effWpm });
    this.cur.end = s.end;
  }

  hearAgain() {
    const v = this.verdict;
    if (!v || v.ok) return;
    const s = this.game.audio.say(v.w, { effWpm: this.game.store.p.effWpm });
    v.playing = { t0: s.t0, end: s.end, chars: s.r.chars };
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const r = this.results;
    if (!aborted || r.length >= 5) this.game.store.p.rushLen = this.len;
    this.game.go('results', {
      mission: 'rush', aborted, total: r.length, correct: r.filter((x) => x.ok).length,
      score: this.score, rushLen: this.len, seconds: (performance.now() - this.startedAt) / 1000,
    });
  }

  onKey(e, down) {
    if (!down) return false;
    const game = this.game;
    if (e.key === 'Escape') { this.finish(true); return true; }
    if (this.state === 'verdict') {
      // The Enter that submitted can repeat; ignore Enter for a beat.
      if (e.key === 'Enter' && this.verdict.age > 0.4) this.verdict.t = 0;
      else if ((e.key === ' ' || e.key === 'Tab') && !this.verdict.ok) this.hearAgain();
      return true;
    }
    if (this.state !== 'listen') return e.key.length === 1;
    if (e.key === 'Enter') { if (this.typed) this.submit(); return true; }
    if (e.key === 'Backspace') { this.typed = this.typed.slice(0, -1); return true; }
    if (e.key === 'Tab') { this.replayListen(); return true; }
    if (e.key.length === 1 && /[a-z0-9.,?/= ]/i.test(e.key) && this.typed.length < 16) {
      this.typed += e.key.toUpperCase();
      game.audio.sfx('type');
      return true;
    }
    return false;
  }

  update(dt) {
    this.t += dt;
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) this.toast = null; }
    this.speed += (140 - this.speed) * dt * 0.25;
    this.scroll += this.speed * dt;
    if (this.state === 'countdown' && this.t > 2.2) this.next();
    if (this.state === 'listen') {
      const left = this.cur.end + this.cur.window - this.game.audio.now();
      if (left <= 0) this.submit();
    }
    if (this.state === 'verdict') {
      this.verdict.age += dt;
      this.verdict.t -= dt;
      if (this.verdict.t <= 0) this.next();
    }
    // Speed sparks off the car.
    const g = this.game.gfx;
    if (this.speed > 300 && Math.random() < 0.5) this.game.particles.spark(g.W * 0.22, g.H * 0.8, C.amber, -300 - Math.random() * 200, -40 * Math.random(), 0.4, 2);
  }

  draw(g) {
    const game = this.game, c = g.ctx;
    const bg = game.art['bg-rush'];
    if (bg) {
      // Endless street: the art tiled and mirrored as it scrolls.
      const h = g.H, w = bg.width * (h / bg.height);
      const off = (this.scroll * 0.6) % (w * 2);
      for (let k = -1; k < Math.ceil(g.W / w) + 2; k++) {
        const x = k * w - off;
        c.save();
        if (k % 2 !== 0) { c.translate(x + w, 0); c.scale(-1, 1); c.drawImage(bg, 0, 0, w, h); } else c.drawImage(bg, x, 0, w, h);
        c.restore();
      }
    }
    g.rect(0, 0, g.W, g.H, C.bg, 0.25);
    // Speed lines.
    c.save();
    c.globalCompositeOperation = 'lighter';
    const n = Math.floor(this.speed / 30);
    for (let i = 0; i < n; i++) {
      const y = (i * 97.13 + this.scroll * 0.02) % g.H;
      const x = (g.W - ((this.scroll * (1 + (i % 5) * 0.3) + i * 211) % (g.W + 300)));
      c.globalAlpha = 0.15;
      c.fillStyle = i % 3 ? C.cyan : C.green;
      c.fillRect(x, y, 80 + this.speed * 0.2, 2);
    }
    c.restore();
    game.rain.draw(g, 0.6);
    // The Runner.
    const car = game.art['prop-runner-side'];
    if (car) {
      const cw = g.portrait ? g.W * 0.9 : 520, ch = cw * car.height / car.width;
      const bob = Math.sin(g.time * 18) * (this.speed > 300 ? 2 : 1);
      g.ctx.drawImage(car, g.W * (g.portrait ? 0.05 : 0.04), g.H * 0.86 - ch + bob, cw, ch);
    }

    // HUD
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text('WORD RUSH', 22, 32, { size: 38, color: C.cyan, spacing: 3 });
    const step = this.cur?.build ? `REBUILD ${this.cur.build.n}/${this.cur.build.of}` : `${this.len} LETTERS`;
    g.text(`${Math.max(0, Math.min(this.i + 1, COUNT))}/${COUNT}  //  ${step}  //  ${game.store.p.settings.charWpm} WPM @ ${game.store.p.effWpm} EFF`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    g.text(String(this.score).padStart(6, '0'), g.W - 22, 32, { size: 40, color: C.amber, align: 'right' });
    g.text(`${Math.round(this.speed / 4)} KM/H`, g.W - 22, 62, { size: 18, color: this.speed > 400 ? C.amber : C.grey, align: 'right' });

    const cx = g.W / 2, cy = g.portrait ? g.H * 0.3 : g.H * 0.36;
    if (this.state === 'countdown') {
      g.text('LISTEN FOR WHOLE WORDS', cx, cy, { size: 54, color: C.cyan, align: 'center' });
      g.text(`STARTING AT ${this.len} LETTERS. ${UP_AFTER} CLEAN IN A ROW ADDS ONE.`, cx, cy + 46, { size: 20, font: FONT.ui, color: C.amber, align: 'center' });
      g.text("TYPE EACH LETTER AS IT LANDS. DON'T WAIT FOR THE WORD TO END.", cx, cy + 76, { size: 18, font: FONT.ui, color: C.white, align: 'center' });
      g.text('ENTER: SEND  //  TAB: HEAR AGAIN (HALF POINTS)', cx, cy + 104, { size: 14, font: FONT.ui, color: C.grey, align: 'center' });
    }
    if (this.toast) {
      g.text(this.toast.msg, cx, g.portrait ? g.H * 0.18 : 120, { size: 34, color: this.toast.col, align: 'center', alpha: Math.min(1, this.toast.t * 2), glow: 20, spacing: 3 });
    }
    if (this.state === 'listen') {
      const playing = game.audio.cwPlaying > 0;
      const bw = Math.min(640, g.W - 40);
      g.panel(cx - bw / 2, cy - 60, bw, 120, { color: playing ? C.amber : C.cyan, fillAlpha: 0.85 });
      const shown = this.typed || (playing ? 'RECEIVING...' : '_');
      const blink = Math.sin(g.time * 8) > 0 ? '_' : ' ';
      g.text(this.typed ? this.typed + blink : shown, cx, cy, { size: 72, color: this.typed ? C.white : C.grey, align: 'center', spacing: 8 });
      const left = Math.max(0, this.cur.end + this.cur.window - game.audio.now());
      meter(g, cx - bw / 2, cy + 74, bw, 6, left / this.cur.window, left < 2 ? C.red : C.cyan);
      const hb = Math.min(300, (bw - 12) / 2);
      if (game.button('rush-again', cx - hb - 6, cy + 92, hb, 44, this.cur.replayed ? 'HEARD AGAIN' : 'HEAR AGAIN [TAB]', { size: 20, color: C.cyan, disabled: this.cur.replayed })) this.replayListen();
      if (game.button('rush-send', cx + 6, cy + 92, hb, 44, 'SEND [ENTER]', { size: 20, color: C.amber, disabled: !this.typed })) this.submit();
    }
    if (this.state === 'verdict') {
      const v = this.verdict;
      const col = v.ok ? C.green : C.red;
      g.text(v.w, cx, cy - 10, { size: 90, color: col, align: 'center', glow: 30, spacing: 8 });
      if (!v.ok) {
        // Letter-by-letter diff.
        const t = v.typed || '(nothing)';
        const w = g.measure(t, 34, FONT.big, 4);
        let x = cx - w / 2;
        for (let i = 0; i < t.length; i++) {
          const good = t[i] === v.w[i];
          g.text(t[i], x, cy + 64, { size: 34, color: good ? C.green : C.red, spacing: 4 });
          x += g.measure(t[i], 34, FONT.big, 4);
        }
        const pw = Math.min(760, g.W - 30);
        g.panel(cx - pw / 2, cy + 118, pw, 182, { color: C.cyan, fillAlpha: 0.9 });
        g.text('YOU TYPED', cx, cy + 100, { size: 14, font: FONT.ui, color: C.amber, align: 'center' });
        // Each letter of the right answer with its pattern; the letter
        // sounding right now lights up.
        const now = game.audio.now();
        const pl = v.playing && now >= v.playing.t0 && now <= v.playing.end ? v.playing : null;
        const letters = v.w.split('');
        const slot = Math.min(150, (g.W - 40) / letters.length);
        const unit = Math.max(5, Math.min(10, slot / 14));
        const py = cy + 150;
        // Lit from its first element until the next letter starts, so the
        // Farnsworth gaps don't leave everything dark.
        let lit = -1;
        if (pl) pl.chars.forEach((c, i) => { if (now - pl.t0 >= c.start) lit = i; });
        letters.forEach((ch, i) => {
          const x = cx + (i - (letters.length - 1) / 2) * slot;
          const col = i === lit ? C.white : C.cyan;
          g.text(ch, x, py, { size: 34, color: col, align: 'center', glow: i === lit ? 24 : 6 });
          if (MORSE[ch]) drawPattern(g, MORSE[ch], x, py + 34, unit, col);
        });
        const by = py + 70, bw = Math.min(260, (g.W - 60) / 2);
        if (game.button('rush-hear', cx - bw - 10, by, bw, 46, 'HEAR AGAIN [SPACE]', { size: 22, color: C.cyan })) this.hearAgain();
        if (game.button('rush-next', cx + 10, by, bw, 46, v.rebuild ? 'REBUILD IT [ENTER]' : 'NEXT [ENTER]', { size: 22, color: C.amber })) v.t = 0;
      }
    }
  }
}
