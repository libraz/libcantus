import type { KeyScale } from '../../core/types.js';
import { MAJOR_MASK, NAMED_SCALES, NATURAL_MINOR_MASK } from './masks.js';

/**
 * Build a `KeyScale` for a major key on the given root pitch class.
 *
 * @example
 * ```ts
 * import { majorKey } from '@libraz/libcantus';
 * const cMajor = majorKey(0); // C major: { rootPc: 0, modeMask12: MAJOR_MASK }
 * ```
 *
 * @category Scales
 */
export function majorKey(rootPc: number): KeyScale {
  return { rootPc: ((rootPc % 12) + 12) % 12, modeMask12: MAJOR_MASK };
}

/**
 * Build a `KeyScale` for a natural-minor key on the given root pitch class.
 *
 * @example
 * ```ts
 * import { minorKey } from '@libraz/libcantus';
 * const aMinor = minorKey(9); // A natural minor: { rootPc: 9, modeMask12: NATURAL_MINOR_MASK }
 * ```
 *
 * @category Scales
 */
export function minorKey(rootPc: number): KeyScale {
  return { rootPc: ((rootPc % 12) + 12) % 12, modeMask12: NATURAL_MINOR_MASK };
}

/**
 * Build a `KeyScale` from a named scale (see {@link NAMED_SCALES}).
 *
 * @param name The scale name, e.g. `'dorian'` or `'harmonicMinor'`.
 * @param rootPc The root pitch class.
 * @returns The key/scale.
 * @throws If the name is not a known scale.
 *
 * @example
 * ```ts
 * import { scaleByName } from '@libraz/libcantus';
 * const dDorian = scaleByName('dorian', 2); // D Dorian, rootPc 2
 * ```
 *
 * @category Scales
 */
export function scaleByName(name: string, rootPc: number): KeyScale {
  const mask = NAMED_SCALES[name];
  if (mask === undefined) {
    throw new Error(`Unknown scale: ${name}`);
  }
  return { rootPc: ((rootPc % 12) + 12) % 12, modeMask12: mask };
}
