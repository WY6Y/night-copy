// INTERCEPT: instant character recognition. A packet drops toward the tower
// while its character plays; type it before it reaches the trace line.
// With { boss: true } this is the FAUX fight: noise, fading, a second
// station, spoofed visual hints, and Faux's integrity bar to break.

import { C, FONT } from '../gfx.js';
import { backdrop, tiles, meter, accColor } from './common.js';
import { CHAPTERS } from '../content.js';

const NORMAL_COUNT = 40, BOSS_COUNT = 32;

export class Intercept {
  constructor(game, args) {
    this.game = game;
    this.boss = !!args.boss;
    const p = game.store.p;
    this.letters = game.core.koch.slice(0, p.unlocked);
    this.count = this.boss ? BOSS_COUNT : NORMAL_COUNT;
    this.n = 0;
    this.results = [];
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.trace = 0;
    this.faux = 1;          // boss integrity
    this.packet = null;
    this.reveal = null;     // { ch, ok, t }
    this.state = 'intro';
    this.t = 0;
    this.startedAt = performance.now();
    this.introQueue = this.letters.filter((c) => !p.introduced[c]);
    this.intro = null;
    const chap = Math.min(p.chapter, CHAPTERS.length - 1);
    this.noise = this.boss ? 0.22 + chap * 0.03 : (p.chapter >= 2 ? 0.1 : 0);
    this.qsb = this.boss ? 0.35 : 0;
    this.qrm = this.boss ? 0.25 + chap * 0.04 : 0;
    this.last = null;
  }

  enter() {
    const game = this.game;
    game.audio.music(this.boss ? 'overclock' : null);
    if (!this.introQueue.length) this.state = 'countdown';
    this.t = 0;
  }

  // ---- input ---------------------------------------------------------------

  onKey(e, down) {
    if (!down) return false;
    if (e.key === 'Escape') { this.finish(true); return true; }
    if (this.state === 'intro' && (e.key === 'Enter' || e.key === ' ')) { this.skipIntro(); return true; }
    if (this.state !== 'play') return false;
    if (e.key === ' ' || e.key === 'Tab') { this.replay(); return true; }
    if (e.key.length === 1) { this.answer(e.key.toUpperCase()); return true; }
    return false;
  }

  /** Hear the falling letter once more (breaks the combo). */
  replay() {
    if (this.state !== 'play' || !this.packet || this.packet.replayed || this.packet.done) return;
    this.packet.replayed = true;
    this.combo = 0;
    this.play(this.packet);
  }

  skipIntro() {
    this.introQueue = [];
    this.intro = null;
    this.state = 'countdown';
    this.t = 0;
  }

  // ---- flow ----------------------------------------------------------------

  play(pk) {
    const s = this.game.audio.say(pk.ch, { noise: this.noise, qsb: this.qsb, qrm: this.qrm, seed: pk.seed });
    pk.t0 = s.t0;
    pk.end = s.end;
  }

  spawn() {
    const game = this.game, p = game.store.p;
    const ch = game.core.pick(p.unlocked, p.stats, this.last);
    this.last = ch;
    const fall = this.boss ? 2.6 : Math.max(1.9, 3.8 - this.combo * 0.08);
    const g = game.gfx;
    const pk = {
      ch, seed: (Math.random() * 2 ** 31) | 1, fall, done: false, replayed: false,
      x0: g.W * (0.25 + Math.random() * 0.5), spin: Math.random() * 6,
      spoof: this.boss && Math.random() < 0.3 ? this.letters[Math.floor(Math.random() * this.letters.length)] : null,
    };
    this.play(pk);
    this.packet = pk;
    this.n++;
  }

  progress(pk) {
    const now = this.game.audio.now();
    const total = (pk.end - pk.t0) + pk.fall;
    return Math.max(0, Math.min(1, (now - pk.t0) / total));
  }

  answer(key) {
    const pk = this.packet;
    if (!pk || pk.done) return;
    if (!/^[A-Z0-9.,?/=]$/.test(key)) return;
    const game = this.game;
    const now = game.audio.now();
    const ok = key === pk.ch;
    const lat = Math.max(0, (now - pk.end) * 1000);
    this.resolve(pk, ok, ok ? lat : null, key);
  }

