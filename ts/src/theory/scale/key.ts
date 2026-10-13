import type { KeyScale } from '../../core/types.js';
import type { SpelledKeyScale } from './kinds.js';
import type { ScaleNameInput } from './masks.js';
import { spelledKeyOf } from './relations.js';
import { majorScale, minorScale, namedScale } from './scales.js';

/**
 * A built key, with the spelling it is conventionally written in beside it.
 *
 * The tonic is read by the one reader the rest of the library reads keys with,
 * so a built key is spelled exactly as the same pitch classes would be spelled
 * anywhere else — nothing about the answer changes by carrying it. What changes
 * is that the key can now be handed to an entry point whose answer depends on
 * how the key is written, which a bare scale cannot be: a bare scale reaching
 * one of those has had a spelling and lost it.
 */
function spelled(scale: KeyScale): SpelledKeyScale {
  const { tonic, variant } = spelledKeyOf(scale);
  return { ...scale, tonic, variant };
}

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
export function majorKey(rootPc: number): SpelledKeyScale {
  return spelled(majorScale(rootPc));
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
export function minorKey(rootPc: number): SpelledKeyScale {
  return spelled(minorScale(rootPc));
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
export function scaleByName(name: ScaleNameInput, rootPc: number): SpelledKeyScale {
  return spelled(namedScale(name, rootPc));
}
