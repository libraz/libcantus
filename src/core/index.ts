/**
 * Public API of the core layer. Re-exports every core-layer module;
 * also available from the package root.
 */

export type { DurationData, NoteValue, SpelledDuration, Tuplet } from './duration/index.js';
export {
  beatsToDuration,
  beatsToTiedDurations,
  durationToBeats,
  NOTE_VALUES,
} from './duration/index.js';
export type { LibcantusError, LibcantusErrorCode, ParseResult } from './errors/index.js';
export {
  BudgetExceededError,
  InvalidInputError,
  isLibcantusError,
  NoSolutionError,
} from './errors/index.js';
export type {
  IndexedNoteEvent,
  NoteEventIndex,
  NoteEventIndexOptions,
  OnsetTieBreak,
} from './event-index/index.js';
export { createNoteEventIndex } from './event-index/index.js';
export type {
  Articulation,
  InstrumentProfile,
  InstrumentProfileCommon,
  InstrumentProfileLike,
  Limb,
  NotePlacement,
  PercussionProfile,
  PlayabilityIssue,
  PlayabilityIssueType,
  PlayabilityLayer,
  PlayabilityReport,
  StringedProfile,
  StringFingering,
} from './instrument/index.js';
export {
  ARTICULATIONS,
  BASS_4_STRING,
  BASS_5_STRING,
  canSound,
  fingeringsFor,
  foldIntoRange,
  GUITAR_DROP_D,
  GUITAR_STANDARD,
  instrumentRange,
  LIMBS,
  playability,
} from './instrument/index.js';
export {
  ConsonanceClass,
  classifyInterval,
  isConsonantInterval,
  isPerfectInterval,
} from './interval/index.js';
export type {
  BarPosition,
  MeterChange,
  MeterLike,
  MeterMap,
  TimeSignature,
} from './meter/index.js';
export {
  barIndexAt,
  barPositionToBeat,
  barPositionToPulse,
  barStartBeat,
  beatsPerBar,
  beatsPerBarAt,
  beatToBarPosition,
  formatBarPosition,
  formatTimeSignature,
  isCompound,
  isStrongBeat,
  meterAt,
  metricWeight,
  parseTimeSignature,
  pulseBeats,
  pulsesPerBar,
  resolveMeters,
  tryParseTimeSignature,
  tuplet,
} from './meter/index.js';
export type {
  IntervalLike,
  IntervalQualityLabel,
  KeyName,
  Note as NoteData,
  NoteLike,
  NoteNameOptions,
  NoteNameSystem,
  SpelledInterval,
} from './pitch/index.js';
export {
  detectNoteNameSystem,
  diatonicLetterOf,
  formatKeyName,
  formatNote,
  intervalSemitones,
  midiToNote,
  naturalPitchClassOf,
  noteToMidi,
  noteToPitchClass,
  parseInterval,
  parseKeyName,
  parseNote,
  pitchClassOf,
  spelledInterval,
  toNoteData,
  toSpelledInterval,
  transposeByInterval,
  transposeNote,
  tryParseInterval,
  tryParseKeyName,
  tryParseNote,
} from './pitch/index.js';
export type { PositionalRng, Rng, SeedPath } from './random/index.js';
export {
  ALGORITHM_VERSION,
  createPositionalRng,
  createRng,
  deriveSeed,
  includeAt,
  MIN_ALGORITHM_VERSION,
  resolveAlgorithmVersion,
} from './random/index.js';
export type { TempoEvent, TempoMap } from './tempo/index.js';
export {
  beatsToSeconds,
  beatsToTicks,
  durationToSeconds,
  secondsToBeats,
  tempoAt,
  ticksToBeats,
} from './tempo/index.js';
export type { TuningTable } from './tuning/index.js';
export {
  centsBetweenFreq,
  centsFromNearestStep,
  centsOfSteps,
  centsToRatio,
  edo,
  frequencyOf,
  JUST_RATIOS,
  justDeviationCents,
  nearestStep,
  ratioToCents,
  stepOf,
  stepsOfCents,
  TWELVE_TET,
} from './tuning/index.js';
export type { KeyScale, NoteEvent } from './types.js';
export type { NoteEventAssertOptions } from './validation/index.js';
export {
  assertDegree,
  assertFiniteNumber,
  assertFiniteSemitones,
  assertGenerationBudget,
  assertInteger,
  assertMeterMap,
  assertMidiPitch,
  assertNoteEvent,
  assertNoteEvents,
  assertOneOf,
  assertPositiveInt,
  assertRange,
  assertTimeSignature,
  clampToMidi,
  DEFAULT_GENERATION_BUDGET,
  dropSilentNotes,
  soundingNotesOnly,
} from './validation/index.js';
