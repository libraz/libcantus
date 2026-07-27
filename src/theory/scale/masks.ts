/**
 * Build a 12-bit mode mask from a list of semitone offsets above the root.
 *
 * Bit 0 (the root) is always set, enforcing the `KeyScale` invariant that the
 * root is a scale tone even when the offset list omits 0.
 *
 * @category Scales
 */
export function maskFromOffsets(offsets: readonly number[]): number {
  let mask = 1;
  for (const offset of offsets) {
    mask |= 1 << (((offset % 12) + 12) % 12);
  }
  return mask;
}

/**
 * Mode mask for the major (Ionian) scale: offsets {0, 2, 4, 5, 7, 9, 11}.
 *
 * @category Scales
 */
export const MAJOR_MASK = 0b101010110101;

/**
 * Mode mask for the natural minor (Aeolian) scale: offsets {0, 2, 3, 5, 7, 8, 10}.
 *
 * @category Scales
 */
export const NATURAL_MINOR_MASK = 0b010110101101;

/**
 * Harmonic minor: natural minor with a raised seventh — offsets {0,2,3,5,7,8,11}.
 *
 * @category Scales
 */
export const HARMONIC_MINOR_MASK = maskFromOffsets([0, 2, 3, 5, 7, 8, 11]);

/**
 * Ascending melodic minor: offsets {0,2,3,5,7,9,11}.
 *
 * @category Scales
 */
export const MELODIC_MINOR_MASK = maskFromOffsets([0, 2, 3, 5, 7, 9, 11]);

/**
 * Dorian mode: offsets {0,2,3,5,7,9,10}.
 *
 * @category Scales
 */
export const DORIAN_MASK = maskFromOffsets([0, 2, 3, 5, 7, 9, 10]);

/**
 * Phrygian mode: offsets {0,1,3,5,7,8,10}.
 *
 * @category Scales
 */
export const PHRYGIAN_MASK = maskFromOffsets([0, 1, 3, 5, 7, 8, 10]);

/**
 * Lydian mode: offsets {0,2,4,6,7,9,11}.
 *
 * @category Scales
 */
export const LYDIAN_MASK = maskFromOffsets([0, 2, 4, 6, 7, 9, 11]);

/**
 * Mixolydian mode: offsets {0,2,4,5,7,9,10}.
 *
 * @category Scales
 */
export const MIXOLYDIAN_MASK = maskFromOffsets([0, 2, 4, 5, 7, 9, 10]);

/**
 * Locrian mode: offsets {0,1,3,5,6,8,10}.
 *
 * @category Scales
 */
export const LOCRIAN_MASK = maskFromOffsets([0, 1, 3, 5, 6, 8, 10]);

/**
 * Major pentatonic: offsets {0,2,4,7,9}.
 *
 * @category Scales
 */
export const MAJOR_PENTATONIC_MASK = maskFromOffsets([0, 2, 4, 7, 9]);

/**
 * Minor pentatonic: offsets {0,3,5,7,10}.
 *
 * @category Scales
 */
export const MINOR_PENTATONIC_MASK = maskFromOffsets([0, 3, 5, 7, 10]);

/**
 * Hexatonic blues scale: minor pentatonic plus the flat-fifth — {0,3,5,6,7,10}.
 *
 * @category Scales
 */
export const BLUES_MASK = maskFromOffsets([0, 3, 5, 6, 7, 10]);

/**
 * Whole-tone scale: offsets {0,2,4,6,8,10}.
 *
 * @category Scales
 */
export const WHOLE_TONE_MASK = maskFromOffsets([0, 2, 4, 6, 8, 10]);

/**
 * Octatonic (half-step first): offsets {0,1,3,4,6,7,9,10}.
 *
 * @category Scales
 */
export const OCTATONIC_HALF_WHOLE_MASK = maskFromOffsets([0, 1, 3, 4, 6, 7, 9, 10]);

/**
 * Octatonic (whole-step first): offsets {0,2,3,5,6,8,9,11}.
 *
 * @category Scales
 */
export const OCTATONIC_WHOLE_HALF_MASK = maskFromOffsets([0, 2, 3, 5, 6, 8, 9, 11]);

/**
 * Chromatic scale: all twelve pitch classes.
 *
 * @category Scales
 */
export const CHROMATIC_MASK = 0b111111111111;

/**
 * Named scale masks addressable by {@link scaleByName}.
 *
 * @category Scales
 */
export const NAMED_SCALES = Object.freeze({
  major: MAJOR_MASK,
  ionian: MAJOR_MASK,
  naturalMinor: NATURAL_MINOR_MASK,
  aeolian: NATURAL_MINOR_MASK,
  harmonicMinor: HARMONIC_MINOR_MASK,
  melodicMinor: MELODIC_MINOR_MASK,
  dorian: DORIAN_MASK,
  phrygian: PHRYGIAN_MASK,
  lydian: LYDIAN_MASK,
  mixolydian: MIXOLYDIAN_MASK,
  locrian: LOCRIAN_MASK,
  majorPentatonic: MAJOR_PENTATONIC_MASK,
  minorPentatonic: MINOR_PENTATONIC_MASK,
  blues: BLUES_MASK,
  wholeTone: WHOLE_TONE_MASK,
  octatonicHalfWhole: OCTATONIC_HALF_WHOLE_MASK,
  octatonicWholeHalf: OCTATONIC_WHOLE_HALF_MASK,
  chromatic: CHROMATIC_MASK,
});

/**
 * The name of a built-in scale, as accepted by {@link scaleByName},
 * {@link avoidNotes}, and {@link availableTensions}.
 *
 * @category Scales
 */
export type ScaleName = keyof typeof NAMED_SCALES;

/**
 * A scale name that completes to the built-in names but still accepts any
 * string, so a caller with a name from configuration is not forced to cast.
 *
 * @category Scales
 */
export type ScaleNameInput = ScaleName | (string & {});

/**
 * The mask of a named scale, or undefined when the name is not one.
 *
 * Looking the name up through this helper is what keeps `'constructor'` or
 * `'toString'` from resolving to something inherited from `Object.prototype`
 * and producing a scale whose mask is a function.
 *
 * @param name The scale name.
 * @returns The 12-bit mask, or undefined for an unknown name.
 * @category Scales
 */
export function namedScaleMask(name: ScaleNameInput): number | undefined {
  return Object.hasOwn(NAMED_SCALES, name) ? NAMED_SCALES[name as ScaleName] : undefined;
}

/**
 * The mask of a named scale, rejecting an unknown name.
 *
 * Every public entry point that takes a scale name funnels through here, so a
 * typo is reported the same way everywhere instead of being answered with an
 * empty result that also means "this scale has none".
 *
 * @param name The scale name.
 * @param label What the name is, for the error message.
 * @returns The 12-bit mask.
 * @throws If the name is not a built-in scale.
 * @category Scales
 */
export function requireScaleMask(name: ScaleNameInput, label = 'scale'): number {
  const mask = namedScaleMask(name);
  if (mask === undefined) {
    throw new RangeError(`Unknown ${label}: ${String(name)}`);
  }
  return mask;
}
