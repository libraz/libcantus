/**
 * Hierarchical seeds: one project number that addresses every part.
 *
 * A flat seed per generator makes the caller keep a table of numbers and,
 * worse, makes "reroll the drums" mean "pick a number nobody else is using".
 * Deriving instead — `deriveSeed(project, 'drums', 'chorus', 2)` — turns a
 * reroll into an extra path segment, and every other part keeps the seed it
 * had because its path did not change.
 */

import { assertInteger } from '../validation/index.js';
import { DOMAIN_SEED, hashPath } from './internal.js';

/**
 * The address of one derivation: a namespace, and whatever names or indices
 * locate the thing being seeded.
 *
 * Strings and numbers are kept apart by the hash, so `'3'` and `3` address
 * different things, as do `['ab', 'c']` and `['a', 'bc']`.
 *
 * @category Utilities
 */
export type SeedPath = readonly (string | number)[];

/**
 * Derive a child seed from a root seed and a path.
 *
 * The result is a 32-bit integer, so it can be passed straight to
 * {@link createRng}. Derivation is a pure function of its arguments — the same
 * root and path give the same seed in every runtime — and near-identical paths
 * (`'drums'` against `'drum'`, bar 1 against bar 2) give unrelated seeds: the
 * path is hashed with FNV-1a and finished with the MurmurHash3 fmix32
 * avalanche step.
 *
 * @param root The project seed; an integer in 0..0xffffffff.
 * @param path The address to derive at; string or finite number segments.
 * @returns The derived seed, an integer in 0..0xffffffff.
 * @throws If the root is not a 32-bit integer, or a segment is neither a
 * string nor a finite number.
 * @example
 * ```ts
 * import { createRng, deriveSeed } from '@libraz/libcantus';
 * const drums = deriveSeed(42, 'drums', 'chorus', 3);
 * const rng = createRng(drums); // rerolling only the drums: bump the 3
 * ```
 * @category Utilities
 */
export function deriveSeed(root: number, ...path: SeedPath): number {
  // The root is held to the seed range createRng accepts, so a derived seed is
  // always a legal root for a further derivation.
  assertInteger(root, 'root seed', 0, 0xffffffff);
  return hashPath(DOMAIN_SEED, root, path);
}
