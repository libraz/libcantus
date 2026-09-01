import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { clampToMidi } from '../../core/validation/index.js';
import { type KeyLike, toKeyScale } from './coerce.js';

/** Scale offset of a pitch relative to the key root, in [0, 11]. */
function scaleOffset(pitch: number, key: KeyScale): number {
  return (pitchClass(pitch) - pitchClass(key.rootPc) + 12) % 12;
}

/** Whether a pitch belongs to an already-resolved scale. */
function inScale(pitch: number, scale: KeyScale): boolean {
  return ((scale.modeMask12 >> scaleOffset(pitch, scale)) & 1) === 1;
}

/**
 * Test whether a pitch belongs to the scale.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param key The key/scale to test against, as a key name, a key/scale, or a
 *   `Key`.
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
export function isScaleTone(pitch: number, key: KeyLike): boolean {
  return inScale(pitch, toKeyScale(key));
}

/**
 * Find the nearest MIDI pitch whose pitch class is in the scale.
 *
 * The search expands symmetrically outward from `pitch`. On a tie (equal
 * distance above and below) the lower pitch is returned.
 *
 * @param pitch MIDI pitch to snap.
 * @param key The key/scale to snap to, as a key name, a key/scale, or a `Key`.
 * @returns The nearest in-scale MIDI pitch.
 *
 * @category Scales
 */
export function nearestScaleTone(pitch: number, key: KeyLike): number {
  const scale = toKeyScale(key);
  const base = clampToMidi(Math.round(pitch), 'pitch');
  for (let distance = 0; distance < 12; distance += 1) {
    const lower = base - distance;
    if (lower >= 0 && inScale(lower, scale)) {
      return lower;
    }
    const higher = base + distance;
    if (higher <= 127 && inScale(higher, scale)) {
      return higher;
    }
  }
  return base;
}

/** The key's scale offsets above its root, ascending within one octave. */
function scaleOffsets(key: KeyScale): number[] {
  const offsets: number[] = [];
  for (let n = 0; n < 12; n += 1) {
    if (((key.modeMask12 >> n) & 1) === 1) {
      offsets.push(n);
    }
  }
  return offsets;
}

/**
 * Where a pitch sits on the key's ladder of scale tones.
 *
 * `rung` counts scale tones from the tonic and continues across octaves, so
 * adding to it moves by scale degrees; it is negative below the tonic of octave
 * 0. `offset` is how many semitones the pitch sounds above that rung, which is 0
 * for a scale tone and positive for one between two of them.
 */
export type ScaleLadderPosition = {
  rung: number;
  offset: number;
};

/**
 * Locate a pitch on the key's ladder of scale tones.
 *
 * Anything counting in scale degrees has to put a pitch on this ladder and back
 * again afterwards. Keeping the chromatic offset apart from the rung is what
 * lets a note between two scale tones survive the arithmetic as the note it was:
 * without it a shift by any number of degrees — including none — would first
 * flatten every chromatic pitch onto the scale.
 *
 * In C major, C# sits on the tonic's rung with an offset of one semitone.
 *
 * Layer-internal: the generators count degrees with it, and callers reach the
 * same arithmetic through the transforms that use it.
 *
 * @param pitch MIDI pitch.
 * @param key The key/scale to count along, as a key name, a key/scale, or a
 *   `Key`.
 * @returns The rung the pitch sits on and its semitone offset above it.
 */
export function scaleLadderPosition(pitch: number, key: KeyLike): ScaleLadderPosition {
  return ladderPosition(pitch, toKeyScale(key));
}

/** {@link scaleLadderPosition} over an already-resolved scale. */
function ladderPosition(pitch: number, key: KeyScale): ScaleLadderPosition {
  const offsets = scaleOffsets(key);
  const size = offsets.length;
  if (size === 0) {
    return { rung: 0, offset: 0 };
  }
  const relative = pitch - pitchClass(key.rootPc);
  const octave = Math.floor(relative / 12);
  const within = relative - octave * 12;
  let degree = 0;
  for (let n = 0; n < size; n += 1) {
    if ((offsets[n] ?? 0) <= within) {
      degree = n;
    }
  }
  return { rung: octave * size + degree, offset: within - (offsets[degree] ?? 0) };
}

