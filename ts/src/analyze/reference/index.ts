/**
 * Aggregate of the reference module.
 *
 * The public surface — the profile, its validator, and the comparison — is
 * also re-exported from `analyze/index.ts` and the package root. The rest
 * exists for the model layer and for `compareReferences`' own measures to
 * share: `referenceFromReadings` is what {@link Score.reference} and
 * {@link Arrangement.reference} build a profile from without inferring the
 * harmony a second time, and the measures in `measures.ts` are what a v1.4
 * evaluation reads a candidate against, not entry points of their own.
 */

export type { ReferenceComparison, ReferenceComparisonOptions } from './compare.js';
export { compareReferences } from './compare.js';
export * from './measures.js';
export type { ReferenceProfileOptions, ReferenceReadings } from './profile.js';
export { analyzeReference, readingsFor, referenceFromReadings } from './profile.js';
export type {
  ReferenceCadence,
  ReferenceChord,
  ReferenceForm,
  ReferenceHarmony,
  ReferenceKeyRegion,
  ReferenceMelody,
  ReferenceMotif,
  ReferencePhrase,
  ReferencePhraseMelody,
  ReferenceProfile,
} from './types.js';
export { REFERENCE_PROFILE_VERSION } from './types.js';
export { assertReferenceProfile } from './validate.js';
