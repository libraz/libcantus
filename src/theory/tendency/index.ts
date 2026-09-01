import type { SpelledInterval } from '../../core/pitch/index.js';
import { pitchClassOf } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordQuality } from '../chord/index.js';
import { chordPitchClasses, chordToneRole } from '../chord/index.js';
import { isScaleTone, majorKey, scaleTonesInDegreeOrder } from '../scale/index.js';
import { isMinorMask } from '../scale/masks.js';

/**
 * What a chord is to a key, written once: the leading tone, the dominant's own
 * sonority, the two readings — diatonic and Neapolitan — that decide whether a
 * chord belongs to the key at all, and which of the key's degrees can be made a
 * local tonic.
 *
 * Four modules ask about the leading tone and each had grown its own answer:
 * the voicing search, the part-writing checker, the cadence reader and the
 * harmonizer. The answers agreed until one of them was corrected, and then a
 * voicing the generator chose was reported as faulty by the checker that had
 * not been. The same happened to "does this sound like a dominant", which had
 * four answers — one of them a match on a quality name, so that `G13` was not a
 * dominant while `G7` was.
 *
 * The facts live below all of them rather than in any one: the voicing module
 * reads the counterpoint module, so a shared fact cannot live in either without
 * one importing the other back, and the analysis layer sits above both. Nothing
 * here reaches past the chord and the key, which is what makes that placement
 * possible.
 */

/** Whether a chord's template carries an interval, reduced to within an octave. */
function hasInterval(chord: Chord, semitones: number): boolean {
  return chord.intervals.some((interval) => pitchClassOf(interval) === semitones);
}

/**
 * Whether every pitch class of a chord belongs to the key's scale.
 *
 * The test is strict against the key's own mode mask: in a natural-minor key
 * the harmonic-minor dominant is not diatonic, since the raised leading tone
 * lies outside the mask.
 */
export function isDiatonicChord(chord: Chord, key: KeyScale): boolean {
  return chordPitchClasses(chord).every((pc) => isScaleTone(pc, key));
}

/**
 * Whether a chord's interval template carries a major third above its root.
 *
 * The interval is reduced first, so a third voiced as a tenth still counts: it
 * is the same chord tone, and a dominant spread across two octaves is heard
 * through the same leading tone as a close one.
 */
export function hasMajorThird(chord: Chord): boolean {
  return hasInterval(chord, 4);
}

/**
 * Whether a chord sounds a dominant seventh: a major third with a minor
 * seventh, whatever quality it is labelled with.
 *
 * The tritone between those two is the whole of it, so every extension and
 * alteration built over them — the ninth, the thirteenth, the altered dominant
 * — sounds the same dominant as the plain seventh and is read as one. Asking
 * the quality name instead is what let a lead sheet's `G13` stop naming its key.
 */
export function soundsDominantSeventh(chord: Chord): boolean {
  return hasMajorThird(chord) && hasInterval(chord, 10);
}

/**
 * Whether a chord has the dominant's sonority: a bare major triad, or any chord
 * sounding a dominant seventh.
 *
 * The triad belongs here because it can still tonicize by falling a fifth; what
 * it cannot do is resolve a tritone it does not have, which is why the callers
 * that need the tritone ask {@link soundsDominantSeventh} instead.
 */
export function hasDominantSonority(chord: Chord): boolean {
  return chord.quality === 'maj' || soundsDominantSeventh(chord);
}

/**
 * Whether a chord is the key's own dominant: it stands a perfect fifth above
 * the tonic and sounds the third that dominant is heard through.
 *
 * That third is the major one, which carries the leading tone, or the
 * suspension standing in its place over a seventh — a suspended chord replaces
 * the third rather than lowering it, and `V7sus4` is how gospel, pop and modal
 * jazz routinely write the dominant. The seventh is what settles the reading:
 * without it a bare `sus4` is a suspension over the fifth degree that has yet
 * to say what it is. A minor third is a different chord again: the bare `v` of
 * a natural-minor key carries no leading tone and frames nothing the tonic is
 * approached from.
 */
export function isDominantChordOf(chord: Chord, key: KeyScale): boolean {
  if (pitchClassOf(chord.rootPc - key.rootPc) !== 7) {
    return false;
  }
  if (hasMajorThird(chord)) {
    return true;
  }
  const suspended = !hasInterval(chord, 3) && (hasInterval(chord, 5) || hasInterval(chord, 2));
  return suspended && hasInterval(chord, 10);
}

/**
 * Whether a chord is the Neapolitan: a major triad on the flat second degree of
 * a key that does not have that degree already.
 *
 * The Neapolitan is an altered predominant, so it has to be an alteration. A
 * mode carrying a lowered second of its own — phrygian, locrian, and the
 * phrygian-dominant scales of flamenco and modal jazz — sounds that triad as a
 * native chord of the key, and calling it chromatic there would make the key's
 * own II a borrowing every time it appeared, exempt from the chromatic rules
 * every other diatonic chord answers to.
 */
