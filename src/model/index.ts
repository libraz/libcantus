/**
 * Fluent, immutable object model over the functional core.
 *
 * Each class wraps one of the library's plain data types (spelled notes,
 * chords, key/scales) and delegates every operation to the existing pure
 * functions. All instances are immutable: fields are read-only, transforming
 * methods return new instances, and getters hand out defensive copies of any
 * mutable data.
 */

export type {
  ChordMatch,
  DetectChordOptions,
  DetectKeyOptions,
  KeyMatch,
  KeyProfileName,
  KeyProfilePair,
  KeyVariant,
  ModalScaleName,
} from '../analyze/detect/index.js';
// The classes' own signatures name these plain types; without them a consumer
// importing only `@libraz/libcantus/model` cannot declare a variable, write a
// wrapper, or emit declarations under `isolatedDeclarations`.
export type {
  AnalyzeChordOptions,
  BorrowedSource,
  CadenceResult,
  ChordAnalysis,
  ChordToRomanOptions,
  DetectCadenceOptions,
  HarmonicFunction,
  RejectedCandidate,
} from '../analyze/functional/index.js';
export type {
  CadenceHit,
  ChordSegmentation,
  ChordTimeline,
  ChordTimelineOptions,
  KeyRegion,
  PivotChord,
  ReducedChord,
  ReduceProgressionOptions,
  ReductionBasis,
  ReductionLevel,
} from '../analyze/index.js';
export type {
  DurationData,
  NoteValue,
  SpelledDuration,
  Tuplet,
} from '../core/duration/index.js';
export type {
  BudgetExceededError,
  InvalidInputError,
  LibcantusError,
  NoSolutionError,
  ParseResult,
} from '../core/errors/index.js';
export type {
  Articulation,
  InstrumentProfile,
  InstrumentProfileCommon,
  Limb,
  NotePlacement,
  PercussionProfile,
  PlayabilityIssue,
  PlayabilityIssueType,
  PlayabilityLayer,
  PlayabilityReport,
  StringedProfile,
  StringFingering,
} from '../core/index.js';
export type {
  BarPosition,
  MeterChange,
  MeterMap,
  TimeSignature,
} from '../core/meter/index.js';
export type {
  IntervalLike,
  IntervalQualityLabel,
  Note as NoteData,
  NoteLike,
  NoteNameOptions,
  NoteNameSystem,
  SpelledInterval,
} from '../core/pitch/index.js';
export type { TuningTable } from '../core/tuning/index.js';
export type { KeyScale, NoteEvent } from '../core/types.js';
export type {
  Chord as ChordData,
  ChordQuality,
  ChordSegment,
  ChordSpan,
  ChordToneRole,
  PitchSpelling,
} from '../theory/chord/index.js';
export type {
  AvailableTensionsOptions,
  AvoidNotesOptions,
  AvoidNoteUse,
  ChordScaleMatch,
  ScaleChoice,
} from '../theory/chordscale/index.js';
export type {
  KeyLike,
  KeyMode,
  KeyRelation,
  ScaleName,
  ScaleNameInput,
  SpelledKey,
} from '../theory/scale/index.js';
export type { ChordSymbolOptions } from '../theory/symbol/index.js';
export type {
  TransposingInstrument,
  TransposingInstrumentName,
} from '../theory/transposition/index.js';
export type {
  StyledVoicingOptions,
  VoiceRange,
  VoicingOptions,
  VoicingStyle,
} from '../theory/voicing/index.js';

export { Chord } from './chord.js';
export { Duration } from './duration.js';
export { Instrument } from './instrument.js';
export { Interval } from './interval.js';
export { type DetectedKeyMatch, Key, type KeyData } from './key.js';
export { Meter } from './meter.js';
export { Note } from './note.js';
export { Progression, type ProgressionData } from './progression.js';
export { Tempo, type TempoData } from './tempo.js';
export { Timeline, type TimelineData, type TimelineRoman } from './timeline.js';
export { Tuning } from './tuning.js';
