import { InvalidInputError } from '../../core/errors/index.js';
import { includeAt, type PositionalRng, type SeedPath } from '../../core/random/index.js';
import { assertFiniteNumber, assertInteger } from '../../core/validation/index.js';

/**
 * The samplers a generator needs, each addressed by the position it is drawing
 * for rather than by how many draws came before it.
 *
 * Every method is a pure function of the source and the path: asking twice
 * gives the same answer, asking in a different order changes nothing, and a
 * position nobody asks about costs nothing. That is what lets a caller change
 * one parameter — or one bar — without redrawing the rest of the piece.
 *
 * @category Composition
 */
export type Draw = {
  /** The raw draw at a position: a float in [0, 1). */
  at: (...path: SeedPath) => number;
  /**
   * Whether an event of probability `p` happens at a position. Because the
   * underlying draw is fixed by the path, raising `p` only ever turns more
   * positions on.
   */
  prob: (p: number, ...path: SeedPath) => boolean;
  /** An integer in the inclusive range [lo, hi] at a position. */
  range: (lo: number, hi: number, ...path: SeedPath) => number;
  /** A float in [lo, hi) at a position. */
  float: (lo: number, hi: number, ...path: SeedPath) => number;
};

/**
 * Build the sampler set for one namespace of a positional source.
 *
 * The prefix separates parts that share a source: a caller-supplied
 * {@link PositionalRng} is used by every generator at once, and without a
 * prefix the drums' bar 3 and the bass's bar 3 would draw the same number.
 *
 * @param rng The positional source.
 * @param prefix Path segments prepended to every draw.
 * @returns The samplers, addressed under `prefix`.
 */
export function drawsFrom(rng: PositionalRng, ...prefix: SeedPath): Draw {
  const at = (...path: SeedPath) => rng.at(...prefix, ...path);
  return {
    at,
    prob: (p, ...path) => includeAt(rng, p, ...prefix, ...path),
    range: (lo, hi, ...path) => {
      assertInteger(lo, 'range lower bound');
      assertInteger(hi, 'range upper bound');
      if (lo > hi) {
        throw new InvalidInputError(
          `range lower bound must not exceed upper bound; received ${lo} > ${hi}`,
        );
      }
      return lo + Math.floor(at(...path) * (hi - lo + 1));
    },
    float: (lo, hi, ...path) => {
      assertFiniteNumber(lo, 'float lower bound');
      assertFiniteNumber(hi, 'float upper bound');
      if (lo > hi) {
        throw new InvalidInputError(
          `float lower bound must not exceed upper bound; received ${lo} > ${hi}`,
        );
      }
      return lo + at(...path) * (hi - lo);
    },
  };
}
