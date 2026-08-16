export type { ScaleLadderPosition } from './degrees.js';
export {
  diatonicPitchClasses,
  isScaleTone,
  nearestScaleTone,
  pitchToScaleDegree,
  scaleLadderPitch,
  scaleLadderPosition,
  scaleTonesInDegreeOrder,
  shiftByScaleDegrees,
} from './degrees.js';
export { majorKey, minorKey, scaleByName } from './key.js';
export type { ScaleAliasName, ScaleName, ScaleNameInput, WorldScaleName } from './masks.js';
export {
  ALTERED_MASK,
  BLUES_MASK,
  CHROMATIC_MASK,
  DORIAN_MASK,
  DOUBLE_HARMONIC_MASK,
  HARMONIC_MINOR_MASK,
  LOCRIAN_MASK,
  LOCRIAN_NATURAL2_MASK,
  LYDIAN_DOMINANT_MASK,
  LYDIAN_MASK,
  MAJOR_MASK,
  MAJOR_PENTATONIC_MASK,
  MARWA_MASK,
  MELODIC_MINOR_MASK,
  MINOR_PENTATONIC_MASK,
  MIXOLYDIAN_B13_MASK,
  MIXOLYDIAN_MASK,
  MIYAKO_BUSHI_MASK,
  maskFromOffsets,
  NAMED_SCALES,
  NATURAL_MINOR_MASK,
  namedScaleMask,
  OCTATONIC_HALF_WHOLE_MASK,
  OCTATONIC_WHOLE_HALF_MASK,
  PHRYGIAN_DOMINANT_MASK,
  PHRYGIAN_MASK,
  PURVI_MASK,
  RITSU_MASK,
  RYUKYU_MASK,
  requireScaleMask,
  resolveScaleName,
  SCALE_ALIASES,
  TODI_MASK,
  WHOLE_TONE_MASK,
  WORLD_SCALES,
} from './masks.js';
export type { KeyRelation, SpelledKey } from './relations.js';
export {
  dominantKeyOf,
  enharmonicKeyOf,
  keyRelationBetween,
  parallelKeyOf,
  relatedKeysOf,
  relativeKeyOf,
  spelledKeyOf,
  subdominantKeyOf,
} from './relations.js';
export type { KeyMode } from './signature.js';
export { isSignatureKey, keyFromFifths, keySignatureFifths } from './signature.js';
export type { ScaleSystem } from './system.js';
export { SCALE_SYSTEMS, scaleSystemOf, supportsFunctionalHarmony } from './system.js';
