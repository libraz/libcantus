/**
 * Public API of the analyze layer. Re-exports every analyze-layer module;
 * also available from the package root.
 */
export type {
  ArrangementAnalysis,
  ArrangementOptions,
  ArrangementTrack,
  Conflict,
  TensionPoint,
  TrackAnalysis,
  TrackRole,
} from './arrange/index.js';
export { analyzeArrangement, tensionCurve } from './arrange/index.js';
export type { ChordMatch, DetectChordOptions, KeyMatch } from './detect/index.js';
export { detectChord, detectChordBest, detectKey } from './detect/index.js';
export type {
  BorrowedSource,
  Cadence,
  ChordAnalysis,
  HarmonicFunction,
} from './functional/index.js';
export {
  analyzeChord,
  borrowedSource,
  chordToRoman,
  detectCadence,
  functionOf,
  isBorrowedChord,
  isDiatonic,
  isMinorKey,
  parallelKey,
  romanToChord,
  secondaryDominant,
} from './functional/index.js';
export type {
  CadenceHit,
  ChordSegment,
  ChordTimeline,
  ChordTimelineOptions,
  ChordTimelineResult,
} from './timeline/index.js';
export {
  chordTimelineFromChords,
  chordTimelineFromNotes,
  detectCadences,
} from './timeline/index.js';
export type { AnalyzedNote, TheoryLabel, VoiceNote } from './voice/index.js';
export { analyzeVoice } from './voice/index.js';
