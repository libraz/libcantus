/**
 * Borrowed chords (modal interchange) and the Neapolitan.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import {
  HARMONIC_MINOR_MASK,
  type KeyLike,
  MELODIC_MINOR_MASK,
  toKeyScale,
} from '../../theory/scale/index.js';
import { type ChordLike, toChordData } from '../../theory/symbol/index.js';
import {
  isDiatonicChord,
  isMinorScale,
  isNeapolitanChordOf,
  mod12,
  parallelScale,
} from './internal.js';

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
  if (!isMinorScale(key)) return false;
  const alteredKey = { rootPc: mod12(key.rootPc), modeMask12: HARMONIC_MINOR_MASK };
  if (isDiatonicChord(chord, alteredKey)) return true;
  // Melodic minor contributes the raised-leading-tone half-diminished seventh,
  // but treating every chord in its ascending collection as a non-borrowed
  // alteration would hide ordinary modal interchange such as minor-key IV.
  return (
    mod12(chord.rootPc - key.rootPc) === 11 &&
    isDiatonicChord(chord, { rootPc: mod12(key.rootPc), modeMask12: MELODIC_MINOR_MASK })
  );
}

/** {@link isBorrowedChord} on data already read into its narrow form. */
function isBorrowed(chord: Chord, key: KeyScale): boolean {
  if (isDiatonicChord(chord, key)) {
    return false;
  }
  if (isNeapolitanChordOf(chord, key)) {
    return true;
  }
  if (isMinorScaleAlteration(chord, key)) {
    return false;
  }
  return isDiatonicChord(chord, parallelScale(key));
}

/** {@link borrowedSource} on data already read into its narrow form. */
export function borrowedSourceOf(chord: Chord, key: KeyScale): BorrowedSource {
  if (isDiatonicChord(chord, key)) {
    return null;
  }
  if (isNeapolitanChordOf(chord, key)) return 'neapolitan';
  if (isBorrowed(chord, key)) {
    return isMinorScale(key) ? 'parallelMajor' : 'parallelMinor';
  }
  return null;
}

/**
 * Whether a chord is borrowed from the parallel mode (modal interchange).
 *
 * True when the chord is not diatonic to `key` but is diatonic to its
 * {@link parallelKeyOf | parallel key} — e.g. iv, bVI, or bVII in a major key, or the Picardy
 * tonic and major IV in a minor key — and true for the Neapolitan, which is
 * counted as a borrowing of its own even though it belongs to neither parallel
 * mode. Two non-diatonic families are excluded: any other chord diatonic to
 * neither mode (those are chromatic, not borrowed), and, in a minor key, chords
 * explained by the altered minor forms (the major dominant and
 * raised-leading-tone chords), which are in-key alterations rather than
 * interchange even though they happen to fit the parallel major.
 *
 * @param chord The chord to test, as a chord symbol, chord data, or a `Chord`.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @returns True if the chord is borrowed from the parallel mode.
 * @category Functional Harmony
 */
export function isBorrowedChord(chord: ChordLike, key: KeyLike): boolean {
  return isBorrowed(toChordData(chord), toKeyScale(key));
}

/**
 * Identify where a non-diatonic chord comes from.
 *
 * The Neapolitan (major triad on b2 of a key that does not have that degree
 * already) is recognized first, since it sits outside both parallel modes;
 * parallel-mode borrowing follows the {@link isBorrowedChord} rules. Diatonic
 * chords and altered-minor chords, and unrecognized chromatic chords all yield
 * null.
 *
 * @param chord The chord to classify, as a chord symbol, chord data, or a
 *   `Chord`.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @returns The borrowing source, or null.
 * @category Functional Harmony
 */
export function borrowedSource(chord: ChordLike, key: KeyLike): BorrowedSource {
  return borrowedSourceOf(toChordData(chord), toKeyScale(key));
}
