// Copy fields: one box per character, typed in place. Characters he hasn't
// unlocked yet are filled in and skipped, so any text works at any stage.
// Used by QSO LADDER and DEAD DROP.

import { C, FONT } from '../gfx.js';

export class Fields {
  /** list: [[label, value]]; set: the unlocked characters. */
  constructor(list, set) {
    this.list = list.map(([label, value]) => ({
      label, value,
      typed: [...value].map((ch) => (set.has(ch) ? '' : ch)),
      locked: [...value].map((ch) => !set.has(ch)),
    }));
    this.active = 0;
    this.toBlank();
  }

  toBlank() {
    const f = this.list[this.active];
    if (!f) return;
    this.pos = f.typed.findIndex((c, i) => !c && !f.locked[i]);
    if (this.pos < 0) this.pos = f.value.length;
    // raw: where his typing is, counting pre-filled boxes he hasn't stepped over.
    this.raw = f.typed.some((c, i) => c && !f.locked[i]) ? this.pos : 0;
  }

  /** Handle a key. Returns 'submit' on Enter at the last field, true if used. */
  key(e) {
    const f = this.list[this.active];
    if (!f) return e.key === 'Enter' ? 'submit' : false;
    const last = this.active >= this.list.length - 1;
    if (e.key === 'Enter') {
      if (!last) { this.active++; this.toBlank(); return true; }
      return 'submit';
    }
    if (e.key === 'Tab') { this.active = (this.active + 1) % this.list.length; this.toBlank(); return true; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { this.active = Math.max(0, this.active - 1); this.toBlank(); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { this.active = Math.min(this.list.length - 1, this.active + 1); this.toBlank(); return true; }
    if (e.key === 'Backspace') {
      let i = Math.min(this.pos, f.value.length) - 1;
      while (i >= 0 && f.locked[i]) i--;
      if (i >= 0) { f.typed[i] = ''; this.pos = i; this.raw = i; } else if (this.active > 0) { this.active--; this.pos = this.list[this.active].value.length; }
      return true;
    }
    if (e.key.length === 1 && /[a-z0-9?/.,=]/i.test(e.key)) {
      const ch = e.key.toUpperCase(), len = f.value.length;
      // Typing a pre-filled letter (he knows the word) steps over its box.
      for (let j = this.raw; j < Math.min(this.pos, len); j++) {
        if (f.locked[j] && f.value[j] === ch) { this.raw = j + 1; return 'typed'; }
      }
      if (this.pos >= len) {
        if (last) return true;
        this.active++; this.toBlank();
        return this.key(e);
      }
      f.typed[this.pos] = ch;
      this.raw = this.pos + 1;
      let i = this.pos + 1;
      while (i < len && f.locked[i]) i++;
      this.pos = i;
      // Stay put while pre-filled boxes trail the word, so he can type over them.
      if (i >= len && !last && !f.locked.slice(this.raw).some(Boolean)) { this.active++; this.toBlank(); }
      return 'typed';
    }
    return false;
  }

  /** Grade every field: sets f.good, returns { ok, total, chars, charsOk } over open characters. */
  grade() {
    let ok = 0, chars = 0, charsOk = 0;
    for (const f of this.list) {
      f.good = f.typed.join('') === f.value;
      if (f.good) ok++;
      f.value.split('').forEach((ch, i) => { if (!f.locked[i]) { chars++; if (f.typed[i] === ch) charsOk++; } });
    }
    return { ok, total: this.list.length, chars, charsOk };
  }

  /** Lay the fields out left to right, wrapping. Returns the bottom y. */
  draw(g, x0, y0, w, o = {}) {
    const box = o.box || 40, gap = 4, fieldGap = o.fieldGap ?? 22, rowH = box + (o.labels === false ? 22 : 40);
    const reveal = !!o.reveal;
    let x = x0, y = y0;
    this.list.forEach((f, k) => {
      const fw = f.value.length * (box + gap) - gap;
      if (x > x0 && x + fw > x0 + w) { x = x0; y += rowH; }
      const act = k === this.active && !reveal;
      const col = reveal ? (f.good ? C.green : C.red) : act ? C.amber : C.green;
      if (o.labels !== false) g.text(f.label, x, y, { size: 15, font: FONT.ui, color: col, glow: 3 });
      const by = y + (o.labels === false ? 0 : 12);
      f.value.split('').forEach((ch, i) => {
        const bx = x + i * (box + gap);
        const cur = act && i === this.pos && Math.sin(g.time * 8) > 0;
        g.panel(bx, by, box, box + 6, { color: f.locked[i] ? C.indigo : cur ? C.white : col, fillAlpha: 0.82, glow: cur ? 14 : 4 });
        const shown = reveal ? ch : f.typed[i];
        const right = f.typed[i] === ch;
        g.text(shown || '', bx + box / 2, by + box / 2 + 4, { size: box * 0.85, color: f.locked[i] ? C.grey : reveal ? (right ? C.green : C.red) : C.white, align: 'center' });
      });
      x += fw + fieldGap;
    });
    return y + rowH;
  }
}
