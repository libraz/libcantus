import type { KeyScale } from '../../core/types.js';

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
