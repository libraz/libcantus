/**
 * Genre vocabulary as data: the figures a player already knows, plus the rules
 * that deform them.
 *
 * See {@link Vocabulary} for the model and for the provenance rule every entry
 * is admitted under.
 */

export type {
  DeformOptions,
  GridEvent,
} from './transform.js';
export {
  BAR_STEPS,
  BEAT_STEPS,
  deform,
  double,
  doubleTime,
  halfTime,
  metricWeight,
  ornamentBy,
  STEP_BEATS,
  syncopate,
  thin,
  withinCeiling,
} from './transform.js';
export type {
  Genre,
  Provenance,
  ProvenanceBasis,
  Vocabulary,
  VocabularyQuery,
} from './types.js';
export {
  assertVocabulary,
  fitsQuery,
  GENRES,
  mergeVocabulary,
  PROVENANCE_BASES,
  pickVocabulary,
  selectVocabulary,
  vocabularyOfKind,
} from './types.js';
