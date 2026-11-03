// CONTACT: work a whole simulated QSO. Copy the CQ, send your call, copy the
// exchange into the log (RST, name, QTH), send TU, and earn a QSL card.
// Characters not yet unlocked are filled in for you, so it works early on.

import { C, FONT } from '../gfx.js';
import { backdrop } from './common.js';
import { NAMES, QTHS, callsign, rand } from '../content.js';
import { localDay, myCall } from '../store.js';

export class Contact {
  constructor(game, args = {}) {
    this.game = game;
    if (args.resume) { Object.assign(this, args.resume, { game }); this.resumed = true; return; }
    const p = game.store.p;
    this.set = new Set(game.core.koch.slice(0, p.unlocked));
    const rst = rand(['599', '579', '559', '449', '589', '5NN']);
    this.q = { call: callsign(), rst, name: rand(NAMES), qth: rand(QTHS) };
    const lvl = Math.min(1, p.chapter / 6);
    this.noise = 0.12 + 0.25 * lvl;
    this.qsb = 0.15 + 0.3 * lvl;
    this.qrm = p.chapter >= 2 ? 0.2 + 0.2 * lvl : 0;
    this.seed = (Math.random() * 2 ** 31) | 1;
    this.stage = 0;
    this.score = 0;
    this.replays = 0;
    this.fieldScore = [];
    this.startedAt = performance.now();
  }

  get stages() {
    const q = this.q, me = myCall(this.game.store.p.settings);
    return [
      { rx: `CQ CQ DE ${q.call} ${q.call} K`, fields: [['CALL', q.call]] },
      { tx: me, vera: `${q.call} is calling CQ. Answer with your call.` },
      { rx: `${me} DE ${q.call} GM UR RST ${q.rst} ${q.rst} NAME ${q.name} ${q.name} QTH ${q.qth} ${q.qth} HW? ${me} DE ${q.call} K`, fields: [['RST', q.rst], ['NAME', q.name], ['QTH', q.qth]] },
      { tx: 'TU', vera: `Wrap it up. Send TU to ${q.name}.` },
      { rx: `TU ${q.name === 'BOB' ? 'OM' : q.name} 73 <SK>`, fields: [] },
    ];
  }

  enter() {
    const game = this.game;
    game.audio.music(null);
    this.wf = document.createElement('canvas');
    this.wf.width = 220; this.wf.height = 140;
    this.wfx = this.wf.getContext('2d');
    this.wfx.fillStyle = '#000'; this.wfx.fillRect(0, 0, 220, 140);
    this.startStage(this.resumed ? this.stage + 1 : this.stage);
  }

  exit() { this.game.wantText(false); }

  startStage(i) {
    const game = this.game;
    this.stage = i;
    const st = this.stages[i];
    if (!st) { this.finish(false); return; }
    if (st.tx) {
      const snapshot = { ...this, game: undefined, wf: undefined, wfx: undefined };
      game.go('relay', {
        title: `CONTACT // ${this.q.call}`, targets: [st.tx], vera: st.vera,
        then: (res) => {
          if (!res.aborted && res.ok) snapshot.score += 300;
          if (res.aborted) game.go('hub');
          else game.go('contact', { resume: snapshot });
        },
      });
      return;
    }
    this.fields = st.fields.map(([label, value]) => ({
      label, value,
      // Pre-fill characters not unlocked yet; the rest are blanks to copy.
      typed: [...value].map((ch) => (this.set.has(ch) ? '' : ch)),
      locked: [...value].map((ch) => !this.set.has(ch)),
    }));
    this.active = 0;
    this.cursorToBlank();
    this.state = 'rx';
    this.play();
    game.wantText(this.fields.length > 0);
  }

  play() {
    const st = this.stages[this.stage];
    const s = this.game.audio.say(st.rx, { effWpm: this.game.store.p.effWpm, noise: this.noise, qsb: this.qsb, qrm: this.qrm, seed: this.seed + this.stage });
    this.rx = { t0: s.t0, end: s.end, marks: s.r.marks };
  }

  cursorToBlank() {
    const f = this.fields?.[this.active];
    if (!f) return;
    this.pos = f.typed.findIndex((c, i) => !c && !f.locked[i]);
    if (this.pos < 0) this.pos = f.value.length;
  }

  submit() {
    const game = this.game;
    let ok = 0, total = 0;
    for (const f of this.fields) {
      const got = f.typed.join('');
      const good = got === f.value;
      f.good = good;
      total++; if (good) ok++;
      this.fieldScore.push(good);
    }
    this.score += ok * 250 - this.replays * 40;
    game.audio.sfx(ok === total ? 'win' : 'bad');
    if (ok < total) game.gfx.glitch(0.6);
    this.state = 'reveal';
    this.revealT = 3.2;
    game.wantText(false);
  }