  resolve(pk, ok, lat, typed) {
    const game = this.game, g = game.gfx;
    pk.done = true;
    game.store.record(pk.ch, ok, lat);
    if (!ok && typed) game.store.recordConfusion(pk.ch, typed);
    this.results.push({ ch: pk.ch, ok, lat, typed });
    const pos = this.packetPos(pk);
    if (ok) {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const mult = 1 + Math.floor(this.combo / 5) * 0.5;
      const speed = Math.max(0, 200 - (lat || 0) / 4);
      this.score += Math.round((100 + speed) * mult);
      game.particles.burst(pos.x, pos.y, C.green, 40, 320);
      game.particles.burst(pos.x, pos.y, C.cyan, 16, 180, 0.6, 2);
      game.audio.sfx(this.combo % 5 === 0 ? 'combo' : 'ok');
      if (this.boss) {
        this.faux = Math.max(0, this.faux - 1 / (this.count * 0.8));
        g.glitch(0.25);
      }
      this.reveal = { ch: pk.ch, ok: true, t: 0.55 };
    } else {
      this.combo = 0;
      this.trace = Math.min(1, this.trace + (typed ? 0.1 : 0.13));
      game.particles.burst(pos.x, pos.y, C.red, 30, 260);
      game.audio.sfx('bad');
      g.glitch(0.9);
      g.shake(0.6);
      // Teach the sound: show the right letter while it plays again.
      this.reveal = { ch: pk.ch, ok: false, typed, t: 1.6 };
      setTimeout(() => {
        if (this.game.scene === this) this.game.audio.say(pk.ch, { seed: pk.seed });
      }, 380);
    }
    if (this.trace >= 1 || (this.boss && this.faux <= 0)) this.state = 'ending';
  }

  update(dt) {
    this.t += dt;
    const game = this.game;
    if (this.state === 'intro') {
      if (!this.intro && this.introQueue.length) {
        const ch = this.introQueue.shift();
        this.intro = { ch, t: 0, plays: 0 };
        game.audio.sfx('unlock');
      }
      if (this.intro) {
        const it = this.intro;
        it.t += dt;
        // Play the new letter four times, the letter on screen the whole time.
        if (it.plays < 4 && it.t > 0.9 + it.plays * 1.3) { game.audio.say(it.ch, { delay: 0.02 }); it.plays++; }
        if (it.t > 0.9 + 4 * 1.3 + 0.6) {
          game.store.p.introduced[it.ch] = true;
          game.store.save();
          this.intro = null;
          if (!this.introQueue.length) { this.state = 'countdown'; this.t = 0; }
        }
      }
      return;
    }
    if (this.state === 'countdown') {
      if (this.t > 2.4) { this.state = 'play'; this.t = 0; }
      return;
    }
    if (this.state === 'play') {
      if (this.reveal) {
        this.reveal.t -= dt;
        if (this.reveal.t <= 0) this.reveal = null;
      }
      const pk = this.packet;
      if (pk && !pk.done && this.progress(pk) >= 1) {
        this.resolve(pk, false, null, null);
        game.audio.sfx('alarm');
      }
      if ((!pk || pk.done) && !this.reveal && this.state === 'play') {
        if (this.n >= this.count) this.state = 'ending';
        else this.spawn();
      }
      // Packet trail.
      if (pk && !pk.done) {
        const pos = this.packetPos(pk);
        if (Math.random() < 0.7) game.particles.spark(pos.x + (Math.random() - 0.5) * 10, pos.y - 12, this.boss ? C.red : C.green, (Math.random() - 0.5) * 30, -40 - Math.random() * 40, 0.5, 2);
      }
    }
    if (this.state === 'ending') {
      this.endT = (this.endT || 0) + dt;
      if (this.endT > (this.reveal ? 1.6 : 0.6)) this.finish(false);
    }
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const r = this.results;
    const ok = r.filter((x) => x.ok).length;
    const lats = r.filter((x) => x.ok && x.lat != null).map((x) => x.lat);
    this.game.go('results', {
      mission: this.boss ? 'faux' : 'intercept',
      aborted,
      total: r.length,
      correct: ok,
      avgLat: lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0,
      score: this.score,
      maxCombo: this.maxCombo,
      traced: this.trace >= 1,
      bossWon: this.boss && this.faux <= 0.001 && this.trace < 1,
      seconds: (performance.now() - this.startedAt) / 1000,
      perChar: r,
    });
  }

