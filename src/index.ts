export type {
  ArrangementAnalysis,
  ArrangementOptions,
  ArrangementTrack,
  Conflict,
  TensionPoint,
  TrackAnalysis,
  TrackRole,
} from './analyze/arrange/index.js';
export { analyzeArrangement, tensionCurve } from './analyze/arrange/index.js';
export type { ChordMatch, KeyMatch } from './analyze/detect/index.js';
export { detectChord, detectChordBest, detectKey } from './analyze/detect/index.js';
export type {
  BorrowedSource,
  Cadence,
  ChordAnalysis,
  HarmonicFunction,
} from './analyze/functional/index.js';
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
} from './analyze/functional/index.js';
export type {
  CadenceHit,
  ChordSegment,
  ChordTimeline,
  ChordTimelineOptions,
  ChordTimelineResult,
} from './analyze/timeline/index.js';
export {
  chordTimelineFromChords,
  chordTimelineFromNotes,
  detectCadences,
} from './analyze/timeline/index.js';
export type { AnalyzedNote, TheoryLabel, VoiceNote } from './analyze/voice/index.js';
export { analyzeVoice } from './analyze/voice/index.js';
export {
  classifyInterval,
  IntervalQuality,
  isConsonantInterval,
  isPerfectInterval,
} from './core/interval/index.js';
export type { BarPosition, TimeSignature } from './core/meter/index.js';
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
} from './core/meter/index.js';
export type { Note as NoteData, SpelledInterval } from './core/pitch/index.js';
export {
  formatNote,
  midiToNote,
  noteToMidi,
  noteToPitchClass,
  parseNote,
  spelledInterval,
} from './core/pitch/index.js';
export type { Rng } from './core/random/index.js';
export { createRng } from './core/random/index.js';
export type { Tuning } from './core/tuning/index.js';
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
} from './core/tuning/index.js';
export type { KeyScale, NoteEvent } from './core/types.js';
export type { BassLineOptions, BassSegment, BassStyle } from './generate/bass/index.js';
export { generateBassLine } from './generate/bass/index.js';
export type { CounterMelodyOptions } from './generate/countermelody/index.js';
export { generateCounterMelody } from './generate/countermelody/index.js';
export type {
  DrumHit,
  DrumRole,
  DrumsOptions,
  EuclideanKick,
  GrooveFeel,
  GrooveStyle,
  Section,
} from './generate/drums/index.js';
export { generateDrums } from './generate/drums/index.js';
export type { GrooveSlot, GrooveTemplate, HumanizeOptions } from './generate/groove/index.js';
export { applyGrooveTemplate, extractGrooveTemplate, humanize } from './generate/groove/index.js';
export type {
  HarmonizeOptions,
  HarmonizeResult,
  MelodyNote,
} from './generate/harmonize/index.js';
export { harmonizeMelody } from './generate/harmonize/index.js';
export type {
  MotifCell,
  MotifContour,
  MotifNote,
  MotifOptions,
  MotifTransform,
} from './generate/motif/index.js';
export { developMotif, generateMotif, transformMotif } from './generate/motif/index.js';
export type {
  ChordSpan,
  ProgFunction,
  ProgressionOptions,
  ProgressionPreset,
  ProgStyle,
} from './generate/progression/index.js';
export {
  generateProgression,
  progressions,
  progressionsByStyle,
} from './generate/progression/index.js';
export type {
  BorrowedChord,
  SubstituteOptions,
  Substitution,
  SubstitutionType,
} from './generate/reharmony/index.js';
export {
  modalInterchangePalette,
  negativeHarmonyMirror,
  substituteChord,
} from './generate/reharmony/index.js';
export type { RhythmEvent, RhythmOptions } from './generate/rhythm/index.js';
export { generateRhythm, onsetWeightCurve, rhythmDensity } from './generate/rhythm/index.js';
export { Chord, Interval, Key, Note, Progression } from './model/index.js';
export type { Chord as ChordData, ChordQuality } from './theory/chord/index.js';
export {
  chordFromDegree,
  chordPitchClasses,
  chordQualities,
  chordToneRole,
  diatonicSeventh,
  diatonicTriad,
  makeChord,
} from './theory/chord/index.js';
export type {
  ChordScaleMatch,
  ChordScaleReportEntry,
  ScaleChoice,
} from './theory/chordscale/index.js';
export {
  availableTensions,
  avoidNotes,
  chordScaleReport,
  chordScales,
  scaleMatchesChord,
  scalesForChanges,
} from './theory/chordscale/index.js';
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
} from './theory/counterpoint/index.js';
export type { HarmonyRole, LockLevel, VoicedRole } from './theory/harmony/index.js';
export { roleOf } from './theory/harmony/index.js';
export type {
  SafetyProfile,
  SafetyQuery,
  SafetyResult,
  VoiceSnapshot,
} from './theory/safety/index.js';
export {
  enumerateSafePitches,
  evaluateSafety,
  NoteSafety,
  ReasonFlag,
} from './theory/safety/index.js';
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
} from './theory/scale/index.js';
export {
  noteNames,
  spellChord,
  spellPitchClass,
  spellPitchClasses,
  spellScale,
} from './theory/spelling/index.js';
export {
  formatChordSymbol,
  parseChordSymbol,
  transposeChordSymbol,
} from './theory/symbol/index.js';
export type {
  StyledVoicingOptions,
  VoiceRange,
  VoicingOptions,
  VoicingStyle,
} from './theory/voicing/index.js';
export {
  nextVoicing,
  SATB_RANGES,
  voiceChord,
  voiceChordStyled,
  voiceLeadingCost,
  voiceProgression,
} from './theory/voicing/index.js';
