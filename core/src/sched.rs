//! Koch scheduler: pick the next character to drill, weighted toward the
//! ones Stephen misses or answers slowly, and toward the newest letter.

use crate::rng::Rng;

#[derive(Clone, Copy, Default)]
pub struct Stat {
    /// Recent accuracy, 0..1 (an exponential average kept by the game).
    pub acc: f32,
    /// Recent response time in ms.
    pub lat: f32,
    pub seen: u32,
}

pub struct Sched {
    pub stats: [Stat; 64],
    pub rng: Rng,
}

impl Sched {
    pub fn new(seed: u32) -> Self {
        Sched { stats: [Stat::default(); 64], rng: Rng::new(seed) }
    }

    pub fn weight(&self, i: usize, unlocked: usize) -> f32 {
        let s = self.stats[i];
        if s.seen == 0 {
            return 5.0;
        }
        let miss = 1.0 - s.acc.clamp(0.0, 1.0);
        let slow = ((s.lat - 700.0) / 900.0).clamp(0.0, 2.0);
        let mut w = 1.0 + 7.0 * miss + 1.5 * slow;
        if i + 1 == unlocked && s.seen < 60 {
            w *= 2.2; // the letter just learned
        }
        w
    }

    /// Weighted pick among the first `unlocked` Koch characters, damping
    /// the previous pick so the same letter rarely plays twice in a row.
    pub fn pick(&mut self, unlocked: usize, last: Option<usize>) -> usize {
        let n = unlocked.clamp(1, 64);
        let ws: Vec<f32> = (0..n)
            .map(|i| if Some(i) == last && n > 1 { self.weight(i, n) * 0.25 } else { self.weight(i, n) })
            .collect();
        let total: f32 = ws.iter().sum();
        let mut r = self.rng.f64() as f32 * total;
        for (i, w) in ws.iter().enumerate() {
            if r < *w {
                return i;
            }
            r -= w;
        }
        n - 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weak_letters_come_back_more() {
        let mut s = Sched::new(7);
        for i in 0..5 {
            s.stats[i] = Stat { acc: 0.97, lat: 500.0, seen: 100 };
        }
        s.stats[2] = Stat { acc: 0.5, lat: 1500.0, seen: 100 };
        let mut counts = [0; 5];
        for _ in 0..5000 {
            counts[s.pick(5, None)] += 1;
        }
        assert!(counts[2] > 2 * counts[0], "weak letter drawn {counts:?}");
    }
}
