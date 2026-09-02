import { InvalidInputError } from '../../core/errors/index.js';
import { includeAt, type PositionalRng, type SeedPath } from '../../core/random/index.js';
import {
  assertArray,
  assertFiniteNumber,
  assertFunction,
  assertInteger,
  assertRecord,
  describeRejected,
} from '../../core/validation/index.js';

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
 * The samplers a {@link Draw} carries, in declaration order.
 *
 * Named once so the check below cannot fall behind the type: a sampler added to
 * `Draw` is added here on the same commit, and the check that the two agree is
 * the suite's rather than a reader's.
 */
export const DRAW_METHODS = ['at', 'prob', 'range', 'float'] as const;

/**
 * Read a sampler set as one, before a generator draws from it.
 *
 * Every generator takes a `Draw` and calls straight into it, so a caller that
 * built its own — or restored one from a session where the methods did not
 * survive — reaches the draw as a call on something that is not a function, deep
 * inside the generator. Checked here, it is refused by the name of the sampler
 * that is missing.
 *
 * @param draw The sampler set as the caller passed it.
 * @param name What the value is, for the error message.
 * @returns The sampler set.
 * @throws If it is not an object carrying all four samplers.
 */
export function assertDraw(draw: Draw, name = 'draw'): Draw {
  const sampler = assertRecord<Draw>(draw, name);
  for (const method of DRAW_METHODS) {
    assertFunction(sampler[method], `${name}.${method}`);
  }
  return sampler;
}

/**
 * Read the path a draw is addressed by, before it names a position.
 *
 * The path is what makes a draw reproducible: the same path is the same number,
 * for the same source, forever. A caller assembling one from its own ids can
 * put a `null` or an `undefined` in it — a track that has no name yet, an index
 * that was not computed — and nothing downstream objects, because a path
 * segment is only ever concatenated into a seed string. What the caller gets is
 * a different piece of music under a path it thought it had named, and two
 * different requests that seed identically. Reading the path here refuses that
 * by the segment that is wrong.
 *
 * @param path The path segments as the caller passed them.
 * @param name What the path is, for the error message.
 * @returns The same segments.
 * @throws If a segment is neither a string nor a finite number.
 */
export function assertSeedPath(path: SeedPath, name = 'draw path'): SeedPath {
  const steps = assertArray<SeedPath[number]>(path, name);
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (typeof step !== 'string' && !Number.isFinite(step)) {
      throw new InvalidInputError(
        `${name}[${index}] must be a string or a finite number; received ${describeRejected(step)}`,
      );
    }
  }
  return steps;
}

/**
 * One draw from a positional source, held to the range the source promises.
 *
 * A caller-supplied {@link PositionalRng} is part of the contract, so a source
 * returning 1, a negative value or NaN is rejected here rather than becoming an
 * index past the end of a vocabulary, a NaN pitch, or a bar silently dropped far
 * from the cause. This is the guard `includeAt` already applies to `prob`, on
 * the same predicate.
 */
function drawFrom(rng: PositionalRng, path: SeedPath): number {
  const draw = rng.at(...path);
  if (!(draw >= 0 && draw < 1)) {
    throw new InvalidInputError(`positional draw must be in [0, 1); received ${draw}`);
  }
  return draw;
}

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
  const at = (...path: SeedPath) => drawFrom(rng, [...prefix, ...path]);
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
      // The span is what the draw is scaled by, so a pair whose difference is
      // not itself an exact safe integer would be sampled at reduced precision
      // and could land outside [lo, hi]. `Rng.range` rejects such a pair; the
      // two samplers promise the same inclusive range and so reject the same
      // arguments.
      assertInteger(hi - lo, 'range span', 0);
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
      // The span scales the draw, so a pair whose difference is not finite
      // would sample outside [lo, hi). `Rng.float` rejects such a pair, and the
      // two samplers promise the same range.
      assertFiniteNumber(hi - lo, 'float span');
      return lo + at(...path) * (hi - lo);
    },
  };
}
