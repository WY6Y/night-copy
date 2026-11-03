// Chapter cutscenes: title card, then typewriter dialogue over the art.

import { C, FONT } from '../gfx.js';
import { backdrop, dialogue } from './common.js';
import { CHAPTERS } from '../content.js';

export class Story {
  constructor(game, args) {
    this.game = game;
    this.ci = args.chapter;
    this.part = args.part;
    this.then = args.then;
    this.ch = CHAPTERS[this.ci];
    this.lines = this.ch[this.part];
    this.i = -1;            // -1 = title card
    this.chars = 0;
    this.t = 0;
  }

  enter() {
    const game = this.game;
    game.audio.music(this.part === 'outro' && this.lines.some(([s]) => s === 'FAUX') ? 'overclock' : 'continual');
    game.audio.sfx('whoosh');
  }

  advance() {
    const game = this.game;
    if (this.i >= 0 && this.chars < this.lines[this.i][1].length) { this.chars = 1e9; return; }
    this.i++;
    this.chars = 0;
    this.t = 0;
    game.audio.sfx('click');
    if (this.i >= this.lines.length) this.done();
    else if (this.lines[this.i][0] === 'FAUX') { game.gfx.glitch(0.8); game.audio.sfx('alarm'); }
  }

  done() {
    const game = this.game;
    game.store.p.storySeen[`${this.ci}-${this.part}`] = true;
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

  update(dt) {
    this.t += dt;
    if (this.i === -1 && this.t > 3.2) this.advance();
    if (this.i >= 0) {
      const before = Math.floor(this.chars);
      this.chars += dt * 42;
      if (Math.floor(this.chars) > before && Math.floor(this.chars) % 3 === 0) this.game.audio.sfx('type');
    }
  }

  draw(g) {
    const game = this.game;
    const speaker = this.i >= 0 ? this.lines[this.i][0] : null;
    const art = speaker === 'FAUX' ? 'scene-12-threshold-faux' : (this.part === 'outro' && this.ci === CHAPTERS.length - 1 ? 'scene-07-overlook' : this.ch.art);
    backdrop(game, art, { dark: 0.05, zoom: 1.1, speed: 0.05, panY: 0.45 });
    g.shade(0, g.H * 0.55, g.W, g.H * 0.45, 'rgba(5,4,13,0)', 'rgba(5,4,13,0.8)');
    if (this.i === -1) {
      const a = Math.min(1, this.t * 1.5) * Math.min(1, (3.2 - this.t) * 2);
      g.text(this.part === 'intro' ? `CHAPTER ${this.ci + 1}` : `CHAPTER ${this.ci + 1} // CLEARED`, g.W / 2, g.H * 0.42, { size: 34, color: C.amber, align: 'center', spacing: 10, alpha: a });
      g.text(this.ch.title, g.W / 2, g.H * 0.52, { size: g.portrait ? 64 : 96, color: C.green, align: 'center', spacing: 6, alpha: a, glow: 30 });
      g.text('NIGHT COPY', g.W / 2, g.H * 0.62, { size: 18, font: FONT.ui, color: C.cyan, align: 'center', spacing: 8, alpha: a });
    } else {
      const [who, text] = this.lines[this.i];
      dialogue(game, who, text, this.chars);
    }
    g.text('CLICK / ENTER: NEXT  //  ESC: SKIP', g.W - 16, 22, { size: 13, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
  }
}
