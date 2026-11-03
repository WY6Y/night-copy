// CyberCW: NIGHT COPY. Game shell: boot, scene manager, input, UI widgets,
// and the status strip (paddle, TX guard, sync) that every scene shows.

import { BUILD } from './build.js';
import { Gfx, Particles, Rain, C, FONT, loadImage } from './gfx.js';
import { Core } from './core.js';
import { Audio } from './audio.js';
import { Store } from './store.js';
import { Paddle } from './paddle.js';
import { Title } from './scenes/title.js';
import { Hub } from './scenes/hub.js';
import { Intercept } from './scenes/intercept.js';
import { Rush } from './scenes/rush.js';
import { Relay } from './scenes/relay.js';
import { Contact } from './scenes/contact.js';
import { Story } from './scenes/story.js';
import { Results } from './scenes/results.js';
import { Settings } from './scenes/settings.js';
import { Coach } from './scenes/coach.js';
import { Drill } from './scenes/drill.js';
import { Pileup } from './scenes/pileup.js';
import { HeadCopy } from './scenes/headcopy.js';

const ART = [
  'bg-title', 'bg-intercept', 'bg-relay', 'bg-rush', 'bg-contact', 'bg-faux', 'bg-shack-hub', 'boss-faux-eye',
  'vera-radio', 'nightop-key', 'faux-screen', 'card-intercept', 'card-relay', 'card-rush', 'card-contact', 'card-faux',
  'scene-01-tower', 'scene-02-shack', 'scene-04-rain-meet', 'scene-06-cityscape', 'scene-07-overlook',
  'scene-09-director-room', 'scene-10-relay-tunnel', 'scene-12-threshold-faux', 'scene-15-foxhunt-bearing',
  'char-dame', 'char-operator', 'char-villain-faux', 'prop-runner-side', 'scene-14-fragment-crt',
  'scene-03-cabinet', 'scene-11-nightop-watcher',
];

