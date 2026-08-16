import { InvalidInputError } from '../../core/errors/index.js';
import { noteToPitchClass, parseKeyName, pitchClassOf } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertInteger } from '../../core/validation/index.js';
import { majorKey, minorKey } from './key.js';
import { CHROMATIC_MASK } from './masks.js';

/**
 * Anything that names a key: a key name, a plain {@link KeyScale}, or a value
 * that serializes to one such as the `Key` class.
 *
 * @category Scales
 */
export type KeyLike =
  | string
  | KeyScale
  | {
      /** The key data this value stands for, carrying the scale it denotes. */
      toJSON(): { scale: KeyScale };
    };

/** Validate a plain key/scale and return it in the canonical shape. */
function normalizedKeyScale(scale: KeyScale): KeyScale {
  assertInteger(scale.modeMask12, 'key.modeMask12', 1, CHROMATIC_MASK);
  if ((scale.modeMask12 & 1) === 0) {
    // Every scale contains its own root, and the rest of the library reads
    // bit 0 as given. A mask without it names no key and would degrade into
    // wrong answers far from here rather than failing at the boundary.
    throw new InvalidInputError(
      `key.modeMask12 must include its root; received ${scale.modeMask12}`,
    );
  }
  assertInteger(scale.rootPc, 'key.rootPc');
  return { rootPc: pitchClassOf(scale.rootPc), modeMask12: scale.modeMask12 };
}

/**
 * Resolve any key-shaped value to a plain {@link KeyScale}.
 *
 * The counterpart of {@link toSpelledInterval} for keys: an entry point takes
 * whatever form the caller has — the name a key field holds, the scale the
 * theory module returns, or a `Key` instance — and gets one shape back. An
 * instance is accepted through its `toJSON` method rather than by its type, so
 * the layers below the model can read a class without importing it.
 *
 * A name is read by {@link parseKeyName} and nothing else, so every entry point
 * that takes a key accepts exactly the names a key field already accepts, in
 * every notation system it already reads. The mode word decides the scale: a
 * major name gives the major scale, a minor name the natural minor. The
 * harmonic and melodic forms have no name of their own, so a caller who needs
 * one builds it with {@link scaleByName} and passes the scale.
 *
 * @param value A key name, a plain key/scale, or a value whose `toJSON`
 *   returns data carrying one.
 * @returns The validated key/scale, with its root reduced to a pitch class.
 * @throws If the value names no key, or its mode mask is out of range or
 *   excludes its own root.
 * @example
 * ```ts
 * import { toKeyScale } from '@libraz/libcantus';
 * toKeyScale('C major').rootPc; // 0
 * toKeyScale('A minor').rootPc; // 9
 * ```
 * @category Scales
 */
export function toKeyScale(value: KeyLike): KeyScale {
  if (typeof value === 'string') {
    const name = parseKeyName(value);
    const rootPc = noteToPitchClass(name.tonic);
    return name.mode === 'major' ? majorKey(rootPc) : minorKey(rootPc);
  }
  if (typeof value === 'object' && value !== null) {
    const data =
      'toJSON' in value && typeof value.toJSON === 'function' ? value.toJSON().scale : value;
    if (typeof data === 'object' && data !== null) {
      return normalizedKeyScale(data as KeyScale);
    }
  }
  throw new InvalidInputError(`key must be a key name or a key/scale; received ${typeof value}`);
}
