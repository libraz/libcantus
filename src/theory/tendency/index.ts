import { pitchClassOf } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordQuality } from '../chord/index.js';
import { chordToneRole } from '../chord/index.js';

/**
 * What the leading tone is, written once.
 *
 * Four modules ask this and each had grown its own answer: the voicing search,
 * the part-writing checker, the cadence reader and the harmonizer. The answers
 * agreed until one of them was corrected, and then a voicing the generator
 * chose was reported as faulty by the checker that had not been.
 *
 * The facts live below all four rather than in any one of them: the voicing
 * module reads the counterpoint module, so the shared fact cannot live in
 * either without one importing the other back. Nothing here reaches past the
 * chord and the key, which is what makes that placement possible.
 */

/**
 * The pitch class a semitone below the tonic.
 *
 * The raised seventh whatever the key's own signature writes: a minor key
 * cadences through it, and the numeral that stands on it is spelled from it.
 */
export function leadingTonePcOf(key: KeyScale): number {
  return pitchClassOf(key.rootPc - 1);
}

/**
 * The qualities a leading-tone chord takes.
 *
 * The diminished triad and both diminished sevenths: the fully diminished and
 * the half-diminished stand on the same raised leading tone and differ only in
 * the colour of the sixth degree above it.
 */
export const LEADING_TONE_QUALITIES: ReadonlySet<ChordQuality> = new Set(['dim', 'dim7', 'm7b5']);

/** Whether a chord's quality is one a leading-tone chord takes. */
export function isLeadingToneQuality(chord: Chord): boolean {
  return LEADING_TONE_QUALITIES.has(chord.quality);
}

/**
 * Whether a chord is the key's leading-tone chord: one of the diminished
 * qualities, standing on the raised seventh degree.
 *
 * The dominant's function without the dominant's root, which is why the cadence
 * reader and the voicing search both have to agree about it.
 */
export function isLeadingToneChordOf(chord: Chord, key: KeyScale): boolean {
  return pitchClassOf(chord.rootPc) === leadingTonePcOf(key) && isLeadingToneQuality(chord);
}

/**
 * Whether the key's leading tone is functioning as one in a chord.
 *
 * The tendency is the dominant's, not the pitch class's: the leading tone must
 * rise where it is the third of a chord built on the dominant degree, or the
 * root of a leading-tone chord, which are the two places it carries dominant
 * function. The same pitch class is an ordinary chord tone elsewhere — the
 * fifth of iii, or the seventh of Imaj7 — and is free to move as the line asks,
 * which for a seventh means falling by step.
 */
export function isFunctioningLeadingTone(chord: Chord, key: KeyScale): boolean {
  const role = chordToneRole(leadingTonePcOf(key), chord);
  if (role === 'third') {
    return pitchClassOf(chord.rootPc) === pitchClassOf(key.rootPc + 7);
  }
  if (role === 'root') {
    return isLeadingToneQuality(chord);
  }
  return false;
}

/**
 * The chord's own seventh as a pitch class, or undefined when it has none.
 *
 * "Seventh" means the tone the chord itself writes as one, which is what
 * {@link chordToneRole} answers: a chord carrying its own spelling is read by
 * that spelling, so the augmented sixth of an Italian or German sixth — ten
 * semitones above the root but five letters up — is a sixth resolving outward
 * and owes nothing to the seventh's downward rule. The French sixth is rooted
 * on the supertonic, where its ten semitones really are a chordal seventh, and
 * keeps that obligation.
 */
export function seventhPcOf(chord: Chord): number | undefined {
  for (const interval of chord.intervals) {
    const pc = pitchClassOf(chord.rootPc + interval);
    if (chordToneRole(pc, chord) === 'seventh') {
      return pc;
    }
  }
  return undefined;
}

/** The chord's own fifth as a pitch class, or undefined when it has none. */
export function fifthPcOf(chord: Chord): number | undefined {
  for (const interval of chord.intervals) {
    const pc = pitchClassOf(chord.rootPc + interval);
    if (chordToneRole(pc, chord) === 'fifth') {
      return pc;
    }
  }
  return undefined;
}

/** The two thirds a frustrated leading tone may fall by, in semitones. */
const THIRD_SEMITONES: readonly number[] = [3, 4];

/**
 * Whether a leading tone that does not rise is nevertheless left the way the
 * classical norm allows: the frustrated leading tone.
 *
 * An inner voice may drop a third from the leading tone onto the fifth of the
 * arriving chord, which is what completes a triad the rising resolution would
 * leave without one — the standard answer to a complete dominant seventh
 * moving to a complete tonic. The exemption is the inner voices' alone: in the
 * bass or the top voice the leading tone is exposed and must rise, so callers
 * ask this only about a voice that is neither.
 *
 * @param fromPitch The sounding leading tone.
 * @param toPitch Where the voice went.
 * @param nextChord The chord arrived on, supplying the fifth.
 * @returns True when the voice falls a third onto that chord's fifth.
 */
export function isFrustratedLeadingTone(
  fromPitch: number,
  toPitch: number,
  nextChord: Chord,
): boolean {
  if (!THIRD_SEMITONES.includes(fromPitch - toPitch)) {
    return false;
  }
  const fifthPc = fifthPcOf(nextChord);
  return fifthPc !== undefined && pitchClassOf(toPitch) === fifthPc;
}
