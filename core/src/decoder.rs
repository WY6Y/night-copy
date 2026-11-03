//! Turn keyed elements back into text. Paddle elements arrive already typed
//! (dit/dah); straight-key marks are classified by length with an adaptive
//! unit. Gaps decide character and word boundaries.

use crate::keyer::Kind;
use crate::morse;

pub struct Decoder {
    pub unit_ms: f64,
    pattern: String,
    last_end: Option<f64>,
    word_sent: bool,
    /// Key is down: an element is in progress, so silence isn't silence yet.
    keying: bool,
    pub out: Vec<u8>,
    /// Gaps between characters, in units, for timing feedback.
    pub char_gaps: Vec<f64>,
}

// 2.5 units (standard spacing is 1 inside a letter, 3 between): forgiving
// of a beginner who re-presses a lever a little late, still splits letters.
const CHAR_GAP_U: f64 = 2.5;
const WORD_GAP_U: f64 = 5.0;

impl Decoder {
    pub fn new(unit_ms: f64) -> Self {
        Decoder { unit_ms, pattern: String::new(), last_end: None, word_sent: true, keying: false, out: Vec::new(), char_gaps: Vec::new() }
    }

    fn flush(&mut self) {
        if self.pattern.is_empty() {
            return;
        }
        let c = morse::lookup(&self.pattern).unwrap_or(b'*');
        self.out.push(c);
        self.pattern.clear();
        self.word_sent = false;
    }

    /// The keyer reports key down/up as it happens; elements only arrive
    /// when they end. Without this, polling during a long dah would close
    /// the character early (M decoded as T T).
    pub fn key(&mut self, down: bool) {
        self.keying = down;
    }

    pub fn element(&mut self, kind: Kind, start_ms: f64, end_ms: f64) {
        self.keying = false;
        let u = self.unit_ms;
        if let Some(le) = self.last_end {
            let gap = start_ms - le;
            if gap > CHAR_GAP_U * u {
                self.flush();
                self.char_gaps.push(gap / u);
                if gap > WORD_GAP_U * u && !self.word_sent {
                    self.out.push(b' ');
                    self.word_sent = true;
                }
            }
        }
        let dur = end_ms - start_ms;
        let dah = match kind {
            Kind::Dit => false,
            Kind::Dah => true,
            Kind::Straight => {
                let dah = dur >= 2.0 * u;
                // Track the operator's speed from what they actually send.
                let est = if dah { dur / 3.0 } else { dur };
                self.unit_ms = (0.8 * self.unit_ms + 0.2 * est).clamp(24.0, 240.0);
                dah
            }
        };
        self.pattern.push(if dah { '-' } else { '.' });
        self.last_end = Some(end_ms);
    }