  finish(aborted) {
    if (this.finished) return;
    this.finished = true;
    const q = this.q;
    const ok = this.fieldScore.filter(Boolean).length;
    this.game.go('results', {
      mission: 'contact', aborted, total: this.fieldScore.length, correct: ok, score: Math.max(0, this.score),
      seconds: (performance.now() - this.startedAt) / 1000,
      qsl: aborted ? null : { call: q.call, rst: q.rst, name: q.name, qth: q.qth, day: localDay(), copied: `${ok}/${this.fieldScore.length}` },
    });
  }

  onKey(e, down) {
    if (!down) return false;
    const game = this.game;
    if (e.key === 'Escape') { this.finish(true); return true; }
    if (this.state === 'qsl') { if (e.key === 'Enter' || e.key === ' ') this.finish(false); return true; }
    if (this.state === 'reveal') { if (e.key === 'Enter') this.revealT = 0; return true; }
    if (this.state !== 'rx') return false;
    if (e.key === '?' || (e.key === 'Tab' && e.shiftKey)) { this.replays++; this.play(); return true; }
    if (!this.fields.length) return true;
    const f = this.fields[this.active];
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (this.active < this.fields.length - 1) { this.active++; this.cursorToBlank(); }
      else if (e.key === 'Enter') this.submit();
      return true;
    }
    if (e.key === 'ArrowUp') { this.active = Math.max(0, this.active - 1); this.cursorToBlank(); return true; }
    if (e.key === 'ArrowDown') { this.active = Math.min(this.fields.length - 1, this.active + 1); this.cursorToBlank(); return true; }
    if (e.key === 'Backspace') {
      let i = Math.min(this.pos, f.value.length) - 1;
      while (i >= 0 && f.locked[i]) i--;
      if (i >= 0) { f.typed[i] = ''; this.pos = i; }
      return true;
    }
    if (e.key.length === 1 && /[a-z0-9?/]/i.test(e.key)) {
      let i = this.pos;
      while (i < f.value.length && f.locked[i]) i++;
      if (i < f.value.length) {
        f.typed[i] = e.key.toUpperCase();
        game.audio.sfx('type');
        i++;
        while (i < f.value.length && f.locked[i]) i++;
        this.pos = i;
        if (i >= f.value.length && this.active < this.fields.length - 1) { this.active++; this.cursorToBlank(); }
      }
      return true;
    }
    return false;
  }

  update(dt) {
    const game = this.game;
    if (this.state === 'rx' && !this.fields.length && game.audio.now() > this.rx.end + 0.8) {
      this.state = 'qsl';
      game.audio.sfx('unlock');
      game.gfx.flash(0.2);
    }
    if (this.state === 'reveal') {
      this.revealT -= dt;
      if (this.revealT <= 0) this.startStage(this.stage + 1);
    }
    this.drawWaterfall();
  }

  keyDown() {
    if (!this.rx) return false;
    const t = this.game.audio.now() - this.rx.t0;
    return this.rx.marks.some(([a, b]) => t >= a && t <= b + 0.004);
  }

  drawWaterfall() {
    const c = this.wfx;
    if (!c) return;
    c.drawImage(this.wf, 0, 1);
    const row = c.createImageData(220, 1);
    const sig = this.keyDown();
    const fade = 1 - this.qsb * 0.5 * (0.5 + 0.5 * Math.sin(performance.now() / 1300));
    for (let x = 0; x < 220; x++) {
      let v = Math.random() * 60 * (0.4 + this.noise * 1.6);
      if (sig && Math.abs(x - 110) < 3) v = 255 * fade;
      if (this.qrm && Math.random() < 0.08 && Math.abs(x - 150) < 2) v = 180;
      row.data[x * 4] = v * 0.25; row.data[x * 4 + 1] = v; row.data[x * 4 + 2] = v * 0.7; row.data[x * 4 + 3] = 255;
    }
    c.putImageData(row, 0, 0);
  }

  draw(g) {
    const game = this.game, q = this.q;
    backdrop(game, 'bg-contact', { dark: 0.35, zoom: 1.06 });
    g.shade(0, 0, g.W, 90, 'rgba(5,4,13,0.9)', 'rgba(5,4,13,0)');
    g.text('CONTACT', 22, 32, { size: 38, color: C.cyan, spacing: 3 });
    const names = ['COPY THE CQ', 'ANSWER', 'LOG THE EXCHANGE', 'SIGN OFF', '73'];
    g.text(`STAGE ${this.stage + 1}/5: ${names[this.stage]}  //  ${game.store.p.effWpm} WPM EFF`, 24, 60, { size: 16, font: FONT.ui, color: C.cyan, glow: 3 });
    g.text(String(Math.max(0, this.score)).padStart(5, '0'), g.W - 22, 32, { size: 40, color: C.amber, align: 'right' });

    // Panadapter waterfall.
    const ww = g.portrait ? g.W - 40 : 360, wh = 200, wx = g.portrait ? 20 : g.W - ww - 24, wy = 100;
    g.panel(wx, wy, ww, wh + 30, { color: C.greenDim, fillAlpha: 0.9 });
    if (this.wf) { g.ctx.imageSmoothingEnabled = false; g.ctx.drawImage(this.wf, wx + 6, wy + 24, ww - 12, wh); g.ctx.imageSmoothingEnabled = true; }
    g.text(`WATERFALL  //  ${game.store.p.settings.tone} HZ`, wx + 10, wy + 12, { size: 13, font: FONT.ui, color: C.green, glow: 2 });
    if (this.keyDown()) g.rect(wx + ww - 22, wy + 6, 10, 10, C.green);

    if (this.state === 'rx' || this.state === 'reveal') {
      const playing = this.rx && game.audio.now() < this.rx.end;
      const lx = 30, ly = g.portrait ? 360 : 130;
      g.text(playing ? `RECEIVING ${q.call.replace(/./g, '?')}...` : 'COPY COMPLETE. FILL THE LOG.', lx, ly, { size: 26, color: playing ? C.amber : C.green, spacing: 2 });
      g.text('? : ASK FOR A REPEAT (AGN)  //  TAB: NEXT FIELD  //  ENTER: LOG IT', lx, ly + 28, { size: 13, font: FONT.ui, color: C.grey, glow: 0 });
      this.fields.forEach((f, k) => {
        const y = ly + 70 + k * 92;
        const act = k === this.active && this.state === 'rx';
        const col = this.state === 'reveal' ? (f.good ? C.green : C.red) : act ? C.amber : C.green;
        g.text(f.label, lx, y, { size: 18, font: FONT.ui, color: col, glow: 3 });
        const box = 46;
        f.value.split('').forEach((ch, i) => {
          const x = lx + i * (box + 6), yy = y + 14;
          const cur = act && i === this.pos && Math.sin(g.time * 8) > 0;
          g.panel(x, yy, box, box + 8, { color: f.locked[i] ? C.indigo : cur ? C.white : col, fillAlpha: 0.8, glow: cur ? 14 : 4 });
          const shown = this.state === 'reveal' ? ch : f.typed[i];
          const right = f.typed[i] === ch;
          g.text(shown || '', x + box / 2, yy + box / 2 + 4, { size: 40, color: f.locked[i] ? C.grey : this.state === 'reveal' ? (right ? C.green : C.red) : C.white, align: 'center' });
        });
      });
      if (this.state === 'reveal') {
        const st = this.stages[this.stage];
        g.wrap(st.rx.replace('<SK>', 'SK'), g.W - 80, 18).slice(0, 3).forEach((l, i) => g.text(l, 30, g.H - 120 + i * 22, { size: 18, font: FONT.ui, color: C.cyan }));
      }
      if (this.state === 'rx' && this.fields.length) {
        if (game.button('log', 30, g.H - 96, 220, 44, 'LOG IT', { size: 26, color: C.amber })) this.submit();
        if (game.button('agn', 262, g.H - 96, 160, 44, 'AGN?', { size: 26, color: C.cyan })) { this.replays++; this.play(); }
      }
    }

    if (this.state === 'qsl') this.drawQsl(g);
  }

  drawQsl(g) {
    const game = this.game, q = this.q;
    const w = Math.min(760, g.W - 40), h = w * 0.58;
    const x = g.W / 2 - w / 2, y = g.H / 2 - h / 2 - 10;
    g.rect(0, 0, g.W, g.H, C.bg, 0.6);
    g.cover(game.art['scene-07-overlook'], x, y, w, h, { alpha: 0.9, zoom: 1.1 });
    g.shade(x, y, w, h, 'rgba(5,4,13,0.2)', 'rgba(5,4,13,0.92)');
    g.panel(x, y, w, h, { color: C.amber, fillAlpha: 0, glow: 18 });
    g.text(q.call, x + 30, y + 64, { size: 92, color: C.amber, glow: 30, spacing: 6 });
    g.text('CONFIRMING QSO WITH', x + 32, y + 120, { size: 15, font: FONT.ui, color: C.grey });
    g.text(myCall(game.store.p.settings), x + 32, y + 152, { size: 44, color: C.green, spacing: 4 });
    const col = (label, val, cx) => {
      g.text(label, cx, y + h - 82, { size: 13, font: FONT.ui, color: C.grey, glow: 0 });
      g.text(val, cx, y + h - 50, { size: 34, color: C.white });
    };
    col('DATE', localDay(), x + 32);
    col('RST', q.rst, x + w * 0.38);
    col('OP', q.name, x + w * 0.54);
    col('QTH', q.qth, x + w * 0.74);
    g.text('TNX QSO ES 73  //  NIGHT COPY RELAY NET', x + w - 24, y + 26, { size: 13, font: FONT.ui, color: C.cyan, align: 'right' });
    if (game.button('qsl-ok', g.W / 2 - 160, y + h + 18, 320, 50, 'FILE THE QSL', { size: 28, color: C.amber })) this.finish(false);
  }
}