  // ---- drawing -------------------------------------------------------------

  beacon() {
    if (this.boss) {
      // The boss's lens is the beacon: packets fall into Faux's eye.
      const g = this.game.gfx;
      return { x: g.W / 2, y: 40 + Math.sin(g.time) * 6 + 0.45 * this.eyeSize() };
    }
    return this.at ? this.at(0.536, 0.565) : { x: this.game.gfx.W / 2, y: this.game.gfx.H * 0.56 };
  }

  eyeSize() {
    return (this.game.gfx.portrait ? 420 : 380) + Math.sin(this.game.gfx.time * 2) * 10;
  }

  packetPos(pk) {
    const g = this.game.gfx;
    const b = this.beacon();
    const p = this.progress(pk);
    const e = p * p * (3 - 2 * p) * 0.15 + p * 0.85;
    return { x: pk.x0 + (b.x - pk.x0) * e, y: -30 + (b.y - 40 + 30) * e };
  }

  draw(g) {
    const game = this.game, p = game.store.p;
    this.at = backdrop(game, this.boss ? 'bg-faux' : 'bg-intercept', { dark: this.boss ? 0.4 : 0.15, zoom: 1.05, speed: 0.015 });
    const b = this.beacon();
    const c = g.ctx;

    if (this.boss) {
      // Faux's eye, black dropped out by additive blending.
      const eye = game.art['boss-faux-eye'];
      if (eye) {
        const s = this.eyeSize();
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.6 + 0.35 * this.faux;
        c.drawImage(eye, g.W / 2 - s / 2, 40 + Math.sin(g.time) * 6, s, s);
        c.restore();
      }
    }

    // Trace line at the tower.
    const danger = this.trace;
    c.save();
    c.strokeStyle = this.boss ? C.red : C.cyan;
    c.globalAlpha = 0.25 + danger * 0.5;
    c.shadowColor = c.strokeStyle; c.shadowBlur = 12;
    c.setLineDash([8, 10]);
    c.lineDashOffset = -g.time * 40;
    c.beginPath(); c.moveTo(0, b.y - 40); c.lineTo(g.W, b.y - 40); c.stroke();
    c.restore();
    g.text('TRACE LINE', 16, b.y - 54, { size: 14, font: FONT.ui, color: this.boss ? C.red : C.cyan, glow: 3, alpha: 0.7 });

    // Beacon pulse while CW plays.
    const playing = game.audio.cwPlaying > 0;
    const pr = playing ? 70 + Math.sin(g.time * 30) * 6 : 34;
    const grd = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, pr);
    grd.addColorStop(0, `rgba(255,59,74,${playing ? 0.75 : 0.35})`);
    grd.addColorStop(1, 'rgba(255,59,74,0)');
    c.fillStyle = grd;
    c.fillRect(b.x - pr, b.y - pr, pr * 2, pr * 2);

    // Packet.
    const pk = this.packet;
    if (pk && !pk.done && this.state === 'play') {
      const pos = this.packetPos(pk);
      const prog = this.progress(pk);
      const col = prog > 0.75 ? C.red : this.boss ? C.amber : C.green;
      c.save();
      c.translate(pos.x, pos.y);
      // Sound rings while it plays.
      if (playing) {
        for (let i = 0; i < 3; i++) {
          const r = ((g.time * 90 + i * 30) % 90) + 20;
          c.globalAlpha = 1 - r / 110;
          c.strokeStyle = col; c.lineWidth = 2;
          c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
        }
      }
      c.globalAlpha = 1;
      c.rotate(Math.PI / 4 + Math.sin(g.time * 3 + pk.spin) * 0.15);
      c.shadowColor = col; c.shadowBlur = 25;
      c.fillStyle = '#0a1a14';
      c.fillRect(-26, -26, 52, 52);
      c.strokeStyle = col; c.lineWidth = 3;
      c.strokeRect(-26, -26, 52, 52);
      c.restore();
      g.text('?', pos.x, pos.y + 2, { size: 44, color: col, align: 'center' });
      if (pk.spoof && Math.sin(g.time * 13) > 0.3) {
        g.text(pk.spoof, pos.x + 46, pos.y - 30, { size: 40, color: C.red, align: 'center', alpha: 0.55 });
        g.text('SPOOF?', pos.x + 46, pos.y - 2, { size: 12, font: FONT.ui, color: C.red, align: 'center', alpha: 0.5 });
      }
    }

