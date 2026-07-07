/**
 * Public API of the generate layer. Re-exports every generate-layer module;
 * also available from the package root.
 */
export type { BassLineOptions, BassSegment, BassStyle } from './bass/index.js';
export { generateBassLine } from './bass/index.js';
export type { CounterMelodyOptions } from './countermelody/index.js';
export { generateCounterMelody } from './countermelody/index.js';
export type {
  DrumHit,
  DrumRole,
  DrumsOptions,
  EuclideanKick,
  GrooveFeel,
  GrooveStyle,
  Section,
} from './drums/index.js';
export { generateDrums } from './drums/index.js';
export type { GrooveSlot, GrooveTemplate, HumanizeOptions } from './groove/index.js';
export { applyGrooveTemplate, extractGrooveTemplate, humanize } from './groove/index.js';
export type {
  HarmonizeOptions,
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
export { developMotif, generateMotif, transformMotif } from './motif/index.js';
export type {
  ChordSpan,
  ProgFunction,
  ProgressionOptions,
  ProgressionPreset,
  ProgStyle,
} from './progression/index.js';
export {
  generateProgression,
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
export { generateRhythm, onsetWeightCurve, rhythmDensity } from './rhythm/index.js';
