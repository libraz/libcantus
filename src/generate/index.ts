/**
 * Public API of the generate layer. Re-exports every generate-layer module;
 * also available from the package root.
 */

// Types from the layers below that this layer's own signatures name, so a
// consumer importing only `@libraz/libcantus/generate` can still spell them.
export type { BorrowedSource, HarmonicFunction } from '../analyze/functional/index.js';
export type { ChordSegment, ChordTimeline } from '../analyze/timeline/index.js';
export type {
  Articulation,
  InstrumentProfile,
  InstrumentProfileCommon,
  Limb,
  PercussionProfile,
  StringedProfile,
} from '../core/instrument/index.js';
export type { MeterChange, MeterLike, MeterMap, TimeSignature } from '../core/meter/index.js';
export type {
  IntervalLike,
  IntervalQualityLabel,
  SpelledInterval,
} from '../core/pitch/index.js';
export type { PositionalRng, SeedPath } from '../core/random/index.js';
export type { KeyScale, NoteEvent } from '../core/types.js';
// ChordSpan is defined in the theory layer but appears in this layer's public
// signatures (generateProgression's return, HarmonizeResult.chords), so it is
// re-exported here: a consumer of the /generate subpath must be able to name
// every type those signatures mention.
export type {
  Chord as ChordData,
  ChordQuality,
  ChordSpan,
  ChordToneRole,
  PitchSpelling,
} from '../theory/chord/index.js';
export type { HarmonyRole } from '../theory/harmony/index.js';
export type { ProfileWeights } from '../theory/safety/index.js';
// The widened forms this layer's own signatures take: a generator accepts a key
// or a chord written as text just as the layers below it do.
export type { KeyLike } from '../theory/scale/index.js';
export type { ChordLike } from '../theory/symbol/index.js';
export type {
  BassLick,
  BassLineOptions,
  BassSegment,
  BassStyle,
  LickMaterial,
  LickNote,
  PlaceLicksOptions,
} from './bass/index.js';
export {
  BASS_LICKS,
  BASS_STYLES,
  generateBassLine,
  isLickMaterial,
  placeLicks,
} from './bass/index.js';
export type { Draw } from './context/draw.js';
export type {
  Complexity,
  GenerationContext,
  GenerationContextInput,
  ResolvedContext,
} from './context/index.js';
export {
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  resolveContext,
  sustainsShift,
  sustainsStrokes,
} from './context/index.js';
export type {
  CounterMelodyOptions,
  ImitationAnswer,
  ImitationOptions,
} from './countermelody/index.js';
export { generateCounterMelody, imitate } from './countermelody/index.js';
export type {
  DrumHit,
  DrumPattern,
  DrumPatternOptions,
  DrumRole,
  DrumStroke,
  DrumStyle,
  DrumsOptions,
  DrumVocabulary,
  DrumVoice,
  EuclideanKick,
  FillArchetype,
  FillStroke,
  FillType,
  FillVelocity,
  GrooveFeel,
  GrooveStyle,
  KickFigure,
  KickPattern,
  KickSlot,
  Section,
} from './drums/index.js';
export {
  DRUM_KIT,
  DRUM_NOTES,
  DRUM_PATTERNS,
  drumVoiceOf,
  FILL_ARCHETYPES,
  FILL_TYPES,
  generateDrums,
  isDrumPattern,
  isFillArchetype,
  KICK_FIGURES,
  KICK_STEPS,
  placeDrumPattern,
} from './drums/index.js';
export type { GrooveSlot, GrooveTemplate, HumanizeOptions } from './groove/index.js';
export { applyGrooveTemplate, extractGrooveTemplate, humanize } from './groove/index.js';
export type {
  ClassifiedMelodyTone,
  HarmonizeOptions,
  HarmonizePlacement,
  HarmonizeResult,
  MelodyNote,
  MelodyToneRole,
} from './harmonize/index.js';
export { classifyMelodyTones, harmonizeMelody } from './harmonize/index.js';
export type {
  MotifCell,
  MotifContour,
  MotifNote,
  MotifOptions,
  MotifTransform,
} from './motif/index.js';
export {
  developMotif,
  generateMotif,
  motifToNoteEvents,
  transformMotif,
} from './motif/index.js';
export type { OrnamentOptions, OrnamentStyle } from './ornament/index.js';
export { ORNAMENT_STYLES, ornament } from './ornament/index.js';
export type {
  ProgFunction,
  ProgressionDegree,
  ProgressionOptions,
  ProgressionPreset,
  ProgStyle,
} from './progression/index.js';
export {
  BORROWED_DEGREES,
  generateProgression,
  pickProgressionPreset,
  progressions,
  progressionsByStyle,
} from './progression/index.js';
export type {
  BorrowedChord,
  SubstituteOptions,
  Substitution,
  SubstitutionType,
} from './reharmony/index.js';
export {
  modalInterchangePalette,
  negativeHarmonyMirror,
  substituteChord,
} from './reharmony/index.js';
export type { RhythmEvent, RhythmOptions } from './rhythm/index.js';
export {
  generateRhythm,
  onsetWeightCurve,
  rhythmDensity,
  rhythmToNoteEvents,
} from './rhythm/index.js';
export type { DeformOptions, GridEvent } from './vocabulary/transform.js';
export {
  BAR_STEPS,
  BEAT_STEPS,
  deform,
  double,
  doubleTime,
  gridMetricWeight,
  halfTime,
  ornamentBy,
  STEP_BEATS,
  syncopate,
  thin,
  withinCeiling,
} from './vocabulary/transform.js';
export type {
  Genre,
  Provenance,
  ProvenanceBasis,
  Vocabulary,
  VocabularyQuery,
} from './vocabulary/types.js';
export {
  assertVocabulary,
  fitsQuery,
  GENRES,
  mergeVocabulary,
  PROVENANCE_BASES,
  pickVocabulary,
  selectVocabulary,
  vocabularyOfKind,
} from './vocabulary/types.js';