    /// Close out a character or word once enough silence has passed.
    pub fn poll(&mut self, now_ms: f64) {
        if self.keying {
            return;
        }
        let Some(le) = self.last_end else { return };
        let gap = now_ms - le;
        if gap > CHAR_GAP_U * self.unit_ms {
            self.flush();
        }
        if gap > WORD_GAP_U * self.unit_ms && !self.word_sent {
            self.out.push(b' ');
            self.word_sent = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keyer::tests::{run, SR};
    use crate::keyer::Keyer;
    use crate::morse::KOCH;
    use crate::rng::Rng;

    /// Send text through the iambic keyer the way a person would: press the
    /// lever for each element, release, and wait out the gaps.
    fn key_text(k: &mut Keyer, text: &[u8], wpm: f64) {
        let u = 1200.0 / wpm;
        for item in morse::parse(text) {
            match item {
                None => run(k, 4.0 * u),
                Some((_, els)) => {
                    for dah in els {
                        k.paddles(!dah, dah);
                        run(k, u * 0.5);
                        k.paddles(false, false);
                        // Finish the element and its one-unit space.
                        run(k, if dah { 3.5 * u } else { 1.5 * u });
                    }
                    run(k, 2.0 * u);
                }
            }
        }
        run(k, 10.0 * u);
    }

    fn decode(k: &Keyer, unit_ms: f64) -> String {
        let mut d = Decoder::new(unit_ms);
        for e in &k.events {
            d.element(e.kind, e.start as f64 / SR * 1000.0, e.end as f64 / SR * 1000.0);
        }
        d.poll(k.frame() as f64 / SR * 1000.0);
        String::from_utf8(d.out).unwrap()
    }

    #[test]
    fn round_trip_200_koch_groups() {
        let mut rng = Rng::new(42);
        let mut errors = 0;
        for _ in 0..200 {
            let n = 2 + rng.below(4) as usize;
            let group: Vec<u8> = (0..n).map(|_| KOCH[rng.below(KOCH.len() as u32) as usize]).collect();
            let mut k = Keyer::new(SR);
            k.config(20.0, 600.0, 5.0);
            key_text(&mut k, &group, 20.0);
            let got = decode(&k, 60.0);
            if got.trim() != String::from_utf8_lossy(&group) {
                errors += 1;
                eprintln!("sent {:?} decoded {:?}", String::from_utf8_lossy(&group), got);
            }
        }
        assert_eq!(errors, 0);
    }

    /// Drive the keyer in 5 ms steps, feeding events and key state to the
    /// decoder and polling it every step, the way the game's frame loop does.
    fn live_decode(script: &[(f64, bool, bool)], end_ms: f64, wpm: f64) -> String {
        let mut k = Keyer::new(SR);
        k.config(wpm, 600.0, 5.0);
        let mut d = Decoder::new(1200.0 / wpm);
        let mut t = 0.0;
        let mut i = 0;
        let mut was_down = false;
        while t < end_ms {
            while i < script.len() && script[i].0 <= t {
                k.paddles(script[i].1, script[i].2);
                i += 1;
            }
            run(&mut k, 5.0);
            t += 5.0;
            for e in k.events.drain(..) {
                d.element(e.kind, e.start as f64 / SR * 1000.0, e.end as f64 / SR * 1000.0);
            }
            if k.key_down() != was_down {
                was_down = k.key_down();
                d.key(was_down);
            }
            d.poll(t);
        }
        String::from_utf8(d.out).unwrap().trim().to_string()
    }

    #[test]
    fn held_dah_lever_is_m_not_tt_with_live_polling() {
        // Hold the dah lever for two dahs at 16 wpm (unit 75 ms): 0..400 ms.
        assert_eq!(live_decode(&[(0.0, false, true), (400.0, false, false)], 1500.0, 16.0), "M");
    }

    #[test]
    fn callsign_with_live_polling() {
        // WY6Y keyed lever by lever at 16 wpm, polled every 5 ms.
        let u = 75.0;
        let mut script = Vec::new();
        let mut t = 0.0;
        for code in [".--", "-.--", "-....", "-.--"] {
            for e in code.chars() {
                let dah = e == '-';
                script.push((t, !dah, dah));
                script.push((t + u * 0.5, false, false));
                t += if dah { 4.0 * u } else { 2.0 * u };
            }
            t += 2.0 * u;
        }
        assert_eq!(live_decode(&script, t + 1500.0, 16.0), "WY6Y");
    }

    #[test]
    fn words_split_on_long_gaps() {
        let mut k = Keyer::new(SR);
        key_text(&mut k, b"CQ DE WY6Y", 20.0);
        assert_eq!(decode(&k, 60.0).trim(), "CQ DE WY6Y");
    }

    #[test]
    fn straight_key_adapts_to_speed() {
        // A 12 wpm straight-key fist (100 ms unit), decoder starting at 20 wpm.
        let mut d = Decoder::new(60.0);
        let mut t = 0.0;
        for &(dah, gap) in &[(true, 1.0), (false, 1.0), (true, 3.5), (true, 1.0), (true, 3.5)] {
            let len = if dah { 300.0 } else { 100.0 };
            d.element(Kind::Straight, t, t + len);
            t += len + gap * 100.0;
        }
        d.poll(t + 2000.0);
        assert_eq!(String::from_utf8(d.out).unwrap().trim(), "KM");
    }
}
