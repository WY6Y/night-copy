//! Sample-accurate iambic keyer (modes A and B) and straight key, with a
//! raised-cosine sidetone. Runs inside the AudioWorklet, one block at a time.

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Dit = 0,
    Dah = 1,
    Straight = 2,
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    Idle,
    /// Key down until frame `until` (exclusive).
    Element { kind: Kind, until: u64 },
    /// Element space, silent until frame `until`.
    Space { last: Kind, until: u64 },
}

/// A finished element: kind and its start/end in samples since `reset`.
#[derive(Clone, Copy, Debug)]
pub struct Event {
    pub kind: Kind,
    pub start: u64,
    pub end: u64,
}

/// A straight-key or paddle closure longer than this is treated as stuck.
const STUCK_S: f64 = 5.0;

pub struct Keyer {
    sr: f64,
    unit: u32,
    freq: f64,
    phase: f64,
    env_p: f64,
    env_step: f64,
    pub volume: f64,
    pub mode_b: bool,
    dit: bool,
    dah: bool,
    dit_latch: bool,
    dah_latch: bool,
    squeezed: bool,
    first_dah: bool,
    straight: bool,
    straight_start: u64,
    state: State,
    frame: u64,
    start: u64,
    pub events: Vec<Event>,
}

impl Keyer {
    pub fn new(sr: f64) -> Self {
        let mut k = Keyer {
            sr, unit: 0, freq: 600.0, phase: 0.0, env_p: 0.0, env_step: 0.0, volume: 0.35,
            mode_b: true, dit: false, dah: false, dit_latch: false, dah_latch: false,
            squeezed: false, first_dah: false, straight: false, straight_start: 0,
            state: State::Idle, frame: 0, start: 0, events: Vec::new(),
        };
        k.config(20.0, 600.0, 5.0);
        k
    }

    pub fn config(&mut self, wpm: f64, freq: f64, rise_ms: f64) {
        self.unit = (1.2 / wpm * self.sr).round() as u32;
        self.freq = freq;
        self.env_step = 1.0 / (rise_ms / 1000.0 * self.sr).max(1.0);
    }

    pub fn frame(&self) -> u64 {
        self.frame
    }

    pub fn paddles(&mut self, dit: bool, dah: bool) {
        if dah && !self.dah && !self.dit {
            self.first_dah = true;
        } else if dit && !self.dit && !self.dah {
            self.first_dah = false;
        }
        self.dit = dit;
        self.dah = dah;
    }

    pub fn straight(&mut self, down: bool) {
        if down && !self.straight {
            self.straight_start = self.frame;
        } else if !down && self.straight {
            self.events.push(Event { kind: Kind::Straight, start: self.straight_start, end: self.frame });
        }
        self.straight = down;
    }

    /// Drop all key state at once (paddle lost, guard locked, tab hidden).
    pub fn release_all(&mut self) {
        self.paddles(false, false);
        self.straight(false);
        self.dit_latch = false;
        self.dah_latch = false;
    }

    fn begin(&mut self, kind: Kind) {
        let len = if kind == Kind::Dah { 3 * self.unit } else { self.unit } as u64;
        self.squeezed = self.dit && self.dah;
        self.start = self.frame;
        self.state = State::Element { kind, until: self.frame + len };
    }

    fn latch(&mut self, kind: Kind) {
        if self.dit && self.dah {
            self.squeezed = true;
        }
        match kind {
            Kind::Dit if self.dah => self.dah_latch = true,
            Kind::Dah if self.dit => self.dit_latch = true,
            _ => {}
        }
    }

    fn decide(&mut self, last: Kind) {
        let (opp_latch, opp_down, same_down, opp) = match last {
            Kind::Dit => (self.dah_latch, self.dah, self.dit, Kind::Dah),
            _ => (self.dit_latch, self.dit, self.dah, Kind::Dit),
        };
        // Mode A ends a squeeze as soon as both levers are released; mode B
        // finishes it with one more alternate element.
        let latch_counts = self.mode_b || !self.squeezed || self.dit || self.dah;
        self.dit_latch = false;
        self.dah_latch = false;
        if opp_down || (opp_latch && latch_counts) {
            self.begin(opp);
        } else if same_down {
            self.begin(last);
        } else {
            self.state = State::Idle;
        }
    }

