/**
 * Deterministic seeded pseudo-random number generation shared across the
 * generative modules (rhythm, drums, bass, groove, counter-melody). A single
 * mulberry32 core exposes the small set of samplers those modules need; given a
 * seed the stream is fully reproducible.
 */

import { assertFiniteNumber, assertInteger, assertRange } from '../validation/index.js';

/**
 * A deterministic PRNG with the sampling helpers the generators need.
 *
 * @category Utilities
 */
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
 * @example
 * ```ts
 * import { createRng } from '@libraz/libcantus';
 * const rng = createRng(42);
 * rng.next(); // deterministic float in [0, 1)
 * rng.range(1, 6); // deterministic integer in [1, 6]
 * ```
 * @category Utilities
 */
export function createRng(seed: number): Rng {
  assertFiniteNumber(seed, 'seed');
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
    prob: (p) => next() < assertRange(p, 0, 1, 'probability'),
    range: (lo, hi) => {
      assertInteger(lo, 'range lower bound');
      assertInteger(hi, 'range upper bound');
      if (lo > hi) {
        throw new RangeError(
          `range lower bound must not exceed upper bound; received ${lo} > ${hi}`,
        );
      }
      assertInteger(hi - lo, 'range span', 0);
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    float: (lo, hi) => {
      assertFiniteNumber(lo, 'float lower bound');
      assertFiniteNumber(hi, 'float upper bound');
      if (lo > hi) {
        throw new RangeError(
          `float lower bound must not exceed upper bound; received ${lo} > ${hi}`,
        );
      }
      assertFiniteNumber(hi - lo, 'float span');
      return lo + next() * (hi - lo);
    },
  };
}
