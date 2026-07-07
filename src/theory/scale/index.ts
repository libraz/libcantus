import type { KeyScale } from '../../core/types.js';

/**
 * Build a 12-bit mode mask from a list of semitone offsets above the root.
 *
 * Bit 0 (the root) is always set, enforcing the `KeyScale` invariant that the
 * root is a scale tone even when the offset list omits 0.
 *
 * @category Scales
 */
export function maskFromOffsets(offsets: readonly number[]): number {
  let mask = 1;
  for (const offset of offsets) {
    mask |= 1 << (((offset % 12) + 12) % 12);
  }
  return mask;
}

/**
 * Mode mask for the major (Ionian) scale: offsets {0, 2, 4, 5, 7, 9, 11}.
 *
 * @category Scales
 */
export const MAJOR_MASK = 0b101010110101;

/**
 * Mode mask for the natural minor (Aeolian) scale: offsets {0, 2, 3, 5, 7, 8, 10}.
 *
 * @category Scales
 */
export const NATURAL_MINOR_MASK = 0b010110101101;

/**
 * Harmonic minor: natural minor with a raised seventh — offsets {0,2,3,5,7,8,11}.
 *
 * @category Scales
 */
export const HARMONIC_MINOR_MASK = maskFromOffsets([0, 2, 3, 5, 7, 8, 11]);

/**
 * Ascending melodic minor: offsets {0,2,3,5,7,9,11}.
 *
 * @category Scales
 */
export const MELODIC_MINOR_MASK = maskFromOffsets([0, 2, 3, 5, 7, 9, 11]);

/**
 * Dorian mode: offsets {0,2,3,5,7,9,10}.
 *
 * @category Scales
 */
export const DORIAN_MASK = maskFromOffsets([0, 2, 3, 5, 7, 9, 10]);

/**
 * Phrygian mode: offsets {0,1,3,5,7,8,10}.
 *
 * @category Scales
 */
export const PHRYGIAN_MASK = maskFromOffsets([0, 1, 3, 5, 7, 8, 10]);

/**
 * Lydian mode: offsets {0,2,4,6,7,9,11}.
 *
 * @category Scales
 */
export const LYDIAN_MASK = maskFromOffsets([0, 2, 4, 6, 7, 9, 11]);

/**
 * Mixolydian mode: offsets {0,2,4,5,7,9,10}.
 *
 * @category Scales
 */
export const MIXOLYDIAN_MASK = maskFromOffsets([0, 2, 4, 5, 7, 9, 10]);

/**
 * Locrian mode: offsets {0,1,3,5,6,8,10}.
 *
 * @category Scales
 */
export const LOCRIAN_MASK = maskFromOffsets([0, 1, 3, 5, 6, 8, 10]);

/**
 * Major pentatonic: offsets {0,2,4,7,9}.
 *
 * @category Scales
 */
export const MAJOR_PENTATONIC_MASK = maskFromOffsets([0, 2, 4, 7, 9]);

/**
 * Minor pentatonic: offsets {0,3,5,7,10}.
 *
 * @category Scales
 */
export const MINOR_PENTATONIC_MASK = maskFromOffsets([0, 3, 5, 7, 10]);

/**
 * Hexatonic blues scale: minor pentatonic plus the flat-fifth — {0,3,5,6,7,10}.
 *
 * @category Scales
 */
export const BLUES_MASK = maskFromOffsets([0, 3, 5, 6, 7, 10]);

/**
 * Whole-tone scale: offsets {0,2,4,6,8,10}.
 *
 * @category Scales
 */
export const WHOLE_TONE_MASK = maskFromOffsets([0, 2, 4, 6, 8, 10]);

/**
 * Octatonic (half-step first): offsets {0,1,3,4,6,7,9,10}.
 *
 * @category Scales
 */
export const OCTATONIC_HALF_WHOLE_MASK = maskFromOffsets([0, 1, 3, 4, 6, 7, 9, 10]);

/**
 * Octatonic (whole-step first): offsets {0,2,3,5,6,8,9,11}.
 *
 * @category Scales
 */
export const OCTATONIC_WHOLE_HALF_MASK = maskFromOffsets([0, 2, 3, 5, 6, 8, 9, 11]);

/**
 * Chromatic scale: all twelve pitch classes.
 *
 * @category Scales
 */
export const CHROMATIC_MASK = 0b111111111111;

/**
 * Named scale masks addressable by {@link scaleByName}.
 *
 * @category Scales
 */
