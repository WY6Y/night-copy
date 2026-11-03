// Progress: the Pi is the source of truth (/api/progress, revisioned). The
// browser keeps a cache so receive practice works offline, but a failed save
// is always shown ("PROGRESS NOT SAVED"), never dropped quietly.

import { BUILD } from './build.js';

const CACHE = 'cybercw.progress';
const QUEUE = 'cybercw.sessions';

export const DEFAULTS = {
  v: 1,
  unlocked: 2,           // Koch letters available (K, M)
  chapter: 0,            // chapters cleared (bosses beaten)
  xp: 0,
  effWpm: 8,             // Farnsworth effective speed for words and QSOs
  stats: {},             // per char: { acc, lat, seen, ok }
  sendStats: {},         // per char: { ok, n }
  best: {},
  introduced: {},        // letters whose intro has played
  storySeen: {},
  qsl: [],               // completed simulated QSOs
  weak: [],
  confusions: {},        // 'K>R': weight (heard K, typed R); fades as K is copied right
  sendMix: {},           // 'A>N': weight (asked for A, sent N); fades as A is sent right
  rushLen: 2,            // WORD RUSH word length ladder
  settings: {
    charWpm: 20, tone: 600, keyerWpm: 16, modeB: true, swap: false,
    cwVol: 0.8, sfxVol: 0.7, musicVol: 0.45, rainVol: 0.5, crt: true,
    call: BUILD.call,      // the player's callsign, sent in RELAY and CONTACT
  },
  updated: 0,
};

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? { ...base[k], ...v } : v;
  }
  return out;
}

// Deep equality that ignores key order (the server returns keys sorted).
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
}

// The practice day. The Pi deploy pins Central so the 19:00 nudge agrees with
// every device; the desktop build uses the player's own clock.
export function localDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', BUILD.desktop ? {} : { timeZone: 'America/Chicago' }).format(d);
}

export function myCall(settings) {
  return settings.call || 'NOCALL';
}

export class Store {
  constructor() {
    this.p = structuredClone(DEFAULTS);
    this.rev = 0;
    this.sync = 'loading'; // ok | saving | offline | error
    this.syncMsg = '';
    this.saveTimer = null;
  }

  async load() {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { /* storage blocked */ }
    try {
      const r = await fetch('api/progress', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      this.rev = j.rev;
      // Prefer whichever copy has more progress (a device may have played offline).
      const server = j.data;
      const local = cached?.data;
      const pick = (local && (!server || (local.xp || 0) > (server.xp || 0))) ? local : server;
      this.p = merge(DEFAULTS, pick || {});
      this.sync = 'ok';
      if (pick === local && local) this.save(true);
    } catch (e) {
      this.p = merge(DEFAULTS, cached?.data || {});
      this.rev = cached?.rev || 0;
      this.sync = 'offline';
      this.syncMsg = 'Progress server unreachable: playing from this browser\'s copy';
    }
    this.flushSessions();
  }

  cache() {
    try { localStorage.setItem(CACHE, JSON.stringify({ rev: this.rev, data: this.p })); } catch { /* storage blocked */ }
  }

  save(now = false) {
    this.p.updated = Date.now();
    this.p.weak = this.weakLetters(4);
    this.cache();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.push(), now ? 0 : 600);
  }

  async push(retry = true) {
    // One write in flight at a time; a save during it queues one more.
    if (this.pushing) { this.dirty = true; return; }
    this.pushing = true;
    try { await this.pushOnce(retry); } finally { this.pushing = false; }
    if (this.dirty) { this.dirty = false; this.push(); }
  }

