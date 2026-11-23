// THE FALL OF DR. FAUX: the campaign ending (P221). Plays once after the
// THRESHOLD outro, and again from the hub's THE END button.
//
// Shots, each timed in seconds from its own start:
//   transmit  Faux's last CW from the tower (copy it yourself, then it is shown)
//   crack     the lens shatters: flash, shake, glass shards
//   topple    the top of the tower tears off and falls behind the skyline
//   fall      Faux falls away into the dark, rain streaking upward
//   lights    the city's windows come back on
//   credits   dawn, credits scroll
//   stinger   rubble, one red light, a faint QRX... and his eye opens

import { C, FONT } from '../gfx.js';
import { myCall } from '../store.js';

const LAST_WORDS = 'NOBODY HEARS YOU';
const HORIZON = 0.66;      // top of the solid skyline in fin-sky; the tower stands behind it
const SNAP = 0.355;        // where fin-tower-stub ends, fraction of tower height from the base
const LENS = 0.894;        // lens centre, fraction of tower height above the base

const credits = (call) => [
  ['NIGHT COPY', 'title'],
  ['', 'gap'],
  ['A WY6Y PRODUCTION', 'head'],
  ['', 'gap'],
  ['CREATED BY', 'role'], ['WY6Y', 'name'],
  ['STORY', 'role'], ['WY6Y', 'name'],
  ['ART', 'role'], ['WY6Y', 'name'],
  ['CODE', 'role'], ['WY6Y', 'name'],
  ['CW ENGINE AND KEYER', 'role'], ['WY6Y', 'name'],
  ['PADDLE HARDWARE', 'role'], ['WY6Y', 'name'],
  ['', 'gap'],
  ['NIGHTOP', 'role'], [call, 'name'],
  ['', 'gap'],
  ['MUSIC', 'role'], ['CONTINUAL BY PRIGIDA', 'small'], ['OVERCLOCK BY D0D', 'small'], ['VIA UPPBEAT', 'small'],
  ['', 'gap'], ['', 'gap'],
  ['41 LETTERS. EVERY ONE OF THEM YOURS.', 'head'],
  ['', 'gap'],
  ['73', 'title'],
];

export class Finale {
  constructor(game, args = {}) {
    this.game = game;
    this.then = args.then;
    this.shot = 'transmit';
    this.t = 0;
    this.total = 0;
    this.shards = [];
    this.windows = [];
    this.copy = '';
    this.creditsY = null;
    this.fast = false;
  }

  enter() {
    const game = this.game;
    game.audio.music('overclock');
    this.start('transmit');
  }

  start(shot) {
    const game = this.game, a = game.audio;
    this.shot = shot;
    this.t = 0;
    if (shot === 'transmit') {
      const s = game.store.p.settings;
      const cw = a.say(LAST_WORDS, { delay: 1.2, charWpm: 20, effWpm: Math.max(15, s.effWpm || 15), noise: 0.12, qsb: 0.3 });
      this.cwEnd = cw ? cw.r.duration + 1.4 : 7;
    } else if (shot === 'crack') {
      a.stopCW();
      game.gfx.flash(1); game.gfx.shake(1.2); game.gfx.glitch(1.2);
      a.sfx('alarm'); a.sfx('bad'); a.thunder();
      const e = this.eye();
      for (let i = 0; i < 26; i++) {
        const ang = Math.random() * Math.PI * 2, v = 120 + Math.random() * 380;
        this.shards.push({ x: e.x, y: e.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 120, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, s: 14 + Math.random() * 26, life: 2 + Math.random() * 1.5 });
      }
      game.particles.burst(e.x, e.y, C.red, 70, 420, 1.4, 4);
    } else if (shot === 'topple') {
      a.tone(90, 2.6, { vol: 0.35, type: 'sawtooth', to: 30 });
      this.impact = false;
    } else if (shot === 'fall') {
      a.music(null);
      a.tone(520, 4.5, { vol: 0.18, type: 'triangle', to: 40 });
    } else if (shot === 'lights') {
      a.music('continual');
      this.makeWindows();
    } else if (shot === 'credits') {
      this.creditsY = null;
    } else if (shot === 'stinger') {
      a.music(null);
      this.qrx = false;
      this.opened = false;
    }
  }

