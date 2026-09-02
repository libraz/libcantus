/**
 * Instrument profiles and the three layers of playability.
 *
 * An instrument is described by what it physically is — an open-string tuning
 * and a fret count, or the voices each limb reaches — so its range is derived
 * rather than stored. {@link playability} reads a passage against such a profile
 * and reports what stands in the way, without ever rewriting or rejecting it;
 * {@link foldIntoRange} is the one transformation, and it is the one a player
 * makes anyway.
 */

export type { Articulation } from './articulation.js';
export { ARTICULATIONS } from './articulation.js';
export type {
  NotePlacement,
  PlayabilityIssue,
  PlayabilityIssueType,
  PlayabilityLayer,
  PlayabilityReport,
} from './playability.js';
export { playability } from './playability.js';
export type {
  InstrumentProfile,
  InstrumentProfileCommon,
  InstrumentProfileLike,
  Limb,
  PercussionProfile,
  StringedProfile,
  StringFingering,
  ValidatedPercussionProfile,
  ValidatedProfile,
  ValidatedStringedProfile,
} from './profile.js';
export {
  canSound,
  fingeringsFor,
  foldIntoRange,
  instrumentRange,
  LIMBS,
  toInstrumentProfile,
  toStringedProfile,
} from './profile.js';
export {
  BASS_4_STRING,
  BASS_5_STRING,
  GUITAR_DROP_D,
  GUITAR_STANDARD,
} from './profiles.js';
