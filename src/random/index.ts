/**
 * Deterministic seeded pseudo-random number generation shared across the
 * generative modules (rhythm, drums, bass, groove, counter-melody). A single
 * mulberry32 core exposes the small set of samplers those modules need; given a
 * seed the stream is fully reproducible.
 */

/** A deterministic PRNG with the sampling helpers the generators need. */
export type Rng = {
  /** Next float in [0, 1). */
  next: () => number;
  /** True with probability `p`. */
  prob: (p: number) => boolean;
  /** Integer in the inclusive range [lo, hi]. */
  range: (lo: number, hi: number) => number;
  /** Float in [lo, hi). */
  float: (lo: number, hi: number) => number;
};

/**
 * Create a seeded PRNG (mulberry32) exposing the shared samplers.
 *
 * @param seed The 32-bit seed; the same seed always yields the same stream.
 * @returns The seeded generator.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    prob: (p) => next() < p,
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    float: (lo, hi) => lo + next() * (hi - lo),
  };
}
