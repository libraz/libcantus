/**
 * Functional harmony: Roman-numeral parsing and formatting, harmonic function
 * (tonic / subdominant / dominant), cadence detection, and borrowed chords.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

export type { AugmentedSixthKind } from './augmented-sixth.js';
export {
  augmentedSixthChord,
  augmentedSixthFromPitchClasses,
  augmentedSixthKind,
  spellAugmentedSixth,
} from './augmented-sixth.js';
export type { BorrowedSource } from './borrowed.js';
export { borrowedSource, isBorrowedChord } from './borrowed.js';
export type { CadenceResult, DetectCadenceOptions } from './cadence.js';
export { detectCadence } from './cadence.js';
export type { AnalyzeChordOptions, ChordAnalysis, HarmonicFunction } from './function.js';
export {
  analyzeChord,
  functionOf,
  isDiatonic,
  isMinorKey,
  parallelKey,
  secondaryDominant,
  secondaryDominantOf,
} from './function.js';
export type { PivotChord } from './pivot.js';
export { pivotChords } from './pivot.js';
export type { RejectedCandidate } from './rationale.js';
export type { ChordToRomanOptions, ExplainRomanOptions, RomanExplanation } from './roman.js';
export { chordToRoman, explainRoman, romanToChord } from './roman.js';
export type { TonicizableDegree } from './tonicization.js';
export { tonicizableDegrees } from './tonicization.js';