class Game {
  async boot() {
    this.canvas = document.getElementById('screen');
    this.typeBox = document.getElementById('type');
    this.gfx = new Gfx(this.canvas);
    this.particles = new Particles();
    this.rain = new Rain();
    this.store = new Store();
    const settings = () => this.store.p.settings;
    const [core] = await Promise.all([
      Core.load('core.wasm'),
      this.store.load(),
      document.fonts.load('40px VT323'),
      document.fonts.load('20px ShareTech'),
    ]);
    this.core = core;
    this.audio = new Audio(core, settings);
    this.paddle = new Paddle(this.audio, settings);
    this.art = {};
    await Promise.all(ART.map(async (n) => {
      this.art[n] = await loadImage(`assets/art/${n}.webp`);
    }));
    this.scenes = { title: Title, hub: Hub, intercept: Intercept, rush: Rush, relay: Relay, contact: Contact, story: Story, results: Results, settings: Settings, coach: Coach, drill: Drill, pileup: Pileup, headcopy: HeadCopy };
    this.mouse = { x: -1, y: -1, down: false, clicked: false };
    this.ui = { buttons: [], focus: -1, activate: null, lastHover: null };
    this.toasts = [];
    this.wipe = 0;
    this.bindInput();
    document.getElementById('boot').remove();
    this.go('title');
    let last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      // window.cybercw.paused = true stops drawing (debug: frees the main thread).
      if (!this.paused) this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /** First user gesture: audio can start, MIDI can be requested. */
  async wake() {
    if (this.awake) { this.audio.unlock(); return; }
    this.awake = true;
    await this.audio.start();
    this.paddle.connect();
  }

  go(name, args = {}) {
    this.scene?.exit?.();
    this.audio.stopCW?.();
    this.paddle.arm(false);
    this.wantText(false);
    const S = this.scenes[name];
    this.scene = new S(this, args);
    this.sceneName = name;
    this.ui.focus = -1;
    this.wipe = 1;
    this.gfx.glitch(0.6);
    this.scene.enter?.();
  }

  toast(text, color = C.amber, sec = 3.5) {
    this.toasts.push({ text, color, t: sec });
  }

  // ---- input ---------------------------------------------------------------

  bindInput() {
    const c = this.canvas;
    const pos = (e) => { const v = this.gfx.toVirtual(e.clientX, e.clientY); this.mouse.x = v.x; this.mouse.y = v.y; };
    c.addEventListener('pointermove', (e) => { pos(e); this.ui.focus = -1; });
    c.addEventListener('pointerdown', (e) => {
      pos(e); this.mouse.down = true; this.mouse.pressed = true; this.wake();
      if (this.textWanted) this.typeBox.focus({ preventScroll: true });
      this.scene.onPointer?.(this.mouse.x, this.mouse.y, true);
    });
    addEventListener('pointerup', (e) => {
      pos(e); this.mouse.down = false; this.mouse.clicked = true; this.wake();
      this.scene.onPointer?.(this.mouse.x, this.mouse.y, false);
    });
    addEventListener('keydown', (e) => {
      this.wake();
      if (e.target === this.typeBox && e.key.length === 1) return; // handled by input event
      if (this.scene.onKey?.(e, true)) { e.preventDefault(); return; }
      const b = this.ui.buttons;
      if (['ArrowDown', 'ArrowRight', 'Tab'].includes(e.key) && b.length) {
        this.ui.focus = (this.ui.focus + 1 + b.length) % b.length; this.audio.sfx('hover'); e.preventDefault();
      } else if (['ArrowUp', 'ArrowLeft'].includes(e.key) && b.length) {
        this.ui.focus = (this.ui.focus - 1 + b.length) % b.length; this.audio.sfx('hover'); e.preventDefault();
      } else if ((e.key === 'Enter' || e.key === ' ') && this.ui.focus >= 0 && b[this.ui.focus]) {
        this.ui.activate = b[this.ui.focus].id; e.preventDefault();
      } else if (e.key === 'F11' || (e.key === 'f' && e.ctrlKey)) {
        this.fullscreen(); e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => { this.scene.onKey?.(e, false); });
    addEventListener('touchend', () => this.wake(), { passive: true });
    this.typeBox.addEventListener('input', () => {
      this.wake();
      const v = this.typeBox.value;
      this.typeBox.value = '';
      for (const ch of v) this.scene.onKey?.({ key: ch, synthetic: true, preventDefault() {} }, true);
    });
    addEventListener('blur', () => this.scene.onBlur?.());
  }

  wantText(on) {
    this.textWanted = on;
    if (!on) this.typeBox.blur();
  }

  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
  }

  /** Immediate-mode button. Returns true on the frame it is activated. */
  button(id, x, y, w, h, label, o = {}) {
    const g = this.gfx, m = this.mouse;
    const idx = this.ui.buttons.length;
    this.ui.buttons.push({ id, x, y, w, h });
    const over = m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
    const focused = over || this.ui.focus === idx;
    if (over && this.ui.lastHover !== id) { this.ui.lastHover = id; if (!o.disabled) this.audio.sfx('hover'); }
    const col = o.disabled ? C.grey : (o.color || C.green);
    const pulse = 0.5 + 0.5 * Math.sin(g.time * 6);
    if (o.art) {
      g.cover(o.art, x, y, w, h, { zoom: focused ? 1.08 : 1.0, alpha: o.disabled ? 0.25 : 0.85 });
      g.shade(x, y + h * 0.35, w, h * 0.65, 'rgba(5,4,13,0)', 'rgba(5,4,13,0.95)');
    }
    g.panel(x, y, w, h, { color: col, fillAlpha: o.art ? 0 : (focused ? 0.85 : 0.6), glow: focused ? 18 + pulse * 10 : 6, fill: focused && !o.art ? '#0f2a20' : C.ink });
    const size = o.size || Math.min(30, h * 0.5);
    if (o.art) {
      g.text(label, x + 14, y + h - (o.sub ? 42 : 22), { size, color: o.disabled ? C.grey : C.white, glowColor: col });
      if (o.sub) g.text(o.sub, x + 14, y + h - 18, { size: 15, font: FONT.ui, color: col, glow: 4 });
      if (o.badge) g.text(o.badge, x + w - 12, y + 18, { size: 16, font: FONT.ui, color: o.badgeColor || C.amber, align: 'right' });
    } else {
      g.text(label, x + w / 2, y + h / 2 + 1, { size, color: o.disabled ? C.grey : (focused ? C.white : col), align: 'center', glowColor: col, spacing: o.spacing ?? 2 });
    }
    let hit = false;
    if (!o.disabled && ((over && m.clicked) || this.ui.activate === id)) hit = true;
    if (hit) this.audio.sfx('click');
    return hit;
  }

  // ---- frame ---------------------------------------------------------------

  frame(dt) {
    const g = this.gfx;
    this.ui.buttons = [];
    g.fx.scan = this.store.p.settings.crt ? 1 : 0;
    g.fx.curve = 0; // Stephen found the bulge too much (2026-11-01); scanlines stay.
    g.begin(dt);
    this.paddle.tick();
    this.rain.update(dt, () => this.audio.thunder());
    this.particles.update(dt);
    this.scene.update?.(dt);
    this.scene.draw(g);
    // Phones have no Escape key: missions get an on-screen QUIT.
    if (typeof this.scene.finish === 'function' && !this.scene.finished && this.sceneName !== 'results') {
      if (this.button('quit', g.W / 2 - 55, 10, 110, 34, 'QUIT', { size: 20, color: C.grey })) {
        this.scene.onKey?.({ key: 'Escape', preventDefault() {} }, true);
      }
    }
    this.particles.draw(g);
    this.drawStatus(g, dt);
    if (this.wipe > 0) {
      // Scene change: a quick scanline sweep.
      const y = (1 - this.wipe) * g.H;
      g.rect(0, y, g.W, g.H - y, C.bg, this.wipe);
      g.rect(0, y - 3, g.W, 3, C.green, this.wipe);
      this.wipe = Math.max(0, this.wipe - dt * 3.5);
    }
    g.end();
    this.mouse.clicked = false;
    this.mouse.pressed = false;
    this.ui.activate = null;
  }

  drawStatus(g, dt) {
    if (this.sceneName === 'title') return;
    const y = g.H - 22;
    g.rect(0, y - 6, g.W, 28, C.bg, 0.78);
    g.rect(0, y - 6, g.W, 1, C.greenDim, 0.7);
    const p = this.paddle;
    const pc = p.state === 'ok' ? C.green : (p.state === 'lost' || p.state === 'silent') ? C.red : C.grey;
    let x = 14;
    const lamp = (txt, col, blink) => {
      const on = !blink || Math.sin(g.time * 10) > 0;
      g.rect(x, y - 4, 8, 8, col, on ? 1 : 0.25);
      g.text(txt, x + 14, y, { size: 14, font: FONT.ui, color: col, glow: 4 });
      x += g.measure(txt, 14, FONT.ui) + 34;
    };
    lamp(p.statusText(), pc, p.state === 'lost' || p.state === 'silent');
    // Live lever lamps and MIDI message count, on every screen.
    if (p.input || p.msgCount) {
      for (const [k, on] of [['DIT', p.lever.dit], ['DAH', p.lever.dah]]) {
        g.rect(x - 20, y - 6, 40, 12, on ? C.green : C.indigo, on ? 1 : 0.6);
        g.text(k, x, y, { size: 11, font: FONT.ui, color: on ? C.bg : C.grey, align: 'center', glow: 0 });
        x += 46;
      }
      g.text(`MIDI ${p.msgCount || 0}${p.lastData ? ' [' + p.lastData.join(' ') + ']' : ''}`, x - 10, y, { size: 12, font: FONT.ui, color: C.grey, glow: 0 });
      x += 150;
    }
    if (p.armed) {
      const v = p.guard.verdict;
      const gc = p.paddleAllowed() ? C.green : v === 'locked' ? C.red : C.amber;
      lamp(`TX GUARD: ${p.paddleAllowed() ? 'SAFE' : v.toUpperCase()}`, gc, v === 'locked');
    }
    // Audio engine stalled (iOS suspends or interrupts it): say so, loudly.
    const ac = this.audio.ctx;
    if (this.awake && ac && ac.state !== 'running') lamp(`SOUND ${ac.state.toUpperCase()}: TAP TO RESUME`, C.red, true);
    const s = this.store.sync;
    const sc = { ok: C.green, saving: C.cyan, loading: C.cyan, offline: C.amber, error: C.red }[s];
    const sync = BUILD.desktop ? 'SAVE' : 'PI SYNC';
    lamp(s === 'ok' ? `${sync}: OK` : s === 'saving' ? `${sync}: SAVING` : s === 'offline' ? `${sync}: OFFLINE` : s === 'loading' ? sync : 'PROGRESS NOT SAVED', sc, s === 'error');
    if (!g.portrait) g.text('CYBERCW // NIGHT COPY', g.W - 14, y, { size: 14, font: FONT.ui, color: C.greenDim, align: 'right', glow: 0 });
    // Toasts
    let ty = g.H - 60;
    for (const t of this.toasts) {
      t.t -= dt;
      const a = Math.min(1, t.t * 2);
      const w = Math.min(g.W - 40, g.measure(t.text, 18, FONT.ui) + 40);
      g.panel(g.W / 2 - w / 2, ty - 18, w, 36, { color: t.color, alpha: a, fillAlpha: 0.9 * a });
      g.text(t.text, g.W / 2, ty, { size: 18, font: FONT.ui, color: t.color, align: 'center', alpha: a });
      ty -= 44;
    }
    this.toasts = this.toasts.filter((t) => t.t > 0);
    if (this.store.sync === 'error' && this.store.syncMsg && !this._syncToasted) {
      this._syncToasted = true;
      this.toast(this.store.syncMsg, C.red, 6);
      setTimeout(() => { this._syncToasted = false; }, 30000);
    }
  }
}

const game = new Game();
window.cybercw = game;
game.boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.textContent = `BOOT FAILED: ${e.message}`;
});
