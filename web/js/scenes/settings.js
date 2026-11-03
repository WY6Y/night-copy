import { C, FONT } from '../gfx.js';
import { backdrop } from './common.js';

const ROWS = [
  ['call', 'YOUR CALL', '', 0, 0, 0, 'Sent in RELAY and CONTACT. Enter to edit, type it, Enter to save.'],
  ['charWpm', 'CHARACTER SPEED', 'WPM', 15, 30, 1, 'How fast each letter sounds. Keep it 18 to 22 so you learn sounds, not counts.'],
  ['tone', 'TONE', 'HZ', 400, 900, 25, 'Pitch of the CW you copy and your sidetone.'],
  ['keyerWpm', 'KEYER SPEED', 'WPM', 8, 30, 1, 'Speed of your paddle in RELAY and CONTACT.'],
  ['modeB', 'IAMBIC MODE', '', 0, 1, 1, 'B finishes a squeeze with one more element; A stops.'],
  ['swap', 'SWAP PADDLES', '', 0, 1, 1, 'Swap dit and dah on the MIDI paddle.'],
  ['cwVol', 'CW VOLUME', '%', 0, 1, 0.05, ''],
  ['sfxVol', 'EFFECTS VOLUME', '%', 0, 1, 0.05, ''],
  ['musicVol', 'MUSIC VOLUME', '%', 0, 1, 0.05, 'Music ducks whenever CW plays.'],
  ['rainVol', 'RAIN VOLUME', '%', 0, 1, 0.05, ''],
  ['crt', 'SCANLINES', '', 0, 1, 1, 'CRT scanlines.'],
];

export class Settings {
  constructor(game, args = {}) {
    this.game = game;
    this.sel = 0;
    this.askCall = !!args.askCall; // first desktop run: no call yet
    this.editing = this.askCall ? '' : null;
  }

  enter() {
    this.game.audio.music('continual');
    if (this.editing !== null) this.game.wantText(true);
  }

  exit() { this.game.wantText(false); }

  startEdit() {
    this.editing = this.game.store.p.settings.call || '';
    this.game.wantText(true);
  }

  finishEdit() {
    const call = this.editing.trim();
    if (!call) return;
    this.editing = null;
    this.game.wantText(false);
    this.game.store.p.settings.call = call;
    this.game.store.save();
    this.game.audio.say(call, { effWpm: this.game.store.p.settings.charWpm });
    if (this.askCall) {
      this.askCall = false;
      const p = this.game.store.p;
      if (!p.storySeen['0-intro']) this.game.go('story', { chapter: 0, part: 'intro', then: 'hub' });
    }
  }

  leave() {
    if (this.askCall) return; // a call is needed before the first mission
    this.game.go('hub');
  }

  change(i, dir) {
    const [key, , , min, max, step] = ROWS[i];
    if (key === 'call') { this.startEdit(); return; }
    const s = this.game.store.p.settings;
    if (typeof s[key] === 'boolean') s[key] = !s[key];
    else s[key] = Math.round(Math.max(min, Math.min(max, s[key] + dir * step)) * 100) / 100;
    if (key === 'charWpm' && this.game.store.p.effWpm > s.charWpm) this.game.store.p.effWpm = s.charWpm;
    this.game.audio.applyVolumes();
    this.game.audio.configKeyer();
    if (key === 'charWpm' || key === 'tone' || key === 'cwVol') this.game.audio.say('K M', { effWpm: s.charWpm });
    this.game.store.save();
  }

