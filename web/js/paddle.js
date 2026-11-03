// Paddle input: the WY6Y CW Paddle over Web MIDI (Note 20 dit, 21 dah), plus
// keyboard and touch keying. The MIDI paddle is shared with AetherSDR, which
// can key the HL2, so paddle input only reaches the keyer while the Pi's TX
// guard reports SAFE on a fresh read (or Stephen confirms an UNKNOWN).

const DIT_NOTE = 20, DAH_NOTE = 21;
const SILENT_MS = 2600;   // firmware re-sends lever state every 1 s
const GUARD_POLL_MS = 3000;
const GUARD_MAX_AGE_MS = 5000;

export class Paddle {
  constructor(audio, settings) {
    this.audio = audio;
    this.settings = settings;
    this.midi = null;
    this.input = null;
    this.state = 'none';        // none | unsupported | denied | absent | ok | lost | silent
    this.lastMsg = 0;
    this.lever = { dit: false, dah: false };
    this.keys = { dit: false, dah: false };
    this.armed = false;          // a sending mission wants input
    this.guard = { verdict: 'unknown', reason: 'not checked yet', at: 0 };
    this.confirmedUnknown = false;
    this.listeners = new Set();
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  // ---- MIDI ----------------------------------------------------------------

  async connect() {
    if (!navigator.requestMIDIAccess) { this.state = 'unsupported'; return; }
    try {
      this.midi = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.state = 'denied';
      return;
    }
    this.midi.onstatechange = () => this.attach();
    this.attach();
  }

  attach() {
    if (!this.midi || document.hidden) return;
    let found = null;
    for (const inp of this.midi.inputs.values()) {
      if (/cw paddle/i.test(inp.name) && inp.state === 'connected') found = inp;
    }
    if (found && found !== this.input) {
      this.detach();
      this.input = found;
      found.onmidimessage = (e) => this.onMidi(e.data);
      found.open?.();
      this.lastMsg = performance.now();
      this.state = 'ok';
    } else if (!found) {
      if (this.input) this.state = 'lost';
      else if (this.state !== 'lost') this.state = 'absent';
      this.detach();
      this.dropLevers();
    }
  }

  /** Close the MIDI port (shared-device rule: whoever opens it closes it). */
  detach() {
    if (!this.input) return;
    this.input.onmidimessage = null;
    try { this.input.close?.(); } catch { /* already closed */ }
    this.input = null;
  }

  onVisibility() {
    if (document.hidden) {
      this.detach();
      this.dropLevers();
      this.setKeys(false, false);
      this.audio.releaseKeys();
    } else {
      this.attach();
    }
  }

  onMidi(data) {
    this.lastMsg = performance.now();
    this.msgCount = (this.msgCount || 0) + 1;
    this.lastData = Array.from(data);
    if (this.state !== 'ok') this.state = 'ok';
    const [st, note, vel] = data;
    const type = st & 0xf0;
    if (type !== 0x90 && type !== 0x80) return;
    const down = type === 0x90 && vel > 0;
    let { dit, dah } = this.lever;
    const swap = this.settings().swap;
    if (note === DIT_NOTE) swap ? (dah = down) : (dit = down);
    else if (note === DAH_NOTE) swap ? (dit = down) : (dah = down);
    else return;
    this.lever = { dit, dah };
    this.emit('lever', this.lever);
    this.route();
  }

  dropLevers() {
    this.lever = { dit: false, dah: false };
    this.route();
  }

  // ---- keyboard / touch ----------------------------------------------------

  setKeys(dit, dah) {
    this.keys = { dit, dah };
    this.route();
  }

  straight(down) {
    if (!this.armed) return;
    this.audio.straight(down);
  }

  // ---- routing and guard -----------------------------------------------

  /** Paddle input may key the sidetone only when the guard allows it. */
  paddleAllowed() {
    if (!this.armed) return false;
    const fresh = performance.now() - this.guard.at < GUARD_MAX_AGE_MS + GUARD_POLL_MS;
    if (this.guard.verdict === 'safe' && fresh && this.guard.age_ms < GUARD_MAX_AGE_MS) return true;
    if (this.guard.verdict === 'unknown' && this.confirmedUnknown) return true;
    return false;
  }

  route() {
    const pad = this.paddleAllowed() ? this.lever : { dit: false, dah: false };
    const keys = this.armed ? this.keys : { dit: false, dah: false };
    this.audio.paddles(pad.dit || keys.dit, pad.dah || keys.dah);
  }

  arm(on) {
    this.armed = on;
    this.confirmedUnknown = false;
    if (on) this.pollGuard(); else clearTimeout(this.guardTimer);
    this.route();
  }

  async pollGuard() {
    clearTimeout(this.guardTimer);
    const before = this.guard.verdict;
    try {
      const r = await fetch('api/txguard', { cache: 'no-store' });
      const j = await r.json();
      this.guard = { ...j, at: performance.now() };
    } catch {
      this.guard = { verdict: 'unknown', reason: 'Pi guard service unreachable', at: performance.now(), age_ms: 0 };
    }
    if (this.guard.verdict === 'locked' || (before !== this.guard.verdict && this.guard.verdict !== 'safe')) {
      // Any change toward danger cancels an earlier confirmation.
      this.confirmedUnknown = false;
    }
    if (!this.paddleAllowed()) this.audio.releaseKeys();
    this.route();
    this.emit('guard', this.guard);
    if (this.armed) this.guardTimer = setTimeout(() => this.pollGuard(), GUARD_POLL_MS);
  }

  confirmUnknown() {
    if (this.guard.verdict === 'unknown') this.confirmedUnknown = true;
    this.route();
  }

  tick() {
    if (this.state === 'ok' && performance.now() - this.lastMsg > SILENT_MS) {
      this.state = 'silent';
      this.dropLevers();
    }
  }

  statusText() {
    return {
      none: 'PADDLE: NOT CONNECTED', unsupported: 'PADDLE: NO WEB MIDI', denied: 'PADDLE: MIDI BLOCKED',
      absent: 'PADDLE: NOT FOUND', ok: 'PADDLE: ONLINE', lost: 'PADDLE LOST', silent: 'PADDLE SILENT (USB?)',
    }[this.state];
  }

  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(type, data) { for (const f of this.listeners) f(type, data); }
}
