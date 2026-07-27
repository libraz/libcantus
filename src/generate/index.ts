/**
 * Public API of the generate layer. Re-exports every generate-layer module;
 * also available from the package root.
 */

// Types from the layers below that this layer's own signatures name, so a
// consumer importing only `@libraz/libcantus/generate` can still spell them.
export type { BorrowedSource, HarmonicFunction } from '../analyze/functional/index.js';
export type { ChordSegment, ChordTimeline } from '../analyze/timeline/index.js';
export type { TimeSignature } from '../core/meter/index.js';
export type { KeyScale, NoteEvent } from '../core/types.js';
// ChordSpan is defined in the theory layer but appears in this layer's public
// signatures (generateProgression's return, HarmonizeResult.chords), so it is
// re-exported here: a consumer of the /generate subpath must be able to name
// every type those signatures mention.
export type {
  Chord as ChordData,
  ChordQuality,
  ChordSpan,
  PitchSpelling,
} from '../theory/chord/index.js';
export type { HarmonyRole } from '../theory/harmony/index.js';
export type { BassLineOptions, BassSegment, BassStyle } from './bass/index.js';
export { BASS_STYLES, generateBassLine } from './bass/index.js';
export type { CounterMelodyOptions } from './countermelody/index.js';
export { generateCounterMelody } from './countermelody/index.js';
export type {
  DrumHit,
  DrumRole,
  DrumsOptions,
  DrumVoice,
  EuclideanKick,
  GrooveFeel,
  GrooveStyle,
  Section,
} from './drums/index.js';
export { DRUM_NOTES, drumVoiceOf, generateDrums } from './drums/index.js';
export type { GrooveSlot, GrooveTemplate, HumanizeOptions } from './groove/index.js';
export { applyGrooveTemplate, extractGrooveTemplate, humanize } from './groove/index.js';
export type {
  HarmonizeOptions,
  HarmonizePlacement,
  HarmonizeResult,
  MelodyNote,
} from './harmonize/index.js';
export { harmonizeMelody } from './harmonize/index.js';
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
