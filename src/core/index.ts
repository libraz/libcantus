/**
 * Public API of the core layer. Re-exports every core-layer module;
 * also available from the package root.
 */

export type { IndexedNoteEvent, NoteEventIndex } from './event-index/index.js';
export { createNoteEventIndex } from './event-index/index.js';
export {
  ConsonanceClass,
  classifyInterval,
  isConsonantInterval,
  isPerfectInterval,
} from './interval/index.js';
export type { BarPosition, TimeSignature } from './meter/index.js';
export {
  barPositionToBeat,
  barPositionToPulse,
  beatsPerBar,
  beatToBarPosition,
  formatBarPosition,
  formatTimeSignature,
  isCompound,
  isStrongBeat,
  metricWeight,
  parseTimeSignature,
  pulseBeats,
  pulsesPerBar,
  tuplet,
} from './meter/index.js';
export type { IntervalQualityLabel, Note as NoteData, SpelledInterval } from './pitch/index.js';
export {
  diatonicLetterOf,
  formatNote,
  intervalSemitones,
  midiToNote,
  naturalPitchClassOf,
  noteToMidi,
  noteToPitchClass,
  parseInterval,
  parseNote,
  pitchClassOf,
  spelledInterval,
  transposeByInterval,
  transposeNote,
} from './pitch/index.js';
export type { Rng } from './random/index.js';
export { createRng } from './random/index.js';
export type { Tuning } from './tuning/index.js';
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
  assertFiniteNumber,
  assertGenerationBudget,
  assertInteger,
  assertNoteEvent,
  assertNoteEvents,
  assertOneOf,
  assertPositiveInt,
  assertRange,
  assertTimeSignature,
  DEFAULT_GENERATION_BUDGET,
  dropSilentNotes,
} from './validation/index.js';
