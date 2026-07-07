/**
 * Public API of the core layer. Re-exports every core-layer module;
 * also available from the package root.
 */
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
export type { Note as NoteData, SpelledInterval } from './pitch/index.js';
export {
  formatNote,
  midiToNote,
  noteToMidi,
  noteToPitchClass,
  parseNote,
  spelledInterval,
} from './pitch/index.js';
export type { Rng } from './random/index.js';
export { createRng } from './random/index.js';
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