    // Reveal.
    if (this.reveal) {
      const r = this.reveal;
      const a = Math.min(1, r.t * 3);
      const col = r.ok ? C.green : C.red;
      g.text(r.ch, g.W / 2, g.H * 0.36, { size: 150, color: col, align: 'center', alpha: a, glow: 40 });
      if (!r.ok) g.text(r.typed ? `YOU TYPED ${r.typed}  //  LISTEN AGAIN` : 'TOO SLOW  //  LISTEN AGAIN', g.W / 2, g.H * 0.36 + 95, { size: 22, font: FONT.ui, color: C.amber, align: 'center', alpha: a });
    }

    // HUD
    g.shade(0, 0, g.W, 80, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text(this.boss ? 'FAUX // SPOOF STORM' : 'INTERCEPT', 22, 32, { size: 38, color: this.boss ? C.red : C.green, spacing: 3 });
    g.text(`${Math.min(this.n, this.count)}/${this.count}`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    g.text(String(this.score).padStart(6, '0'), g.W - 22, 32, { size: 40, color: C.amber, align: 'right' });
    if (this.combo >= 3) g.text(`COMBO x${this.combo}`, g.W - 22, 62, { size: 20, color: C.cyan, align: 'right' });
    const mw = g.portrait ? g.W - 48 : 300;
    meter(g, 24, 96, mw, 10, this.trace, this.trace > 0.66 ? C.red : C.amber, 'TRACE');
    if (this.boss) meter(g, g.W - 24 - mw, 96, mw, 10, this.faux, C.red, 'FAUX RELAY INTEGRITY');

    // Answer tiles (touch) and keyboard hint.
    if (this.state === 'play') {
      const hit = tiles(game, this.letters, { colorOf: (ch) => accColor(p.stats[ch]), y: g.H - 34, size: g.portrait ? 62 : 44 });
      if (hit) this.answer(hit);
      const tsz = g.portrait ? 62 : 44;
      const perRow = Math.max(1, Math.min(this.letters.length, Math.floor((g.W - 40 + 8) / (tsz + 8))));
      const tilesTop = g.H - 34 - Math.ceil(this.letters.length / perRow) * (tsz + 8);
      const canReplay = pk && !pk.replayed && !pk.done;
      if (game.button('replay', g.W / 2 - 130, tilesTop - 58, 260, 44, canReplay ? 'HEAR AGAIN [SPACE]' : 'HEARD AGAIN', { size: 20, color: C.cyan, disabled: !canReplay })) this.replay();
      if (!g.portrait) g.text('TYPE OR TAP THE LETTER  //  HEAR AGAIN BREAKS THE COMBO', g.W / 2, tilesTop - 70, { size: 13, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });
    }

    if (this.state === 'intro' && this.intro) {
      const it = this.intro;
      g.rect(0, 0, g.W, g.H, C.bg, 0.55);
      g.text('NEW SIGNAL ACQUIRED', g.W / 2, g.H * 0.24, { size: 42, color: C.amber, align: 'center', spacing: 6 });
      const pulse = game.audio.cwPlaying > 0 ? 1.08 : 1;
      g.text(it.ch, g.W / 2, g.H * 0.5, { size: 220 * pulse, color: C.green, align: 'center', glow: 50 });
      g.text('LISTEN TO ITS SHAPE. DON\'T COUNT DOTS.', g.W / 2, g.H * 0.72, { size: 20, font: FONT.ui, color: C.cyan, align: 'center' });
      if (game.button('skip', g.W / 2 - 90, g.H * 0.8 - 20, 180, 40, 'SKIP [ENTER]', { size: 20, color: C.grey })) this.skipIntro();
    }
    if (this.state === 'countdown') {
      const n = 3 - Math.floor(this.t / 0.8);
      g.text(n > 0 ? String(n) : 'COPY', g.W / 2, g.H * 0.4, { size: 140, color: this.boss ? C.red : C.green, align: 'center', glow: 40 });
      g.text(this.boss ? 'TRUST YOUR EARS. HIS HINTS LIE.' : `${this.letters.length} LETTERS IN PLAY: ${this.letters.join(' ')}`, g.W / 2, g.H * 0.4 + 100, { size: 20, font: FONT.ui, color: C.cyan, align: 'center' });
    }
  }
}