  async pushOnce(retry) {
    this.sync = 'saving';
    try {
      // Snapshot what goes out: play keeps changing this.p while the request
      // is in flight, so the read-back is checked against what was sent.
      const body = JSON.stringify({ base_rev: this.rev, data: this.p });
      const sent = JSON.parse(body).data;
      const r = await fetch('api/progress', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body,
      });
      const j = await r.json();
      if (r.status === 409 && retry) {
        // Another device saved first: keep the copy with more progress.
        this.rev = j.rev;
        if ((j.data?.xp || 0) > (this.p.xp || 0)) { this.p = merge(DEFAULTS, j.data); this.cache(); this.sync = 'ok'; return; }
        return this.pushOnce(false);
      }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      // The server read its write back; confirm it matches what we sent.
      if (!same(j.data, sent)) throw new Error('saved copy differs');
      this.rev = j.rev;
      this.cache();
      this.sync = 'ok';
      this.syncMsg = '';
    } catch (e) {
      this.sync = 'error';
      this.syncMsg = `PROGRESS NOT SAVED to ${BUILD.desktop ? 'disk' : 'the Pi'} (${e.message}). Kept in this browser; retrying.`;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.push(), 15000);
    }
  }

  async logSession(s) {
    const row = { day: localDay(), ...s };
    let q = [];
    try { q = JSON.parse(localStorage.getItem(QUEUE) || '[]'); } catch { /* storage blocked */ }
    q.push(row);
    try { localStorage.setItem(QUEUE, JSON.stringify(q)); } catch { /* storage blocked */ }
    await this.flushSessions();
  }

  async flushSessions() {
    let q = [];
    try { q = JSON.parse(localStorage.getItem(QUEUE) || '[]'); } catch { return; }
    while (q.length) {
      try {
        const r = await fetch('api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q[0]) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        q.shift();
        localStorage.setItem(QUEUE, JSON.stringify(q));
      } catch {
        this.sync = 'error';
        this.syncMsg = `${q.length} session(s) waiting to be saved`;
        return;
      }
    }
  }

  /** Recent missions, oldest first (COACH trends). */
  async sessions() {
    try {
      const r = await fetch('api/session?limit=300', { cache: 'no-store' });
      return r.ok ? (await r.json()).sessions : [];
    } catch { return []; }
  }

  async summary() {
    try {
      const r = await fetch(`api/summary?day=${localDay()}`, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  // ---- stats ---------------------------------------------------------------

  record(ch, correct, latMs) {
    const s = this.p.stats[ch] || { acc: 0, lat: 0, seen: 0, ok: 0 };
    const a = s.seen < 5 ? 0.35 : 0.15;
    s.acc = s.seen === 0 ? (correct ? 1 : 0) : s.acc * (1 - a) + (correct ? a : 0);
    if (correct && latMs != null) s.lat = s.lat ? s.lat * 0.8 + latMs * 0.2 : latMs;
    s.seen++;
    if (correct) s.ok++;
    this.p.stats[ch] = s;
    // Copying a letter right fades the mix-ups recorded for it.
    if (correct) {
      for (const k of Object.keys(this.p.confusions || {})) {
        if (k[0] === ch && k[1] === '>') {
          this.p.confusions[k] *= 0.85;
          if (this.p.confusions[k] < 0.3) delete this.p.confusions[k];
        }
      }
    }
  }

  /** A miss where a different letter was typed: remember the mix-up. */
  recordConfusion(heard, typed) {
    if (!typed || typed === heard) return;
    const k = `${heard}>${typed}`;
    this.p.confusions[k] = (this.p.confusions[k] || 0) + 1;
  }

  /** Top mix-up pairs, both directions combined: [{ a, b, w }]. */
  topPairs(n = 3) {
    const pairs = {};
    for (const [k, w] of Object.entries(this.p.confusions || {})) {
      const [h, t] = k.split('>');
      const [a, b] = [h, t].sort();
      const key = a + b;
      (pairs[key] ||= { a, b, w: 0 }).w += w;
    }
    return Object.values(pairs).filter((x) => x.w >= 1).sort((x, y) => y.w - x.w).slice(0, n);
  }

  recordSend(ch, ok) {
    const s = this.p.sendStats[ch] || { ok: 0, n: 0 };
    s.n++; if (ok) s.ok++;
    this.p.sendStats[ch] = s;
    if (ok) {
      for (const k of Object.keys(this.p.sendMix || {})) {
        if (k[0] === ch && k[1] === '>') {
          this.p.sendMix[k] *= 0.85;
          if (this.p.sendMix[k] < 0.3) delete this.p.sendMix[k];
        }
      }
    }
  }

  /** A send where Vera copied a different letter than the one asked for. */
  recordSendMix(want, got) {
    if (!want || !got || want === got) return;
    const m = (this.p.sendMix ||= {});
    m[`${want}>${got}`] = (m[`${want}>${got}`] || 0) + 1;
  }

  /** Strongest send mix-ups, e.g. [{ want: 'A', got: 'N', w: 2 }]. */
  topSendMix(n = 3) {
    return Object.entries(this.p.sendMix || {})
      .map(([k, w]) => ({ want: k[0], got: k[2], w }))
      .filter((x) => x.w >= 1).sort((a, b) => b.w - a.w).slice(0, n);
  }

  /** Send accuracy per letter (0..1), 0.5 when never sent. */
  sendAcc(ch) {
    const s = this.p.sendStats[ch];
    return s && s.n ? s.ok / s.n : 0.5;
  }

  weakLetters(n, koch) {
    const st = this.p.stats;
    return Object.entries(st)
      .filter(([, s]) => s.seen >= 3)
      .sort((a, b) => (a[1].acc - b[1].acc) || (b[1].lat - a[1].lat))
      .slice(0, n)
      .map(([c]) => c);
  }
}