    fn step(&mut self) {
        if self.straight && self.frame - self.straight_start > (STUCK_S * self.sr) as u64 {
            self.straight(false);
        }
        match self.state {
            State::Idle => {
                if self.dit && self.dah {
                    self.begin(if self.first_dah { Kind::Dah } else { Kind::Dit });
                } else if self.dit {
                    self.begin(Kind::Dit);
                } else if self.dah {
                    self.begin(Kind::Dah);
                }
            }
            State::Element { kind, until } => {
                self.latch(kind);
                if self.frame >= until {
                    self.events.push(Event { kind, start: self.start, end: until });
                    self.state = State::Space { last: kind, until: until + self.unit as u64 };
                }
            }
            State::Space { last, until } => {
                self.latch(last);
                if self.frame >= until {
                    self.decide(last);
                }
            }
        }
    }

    pub fn key_down(&self) -> bool {
        self.straight || matches!(self.state, State::Element { .. })
    }

    pub fn process(&mut self, out: &mut [f32]) {
        let w = 2.0 * core::f64::consts::PI * self.freq / self.sr;
        for s in out.iter_mut() {
            self.step();
            if self.key_down() {
                self.env_p = (self.env_p + self.env_step).min(1.0);
            } else {
                self.env_p = (self.env_p - self.env_step).max(0.0);
            }
            let env = 0.5 - 0.5 * (core::f64::consts::PI * self.env_p).cos();
            *s = (self.volume * env * self.phase.sin()) as f32;
            self.phase += w;
            if self.phase > 6.283_185_307_179_586 {
                self.phase -= 6.283_185_307_179_586;
            }
            self.frame += 1;
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub const SR: f64 = 8000.0;

    /// Run the keyer for `ms` milliseconds.
    pub fn run(k: &mut Keyer, ms: f64) {
        let mut buf = vec![0f32; (ms / 1000.0 * SR) as usize];
        k.process(&mut buf);
    }

    fn kinds(k: &Keyer) -> String {
        k.events.iter().map(|e| if e.kind == Kind::Dah { '-' } else { '.' }).collect()
    }

    #[test]
    fn dit_and_dah_lengths() {
        let mut k = Keyer::new(SR);
        k.config(20.0, 600.0, 5.0);
        k.paddles(true, false);
        run(&mut k, 10.0);
        k.paddles(false, false);
        run(&mut k, 300.0);
        k.paddles(false, true);
        run(&mut k, 10.0);
        k.paddles(false, false);
        run(&mut k, 300.0);
        assert_eq!(kinds(&k), ".-");
        let ms = |e: &Event| (e.end - e.start) as f64 / SR * 1000.0;
        assert_eq!(ms(&k.events[0]), 60.0);
        assert_eq!(ms(&k.events[1]), 180.0);
    }

    #[test]
    fn squeeze_mode_b_adds_one_element() {
        // Squeeze dit-first, release both midway through the second element.
        let mut k = Keyer::new(SR);
        k.paddles(true, false);
        run(&mut k, 5.0);
        k.paddles(true, true);
        run(&mut k, 150.0); // dit (60) + space (60) + into the dah
        k.paddles(false, false);
        run(&mut k, 600.0);
        assert_eq!(kinds(&k), ".-.", "mode B finishes the squeeze");

        let mut a = Keyer::new(SR);
        a.mode_b = false;
        a.paddles(true, false);
        run(&mut a, 5.0);
        a.paddles(true, true);
        run(&mut a, 150.0);
        a.paddles(false, false);
        run(&mut a, 600.0);
        assert_eq!(kinds(&a), ".-", "mode A stops");
    }

    #[test]
    fn held_dit_repeats_and_stuck_straight_key_cuts() {
        let mut k = Keyer::new(SR);
        k.paddles(true, false);
        run(&mut k, 590.0); // 5 dits = 5 * 120 ms minus a little
        k.paddles(false, false);
        run(&mut k, 200.0);
        assert_eq!(kinds(&k), ".....");

        let mut s = Keyer::new(SR);
        s.straight(true);
        run(&mut s, 6000.0);
        assert!(!s.key_down(), "straight key is cut after 5 s");
        assert_eq!(s.events.len(), 1);
    }
}