  // ---- geometry -------------------------------------------------------------

  tower() {
    const g = this.game.gfx, img = this.game.art['fin-tower'];
    const h = g.H * (g.portrait ? 0.6 : 0.66);
    const w = img ? h * img.width / img.height : h * 0.18;
    return { x: g.W * (g.portrait ? 0.62 : 0.68), base: g.H * 0.72, w, h };
  }

  eye() {
    const t = this.tower();
    return { x: t.x, y: t.base - t.h * LENS, s: t.w * 1.6 };
  }

  makeWindows() {
    const g = this.game.gfx, cols = [C.amber, C.amber, C.green, C.cyan, C.white];
    this.windows = Array.from({ length: g.portrait ? 160 : 260 }, () => ({
      x: Math.random() * g.W,
      y: g.H * (0.6 + Math.pow(Math.random(), 0.8) * 0.22),
      w: 2 + Math.random() * 4, h: 2 + Math.random() * 3,
      c: cols[Math.floor(Math.random() * cols.length)],
      at: Math.random() * 4.5,
    }));
  }

  // ---- flow -------------------------------------------------------------------

  update(dt) {
    this.t += dt;
    this.total += dt;
    const t = this.t, g = this.game.gfx;
    for (const s of this.shards) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 420 * dt; s.r += s.vr * dt; s.life -= dt; }
    this.shards = this.shards.filter((s) => s.life > 0);

