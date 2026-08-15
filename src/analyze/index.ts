/**
 * Public API of the analyze layer. Re-exports every analyze-layer module;
 * also available from the package root.
 */

// Types from the layers below that this layer's own signatures name, so a
// consumer importing only `@libraz/libcantus/analyze` can still spell them.
export type { TimeSignature } from '../core/meter/index.js';
export type { KeyScale, NoteEvent } from '../core/types.js';
export type {
  Chord as ChordData,
  ChordQuality,
  ChordSpan,
  ChordToneRole,
  PitchSpelling,
} from '../theory/chord/index.js';
export type { SafetyProfile, VoiceSnapshot } from '../theory/safety/index.js';
export { NoteSafety } from '../theory/safety/index.js';
// `KeyRegion.modulation` names this, so the layer barrel has to carry it even
// though the relation vocabulary itself belongs to the scale layer.
export type { KeyRelation } from '../theory/scale/index.js';
export type {
  ArrangementAnalysis,
  ArrangementOptions,
  ArrangementTrack,
  Conflict,
  TensionPoint,
  TrackAnalysis,
  TrackRole,
} from './arrange/index.js';
export { analyzeArrangement, tensionCurve, tensionCurveFrom } from './arrange/index.js';
export type {
  ChordMatch,
  DetectChordOptions,
  DetectKeyOptions,
  KeyMatch,
  KeyProfileName,
  KeyProfilePair,
  KeyVariant,
} from './detect/index.js';
export {
  detectChord,
  detectChordBest,
  detectKey,
  detectKeyBest,
  detectKeyFromNotes,
} from './detect/index.js';
export type {
  BorrowedSource,
  Cadence,
  ChordAnalysis,
  ChordToRomanOptions,
  HarmonicFunction,
  PivotChord,
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
  pivotChords,
  romanToChord,
  secondaryDominant,
  secondaryDominantOf,
} from './functional/index.js';
export type { KeyRegion, KeyTimelineOptions } from './keys/index.js';
export { detectModulations, keyTimelineFromNotes, prevailingKeyOf } from './keys/index.js';
export type {
  CadenceHit,
  ChordSegment,
  ChordSegmentation,
  ChordTimeline,
  ChordTimelineOptions,
  ChordTimelineResult,
} from './timeline/index.js';
export {
  chordTimelineFromChords,
  chordTimelineFromNotes,
  detectCadences,
} from './timeline/index.js';
export type {
  AnalyzedNote,
  IdentifiedVoiceNote,
  KeyContext,
  SuspensionFigure,
  TheoryLabel,
  VoiceNote,
} from './voice/index.js';
export { analyzeVoice, toVoiceNotes } from './voice/index.js';
