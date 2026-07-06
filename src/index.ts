export type { AnalyzedNote, TheoryLabel, VoiceNote } from './analysis/index.js';
export { analyzeVoice } from './analysis/index.js';
export type { Chord, ChordQuality } from './chord/index.js';
export { chordFromDegree, chordPitchClasses, chordToneRole, makeChord } from './chord/index.js';
export {
  createsHiddenParallelPerfect,
  createsParallelOctave,
  createsParallelPerfect,
  createsVerticalDissonance,
  createsVoiceCrossing,
  isForbiddenMelodicLeap,
  isLeadingToneResolution,
} from './counterpoint/index.js';
export type {
  DrumGenOptions,
  DrumHit,
  DrumRole,
  GrooveFeel,
  GrooveStyle,
  Section,
} from './drums/index.js';
export { generateDrums } from './drums/index.js';
export type {
  HarmonizeOptions,
  HarmonizeResult,
  MelodyNote,
} from './harmonize/index.js';
export { harmonizeMelody } from './harmonize/index.js';
export type { HarmonyRole, LockLevel, VoicedRole } from './harmony/index.js';
export { roleOf } from './harmony/index.js';
export {
  classifyInterval,
  IntervalQuality,
  isConsonantInterval,
  isPerfectInterval,
} from './interval/index.js';
export type {
  GenerateMotifOptions,
  MotifCell,
  MotifContour,
  MotifNote,
  MotifTransform,
} from './motif/index.js';
export { developMotif, generateMotif, transformMotif } from './motif/index.js';
export type {
  GeneratedChord,
  GenerateProgressionOptions,
  ProgFunction,
  ProgressionPreset,
  ProgStyle,
} from './progression/index.js';
export {
  generateProgression,
  progressions,
  progressionsByStyle,
} from './progression/index.js';
export type {
  SafetyProfile,
  SafetyQuery,
  SafetyResult,
  VoiceSnapshot,
} from './safety/index.js';
export { enumerateSafePitches, evaluateSafety, NoteSafety, ReasonFlag } from './safety/index.js';
export {
  diatonicPitchClasses,
  isScaleTone,
  MAJOR_MASK,
  majorKey,
  NATURAL_MINOR_MASK,
  nearestScaleTone,
  pitchToScaleDegree,
  scaleTonesInDegreeOrder,
} from './scale/index.js';
export type { ChordSegment, ChordTimeline } from './timeline/index.js';
export { chordTimelineFromChords } from './timeline/index.js';
export type { KeyScale } from './types.js';
