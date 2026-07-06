export type { AnalyzedNote, TheoryLabel, VoiceNote } from './analysis/index.js';
export { analyzeVoice } from './analysis/index.js';
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
export type { BassLineOptions, BassSegment, BassStyle } from './bass/index.js';
export { generateBassLine } from './bass/index.js';
export type { Chord as ChordData, ChordQuality } from './chord/index.js';
export {
  chordFromDegree,
  chordPitchClasses,
  chordQualities,
  chordToneRole,
  diatonicSeventh,
  diatonicTriad,
  makeChord,
} from './chord/index.js';
export type { ChordScaleMatch, ChordScaleReportEntry, ScaleChoice } from './chordscale/index.js';
export {
  availableTensions,
  avoidNotes,
  chordScaleReport,
  chordScales,
  scaleMatchesChord,
  scalesForChanges,
} from './chordscale/index.js';
export type { CounterMelodyOptions } from './countermelody/index.js';
export { generateCounterMelody } from './countermelody/index.js';
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
export type { ChordMatch, KeyMatch } from './detect/index.js';
export { detectChord, detectChordBest, detectKey } from './detect/index.js';
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
export type { GrooveSlot, GrooveTemplate, HumanizeOptions } from './groove/index.js';
export { applyGrooveTemplate, extractGrooveTemplate, humanize } from './groove/index.js';
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
export type { BarPosition, TimeSignature } from './meter/index.js';
export {
  barPositionToBeat,
  beatsPerBar,
  beatToBarPosition,
  formatTimeSignature,
  isCompound,
  isStrongBeat,
  metricWeight,
  parseTimeSignature,
  pulsesPerBar,
  tuplet,
} from './meter/index.js';
export { Chord, Interval, Key, Note, Progression } from './model/index.js';
export type {
  GenerateMotifOptions,
  MotifCell,
  MotifContour,
  MotifNote,
  MotifTransform,
} from './motif/index.js';
export { developMotif, generateMotif, transformMotif } from './motif/index.js';
export type { Note as NoteData, SpelledInterval } from './pitch/index.js';
export {
  formatNote,
  midiToNote,
  noteToMidi,
  noteToPitchClass,
  parseNote,
  spelledInterval,
} from './pitch/index.js';
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
export type { Rng } from './random/index.js';
export { createRng } from './random/index.js';
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
export { generateRhythm, onsetWeightCurve, rhythmDensity } from './rhythm/index.js';
export type {
  SafetyProfile,
  SafetyQuery,
  SafetyResult,
  VoiceSnapshot,
} from './safety/index.js';
export { enumerateSafePitches, evaluateSafety, NoteSafety, ReasonFlag } from './safety/index.js';
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
  spellPitchClass,
  spellPitchClasses,
  spellScale,
} from './spelling/index.js';
export { formatChordSymbol, parseChordSymbol, transposeChordSymbol } from './symbol/index.js';
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
export type { Tuning } from './tuning/index.js';
export {
  centsBetweenFreq,
  centsOfSteps,
  edo,
  frequencyOf,
  JUST_RATIOS,
  justDeviationCents,
  nearestStep,
  ratioToCents,
  TWELVE_TET,
} from './tuning/index.js';
export type { KeyScale, NoteEvent } from './types.js';
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
