/**
 * Public API of the theory layer. Re-exports every theory-layer module;
 * also available from the package root.
 */

// Types from the layers below that this layer's own signatures name, so a
// consumer importing only `@libraz/libcantus/theory` can still spell them.
export type {
  BudgetExceededError,
  InvalidInputError,
  LibcantusError,
  NoSolutionError,
  ParseResult,
} from '../core/errors/index.js';
export type { ConsonanceClass } from '../core/interval/index.js';
export type {
  IntervalData,
  IntervalLike,
  IntervalQualityLabel,
  Note as NoteData,
  NoteLike,
  NoteNameOptions,
  NoteNameSystem,
  SpelledInterval,
} from '../core/pitch/index.js';
export type { KeyScale } from '../core/types.js';
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
} from './chord/index.js';
export {
  chordFromDegree,
  chordFromSpan,
  chordFromSpec,
  chordPitchClasses,
  chordQualities,
  chordSpecIntervals,
  chordSpecOf,
  chordSpecQuality,
  chordToneRole,
  diatonicSeventh,
  diatonicTriad,
  intervalAboveRoot,
  isChordMember,
  makeChord,
  spanFromChord,
  transposeChord,
} from './chord/index.js';
export type {
  AvailableTensionsOptions,
  AvoidNotesOptions,
  AvoidNoteUse,
  ChordScaleMatch,
  ChordScaleReportEntry,
  ScaleChoice,
} from './chordscale/index.js';
export {
  availableTensions,
  avoidNotes,
  chordScaleReport,
  chordScales,
  scaleMatchesChord,
  scalesForChanges,
} from './chordscale/index.js';
export type {
  VoiceIndependenceOptions,
  VoiceIndependenceReport,
} from './counterpoint/index.js';
export {
  classifySpelledInterval,
  createsBattuta,
  createsHiddenParallelPerfect,
  createsParallelOctave,
  createsParallelPerfect,
  createsParallelUnison,
  createsVerticalDissonance,
  createsVoiceCrossing,
  createsVoiceOverlap,
  exceedsSpacing,
  isAugmentedMelodicInterval,
  isForbiddenMelodicLeap,
  isLeadingToneResolution,
  voiceIndependence,
} from './counterpoint/index.js';
export type {
  FiguredBassRealization,
  FiguredBassSuspension,
} from './figured-bass/index.js';
export {
  figuredBassOf,
  figuredBassRealization,
  realizeFiguredBass,
} from './figured-bass/index.js';
export type { HarmonyRole, LockLevel, VoicedRole } from './harmony/index.js';
export { roleOf } from './harmony/index.js';
export type {
  PartWritingOptions,
  PartWritingViolation,
  PartWritingViolationKind,
  Species,
  SpeciesOptions,
  SpelledVoicing,
} from './partwriting/index.js';
export { checkPartWriting, checkSpecies, spellVoicing } from './partwriting/index.js';
export type {
  EvaluateSafetyOptions,
  ProfileWeights,
  SafetyProfile,
  SafetyQuery,
  SafetyResult,
  VoiceSnapshot,
} from './safety/index.js';
export {
  enumerateSafePitches,
  evaluateSafety,
  NoteSafety,
  PROFILE_WEIGHTS,
  profileWeights,
  ReasonFlag,
} from './safety/index.js';
export type {
  KeyLike,
  KeyMode,
  KeyRelation,
  KeyVariant,
  ResolvedKey,
  ScaleAliasName,
  ScaleLadderPosition,
  ScaleName,
  ScaleNameInput,
  ScaleSystem,
  SpelledKey,
  WorldScaleName,
} from './scale/index.js';
export {
  ALTERED_MASK,
  assertKeyVariant,
  BLUES_MASK,
  CHROMATIC_MASK,
  DORIAN_MASK,
  DOUBLE_HARMONIC_MASK,
  diatonicPitchClasses,
  dominantKeyOf,
  enharmonicKeyOf,
  HARMONIC_MINOR_MASK,
  isScaleTone,
  isSignatureKey,
  keyFromFifths,
  keyRelationBetween,
  keySignatureFifths,
  LOCRIAN_MASK,
  LOCRIAN_NATURAL2_MASK,
  LYDIAN_DOMINANT_MASK,
  LYDIAN_MASK,
  MAJOR_MASK,
  MAJOR_PENTATONIC_MASK,
  MARWA_MASK,
  MELODIC_MINOR_MASK,
  MINOR_PENTATONIC_MASK,
  MIXOLYDIAN_B13_MASK,
  MIXOLYDIAN_MASK,
  MIYAKO_BUSHI_MASK,
  majorKey,
  maskFromOffsets,
  minorKey,
  NAMED_SCALES,
  NATURAL_MINOR_MASK,
  namedScaleMask,
  nearestScaleTone,
  OCTATONIC_HALF_WHOLE_MASK,
  OCTATONIC_WHOLE_HALF_MASK,
  PHRYGIAN_DOMINANT_MASK,
  PHRYGIAN_MASK,
  PURVI_MASK,
  parallelKeyOf,
  pitchToScaleDegree,
  RITSU_MASK,
  RYUKYU_MASK,
  relatedKeysOf,
  relativeKeyOf,
  requireScaleMask,
  resolveKey,
  resolveScaleName,
  SCALE_ALIASES,
  SCALE_SYSTEMS,
  scaleByName,
  scaleLadderPitch,
  scaleLadderPosition,
  scaleOf,
  scaleSystemOf,
  scaleTonesInDegreeOrder,
  shiftByScaleDegrees,
  spelledKeyOf,
  subdominantKeyOf,
  supportsFunctionalHarmony,
  TODI_MASK,
  toKeyScale,
  WHOLE_TONE_MASK,
  WORLD_SCALES,
} from './scale/index.js';
export type { SpellingContext } from './spelling/index.js';
export {
  noteNames,
  spellChord,
  spellChordFromRoot,
  spellPitch,
  spellPitchClass,
  spellPitchClasses,
  spellScale,
} from './spelling/index.js';
export type { ChordLike, ChordSymbolOptions } from './symbol/index.js';
export {
  formatChordSymbol,
  parseChordSymbol,
  toChordData,
  transposeChordSymbol,
  tryParseChordSymbol,
} from './symbol/index.js';
export type {
  TransposingInstrument,
  TransposingInstrumentName,
} from './transposition/index.js';
export {
  instrumentTransposition,
  TRANSPOSING_INSTRUMENTS,
  toSoundingPitch,
  toWrittenPitch,
} from './transposition/index.js';
export type {
  StyledVoicingOptions,
  VoiceRange,
  VoicingOptions,
  VoicingStyle,
} from './voicing/index.js';
export {
  nextVoicing,
  SATB_RANGES,
  voiceChord,
  voiceChordStyled,
  voiceLeadingCost,
  voiceProgression,
} from './voicing/index.js';
