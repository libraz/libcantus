import { InvalidInputError } from '../../core/errors/index.js';
import { assertArray, assertInteger, assertOneOf } from '../../core/validation/index.js';
import type { KeyVariant } from './kinds.js';

/**
 * Build a 12-bit mode mask from a list of semitone offsets above the root.
 *
 * Bit 0 (the root) is always set, enforcing the `KeyScale` invariant that the
 * root is a scale tone even when the offset list omits 0.
 *
 * @category Scales
 */
export function maskFromOffsets(offsets: readonly number[]): number {
  assertArray(offsets, 'offsets');
  let mask = 1;
  for (const [index, offset] of offsets.entries()) {
    assertInteger(offset, `offsets[${index}]`);
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
 * Lydian dominant (melodic minor's fourth mode): offsets {0,2,4,6,7,9,10}.
 *
 * The scale over an unaltered dominant with a raised eleventh.
 *
 * @category Scales
 */
export const LYDIAN_DOMINANT_MASK = maskFromOffsets([0, 2, 4, 6, 7, 9, 10]);

/**
 * Mixolydian b13, the aeolian dominant (melodic minor's fifth mode): offsets
 * {0,2,4,5,7,8,10}.
 *
 * The scale over a dominant with a flat thirteenth.
 *
 * @category Scales
 */
export const MIXOLYDIAN_B13_MASK = maskFromOffsets([0, 2, 4, 5, 7, 8, 10]);

/**
 * Locrian natural 2 (melodic minor's sixth mode): offsets {0,2,3,5,6,8,10}.
 *
 * The scale over a half-diminished chord used as a minor ii.
 *
 * @category Scales
 */
export const LOCRIAN_NATURAL2_MASK = maskFromOffsets([0, 2, 3, 5, 6, 8, 10]);

/**
 * The altered scale, or superlocrian (melodic minor's seventh mode): offsets
 * {0,1,3,4,6,8,10}.
 *
 * The scale over an altered dominant: every tension raised or lowered.
 *
 * @category Scales
 */
export const ALTERED_MASK = maskFromOffsets([0, 1, 3, 4, 6, 8, 10]);

/**
 * Phrygian dominant (harmonic minor's fifth mode): offsets {0,1,4,5,7,8,10}.
 *
 * The scale over the dominant of a minor key, and the characteristic sound of
 * the flamenco and maqam repertoires.
 *
 * @category Scales
 */
export const PHRYGIAN_DOMINANT_MASK = maskFromOffsets([0, 1, 4, 5, 7, 8, 10]);

/**
 * Miyako-bushi (都節), the hemitonic pentatonic of Japanese urban art music —
 * shamisen and koto song: offsets {0,1,5,7,8}.
 *
 * Two miyako-bushi tetrachords a fourth apart, in the terms of Koizumi's
 * tetrachord theory: between the two nuclear tones of each tetrachord sits a
 * note a semitone above the lower one.
 *
 * The mask fixes the pitch classes and nothing else: the repertoire's
 * intonation is not twelve-tone equal temperament, and the scale is a pair of
 * tetrachords around nuclear tones rather than a ladder of degrees above a
 * tonic. Cents and non-12 temperaments are the tuning module's business.
 *
 * @category Scales
 */
export const MIYAKO_BUSHI_MASK = maskFromOffsets([0, 1, 5, 7, 8]);

/**
 * Ritsu (律), the anhemitonic pentatonic of Japanese court music and Buddhist
 * chant: offsets {0,2,5,7,9}.
 *
 * Two ritsu tetrachords a fourth apart: the middle note sits a whole tone above
 * the lower nuclear tone. The result is the same five pitch classes as the
 * major pentatonic a fourth above, which is why the mask alone cannot say which
 * tradition is meant.
 *
 * @category Scales
 */
export const RITSU_MASK = maskFromOffsets([0, 2, 5, 7, 9]);

/**
 * Ryūkyū (琉球), the pentatonic of Okinawan music: offsets {0,4,5,7,11}.
 *
 * Two ryūkyū tetrachords a fourth apart: the middle note sits a major third
 * above the lower nuclear tone, which is what puts the two semitone steps under
 * the fourth and the octave.
 *
 * @category Scales
 */
export const RYUKYU_MASK = maskFromOffsets([0, 4, 5, 7, 11]);

/**
 * The heptatonic set with two augmented seconds: offsets {0,1,4,5,7,8,11}.
 *
 * Maqam Hijazkar in Arabic practice, thaat Bhairav in Hindustani practice, and
 * the double harmonic major scale in English-language scale lists — one
 * pitch-class set that three traditions arrived at separately and treat
 * differently.
 *
 * @category Scales
 */
export const DOUBLE_HARMONIC_MASK = maskFromOffsets([0, 1, 4, 5, 7, 8, 11]);

/**
 * Thaat Todi of Hindustani classical music — S r g M' P d N: offsets
 * {0,1,3,6,7,8,11}.
 *
 * @category Scales
 */
export const TODI_MASK = maskFromOffsets([0, 1, 3, 6, 7, 8, 11]);

/**
 * Thaat Marwa of Hindustani classical music — S r G M' P D N: offsets
 * {0,1,4,6,7,9,11}.
 *
 * The thaat carries the fifth; raga Marwa itself leaves it out, which is the
 * kind of distinction a pitch-class mask cannot make.
 *
 * @category Scales
 */
export const MARWA_MASK = maskFromOffsets([0, 1, 4, 6, 7, 9, 11]);

/**
 * Thaat Purvi of Hindustani classical music — S r G M' P d N: offsets
 * {0,1,4,6,7,8,11}.
 *
 * @category Scales
 */
export const PURVI_MASK = maskFromOffsets([0, 1, 4, 6, 7, 8, 11]);

/**
 * Named scale masks addressable by {@link scaleByName}.
 *
 * These are the scales of Western common practice and of jazz, the vocabulary
 * chord-scale theory is stated in. Scales belonging to traditions that chord
 * function does not organise live in {@link WORLD_SCALES}, which
 * {@link scaleByName} resolves just as readily; {@link scaleSystemOf} says
 * which kind a name is.
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
  lydianDominant: LYDIAN_DOMINANT_MASK,
  mixolydianB13: MIXOLYDIAN_B13_MASK,
  locrianNatural2: LOCRIAN_NATURAL2_MASK,
  altered: ALTERED_MASK,
  phrygianDominant: PHRYGIAN_DOMINANT_MASK,
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
 * Scale masks from traditions outside Western common practice, addressable by
 * {@link scaleByName} exactly as {@link NAMED_SCALES} is.
 *
 * They are kept apart from {@link NAMED_SCALES} because chord-scale theory is a
 * Western practice: a raga offered as the scale over an augmented major seventh
 * would read as an answer while being a category error. Nothing else separates
 * them — a `KeyScale` built from one of these masks behaves like any other.
 *
 * Three limits are worth stating plainly rather than leaving a caller to
 * discover:
 *
 * - A twelve-bit mask can only hold what twelve-tone equal temperament can
 *   express. The maqamat that turn on half-flat degrees — Rast, Bayati, Saba,
 *   Sikah — are therefore absent rather than approximated, and the entries that
 *   are here are not tuned the way their traditions tune them. Cents, arbitrary
 *   equal divisions and just ratios live in the tuning module.
 * - A thaat is the pitch material a raga draws on, not the raga: ascent and
 *   descent, the notes a phrase leans on, and the ornaments belong to the raga
 *   and have no place in a mask.
 * - Several of these sets are the same pitch classes as a Western mode. The
 *   name is what carries the tradition, so pass the name, not the mask,
 *   wherever the tradition matters ({@link scaleSystemOf} reads both).
 *
 * The second limit is the general case: an entry is the pitch material a
 * tradition names, never the modal system built on it. A maqam is assembled
 * from ajnas that are transposed and exchanged as a phrase moves, and Koizumi's
 * tetrachord theory describes the Japanese scales by the nuclear tones framing
 * each tetrachord, so `miyakoBushi` and `minyo` differ by tetrachord type — a
 * difference their pitch classes record without explaining. Reach for these
 * entries when a pitch set is what is wanted.
 *
 * @category Scales
 */
export const WORLD_SCALES = Object.freeze({
  /** Miyako-bushi (都節), the hemitonic pentatonic of Japanese art music. */
  miyakoBushi: MIYAKO_BUSHI_MASK,
  /** Ritsu (律), the anhemitonic pentatonic of Japanese court music and chant. */
  ritsu: RITSU_MASK,
  /**
   * Min'yō (民謡), the pentatonic of Japanese folk song, called inaka-bushi
   * (田舎節) opposite miyako-bushi. The same five pitch classes as the minor
   * pentatonic.
   */
  minyo: MINOR_PENTATONIC_MASK,
  /** Ryūkyū (琉球), the pentatonic of Okinawan music. */
  ryukyu: RYUKYU_MASK,
  /** Maqam Ajam of Arabic practice; the same pitch classes as the major scale. */
  ajam: MAJOR_MASK,
  /**
   * Maqam Nahawand of Arabic practice; the same pitch classes as the natural
   * minor, though practice raises the seventh degree at a cadence.
   */
  nahawand: NATURAL_MINOR_MASK,
  /** Maqam Kurd of Arabic practice; the same pitch classes as the phrygian mode. */
  kurd: PHRYGIAN_MASK,
  /**
   * Maqam Hijaz of Arabic practice; the same pitch classes as the phrygian
   * dominant. Played intonation stretches the augmented second beyond its
   * tempered size, which is the sound the mask cannot carry.
   */
  hijaz: PHRYGIAN_DOMINANT_MASK,
  /** Maqam Hijazkar of Arabic practice: Hijaz over Hijaz, with two augmented seconds. */
  hijazkar: DOUBLE_HARMONIC_MASK,
  /** Thaat Bilaval of Hindustani classical music; the same pitch classes as the major scale. */
  bilaval: MAJOR_MASK,
  /** Thaat Khamaj; the same pitch classes as the mixolydian mode. */
  khamaj: MIXOLYDIAN_MASK,
  /** Thaat Kafi; the same pitch classes as the dorian mode. */
  kafi: DORIAN_MASK,
  /** Thaat Asavari; the same pitch classes as the natural minor. */
  asavari: NATURAL_MINOR_MASK,
  /** Thaat Bhairavi; the same pitch classes as the phrygian mode. */
  bhairavi: PHRYGIAN_MASK,
  /** Thaat Bhairav, with komal Re and komal Dha against a natural third and seventh. */
  bhairav: DOUBLE_HARMONIC_MASK,
  /** Thaat Kalyan; the same pitch classes as the lydian mode. */
  kalyan: LYDIAN_MASK,
  /** Thaat Marwa, with komal Re and tivra Ma. */
  marwa: MARWA_MASK,
  /** Thaat Purvi, Marwa's komal Dha counterpart. */
  purvi: PURVI_MASK,
  /** Thaat Todi, with komal Re, komal Ga, komal Dha and tivra Ma. */
  todi: TODI_MASK,
});

/**
 * The name of a scale in {@link WORLD_SCALES}.
 *
 * @category Scales
 */
export type WorldScaleName = keyof typeof WORLD_SCALES;

/**
 * Alternative names that resolve to a canonical scale name.
 *
 * A scale carrying several names gets one canonical entry and its other names
 * here, so that two spellings of one tradition's scale cannot drift into two
 * entries with two masks. Transliterations vary, and one pitch-class set is
 * often named differently in different repertoires.
 *
 * @category Scales
 */
export const SCALE_ALIASES = Object.freeze({
  /** Inaka-bushi (田舎節), the name the in/yō pairing gives the min'yō scale. */
  inakaBushi: 'minyo',
  /** The Okinawan scale, the usual English name for the ryūkyū scale. */
  okinawan: 'ryukyu',
  /** Turkish spelling of Hijaz. */
  hicaz: 'hijaz',
  /** The English-language scale-list name for the Hijazkar/Bhairav set. */
  doubleHarmonic: 'hijazkar',
  /** Transliteration variant of Bilaval. */
  bilawal: 'bilaval',
  /** Transliteration variant of Marwa. */
  marva: 'marwa',
  /** Transliteration variant of Purvi. */
  poorvi: 'purvi',
} as const satisfies Readonly<Record<string, ScaleName | WorldScaleName>>);

/**
 * An alternative scale name that {@link resolveScaleName} maps to a canonical one.
 *
 * @category Scales
 */
export type ScaleAliasName = keyof typeof SCALE_ALIASES;

/**
 * A scale name that completes to the built-in names but still accepts any
 * string, so a caller with a name from configuration is not forced to cast.
 *
 * @category Scales
 */
export type ScaleNameInput = ScaleName | (string & {});

/**
 * The canonical name a scale name stands for, or undefined when it names no
 * built-in scale.
 *
 * A canonical name resolves to itself; an entry of {@link SCALE_ALIASES}
 * resolves to the name it is an alias of. The lookup goes through
 * `Object.hasOwn` for the same reason {@link namedScaleMask} does.
 *
 * @param name The scale name or alias.
 * @returns The canonical name, or undefined for an unknown one.
 * @example
 * ```ts
 * import { resolveScaleName } from '@libraz/libcantus';
 * resolveScaleName('okinawan'); // 'ryukyu'
 * resolveScaleName('dorian'); // 'dorian'
 * ```
 * @category Scales
 */
export function resolveScaleName(name: ScaleNameInput): ScaleName | WorldScaleName | undefined {
  if (Object.hasOwn(NAMED_SCALES, name)) {
    return name as ScaleName;
  }
  if (Object.hasOwn(WORLD_SCALES, name)) {
    return name as WorldScaleName;
  }
  return Object.hasOwn(SCALE_ALIASES, name) ? SCALE_ALIASES[name as ScaleAliasName] : undefined;
}

/**
 * The mask of a named scale, or undefined when the name is not one.
 *
 * Names of {@link NAMED_SCALES}, of {@link WORLD_SCALES} and of
 * {@link SCALE_ALIASES} all answer here, so a caller never has to know which
 * register a scale is kept in.
 *
 * Looking the name up through this helper is what keeps `'constructor'` or
 * `'toString'` from resolving to something inherited from `Object.prototype`
 * and producing a scale whose mask is a function.
 *
 * @param name The scale name or alias.
 * @returns The 12-bit mask, or undefined for an unknown name.
 * @category Scales
 */
export function namedScaleMask(name: ScaleNameInput): number | undefined {
  const canonical = resolveScaleName(name);
  if (canonical === undefined) {
    return undefined;
  }
  return Object.hasOwn(NAMED_SCALES, canonical)
    ? NAMED_SCALES[canonical as ScaleName]
    : WORLD_SCALES[canonical as WorldScaleName];
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
    throw new InvalidInputError(`Unknown ${label}: ${String(name)}`);
  }
  return mask;
}

/** The mask each named form stands for, and the only place that pairing is written. */
const VARIANT_MASKS: Readonly<Record<Exclude<KeyVariant, 'modal'>, number>> = {
  major: MAJOR_MASK,
  natural: NATURAL_MINOR_MASK,
  harmonic: HARMONIC_MINOR_MASK,
  melodic: MELODIC_MINOR_MASK,
};

/**
 * Whether a mode mask is a minor one: it has a minor third and no major third.
 *
 * The third is what the question rests on, so every scale that lowers it — the
 * natural, harmonic and melodic minors, dorian, phrygian, locrian — answers
 * true, and a scale carrying both thirds answers false because the major one
 * is the one the ear takes. Written here, below the layers that ask it: the key
 * signature, the key relations, harmonic function and the generators all branch
 * on it, and an answer that differed between two of them would put a chord in a
 * key whose own signature disagreed about its mode.
 *
 * @param modeMask12 The twelve-bit mode mask to read.
 * @returns True when the mask leans minor.
 * @category Scales
 */
export function isMinorMask(modeMask12: number): boolean {
  return ((modeMask12 >> 3) & 1) === 1 && ((modeMask12 >> 4) & 1) === 0;
}

/**
 * The form a mask stands in, when it stands in one.
 *
 * A bare scale still names its form — a major mask is a major key whoever built
 * it — so the form is read from the mask rather than defaulted away. Only a
 * mask matching none of the four is modal.
 */
export function variantOfMask(modeMask12: number): KeyVariant {
  for (const [variant, mask] of Object.entries(VARIANT_MASKS)) {
    if (mask === modeMask12) {
      return variant as KeyVariant;
    }
  }
  return 'modal';
}

/** Every value a key's variant may hold, in a fixed order. */
const KEY_VARIANTS: readonly KeyVariant[] = [
  ...(Object.keys(VARIANT_MASKS) as Exclude<KeyVariant, 'modal'>[]),
  'modal',
];

/**
 * Refuse a scale form the key's own mask does not hold.
 *
 * A key whose variant says `'harmonic'` over a major mask prints as a harmonic
 * minor while comparing equal to plain C major, so a project file that carried
 * the two apart is refused where the mismatch is still an argument. Kept beside
 * the type it validates: the pairing of form and mask is written once, and
 * every construction path reads that one.
 *
 * @param variant The form claimed for the key.
 * @param modeMask12 The mask the key actually holds.
 * @throws If the form is not one a key may stand in, or the mask does not hold it.
 * @category Scales
 */
export function assertKeyVariant(variant: KeyVariant, modeMask12: number): void {
  assertOneOf(variant, KEY_VARIANTS, 'variant');
  const named = VARIANT_MASKS[variant as Exclude<KeyVariant, 'modal'>];
  const matches =
    named === undefined ? !Object.values(VARIANT_MASKS).includes(modeMask12) : named === modeMask12;
  if (!matches) {
    throw new InvalidInputError(
      `variant ${variant} does not match the scale mask ${modeMask12}; ` +
        'pass the scale that variant names, or omit the variant',
    );
  }
}
