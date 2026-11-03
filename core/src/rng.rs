//! Small deterministic PRNG (xorshift32), so a seed replays the same audio.

pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(if seed == 0 { 0x9E37_79B9 } else { seed })
    }
    pub fn u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }
    pub fn f64(&mut self) -> f64 {
        self.u32() as f64 / 4_294_967_296.0
    }
    pub fn below(&mut self, n: u32) -> u32 {
        if n == 0 { 0 } else { self.u32() % n }
    }
    /// Approximately normal (Irwin-Hall, 6 uniforms).
    pub fn gauss(&mut self) -> f64 {
        (0..6).map(|_| self.f64()).sum::<f64>() - 3.0
    }
}