export const NAMED_SCALES: Record<string, number> = {
  major: MAJOR_MASK,
  ionian: MAJOR_MASK,
  naturalMinor: NATURAL_MINOR_MASK,
  aeolian: NATURAL_MINOR_MASK,
  harmonicMinor: HARMONIC_MINOR_MASK,
  melodicMinor: MELODIC_MINOR_MASK,
  dorian: DORIAN_MASK,
  phrygian: PHRYGIAN_MASK,
  lydian: LYDIAN_MASK,
  mixolydian: MIXOLYDIAN_MASK,
  locrian: LOCRIAN_MASK,
  majorPentatonic: MAJOR_PENTATONIC_MASK,
  minorPentatonic: MINOR_PENTATONIC_MASK,
  blues: BLUES_MASK,
  wholeTone: WHOLE_TONE_MASK,
  octatonicHalfWhole: OCTATONIC_HALF_WHOLE_MASK,
  octatonicWholeHalf: OCTATONIC_WHOLE_HALF_MASK,
  chromatic: CHROMATIC_MASK,
};

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

/** Reduce a pitch (or pitch class) to a pitch class in [0, 11]. */
function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

/** Scale offset of a pitch relative to the key root, in [0, 11]. */
function scaleOffset(pitch: number, key: KeyScale): number {
  return (pitchClass(pitch) - pitchClass(key.rootPc) + 12) % 12;
}

/**
 * Test whether a pitch belongs to the scale.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param key The key/scale to test against.
 * @returns True if the pitch class is a member of the scale.
 *
 * @example
 * ```ts
 * import { majorKey, isScaleTone } from '@libraz/libcantus';
 * const key = majorKey(0); // C major
 * isScaleTone(64, key); // true — E is in C major
 * isScaleTone(61, key); // false — C# is not
 * ```
 *
 * @category Scales
 */
export function isScaleTone(pitch: number, key: KeyScale): boolean {
  return ((key.modeMask12 >> scaleOffset(pitch, key)) & 1) === 1;
}

/**
 * Find the nearest MIDI pitch whose pitch class is in the scale.
 *
 * The search expands symmetrically outward from `pitch`. On a tie (equal
 * distance above and below) the lower pitch is returned.
 *
 * @param pitch MIDI pitch to snap.
 * @param key The key/scale to snap to.
 * @returns The nearest in-scale MIDI pitch.
 *
 * @category Scales
 */
export function nearestScaleTone(pitch: number, key: KeyScale): number {
  const base = Math.round(pitch);
  for (let distance = 0; distance < 12; distance += 1) {
    const lower = base - distance;
    if (isScaleTone(lower, key)) {
      return lower;
    }
    const higher = base + distance;
    if (isScaleTone(higher, key)) {
      return higher;
    }
  }
  return base;
}

/**
 * Get the 0-based scale degree of a pitch.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param key The key/scale to measure against.
 * @returns The 0-based degree, or -1 if the pitch is not in the scale.
 *
 * @category Scales
 */
export function pitchToScaleDegree(pitch: number, key: KeyScale): number {
  const offset = scaleOffset(pitch, key);
  if (((key.modeMask12 >> offset) & 1) === 0) {
    return -1;
  }
  let degree = 0;
  for (let n = 0; n < offset; n += 1) {
    if (((key.modeMask12 >> n) & 1) === 1) {
      degree += 1;
    }
  }
  return degree;
}

/**
 * List the pitch classes of a key's scale.
 *
 * @param key The key/scale to enumerate.
 * @returns The member pitch classes, sorted ascending in [0, 11].
 *
 * @category Scales
 */
export function diatonicPitchClasses(key: KeyScale): number[] {
  const root = pitchClass(key.rootPc);
  const pcs: number[] = [];
  for (let n = 0; n < 12; n += 1) {
    if (((key.modeMask12 >> n) & 1) === 1) {
      pcs.push((root + n) % 12);
    }
  }
  return pcs.sort((a, b) => a - b);
}

/**
 * List the pitch classes of a key's scale in ascending scale-degree order.
 *
 * Degree 0 is the root; degrees follow the mask bits in offset order rather
 * than sorted pitch-class order.
 *
 * @param key The key/scale to enumerate.
 * @returns The member pitch classes ordered by scale degree.
 *
 * @category Scales
 */
export function scaleTonesInDegreeOrder(key: KeyScale): number[] {
  const root = pitchClass(key.rootPc);
  const pcs: number[] = [];
  for (let n = 0; n < 12; n += 1) {
    if (((key.modeMask12 >> n) & 1) === 1) {
      pcs.push((root + n) % 12);
    }
  }
  return pcs;
}
