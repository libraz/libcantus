/**
 * Pivot chords: the common ground two keys share for a modulation.
 *
 * Roots are pitch classes measured against the key tonic, so the two readings
 * of a pivot follow from the chord's degree in each key rather than requiring a
 * spelled key signature.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import { diatonicTriad } from '../../theory/chord/index.js';
import { scaleTonesInDegreeOrder } from '../../theory/scale/index.js';
import { isDiatonic } from './function.js';
import { chordToRoman } from './roman.js';

/** Degree count of a scale that stacks thirds into triads. */
const HEPTATONIC_DEGREES = 7;

/**
 * A chord that is diatonic to two keys at once, with its reading in each.
 *
 * @category Functional Harmony
 */
export type PivotChord = {
  /** The shared chord. */
  chord: Chord;
  /** Roman numeral in the key being left. */
  romanFrom: string;
  /** Roman numeral in the key being entered. */
  romanTo: string;
};

/**
 * List the chords a modulation from `from` to `to` can pivot on.
 *
 * A pivot chord belongs to both keys at once, so it can be heard as a degree of
 * the key being left and reinterpreted as a degree of the key being entered —
 * the seamless way into the new key. Candidates are the diatonic triads of
 * `from`, degrees 1 through 7, kept when every one of their pitch classes is
 * also a scale tone of `to`; the result is ordered by their degree in `from`.
 *
 * Only triads are candidates. The textbook pivot is a triad: a seventh narrows
 * the shared ground by a whole tone for no analytical gain, and the chord that
 * turns the modulation is heard as a triad whether or not a seventh is played
 * over it.
 *
 * A key that is not heptatonic has no diatonic triads at all — stacking scale
 * thirds only lands on a triad over seven degrees — so such a `from` key yields
 * an empty list rather than an error. A `to` key is only tested for membership,
 * so it may be any scale; its numerals then follow the {@link chordToRoman}
 * fallback of naming roots against the parallel major.
 *
 * @param from The key being left.
 * @param to The key being entered.
 * @returns The shared triads, ascending by their degree in `from`.
 * @example
 * ```ts
 * import { majorKey, pivotChords } from '@libraz/libcantus';
 * pivotChords(majorKey(0), majorKey(7)).map((p) => `${p.romanFrom}=${p.romanTo}`);
 * // ['I=IV', 'iii=vi', 'V=I', 'vi=ii'] — C major into G major
 * ```
 * @category Functional Harmony
 */
export function pivotChords(from: KeyScale, to: KeyScale): PivotChord[] {
  // Testing the degree count keeps a key with no diatonic triads an empty
  // result rather than letting the stacking throw.
  if (scaleTonesInDegreeOrder(from).length !== HEPTATONIC_DEGREES) {
    return [];
  }
  const pivots: PivotChord[] = [];
  const seen = new Set<string>();
  for (let degree = 1; degree <= HEPTATONIC_DEGREES; degree += 1) {
    const chord = stackedTriad(degree, from);
    if (chord === null || !isDiatonic(chord, to)) {
      continue;
    }
    // Candidates are identified by sonority, so a scale whose degrees repeat a
    // triad offers that pivot once.
    const identity = `${chord.rootPc}:${chord.quality}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    pivots.push({
      chord,
      romanFrom: chordToRoman(chord, from),
      romanTo: chordToRoman(chord, to),
    });
  }
  return pivots;
}

/**
 * The diatonic triad on a scale degree, or null where the scale stacks none.
 *
 * A heptatonic scale with uneven steps can stack thirds into an interval set no
 * triad quality describes, which {@link diatonicTriad} rejects. That degree
 * offers nothing to pivot on, so it is skipped rather than failing the query
 * for the six degrees that may well be pivots.
 */
function stackedTriad(degree: number, key: KeyScale): Chord | null {
  try {
    return diatonicTriad(degree, key);
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return null;
    }
    throw error;
  }
}
