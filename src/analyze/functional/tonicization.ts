/**
 * Tonicization: which degrees a key can make a local tonic, which chords point
 * at one, and which seventh qualities the minor-key leading-tone numeral
 * convention covers.
 *
 * The function layer and the numeral layer both have to answer "can this degree
 * be tonicized?", and they answered it differently for long enough that a
 * diminished seventh could read as an applied dominant in the same analysis
 * object whose numeral refused to name a target for it. The predicate lives
 * here so both read one rule, and the two layers differ only in what they are
 * allowed to differ in: the numeral never names the tonic as a target, since a
 * chord pointing there is the key's own dominant, and only the function layer
 * accepts the semitone fall a tritone substitute makes.
 */

import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import { scaleTonesInDegreeOrder } from '../../theory/scale/index.js';
import { LEADING_TONE_QUALITIES } from '../../theory/tendency/index.js';
import { borrowedSourceOf } from './borrowed.js';
import { isAppliedDominantSonority, isDiatonicChord, mod12, romanReference } from './internal.js';

/**
 * Diminished-family qualities.
 *
 * All three tonicize from a semitone below, and all three are what the bare
 * `viio` family of numerals means in a key whose seventh degree is lowered: the
 * fully diminished seventh and the half-diminished one stand on the same raised
 * leading tone and differ only in the colour of the sixth degree above it.
 */
export { LEADING_TONE_QUALITIES };

/** A degree a chord can tonicize, as both layers need to name it. */
export type TonicizableDegree = {
  /** 1-based degree number in the key's heptatonic frame. */
  degreeNumber: number;
  /** Pitch class of the degree's root. */
  rootPc: number;
  /** Whether the degree's own triad is minor, which cases its numeral. */
  lower: boolean;
};

/** The third and fifth above a scale degree, measured within its own scale. */
function degreeTriad(tones: readonly number[], index: number): { third: number; fifth: number } {
  const root = tones[index] ?? 0;
  return {
    third: mod12((tones[(index + 2) % tones.length] ?? 0) - root),
    fifth: mod12((tones[(index + 4) % tones.length] ?? 0) - root),
  };
}

/**
 * The degrees of a key that can be made a local tonic, the tonic itself last.
 *
 * A tonicized degree has to be a major or minor triad to be a tonic at all, so
 * a degree whose diatonic triad spans no perfect fifth is no target: nothing
 * tonicizes the diminished triad on the seventh degree of a major key, which is
 * why a chord standing over it is named against the home key instead (`F#7` in
 * C major is `#IV7`, not a numeral applied to `vii`).
 *
 * Degrees are read in the key's heptatonic frame, the same frame the numerals
 * are measured against, so a key with some other number of tones tonicizes the
 * degrees of its parallel major rather than none at all.
 */
export function tonicizableDegrees(key: KeyScale): TonicizableDegree[] {
  const tones = scaleTonesInDegreeOrder(romanReference(key));
  const out: TonicizableDegree[] = [];
  for (let index = 0; index < tones.length; index += 1) {
    const rootPc = tones[index];
    if (rootPc === undefined) {
      continue;
    }
    const triad = degreeTriad(tones, index);
    if (triad.fifth === 7) {
      out.push({ degreeNumber: index + 1, rootPc, lower: triad.third === 3 });
    }
  }
  return out;
}

/** Whether a pitch class is a degree of `key` that can be made a local tonic. */
function isTonicizableRoot(rootPc: number, key: KeyScale): boolean {
  return tonicizableDegrees(key).some((degree) => degree.rootPc === mod12(rootPc));
}

/**
 * The scale degree a chromatic chord tonicizes as a numeral names it, or null
 * when it tonicizes nothing.
 *
 * A dominant sonority points a fifth below itself and a diminished one a
 * semitone above itself. The tonic is never a target here: a chord pointing at
 * it is the key's own dominant, and `V/I` is a numeral no harmony text writes.
 */
export function appliedTarget(chord: Chord, key: KeyScale): TonicizableDegree | null {
  const dominant = isAppliedDominantSonority(chord);
  const leadingTone = LEADING_TONE_QUALITIES.has(chord.quality);
  if (!dominant && !leadingTone) {
    return null;
  }
  for (const degree of tonicizableDegrees(key)) {
    if (degree.degreeNumber === 1) {
      continue;
    }
    if (mod12(degree.rootPc + (dominant ? 7 : -1)) === mod12(chord.rootPc)) {
      return degree;
    }
  }
  return null;
}

/**
 * Whether a chord's interval template sounds a dominant seventh: a major third
 * with a minor seventh, whatever quality label it carries.
 *
 * The intervals are reduced first, so a third voiced as a tenth still counts.
 */
function soundsDominantSeventh(chord: Chord): boolean {
  const has = (semitones: number): boolean =>
    chord.intervals.some((interval) => mod12(interval) === semitones);
  return has(4) && has(10);
}

/**
 * Whether a chord is an applied dominant: a chromatic chord whose sonority and
 * resolution give it dominant function whatever degree it stands on.
 *
 * Three things have to hold. The chord must be chromatic to the key, since a
 * diatonic chord keeps the function of its degree. It must not be modal
 * interchange: the Picardy tonic and the major IV of a minor key are borrowed
 * from the parallel major and sound their own degrees, and reading either as an
 * applied dominant would give the tonic chord dominant function. And it must
 * point at a degree that can be a local tonic, which is the same predicate the
 * numeral layer names its target with.
 *
 * What counts as pointing depends on the sonority. A dominant seventh may fall
 * a perfect fifth — the applied dominants — or a semitone, which is the motion
 * its tritone substitute makes. A diminished-family chord must rise a semitone,
 * the leading-tone resolution; requiring that is what keeps a borrowed `iiø7`,
 * which falls a fifth like any other supertonic chord, reading as a predominant.
 * A bare major triad carries no tritone to resolve, so it only tonicizes by
 * falling a fifth onto a degree other than the tonic — a major triad a fifth
 * above the tonic is the key's own dominant, not an applied one.
 */
export function isAppliedDominant(chord: Chord, key: KeyScale): boolean {
  if (isDiatonicChord(chord, key)) {
    return false;
  }
  const source = borrowedSourceOf(chord, key);
  if (source === 'parallelMajor' || source === 'parallelMinor') {
    return false;
  }
  const root = mod12(chord.rootPc);
  const tonicizes = (step: number): boolean => isTonicizableRoot(mod12(root + step), key);
  if (soundsDominantSeventh(chord)) {
    return tonicizes(5) || tonicizes(11);
  }
  if (LEADING_TONE_QUALITIES.has(chord.quality)) {
    return tonicizes(1);
  }
  return chord.quality === 'maj' && appliedTarget(chord, key) !== null;
}