    switch (this.shot) {
      case 'transmit':
        if (t > this.cwEnd - 1.4) this.copy = LAST_WORDS;
        if (t > this.cwEnd + 1.6) this.start('crack');
        break;
      case 'crack':
        if (t > 2.4) this.start('topple');
        break;
      case 'topple': {
        // Sparks fly off the break while it tips.
        const tw = this.tower(), sy = tw.base - tw.h * SNAP;
        if (Math.random() < 0.6) this.game.particles.spark(tw.x + (Math.random() - 0.5) * tw.w * 0.3, sy, C.amber, (Math.random() - 0.5) * 300, -Math.random() * 260, 0.8, 3);
        if (!this.impact && this.angle() > 1.35) {
          this.impact = true;
          g.shake(1.5); g.flash(0.4);
          this.game.audio.thunder();
          this.game.audio.sfx('bad');
          this.game.particles.burst(tw.x - tw.h * 0.45, g.H * HORIZON, C.grey, 80, 300, 1.6, 5);
        }
        if (t > 4.6) this.start('fall');
        break;
      }
      case 'fall':
        if (t > 5.2) this.start('lights');
        break;
      case 'lights':
        if (t > 8) this.start('credits');
        break;
      case 'credits':
        this.creditsY ??= g.H + 20;
        this.creditsY -= dt * (this.fast ? 260 : 52);
        if (this.creditsY + this.creditsH < g.H * 0.45 && this.t > 3) { this.wait = (this.wait || 0) + dt; if (this.wait > 3) { this.wait = 0; this.start('stinger'); } }
        break;
      case 'stinger':
        if (!this.qrx && t > 4) {
          this.qrx = true;
          this.game.audio.say('QRX', { effWpm: 16, noise: 0.5, qsb: 0.8, freq: 520 });
        }
        if (!this.opened && t > 9.5) {
          this.opened = true;
          g.glitch(1.4); g.flash(0.5);
          this.game.audio.sfx('alarm');
          this.game.audio.music('overclock');
        }
        break;
    }
  }

  angle() {
    // Tipping under gravity: slow, then fast.
    const t = Math.max(0, this.t - 0.3);
    return Math.min(1.75, 0.18 * t * t * t + 0.05 * t);
  }

  done() {
    const game = this.game;
    game.audio.stopCW();
    game.store.p.storySeen.finale = true;
    game.store.save();
    if (typeof this.then === 'function') this.then();
    else game.go(this.then || 'hub');
  }

  onKey(e, down) {
    if (!down) return false;
    if (e.key === 'Escape') { this.done(); return true; }
    this.advance();
    return true;
  }

  onPointer(_x, _y, down) { if (down) this.advance(); }

  advance() {
    if (this.shot === 'credits') this.fast = true;
    else if (this.shot === 'stinger' && this.t > 12) this.done();
    else if (this.shot === 'lights' && this.t > 3) this.start('credits');
  }

  // ---- drawing ---------------------------------------------------------------

  draw(g) {
    const c = g.ctx;
    g.rect(0, 0, g.W, g.H, C.bg, 1);
    if (['transmit', 'crack', 'topple', 'lights'].includes(this.shot)) this.drawCity(g, c);
    else if (this.shot === 'fall') this.drawFall(g, c);
    else if (this.shot === 'credits') this.drawCredits(g, c);
    else if (this.shot === 'stinger') this.drawStinger(g, c);
    this.drawShards(c);
    const skip = this.shot === 'credits' ? 'CLICK: FASTER  //  ESC: SKIP' : 'ESC: SKIP';
    if (this.shot !== 'stinger') g.text(skip, g.W - 16, 22, { size: 13, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
  }

  drawCity(g, c) {
    const game = this.game, t = this.t, tw = this.tower();
    const sky = game.art['fin-sky'], view = { zoom: 1.02 + this.total * 0.0015, panX: 0.5, panY: 0.5 };
    const dark = this.shot === 'lights' ? 0.15 : 0.3;
    g.cover(sky, 0, 0, g.W, g.H, view);
    g.rect(0, 0, g.W, g.H, C.bg, dark);

    const tower = game.art['fin-tower'], stub = game.art['fin-tower-stub'];
    const standing = this.shot === 'transmit' || this.shot === 'crack';
    if (standing && tower) {
      c.drawImage(tower, tw.x - tw.w / 2, tw.base - tw.h, tw.w, tw.h);
    } else if (tower) {
      // Stub in place, the torn-off top rotating about the break.
      if (stub) c.drawImage(stub, tw.x - tw.w / 2, tw.base - tw.h, tw.w, tw.h);
      if (this.shot === 'topple') {
        const sy = tw.base - tw.h * SNAP;
        c.save();
        c.beginPath(); c.rect(0, 0, g.W, g.H * HORIZON); c.clip();   // falls behind the skyline
        c.translate(tw.x - tw.w * 0.12, sy);
        c.rotate(-this.angle());
        const img = tower, cut = img.height * (1 - SNAP);
        const ox = -tw.w / 2 + tw.w * 0.12, oy = -tw.h * (1 - SNAP);
        c.drawImage(img, 0, 0, img.width, cut, ox, oy, tw.w, tw.h * (1 - SNAP));
        // The lens rides down dead: blacked out, the cracked glass flickering.
        const lx = ox + tw.w / 2, ly = -tw.h * (LENS - SNAP), ec = game.art['fin-eye-cracked'];
        c.fillStyle = '#05040d'; c.beginPath(); c.arc(lx, ly, tw.w * 0.16, 0, Math.PI * 2); c.fill();
        if (ec) { c.globalAlpha = 0.35 + 0.3 * Math.random(); c.drawImage(ec, lx - tw.w * 0.45, ly - tw.w * 0.4, tw.w * 0.9, tw.w * 0.8); }
        c.restore();
      }
    }

    // The city in front of the tower's base: redraw the skyline mass over it.
    c.save(); c.beginPath(); c.rect(0, g.H * HORIZON, g.W, g.H); c.clip();
    g.cover(sky, 0, 0, g.W, g.H, view);
    g.rect(0, 0, g.W, g.H, C.bg, dark);
    c.restore();

    // The lens: alive, then cracked, then dark.
    const e = this.eye();
    if (this.shot === 'transmit') {
      const playing = game.audio.cwPlaying > 0;
      this.glow(c, e.x, e.y, playing ? 120 + Math.sin(g.time * 30) * 10 : 70, playing ? 0.75 : 0.4);
      if (t < 2.2) g.text('FAUX // FINAL TRANSMISSION', g.W / 2, g.H * 0.16, { size: 30, color: C.red, align: 'center', spacing: 6, alpha: Math.min(1, t * 2) });
      g.text(playing ? 'COPY IT.' : '', g.W / 2, g.H * 0.16, { size: 26, color: C.red, align: 'center', spacing: 8, alpha: t > 2.2 ? 0.8 : 0 });
      if (this.copy) g.text(this.copy, g.W / 2, g.H * 0.9, { size: g.portrait ? 40 : 56, color: C.red, align: 'center', spacing: 10, glow: 20 });
    } else if (this.shot === 'crack') {
      const ec = game.art['fin-eye-cracked'];
      if (ec) {
        c.save(); c.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(t * 22));
        c.drawImage(ec, e.x - e.s / 2, e.y - e.s / 2, e.s, e.s); c.restore();
      }
      this.glow(c, e.x, e.y, 200 * Math.max(0, 1 - t / 2), 0.9 * Math.max(0, 1 - t / 2));
      if (this.copy) g.text(this.copy, g.W / 2, g.H * 0.9, { size: g.portrait ? 40 : 56, color: C.red, align: 'center', spacing: 10, glow: 20, alpha: Math.max(0, 1 - t) });
    }

    if (this.shot === 'lights') {
      for (const w of this.windows) {
        const a = Math.min(1, Math.max(0, (t - w.at) * 3));
        if (a <= 0) continue;
        c.save(); c.globalAlpha = a * (0.7 + 0.3 * Math.sin(g.time * 2 + w.x));
        c.fillStyle = w.c; c.shadowColor = w.c; c.shadowBlur = 8;
        c.fillRect(w.x, w.y, w.w, w.h); c.restore();
      }
      const a = Math.min(1, Math.max(0, (t - 3.5) / 1.5));
      g.text('THE TOWER IS DOWN', g.W / 2, g.H * 0.18, { size: g.portrait ? 40 : 54, color: C.green, align: 'center', spacing: 8, alpha: a, glow: 24 });
      g.text('THE CITY IS LISTENING', g.W / 2, g.H * 0.18 + 46, { size: 20, font: FONT.ui, color: C.cyan, align: 'center', spacing: 6, alpha: a });
    }
    game.rain.draw(g, this.shot === 'lights' ? Math.max(0.1, 0.5 - t * 0.06) : 0.55);
  }

  drawFall(g, c) {
    const game = this.game, t = this.t;
    // Rain streaking upward: we are falling with him.
    c.save();
    c.strokeStyle = '#7fb8ff';
    for (let i = 0; i < 90; i++) {
      const x = (i * 97.3) % g.W, sp = 900 + (i % 7) * 160;
      const y = g.H - ((t * sp + i * 131) % (g.H + 200));
      c.globalAlpha = 0.15 + (i % 5) * 0.06; c.lineWidth = 1 + (i % 3);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 60 + (i % 4) * 20); c.stroke();
    }
    c.restore();
    // Red city glow far below.
    g.shade(0, g.H * 0.55, g.W, g.H * 0.45, 'rgba(255,59,74,0)', 'rgba(255,59,74,0.18)');

    const img = game.art['fin-faux-fall'] || game.art['char-villain-faux'];
    const k = Math.min(1, t / 4.2);
    const s = (g.portrait ? 1.0 : 0.75) * g.H * (1 - k * 0.95);
    if (img && s > 2) {
      const w = s * img.width / img.height;
      c.save();
      c.translate(g.W / 2 + Math.sin(t * 1.3) * 40 * (1 - k), g.H * (0.42 + k * 0.38));
      c.rotate(Math.sin(t * 0.9) * 0.25 + k * 0.6);
      c.globalAlpha = 1 - Math.max(0, k - 0.85) / 0.15;
      c.drawImage(img, -w / 2, -s / 2, w, s);
      c.restore();
    }
    if (t > 4.4) g.text('SIGNAL LOST', g.W / 2, g.H * 0.82, { size: 26, color: C.red, align: 'center', spacing: 10, alpha: Math.min(1, (t - 4.4) * 2) });
  }

  drawCredits(g, c) {
    const game = this.game;
    g.cover(game.art['fin-dawn'] || game.art['scene-07-overlook'], 0, 0, g.W, g.H, { zoom: 1.03 + this.t * 0.0008, panY: 0.7 });
    g.rect(0, 0, g.W, g.H, C.bg, Math.max(0.25, 1 - this.t / 2));
    g.shade(0, 0, g.W, g.H * 0.6, 'rgba(5,4,13,0.65)', 'rgba(5,4,13,0)');
    const list = credits(myCall(game.store.p.settings));
    const size = { title: 64, head: 26, role: 16, name: 34, small: 18, gap: 0 };
    const gap = { title: 76, head: 44, role: 26, name: 52, small: 26, gap: 30 };
    let y = this.creditsY ?? g.H;
    for (const [txt, kind] of list) {
      if (txt && y > -80 && y < g.H + 80) {
        const col = kind === 'title' ? C.green : kind === 'role' ? C.cyan : kind === 'head' ? C.amber : C.white;
        g.text(txt, g.W / 2, y, { size: size[kind], font: kind === 'role' || kind === 'small' ? FONT.ui : FONT.big, color: col, align: 'center', spacing: kind === 'role' ? 6 : 4, glow: kind === 'title' ? 24 : 6 });
      }
      y += gap[kind];
    }
    this.creditsH = y - (this.creditsY ?? g.H);
  }

  drawStinger(g, c) {
    const game = this.game, t = this.t;
    if (t < 2) return;   // a beat of black after the credits
    if (!this.opened) {
      g.cover(game.art['fin-stinger'], 0, 0, g.W, g.H, { zoom: 1.02 + (t - 2) * 0.012 });
      g.rect(0, 0, g.W, g.H, C.bg, Math.max(0.2, 1 - (t - 2) / 2.5));
      // The one red light in the wreck, breathing.
      this.glow(c, g.W * 0.6, g.H * 0.47, 60 + Math.sin(t * 2.2) * 18, 0.3 + 0.2 * Math.sin(t * 2.2));
      game.rain.draw(g, 0.4);
      if (t > 6.5) g.text('QRX', g.W / 2, g.H * 0.18, { size: 30, color: C.red, align: 'center', spacing: 14, alpha: Math.min(0.8, (t - 6.5) * 0.6) });
      return;
    }
    const k = t - 9.5;
    g.cover(game.art['fin-faux-eye'] || game.art['faux-screen'], 0, 0, g.W, g.H, { zoom: 1.25 - Math.min(0.2, k * 0.05) });
    g.rect(0, 0, g.W, g.H, '#000', Math.max(0, 1 - k * 3));
    if (k > 1.5) g.text('FAUX // SIGNAL REACQUIRED', g.W / 2, g.H * 0.14, { size: g.portrait ? 26 : 34, color: C.red, align: 'center', spacing: 8, glow: 18, alpha: Math.min(1, (k - 1.5) * 2) });
    if (k > 3) {
      g.shade(0, g.H * 0.7, g.W, g.H * 0.3, 'rgba(0,0,0,0)', 'rgba(0,0,0,0.85)');
      g.text('NIGHT COPY WILL RETURN', g.W / 2, g.H * 0.86, { size: g.portrait ? 38 : 52, color: C.green, align: 'center', spacing: 8, glow: 24, alpha: Math.min(1, (k - 3) * 1.5) });
    }
    if (k > 4.5 && Math.sin(g.time * 4) > 0) g.text('CLICK TO RETURN TO THE SHACK', g.W / 2, g.H * 0.94, { size: 14, font: FONT.ui, color: C.grey, align: 'center', glow: 0 });
  }

  drawShards(c) {
    const img = this.game.art['fin-shard'];
    for (const s of this.shards) {
      c.save();
      c.globalAlpha = Math.min(1, s.life);
      c.translate(s.x, s.y); c.rotate(s.r);
      if (img) c.drawImage(img, -s.s / 2, -s.s / 2, s.s, s.s);
      else { c.fillStyle = C.red; c.fillRect(-s.s / 4, -s.s / 4, s.s / 2, s.s / 2); }
      c.restore();
    }
  }

  glow(c, x, y, r, a) {
    if (r <= 0 || a <= 0) return;
    const grd = c.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,59,74,${a})`);
    grd.addColorStop(1, 'rgba(255,59,74,0)');
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = grd;
    c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
  }
}
