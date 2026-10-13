/**
 * Position-addressed randomness and threshold sampling.
 *
 * Drawing in call order makes a generator's output depend on how many draws
 * preceded it, so editing a parameter in the middle of a piece redraws
 * everything after it. Addressing each draw by where it happens — bar, beat,
 * voice — removes that coupling: the value at a position depends on the
 * position alone, so a change anywhere leaves every other position as it was.
 *
 * Deciding inclusion by comparing a fixed positional draw against a complexity
 * dial gives the property a slider needs: raising the dial only adds events,
 * and everything already sounding stays where it was.
 */

import { InvalidInputError } from '../errors/index.js';
import { assertInteger, assertRange } from '../validation/index.js';
import { DOMAIN_POSITION, hashPath, UINT32_RANGE } from './internal.js';
import type { SeedPath } from './seed.js';

/**
 * A random source addressed by position rather than by call order.
 *
 * @category Utilities
 */
export type PositionalRng = {
  /**
   * The draw belonging to a position: a float in [0, 1) that depends only on
   * the seed and the path, so it is the same however often and in whatever
   * order it is asked for.
   */
  at: (...path: SeedPath) => number;
};

/**
 * Create a position-addressed random source.
 *
 * `at` holds no cursor: it is a pure function of the seed and the path, safe to
 * call in any order, any number of times, from anywhere in a generator. Its
 * draws are independent of {@link deriveSeed} at the same path, so a generator
 * may seed a sub-part and take a positional draw at one position without
 * getting the same number twice.
 *
 * @param seed The seed; an integer in 0..0xffffffff, typically from
 * {@link deriveSeed}.
 * @returns The positional source.
 * @throws If the seed is not a 32-bit integer.
 * @example
 * ```ts
 * import { createPositionalRng, deriveSeed } from '@libraz/libcantus';
 * const rng = createPositionalRng(deriveSeed(42, 'drums'));
 * rng.at('ghost', 4, 2.5); // the same value however often it is asked for
 * ```
 * @category Utilities
 */
export function createPositionalRng(seed: number): PositionalRng {
  assertInteger(seed, 'seed', 0, 0xffffffff);
  return {
    at: (...path: SeedPath) => hashPath(DOMAIN_POSITION, seed, path) / UINT32_RANGE,
  };
}

/**
 * Whether the event at a position belongs in the output at a given complexity.
 *
 * The test is `at(...path) < complexity`, and because the draw is fixed by the
 * position, the selected set grows monotonically with complexity: for any
 * `c1 < c2` the events at `c1` are a subset of the events at `c2` over the same
 * seed and the same path space. Complexity 0 selects nothing and complexity 1
 * selects everything.
 *
 * @param rng The positional source; may be a caller-supplied one.
 * @param complexity The dial, in [0, 1].
 * @param path The position to test.
 * @returns True when the position is included.
 * @throws If the complexity is outside [0, 1], or the source returns a value
 * outside [0, 1).
 * @example
 * ```ts
 * import { createPositionalRng, includeAt } from '@libraz/libcantus';
 * const rng = createPositionalRng(7);
 * includeAt(rng, 0.3, 'ghost', 4, 2.5); // raising 0.3 only adds hits
 * ```
 * @category Utilities
 */
export function includeAt(rng: PositionalRng, complexity: number, ...path: SeedPath): boolean {
  assertRange(complexity, 0, 1, 'complexity');
  const draw = rng.at(...path);
  // A substituted source is part of the contract, and one that returns 1, a
  // negative value or NaN would quietly break monotonicity rather than fail.
  if (!(draw >= 0 && draw < 1)) {
    throw new InvalidInputError(`positional draw must be in [0, 1); received ${draw}`);
  }
  return draw < complexity;
}
