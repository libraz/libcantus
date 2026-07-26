/**
 * Public API of the theory layer. Re-exports every theory-layer module;
 * also available from the package root.
 */

// Types from the layers below that this layer's own signatures name, so a
// consumer importing only `@libraz/libcantus/theory` can still spell them.
export type { Note as NoteData } from '../core/pitch/index.js';
export type { KeyScale } from '../core/types.js';
export type {
  Chord as ChordData,
  ChordQuality,
  ChordSpan,
  PitchSpelling,
} from './chord/index.js';
export {
  chordFromDegree,
  chordPitchClasses,
  chordQualities,
  chordToneRole,
  diatonicSeventh,
  diatonicTriad,
  makeChord,
  transposeChord,
} from './chord/index.js';
export type {
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
export {
  createsHiddenParallelPerfect,
  createsParallelOctave,
  createsParallelPerfect,
  createsParallelUnison,
  createsVerticalDissonance,
  createsVoiceCrossing,
  createsVoiceOverlap,
  exceedsSpacing,
  isForbiddenMelodicLeap,
  isLeadingToneResolution,
} from './counterpoint/index.js';
export type { HarmonyRole, LockLevel, VoicedRole } from './harmony/index.js';
export { roleOf } from './harmony/index.js';
export type {
  EvaluateSafetyOptions,
  SafetyProfile,
  SafetyQuery,
  SafetyResult,
  VoiceSnapshot,
} from './safety/index.js';
export {
  enumerateSafePitches,
  evaluateSafety,
  NoteSafety,
  ReasonFlag,
} from './safety/index.js';
export {
  BLUES_MASK,
  CHROMATIC_MASK,
  DORIAN_MASK,
  diatonicPitchClasses,
  HARMONIC_MINOR_MASK,
  isScaleTone,
  LOCRIAN_MASK,
  LYDIAN_MASK,
  MAJOR_MASK,
  MAJOR_PENTATONIC_MASK,
  MELODIC_MINOR_MASK,
  MINOR_PENTATONIC_MASK,
  MIXOLYDIAN_MASK,
  majorKey,
  maskFromOffsets,
  minorKey,
  NAMED_SCALES,
  NATURAL_MINOR_MASK,
  namedScaleMask,
  nearestScaleTone,
  OCTATONIC_HALF_WHOLE_MASK,
  OCTATONIC_WHOLE_HALF_MASK,
  PHRYGIAN_MASK,
  pitchToScaleDegree,
  scaleByName,
  scaleTonesInDegreeOrder,
  WHOLE_TONE_MASK,
} from './scale/index.js';
export {
  noteNames,
  spellChord,
  spellChordFromRoot,
  spellPitch,
  spellPitchClass,
  spellPitchClasses,
  spellScale,
} from './spelling/index.js';
export {
  formatChordSymbol,
  parseChordSymbol,
  transposeChordSymbol,
} from './symbol/index.js';
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
