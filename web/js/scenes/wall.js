// QSL WALL: every card earned in CONTACT and QSO LADDER, newest first, pinned
// up on the shack wall. Tap a card to hear the other station's call.

import { C, FONT } from '../gfx.js';
import { backdrop, header } from './common.js';
import { myCall } from '../store.js';

export class Wall {
  constructor(game) {
    this.game = game;
    this.page = 0;
  }

  enter() { this.game.audio.music('continual'); }

  get cards() { return [...(this.game.store.p.qsl || [])].reverse(); }

  perPage() { return this.game.gfx.portrait ? 6 : 8; }

  onKey(e, down) {
    if (!down) return false;
    const pages = Math.max(1, Math.ceil(this.cards.length / this.perPage()));
    if (e.key === 'Escape' || e.key === 'Enter') { this.game.go('hub'); return true; }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { this.page = Math.min(pages - 1, this.page + 1); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { this.page = Math.max(0, this.page - 1); return true; }
    return false;
  }

  card(g, q, x, y, w, h, tilt) {
    const game = this.game, c = g.ctx;
    const art = game.art['qsl-blank'];
    c.save();
    c.translate(x + w / 2, y + h / 2);
    c.rotate(tilt);
    c.translate(-w / 2, -h / 2);
    c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 16;
    if (art) c.drawImage(art, 0, 0, w, h); else { c.fillStyle = '#2a2318'; c.fillRect(0, 0, w, h); }
    c.shadowBlur = 0;
    // Text goes on the blank right two thirds of the card.
    const tx = w * 0.4;
    g.text(q.call, tx, h * 0.3, { size: h * 0.24, color: '#1b1408', glow: 0, spacing: 2 });
    g.text(`TO ${myCall(game.store.p.settings)}  ${q.day || ''}`, tx, h * 0.47, { size: h * 0.075, font: FONT.ui, color: '#3a2c14', glow: 0 });
    g.text(`RST ${q.rst}  OP ${q.name}`, tx, h * 0.64, { size: h * 0.1, color: '#2a1f0e', glow: 0 });
    g.text(`QTH ${q.qth}`, tx, h * 0.79, { size: h * 0.1, color: '#2a1f0e', glow: 0 });
    g.text(`COPIED ${q.copied}`, w - 10, h - 10, { size: h * 0.07, font: FONT.ui, color: '#5a4520', align: 'right', glow: 0 });
    c.restore();
  }

  update() {}

  draw(g) {
    const game = this.game, m = game.mouse;
    backdrop(game, 'bg-shack-hub', { dark: 0.6, rainAlpha: 0.2 });
    const cards = this.cards;
    header(g, 'QSL WALL', `${cards.length} CARD${cards.length === 1 ? '' : 'S'}  //  EARNED IN CONTACT AND QSO LADDER  //  TAP ONE TO HEAR THE CALL`, C.amber);
    if (game.button('wall-back', g.W - 170, 18, 150, 40, 'BACK', { size: 22, color: C.cyan })) game.go('hub');
    if (!cards.length) {
      g.text('NO CARDS YET. WORK A QSO.', g.W / 2, g.H / 2, { size: 48, color: C.grey, align: 'center' });
      return;
    }
    const per = this.perPage(), cols = g.portrait ? 2 : 4;
    const pages = Math.ceil(cards.length / per);
    this.page = Math.min(this.page, pages - 1);
    const gap = 22, x0 = 30, y0 = 110;
    const w = (g.W - x0 * 2 - gap * (cols - 1)) / cols, h = w / 1.7;
    cards.slice(this.page * per, this.page * per + per).forEach((q, i) => {
      const x = x0 + (i % cols) * (w + gap), y = y0 + Math.floor(i / cols) * (h + gap + 10);
      // A fixed tilt per card, so the wall doesn't shuffle each frame.
      const seed = [...q.call].reduce((s, ch) => s + ch.charCodeAt(0), 0);
      this.card(g, q, x, y, w, h, ((seed % 7) - 3) * 0.008);
      if (m.clicked && m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h) game.wake().then(() => game.audio.say(q.call));
    });
    if (pages > 1) {
      const by = g.H - 90;
      if (game.button('wall-prev', g.W / 2 - 230, by, 140, 40, '< NEWER', { size: 20, color: C.cyan, disabled: this.page === 0 })) this.page--;
      g.text(`${this.page + 1}/${pages}`, g.W / 2, by + 22, { size: 24, color: C.amber, align: 'center' });
      if (game.button('wall-next', g.W / 2 + 90, by, 140, 40, 'OLDER >', { size: 20, color: C.cyan, disabled: this.page >= pages - 1 })) this.page++;
    }
  }
}
