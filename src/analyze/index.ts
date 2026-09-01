/**
 * Public API of the analyze layer. Re-exports every analyze-layer module;
 * also available from the package root.
 */

// Types from the layers below that this layer's own signatures name, so a
// consumer importing only `@libraz/libcantus/analyze` can still spell them.
export type { Articulation } from '../core/instrument/index.js';
export type { MeterChange, MeterLike, MeterMap, TimeSignature } from '../core/meter/index.js';
export type {
  IntervalData,
  IntervalQualityLabel,
  Note as NoteData,
  NoteLike,
  SpelledInterval,
} from '../core/pitch/index.js';
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
export type { KeyLike, KeyRelation, ScaleName } from '../theory/scale/index.js';
export type { ChordLike } from '../theory/symbol/index.js';
export type {
  ArrangementAnalysis,
  ArrangementOptions,
  ArrangementSession,
  ArrangementTrack,
  Conflict,
  TensionPoint,
  TrackAnalysis,
  TrackEdit,
  TrackRole,
} from './arrange/index.js';
export {
  analyzeArrangement,
  createArrangementSession,
  tensionCurve,
  tensionCurveFrom,
} from './arrange/index.js';
export type {
  ChordMatch,
  DetectChordOptions,
  DetectKeyOptions,
  KeyMatch,
  KeyProfileName,
  KeyProfilePair,
  KeyVariant,
  ModalCandidate,
  ModalScaleName,
} from './detect/index.js';
export {
  detectChord,
  detectChordBest,
  detectKey,
  detectKeyBest,
  detectKeyFromNotes,
  MODAL_SCALE_NAMES,
} from './detect/index.js';
export type {
  FormSection,
  FormSectionOptions,
  Hypermeter,
  HypermeterOptions,
  Phrase,
  PhraseOptions,
  PhraseSignal,
  StructuralCadence,
} from './form/index.js';
export {
  hypermeter,
  phrasesFromTimeline,
  sectionsFromNotes,
  structuralCadences,
} from './form/index.js';
export type {
  AnalyzeChordOptions,
  AugmentedSixthKind,
  BorrowedSource,
  CadenceResult,
  ChordAnalysis,
  ChordToRomanOptions,
  DetectCadenceOptions,
  ExplainRomanOptions,
  HarmonicFunction,
  PivotChord,
  RejectedCandidate,
  RomanExplanation,
} from './functional/index.js';
export {
  analyzeChord,
  augmentedSixthChord,
  augmentedSixthFromPitchClasses,
  augmentedSixthKind,
  borrowedSource,
  chordToRoman,
  detectCadence,
  explainRoman,
  functionOf,
  isBorrowedChord,
  isDiatonic,
  isMinorKey,
  pivotChords,
  romanToChord,
  secondaryDominant,
  secondaryDominantOf,
  spellAugmentedSixth,
} from './functional/index.js';
export type { KeyRegion, KeyTimelineOptions, SpelledKeyScale } from './keys/index.js';
export { detectModulations, keyTimelineFromNotes, prevailingKeyOf } from './keys/index.js';
export type {
  ContourDirection,
  ExtractMotifsOptions,
  MelodicComparison,
  MelodicContour,
  MelodicContourShape,
  MelodicPhrase,
  MotifData,
  MotifOccurrence,
  MotifRelation,
  MotifRelationKind,
} from './melody/index.js';
export {
  compareMelodies,
  extractMotifs,
  melodicContour,
  melodicSimilarity,
  motifFromNotes,
  relateMotifs,
} from './melody/index.js';
export type {
  ReducedChord,
  ReduceProgressionOptions,
  ReductionBasis,
  ReductionLevel,
} from './reduction/index.js';
export { reduceProgression } from './reduction/index.js';
export type { SpellLineOptions } from './spelling/index.js';
export { spellLine } from './spelling/index.js';
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