/**
 * The pitch a rung of the key's ladder of scale tones stands for.
 *
 * The inverse of {@link scaleLadderPosition}'s `rung`: adding the position's
 * `offset` back to the result returns the pitch it came from.
 *
 * Layer-internal, like {@link scaleLadderPosition}.
 *
 * @param rung Scale tones counted from the tonic, negative below it.
 * @param key The key/scale to count along, as a key name, a key/scale, or a
 *   `Key`.
 * @returns The MIDI pitch of that scale tone.
 */
export function scaleLadderPitch(rung: number, key: KeyLike): number {
  return ladderPitch(rung, toKeyScale(key));
}

/** {@link scaleLadderPitch} over an already-resolved scale. */
function ladderPitch(rung: number, key: KeyScale): number {
  const offsets = scaleOffsets(key);
  const size = offsets.length;
  if (size === 0) {
    return pitchClass(key.rootPc);
  }
  const octave = Math.floor(rung / size);
  const degree = rung - octave * size;
  return pitchClass(key.rootPc) + octave * 12 + (offsets[degree] ?? 0);
}

/**
 * Shift a pitch by scale degrees along the key's ladder of scale tones.
 *
 * A pitch between two scale tones keeps its distance above the one below it, so
 * a chromatic passing note is still a chromatic passing note after the shift,
 * and a shift of no degrees returns the pitch untouched: a step up the C-major
 * ladder answers C# with D#, not with D.
 *
 * Layer-internal. It is what `transposeDiatonic` and a tonal imitation both
 * count along, so the two answer the same shift the same way; a caller reaches
 * it through either of them.
 *
 * @param pitch MIDI pitch to shift.
 * @param degrees Scale degrees to move by; negative moves down.
 * @param key The key/scale to count along, as a key name, a key/scale, or a
 *   `Key`.
 * @returns The shifted pitch.
 */
export function shiftByScaleDegrees(pitch: number, degrees: number, key: KeyLike): number {
  const scale = toKeyScale(key);
  const steps = Math.trunc(degrees);
  if (steps === 0) {
    return pitch;
  }
  const { rung, offset } = ladderPosition(pitch, scale);
  return ladderPitch(rung + steps, scale) + offset;
}

/**
 * Get the scale degree of a pitch, counted from 1: the tonic is degree 1.
 *
 * A pitch outside the scale answers -1 rather than 0, so a caller testing the
 * result for a degree cannot mistake the "not in the scale" answer for the
 * tonic.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param key The key/scale to measure against, as a key name, a key/scale, or a
 *   `Key`.
 * @returns The 1-based degree, or -1 if the pitch is not in the scale.
 *
 * @category Scales
 */
export function pitchToScaleDegree(pitch: number, key: KeyLike): number {
  const scale = toKeyScale(key);
  const offset = scaleOffset(pitch, scale);
  if (((scale.modeMask12 >> offset) & 1) === 0) {
    return -1;
  }
  let degree = 1;
  for (let n = 0; n < offset; n += 1) {
    if (((scale.modeMask12 >> n) & 1) === 1) {
      degree += 1;
    }
  }
  return degree;
}

/**
 * List the pitch classes of a key's scale.
 *
 * @param key The key/scale to enumerate, as a key name, a key/scale, or a `Key`.
 * @returns The member pitch classes, sorted ascending in [0, 11].
 *
 * @category Scales
 */
export function diatonicPitchClasses(key: KeyLike): number[] {
  const scale = toKeyScale(key);
  const root = pitchClass(scale.rootPc);
  const pcs: number[] = [];
  for (let n = 0; n < 12; n += 1) {
    if (((scale.modeMask12 >> n) & 1) === 1) {
      pcs.push((root + n) % 12);
    }
  }
  return pcs.sort((a, b) => a - b);
}

/**
 * List the pitch classes of a key's scale in ascending scale-degree order.
 *
 * The first entry is the root (degree 1); degrees follow the mask bits in
 * offset order rather than sorted pitch-class order.
 *
 * @param key The key/scale to enumerate, as a key name, a key/scale, or a `Key`.
 * @returns The member pitch classes ordered by scale degree.
 *
 * @category Scales
 */
export function scaleTonesInDegreeOrder(key: KeyLike): number[] {
  const scale = toKeyScale(key);
  const root = pitchClass(scale.rootPc);
  const pcs: number[] = [];
  for (let n = 0; n < 12; n += 1) {
    if (((scale.modeMask12 >> n) & 1) === 1) {
      pcs.push((root + n) % 12);
    }
  }
  return pcs;
}
