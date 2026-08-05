/**
 * Borrowed chords (modal interchange) and the Neapolitan.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import { HARMONIC_MINOR_MASK, MELODIC_MINOR_MASK } from '../../theory/scale/index.js';
import { isDiatonic, isMinorKey, parallelKey } from './function.js';
import { isNeapolitan, mod12 } from './internal.js';

/**
 * The origin of a recognized non-diatonic chord, or null when none applies.
 *
 * @category Functional Harmony
 */
export type BorrowedSource = 'parallelMinor' | 'parallelMajor' | 'neapolitan' | null;

/**
 * In a minor key, whether a non-diatonic chord is explained by the harmonic
 * minor scale on the same tonic (major V, V7, raised-leading-tone vii°), or
 * by the melodic-minor raised-leading-tone half-diminished seventh. Such
 * chords are in-key chromatic alterations, not modal interchange.
 */
function isMinorScaleAlteration(chord: Chord, key: KeyScale): boolean {
  if (!isMinorKey(key)) return false;
  const alteredKey = { rootPc: mod12(key.rootPc), modeMask12: HARMONIC_MINOR_MASK };
  if (isDiatonic(chord, alteredKey)) return true;
  // Melodic minor contributes the raised-leading-tone half-diminished seventh,
  // but treating every chord in its ascending collection as a non-borrowed
  // alteration would hide ordinary modal interchange such as minor-key IV.
  return (
    mod12(chord.rootPc - key.rootPc) === 11 &&
    isDiatonic(chord, { rootPc: mod12(key.rootPc), modeMask12: MELODIC_MINOR_MASK })
  );
}

/**
 * Whether a chord is borrowed from the parallel mode (modal interchange).
 *
 * True when the chord is not diatonic to `key` but is diatonic to its
 * {@link parallelKey} — e.g. iv, bVI, or bVII in a major key, or the Picardy
 * tonic and major IV in a minor key. Two non-diatonic families are excluded:
 * chords diatonic to neither mode (they are chromatic, not borrowed), and, in
 * a minor key, chords explained by the altered minor forms (the major
 * dominant and raised-leading-tone chords), which are in-key alterations
 * rather than interchange even though they happen to fit the parallel major.
 *
 * @param chord The chord to test.
 * @param key The prevailing key.
 * @returns True if the chord is borrowed from the parallel mode.
 * @category Functional Harmony
 */
export function isBorrowedChord(chord: Chord, key: KeyScale): boolean {
  if (isDiatonic(chord, key)) {
    return false;
  }
  if (isNeapolitan(chord, key)) {
    return true;
  }
  if (isMinorScaleAlteration(chord, key)) {
    return false;
  }
  return isDiatonic(chord, parallelKey(key));
}

/**
 * Identify where a non-diatonic chord comes from.
 *
 * The Neapolitan (major triad on b2) is recognized first, since it sits
 * outside both parallel modes; parallel-mode borrowing follows the
 * {@link isBorrowedChord} rules. Diatonic chords and altered-minor chords,
 * and unrecognized chromatic chords all yield null.
 *
 * @param chord The chord to classify.
 * @param key The prevailing key.
 * @returns The borrowing source, or null.
 * @category Functional Harmony
 */
export function borrowedSource(chord: Chord, key: KeyScale): BorrowedSource {
  if (isDiatonic(chord, key)) {
    return null;
  }
  if (isNeapolitan(chord, key)) return 'neapolitan';
  if (isBorrowedChord(chord, key)) {
    return isMinorKey(key) ? 'parallelMajor' : 'parallelMinor';
  }
  return null;
}
