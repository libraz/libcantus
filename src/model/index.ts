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
  ExplainRomanOptions,
  HarmonicFunction,
  RejectedCandidate,
  RomanExplanation,
} from '../analyze/functional/index.js';
export type {
  AnalyzedNote,
  ArrangementAnalysis,
  ArrangementOptions,
  ArrangementSession,
  ArrangementTrack,
  CadenceHit,
  ChordSegmentation,
  ChordTimeline,
  ChordTimelineOptions,
  Conflict,
  ContourDirection,
  ExtractMotifsOptions,
  FormSection,
  FormSectionOptions,
  Hypermeter,
  HypermeterOptions,
  IdentifiedVoiceNote,
  KeyContext,
  KeyRegion,
  KeyTimelineOptions,
  MelodicContour,
  MelodicContourShape,
  MotifData,
  MotifOccurrence,
  MotifRelation,
  MotifRelationKind,
  Phrase,
  PhraseOptions,
  PhraseSignal,
  PivotChord,
  ReducedChord,
  ReduceProgressionOptions,
  ReductionBasis,
  ReductionLevel,
  StructuralCadence,
  SuspensionFigure,
  TensionPoint,
  TheoryLabel,
  TrackAnalysis,
  TrackEdit,
  TrackRole,
  VoiceNote,
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
  IndexedNoteEvent,
  NoteEventIndex,
  NoteEventIndexOptions,
  OnsetTieBreak,
} from '../core/event-index/index.js';
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
  MeterLike,
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
export type { PositionalRng, SeedPath } from '../core/random/index.js';
export type { TempoEvent, TempoMap } from '../core/tempo/index.js';
export type { TuningTable } from '../core/tuning/index.js';
export type { KeyScale, NoteEvent } from '../core/types.js';
export type {
  BassLineOptions,
  BassSegment,
  BassStyle,
  BorrowedChord,
  Complexity,
  CounterMelodyOptions,
  DrumRole,
  DrumsOptions,
  EuclideanKick,
  GenerationContext,
  GenerationContextInput,
  Genre,
  GridEvent,
  GrooveFeel,
  GrooveSlot,
  GrooveStyle,
  GrooveTemplate,
  HarmonizeOptions,
  HarmonizePlacement,
  HumanizeOptions,
  MelodyNote,
  MotifCell,
  MotifContour,
  MotifNote,
  MotifTransform,
  OrnamentOptions,
  OrnamentStyle,
  ProfileWeights,
  ProgFunction,
  ProgressionDegree,
  ProgressionOptions,
  ProgressionPreset,
  ProgStyle,
  Provenance,
  ProvenanceBasis,
  PublicSection,
  RhythmEvent,
  RhythmOptions,
  Section,
  SubstituteOptions,
  Substitution,
  SubstitutionType,
  Vocabulary,
} from '../generate/index.js';
export type {
  Alteration,
  AlteredDegree,
  Chord as ChordData,
  ChordBase,
  ChordQuality,
  ChordSegment,
  ChordSeventh,
  ChordSpan,
  ChordSpec,
  ChordToneRole,
  PitchSpelling,
} from '../theory/chord/index.js';
export type {
  AvailableTensionsOptions,
  AvoidNotesOptions,
  AvoidNoteUse,
  ChordScaleMatch,
  ChordScaleReportEntry,
  ScaleChoice,
} from '../theory/chordscale/index.js';
export type {
  VoiceIndependenceOptions,
  VoiceIndependenceReport,
} from '../theory/counterpoint/index.js';
export type {
  PartWritingOptions,
  PartWritingViolation,
  PartWritingViolationKind,
  Species,
  SpeciesOptions,
} from '../theory/partwriting/index.js';
export type {
  EvaluateSafetyOptions,
  SafetyProfile,
  SafetyQuery,
  SafetyResult,
  VoiceSnapshot,
} from '../theory/safety/index.js';
export { NoteSafety } from '../theory/safety/index.js';
export type {
  KeyLike,
  KeyMode,
  KeyRelation,
  ScaleName,
  ScaleNameInput,
  ScaleSystem,
  SpelledKey,
} from '../theory/scale/index.js';
export type { ChordLike, ChordSymbolOptions } from '../theory/symbol/index.js';
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

export {
  Arrangement,
  type ArrangementData,
  type ArrangementSettings,
  type ArrangementSetup,
  type ArrangementTensionOptions,
} from './arrangement.js';
export { Chord } from './chord.js';
export { Composer, type ComposerOptions, type HarmonizedMelody } from './composer.js';
export { Duration } from './duration.js';
export { Instrument } from './instrument.js';
export { Interval } from './interval.js';
export { type DetectedKeyMatch, Key, type KeyData } from './key.js';
export { Meter } from './meter.js';
export { Motif, type MotifGenerateOptions } from './motif.js';
export { Note } from './note.js';
export { Progression, type ProgressionData } from './progression.js';
export { Rhythm, type RhythmData, type RhythmDeformOptions } from './rhythm.js';
export { Score, type ScoreData, type ScoreOptions } from './score.js';
export { Tempo, type TempoData } from './tempo.js';
export { Timeline, type TimelineData, type TimelineRoman } from './timeline.js';
export { Tuning } from './tuning.js';
export {
  Voicing,
  type VoicingData,
  type VoicingIndependenceOptions,
  type VoicingSafetyQuery,
} from './voicing.js';
