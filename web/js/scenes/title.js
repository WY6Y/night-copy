import { C, FONT } from '../gfx.js';
import { backdrop } from './common.js';

export class Title {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.leaving = 0;
  }

  start() {
    if (this.leaving) return;
    const game = this.game;
    game.wake().then(() => {
      game.audio.sfx('whoosh');
      // His own call: the one thing he can already copy.
      game.audio.say(game.store.p.settings.call || 'CQ', { effWpm: 20 });
    });
    this.leaving = 1.6;
    game.gfx.glitch(1);
  }

  onKey(e, down) {
    if (down && !e.repeat) { this.start(); return true; }
    return false;
  }

  onPointer(_x, _y, down) { if (down) this.start(); }

  update(dt) {
    this.t += dt;
    if (this.leaving) {
      this.leaving -= dt;
      if (this.leaving <= 0) {
        const p = this.game.store.p;
        // A desktop player has no call yet: ask for it before the story.
        if (!p.settings.call) this.game.go('settings', { askCall: true });
        else if (!p.storySeen['0-intro']) this.game.go('story', { chapter: 0, part: 'intro', then: 'hub' });
        else this.game.go('hub');
      }
    }
    if (Math.random() < 0.008) this.game.gfx.glitch(0.35);
  }

  draw(g) {
    const game = this.game;
    const at = backdrop(game, 'bg-title', { dark: 0.25, speed: 0.03, zoom: 1.12 });
    g.shade(0, g.H * 0.35, g.W, g.H * 0.65, 'rgba(5,4,13,0)', 'rgba(5,4,13,0.92)');
    const cx = g.W / 2;
    const big = g.portrait ? 110 : 150;
    const ty = g.portrait ? g.H * 0.42 : g.H * 0.5;
    const jitter = Math.random() < 0.06 ? (Math.random() - 0.5) * 12 : 0;
    // Chromatic split title.
    g.text('NIGHT COPY', cx + jitter - 3, ty, { size: big, color: C.red, align: 'center', alpha: 0.55, glow: 0, spacing: 8 });
    g.text('NIGHT COPY', cx + jitter + 3, ty, { size: big, color: C.cyan, align: 'center', alpha: 0.55, glow: 0, spacing: 8 });
    g.text('NIGHT COPY', cx + jitter, ty, { size: big, color: C.green, align: 'center', glow: 30, spacing: 8 });
    g.text('CYBERCW  //  A CYBERPACKETPERIL SIGNAL', cx, ty + big * 0.55, { size: 20, font: FONT.ui, color: C.cyan, align: 'center', spacing: 4, glow: 6 });
    const blink = Math.sin(this.t * 3.2) > -0.2;
    if (blink) g.text(this.leaving ? 'TUNING IN...' : 'PRESS ANY KEY  //  TAP TO TUNE IN', cx, ty + big * 0.95, { size: 30, color: C.amber, align: 'center', spacing: 3 });
    g.text('LEARN TO HEAR IT. LEARN TO SEND IT.', cx, g.H - 40, { size: 16, font: FONT.ui, color: C.grey, align: 'center', spacing: 3, glow: 0 });
    // The tower beacon in the art: pulse a glow where it sits.
    const { x: bx, y: by } = at(0.795, 0.185);
    const c = g.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.4);
    const grd = c.createRadialGradient(bx, by, 0, bx, by, 40 + pulse * 20);
    grd.addColorStop(0, `rgba(255,59,74,${0.35 * pulse})`);
    grd.addColorStop(1, 'rgba(255,59,74,0)');
    c.fillStyle = grd;
    c.fillRect(bx - 80, by - 80, 160, 160);
  }
}