  onKey(e, down) {
    if (!down) return false;
    if (this.editing !== null) {
      if (e.key === 'Enter') this.finishEdit();
      else if (e.key === 'Escape' && !this.askCall) { this.editing = null; this.game.wantText(false); }
      else if (e.key === 'Backspace') this.editing = this.editing.slice(0, -1);
      else if (e.key.length === 1 && /[a-z0-9/]/i.test(e.key) && this.editing.length < 10) this.editing += e.key.toUpperCase();
      return true;
    }
    if (e.key === 'Escape' || e.key === 'Backspace') { this.leave(); return true; }
    if (e.key === 'ArrowUp') { this.sel = (this.sel + ROWS.length - 1) % ROWS.length; return true; }
    if (e.key === 'ArrowDown') { this.sel = (this.sel + 1) % ROWS.length; return true; }
    if (e.key === 'ArrowLeft') { this.change(this.sel, -1); return true; }
    if (e.key === 'ArrowRight' || e.key === 'Enter') { this.change(this.sel, 1); return true; }
    return false;
  }

  draw(g) {
    const game = this.game, s = game.store.p.settings;
    backdrop(game, 'bg-shack-hub', { dark: 0.75, rainAlpha: 0.2 });
    g.text('SETUP', 24, 40, { size: 52, color: C.cyan, spacing: 5 });
    const w = Math.min(900, g.W - 40), x = (g.W - w) / 2;
    let y = 90;
    ROWS.forEach(([key, label, unit], i) => {
      const v = s[key];
      const shown = key === 'call' ? (this.editing !== null ? `${this.editing}_` : v || 'NOT SET') : typeof v === 'boolean' ? (key === 'modeB' ? (v ? 'B' : 'A') : v ? 'ON' : 'OFF') : unit === '%' ? `${Math.round(v * 100)}%` : `${v} ${unit}`;
      const act = i === this.sel;
      g.panel(x, y, w, 40, { color: act ? C.amber : C.greenDim, fillAlpha: act ? 0.9 : 0.7, glow: act ? 12 : 3 });
      g.text(label, x + 16, y + 20, { size: 24, color: act ? C.amber : C.green });
      if (key === 'call') {
        g.text(shown, x + w - 130, y + 20, { size: 26, color: this.editing !== null ? C.amber : C.white, align: 'center' });
        if (this.editing !== null) {
          if (game.button('call-ok', x + w - 250, y + 4, 60, 32, 'OK', { size: 22 })) this.finishEdit();
        } else if (game.button('call-edit', x + w - 250, y + 4, 70, 32, 'EDIT', { size: 22 })) { this.sel = i; this.startEdit(); }
        y += 44;
        return;
      }
      if (game.button(`m-${key}`, x + w - 250, y + 4, 40, 32, '<', { size: 24 })) { this.sel = i; this.change(i, -1); }
      g.text(shown, x + w - 130, y + 20, { size: 26, color: C.white, align: 'center' });
      if (game.button(`p-${key}`, x + w - 50, y + 4, 40, 32, '>', { size: 24 })) { this.sel = i; this.change(i, 1); }
      y += 44;
    });
    const help = this.askCall ? 'Type your callsign (or your name) and press Enter. You will send it in RELAY and CONTACT.' : ROWS[this.sel][6];
    if (help) g.text(help, g.W / 2, y + 16, { size: 16, font: FONT.ui, color: C.cyan, align: 'center' });
    y += 40;
    const p = game.paddle;
    g.text(`${p.statusText()}${p.input ? `  //  ${p.input.name}` : ''}`, g.W / 2, y, { size: 16, font: FONT.ui, color: p.state === 'ok' ? C.green : C.amber, align: 'center' });
    y += 22;
    if (game.button('midi', g.W / 2 - 300, y, 290, 40, 'CONNECT PADDLE', { size: 22, color: C.green })) { p.connect(); }
    if (game.button('fs', g.W / 2 + 10, y, 290, 40, 'FULLSCREEN', { size: 22, color: C.cyan })) game.fullscreen();
    if (!this.askCall && game.button('back', 24, g.H - 84, 200, 44, 'BACK', { size: 26, color: C.amber })) this.leave();
    g.text('ARROWS TO ADJUST  //  ESC: BACK', g.W - 24, g.H - 62, { size: 13, font: FONT.ui, color: C.grey, align: 'right', glow: 0 });
  }
}
