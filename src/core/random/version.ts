/**
 * The reproducibility contract for generated output.
 *
 * A saved project is a seed plus parameters, and it only reopens as the same
 * piece if the library still turns them into the same notes. Package versions
 * cannot carry that promise: a bug fix inside a generator is a patch release
 * and still moves every note. The algorithm version is the separate number
 * that does carry it, declared here and recorded by the caller alongside the
 * seed.
 */

import { InvalidInputError } from '../errors/index.js';
import { assertInteger } from '../validation/index.js';

/**
 * The generator algorithm version this build produces by default.
 *
 * The guarantee it carries: for a fixed algorithm version, the same inputs —
 * seed, version and every documented parameter — produce the same generated
 * output from any build of this library that accepts that version. It covers
 * what the generators return, and nothing else: analysis results, error
 * messages and output taken under a different version are outside it.
 *
 * Changing what a generator returns for a version it already accepts is a
 * defect. New behaviour raises this constant instead, and the older version
 * keeps producing what it produced. Withdrawing an accepted version is a
 * breaking change, and a project pinned to a withdrawn or not-yet-known
 * version is rejected rather than reinterpreted.
 *
 * @category Utilities
 */
export const ALGORITHM_VERSION = 1;

/**
 * The oldest algorithm version this build still produces.
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
