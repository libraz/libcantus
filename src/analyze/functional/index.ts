/**
 * Functional harmony: Roman-numeral parsing and formatting, harmonic function
 * (tonic / subdominant / dominant), cadence detection, and borrowed chords.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

export type { BorrowedSource } from './borrowed.js';
export { borrowedSource, isBorrowedChord } from './borrowed.js';
export type { Cadence } from './cadence.js';
export { detectCadence } from './cadence.js';
export type { ChordAnalysis, HarmonicFunction } from './function.js';
export {
  analyzeChord,
  functionOf,
  isDiatonic,
  isMinorKey,
  parallelKey,
  secondaryDominant,
} from './function.js';
export { chordToRoman, romanToChord } from './roman.js';
