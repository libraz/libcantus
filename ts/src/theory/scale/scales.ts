import { pitchClassOf } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { ScaleNameInput } from './masks.js';
import { MAJOR_MASK, NATURAL_MINOR_MASK, requireScaleMask } from './masks.js';

/**
 * The scales themselves, with no spelling on them.
 *
 * Below the reading that decides how a key is written, because that reading is
 * built out of these: it walks the circle of fifths asking what each candidate
 * tonic would cost, and every candidate it weighs is a scale. A builder that
 * spelled itself would have to ask the reading, and the reading would ask the
 * builder back.
 *
 * So the public builders in `key.ts` are these plus that reading, and these stay
 * unexported: a caller reaching for a scale with no spelling on it is reaching
 * for the shape the spelling-sensitive entry points refuse, and the way to say
 * that deliberately is to spell it.
 */

/** The major scale on a root pitch class. */
export function majorScale(rootPc: number): KeyScale {
  return { rootPc: pitchClassOf(rootPc), modeMask12: MAJOR_MASK };
}

/** The natural-minor scale on a root pitch class. */
export function minorScale(rootPc: number): KeyScale {
  return { rootPc: pitchClassOf(rootPc), modeMask12: NATURAL_MINOR_MASK };
}

/** A named scale on a root pitch class. */
export function namedScale(name: ScaleNameInput, rootPc: number): KeyScale {
  return { rootPc: pitchClassOf(rootPc), modeMask12: requireScaleMask(name) };
}
