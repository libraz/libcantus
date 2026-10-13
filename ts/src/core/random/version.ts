/**
 * How generated output is pinned across builds.
 *
 * A saved project is a seed plus parameters, and it reopens as the same piece
 * only while the library turns them into the same notes. The algorithm version
 * is the number that says which reading of those parameters a project was
 * written against. It is drawn into every seed, so two versions never draw the
 * same stream, and a caller records it beside the seed.
 */

import { InvalidInputError } from '../errors/index.js';
import { assertInteger } from '../validation/index.js';

/**
 * The generator algorithm version this build produces by default.
 *
 * What it carries: for a fixed algorithm version, the same inputs — seed,
 * version and every documented parameter — produce the same generated output
 * from a given build. It covers what the generators return, and nothing else:
 * analysis results, error messages and output taken under a different version
 * are outside it.
 *
 * What it does not carry is a reading frozen against correction. The
 * generators hold one implementation rather than one per version, so pinning
 * an older number selects a different draw of the current implementation and
 * does not restore what that number produced before: a fix to output that was
 * musically wrong moves the notes of a version already in use, ships as a
 * patch, and is stated in the changelog. Reproducing a piece exactly therefore
 * means recording the package version alongside the seed and this number.
 *
 * Raising this constant marks a deliberate change of approach rather than a
 * correction. A project pinned to a version this build does not know is
 * rejected rather than reinterpreted.
 *
 * @category Utilities
 */
export const ALGORITHM_VERSION = 1;

/**
 * The oldest algorithm version this build still accepts.
 *
 * @category Utilities
 */
export const MIN_ALGORITHM_VERSION = 1;

/**
 * Resolve the algorithm version a request runs under.
 *
 * An unpinned request runs at {@link ALGORITHM_VERSION}, which is what a
 * caller who wants the current behaviour means; a caller who wants the piece
 * back records the resolved number and passes it next time. A version this
 * build does not produce is rejected — a project saved by a newer build cannot
 * be reproduced by an older one, and quietly rendering it at another version
 * would return a different piece under the same name.
 *
 * @param requested The pinned version, or undefined for the current one.
 * @returns The version to generate under.
 * @throws If the version is not an integer this build produces.
 * @example
 * ```ts
 * import { ALGORITHM_VERSION, resolveAlgorithmVersion } from '@libraz/libcantus';
 * resolveAlgorithmVersion(undefined); // ALGORITHM_VERSION
 * resolveAlgorithmVersion(ALGORITHM_VERSION); // the pinned value, unchanged
 * ```
 * @category Utilities
 */
export function resolveAlgorithmVersion(requested?: number): number {
  if (requested === undefined) {
    return ALGORITHM_VERSION;
  }
  assertInteger(requested, 'algorithm version');
  if (requested < MIN_ALGORITHM_VERSION || requested > ALGORITHM_VERSION) {
    throw new InvalidInputError(
      `algorithm version ${requested} is not produced by this build; supported versions are ` +
        `${MIN_ALGORITHM_VERSION}..${ALGORITHM_VERSION}`,
    );
  }
  return requested;
}