export function isNeapolitanChordOf(chord: Chord, key: KeyScale): boolean {
  return (
    pitchClassOf(chord.rootPc - key.rootPc) === 1 &&
    chord.quality === 'maj' &&
    !isDiatonicChord(chord, key)
  );
}

/** A degree a chord can tonicize, as every layer that names one needs it. */
export type TonicizableDegree = {
  /** 1-based degree number in the key's heptatonic frame. */
  degreeNumber: number;
  /** Pitch class of the degree's root. */
  rootPc: number;
  /** Whether the degree's own triad is minor, which cases its numeral. */
  lower: boolean;
};

/** The degree whose triad the leading-tone convention makes major in a minor key. */
const DOMINANT_DEGREE = 5;

/**
 * The seven-degree frame a key's degrees are counted in.
 *
 * A degree is one of seven, so a scale with any other number of tones has no
 * degree-for-degree frame of its own and is read against its parallel major:
 * such a key still tonicizes the degrees that major gives it rather than none
 * at all.
 */
export function heptatonicFrameOf(key: KeyScale): KeyScale {
  return scaleTonesInDegreeOrder(key).length === 7 ? key : majorKey(pitchClassOf(key.rootPc));
}

/** The third and fifth above a scale degree, measured within its own scale. */
function degreeTriad(tones: readonly number[], index: number): { third: number; fifth: number } {
  const root = tones[index] ?? 0;
  return {
    third: pitchClassOf((tones[(index + 2) % tones.length] ?? 0) - root),
    fifth: pitchClassOf((tones[(index + 4) % tones.length] ?? 0) - root),
  };
}

/**
 * The degrees of a key that can be made a local tonic, in degree order.
 *
 * A tonicized degree has to be a major or minor triad to be a tonic at all, so
 * a degree whose diatonic triad spans no perfect fifth is no target: nothing
 * tonicizes the diminished triad on the seventh degree of a major key, which is
 * why a chord standing over it is named against the home key instead (`F#7` in
 * C major is `#IV7`, not a numeral applied to `vii`).
 *
 * The tonic is among them, since it is a tonic already; what may point at it is
 * the narrower question {@link appliedDominantTarget} answers.
 *
 * Degrees are read in the key's heptatonic frame, the same frame the numerals
 * are measured against, so a key with some other number of tones tonicizes the
 * degrees of its parallel major rather than none at all.
 */
export function tonicizableDegrees(key: KeyScale): TonicizableDegree[] {
  const tones = scaleTonesInDegreeOrder(heptatonicFrameOf(key));
  const minor = isMinorMask(key.modeMask12);
  const out: TonicizableDegree[] = [];
  for (let index = 0; index < tones.length; index += 1) {
    const rootPc = tones[index];
    if (rootPc === undefined) {
      continue;
    }
    const triad = degreeTriad(tones, index);
    if (triad.fifth !== 7) {
      continue;
    }
    // The case follows the numeral the target degree takes in this key, not the
    // bare scale triad: the numeral layer writes the fifth degree of a minor key
    // as a major V, since the key cadences through its raised seventh, so the
    // dominant of that degree is `V7/V` and never `V7/v`.
    const dominantDegree = minor && index + 1 === DOMINANT_DEGREE;
    out.push({ degreeNumber: index + 1, rootPc, lower: triad.third === 3 && !dominantDegree });
  }
  return out;
}

/**
 * The degree of a key an applied dominant may tonicize at a given pitch class,
 * or null where that pitch class is no target.
 *
 * The caller works out where its chord points — a dominant sonority a fifth
 * below itself, a diminished one a semitone above itself — and asks here what
 * lies there. The tonic is never a target: a chord pointing at it is the key's
 * own dominant, and `V/I` is a numeral no harmony text writes.
 *
 * One question, one answer, because the layers above ask it for different
 * reasons and must not part company over it: the analysis layer names the
 * degree a chord tonicizes, and the part-writing checker licenses the chromatic
 * tone that tonicizing brings with it. A chord exempted from the cross-relation
 * rule is one the analysis can write an applied numeral for.
 */
export function appliedDominantTarget(rootPc: number, key: KeyScale): TonicizableDegree | null {
  const target = pitchClassOf(rootPc);
  return (
    tonicizableDegrees(key).find(
      (degree) => degree.degreeNumber !== 1 && degree.rootPc === target,
    ) ?? null
  );
}

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

/**
 * Whether a written melodic interval falls by a diatonic step, which is the
 * only way a chordal seventh may be left.
 *
 * The question is about letters rather than semitones, and the two answers part
 * company exactly where the rule bites: Gb down to E spans two semitones but
 * writes a diminished third, and the seventh has not resolved. A search that
 * counted semitones would hand out a voicing its own checker rejects, so both
 * layers ask here.
 *
 * @param interval The written interval from the note left to the note reached.
 * @returns True for a descending minor or major second.
 */
export function isDescendingStep(interval: SpelledInterval): boolean {
  return interval.number === 2 && (interval.semitones === -1 || interval.semitones === -2);
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
