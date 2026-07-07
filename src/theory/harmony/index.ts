import type { Chord } from '../chord/index.js';

/**
 * Harmonic role a pitch plays within a chord.
 *
 * @category Functional Harmony
 */
export type HarmonyRole = 'root' | 'third' | 'fifth' | 'sixth' | 'seventh' | 'tension' | 'doubling';

/**
 * How firmly a pitch is locked to the chord's identity.
 *
 * - `identity`: moving it produces a different chord (the root).
 * - `quality`: moving it flips the chord quality (the third).
 * - `voicing`: it can move freely without changing chord identity or quality.
 *
 * @category Functional Harmony
 */
export type LockLevel = 'identity' | 'quality' | 'voicing';

/**
 * A pitch's role, lock level, and owning chord.
 *
 * @category Functional Harmony
 */
export type VoicedRole = {
  role: HarmonyRole;
  lock: LockLevel;
  belongsToChordId: number;
};

/**
 * Classify a pitch's harmonic role and lock level within a chord.
 *
 * The role comes from the pitch's interval class above the chord root: root (0),
 * third (3/4), fifth (6/7/8), seventh (10/11), and 9/11/13 tensions (2/5/9, and
 * the flat ninth 1). The root locks the chord identity, the third locks its
 * quality, and everything else is free voicing. In a suspended chord (a chord
 * whose intervals include a 4th (5) or 2nd (2) but no third), the suspended tone
 * takes the third's place as the quality-defining tone and is locked to
 * `quality`, since moving it changes the chord. Detecting an octave doubling
 * requires the surrounding voicing, which this single-pitch query does not carry,
 * so `doubling` is part of the type but not returned here.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param chord The chord providing the root reference.
 * @param chordId Identifier stored on the result (defaults to 0).
 * @returns The pitch's role, lock level, and owning chord id.
 * @example
 * ```ts
 * import { roleOf, makeChord } from '@libraz/libcantus';
 * roleOf(64, makeChord(0, 'maj')); // E over C major
 * // { role: 'third', lock: 'quality', belongsToChordId: 0 }
 * ```
 * @category Functional Harmony
 */
export function roleOf(pitch: number, chord: Chord, chordId = 0): VoicedRole {
  const interval = (((Math.trunc(pitch) - chord.rootPc) % 12) + 12) % 12;
  const tones = new Set(chord.intervals.map((i) => ((i % 12) + 12) % 12));
  const hasHigherSeventh = tones.has(10) || tones.has(11);
  const hasThird = tones.has(3) || tones.has(4);
  const isSuspendedTone =
    !hasThird && ((interval === 5 && tones.has(5)) || (interval === 2 && tones.has(2)));
  let role: HarmonyRole;
  let lock: LockLevel;
  if (interval === 0) {
    role = 'root';
    lock = 'identity';
  } else if (isSuspendedTone) {
    role = 'third'; // suspended tone occupies the third's quality-defining slot
    lock = 'quality';
  } else if (interval === 3 || interval === 4) {
    role = 'third';
    lock = 'quality';
  } else if (interval === 6 || interval === 7 || interval === 8) {
    role = 'fifth';
    lock = 'voicing';
  } else if (interval === 9 && tones.has(3) && tones.has(6) && !hasHigherSeventh) {
    role = 'seventh'; // diminished seventh
    lock = 'voicing';
  } else if (interval === 9 && tones.has(9) && !hasHigherSeventh) {
    role = 'sixth';
    lock = 'voicing';
  } else if (interval === 10 || interval === 11) {
    role = 'seventh';
    lock = 'voicing';
  } else {
    role = 'tension';
    lock = 'voicing';
  }
  return { role, lock, belongsToChordId: chordId };
}
