/**
 * Counterpoint predicates: each judges one pair of voices at one moment.
 *
 * Every predicate reads spelled notes, because spelling is what decides two of
 * these rules. An augmented second and a minor third span the same three
 * semitones, and a diminished fourth sounds like a major third; the first is a
 * forbidden melodic leap and the second a vertical dissonance, and neither can
 * be seen in a MIDI integer. {@link createsVerticalDissonance} and
 * {@link isForbiddenMelodicLeap} therefore answer the spelled question when
 * given spelled notes, and the sounding question — all a bare pitch can support
 * — when given integers. {@link isAugmentedMelodicInterval} asks a question that
 * has no sounding half at all, so its integer form answers false rather than
 * refusing the call: every predicate here takes either form, and the ones that
 * need spelling say so by degrading.
 *
 * The remaining rules compare registers or perfect classes, which spelling
 * cannot change: a parallel fifth is a parallel fifth however the two voices are
 * written. Those keep their integer form as an equal partner.
 */

import { ConsonanceClass, isConsonantInterval } from '../../core/interval/index.js';
import type { Note, SpelledInterval } from '../../core/pitch/index.js';
import { pitchClassOf as pitchClass, spelledInterval } from '../../core/pitch/index.js';
import { type KeyLike, toKeyScale } from '../scale/index.js';
import { classifySpelledInterval, pitchOf, simpleIntervalNumber } from './internal.js';

/**
 * Whether an upper voice has crossed below a lower voice.
 *
 * @param upper The nominally higher voice.
 * @param lower The nominally lower voice.
 * @returns True when the upper voice sits below the lower voice.
 * @category Voicing & Counterpoint
 */
export function createsVoiceCrossing(upper: Note, lower: Note): boolean;
export function createsVoiceCrossing(upper: number, lower: number): boolean;
export function createsVoiceCrossing(upper: number | Note, lower: number | Note): boolean {
  return pitchOf(upper) < pitchOf(lower);
}

/**
 * Whether two simultaneous voices form a dissonance.
 *
 * Given spelled notes the spelling decides, so a diminished fourth reads as the
 * dissonance it is. Given MIDI integers only the sounding interval is available,
 * which cannot tell that fourth from a major third; use the spelled form
 * wherever the exercise is written in notes.
 *
 * @param a First voice.
 * @param b Second voice.
 * @param twoVoice When true, the perfect fourth counts as dissonant.
 * @returns True when the vertical interval is dissonant.
 * @example
 * ```ts
 * import { createsVerticalDissonance, parseNote } from '@libraz/libcantus';
 * createsVerticalDissonance(parseNote('Fb4'), parseNote('C4'), true); // true — d4
 * createsVerticalDissonance(64, 60, true); // false — the same pitches read as a major third
 * ```
 * @category Voicing & Counterpoint
 */
export function createsVerticalDissonance(a: Note, b: Note, twoVoice: boolean): boolean;
export function createsVerticalDissonance(a: number, b: number, twoVoice: boolean): boolean;
export function createsVerticalDissonance(
  a: number | Note,
  b: number | Note,
  twoVoice: boolean,
): boolean {
  if (typeof a !== 'number' && typeof b !== 'number') {
    // The interval number and quality are the same read either way round, so the
    // argument order only decides a sign the classification never looks at.
    return classifySpelledInterval(spelledInterval(a, b), twoVoice) === ConsonanceClass.Dissonance;
  }
  return !isConsonantInterval(pitchOf(a) - pitchOf(b), twoVoice);
}

/**
 * Whether a melodic move is a forbidden leap.
 *
 * Forbidden are the seventh in either quality, any leap wider than an octave,
 * and — where the spelling is known — every augmented and diminished interval,
 * the augmented second of the harmonic minor among them. Given MIDI integers the
 * tritone is still caught, since it is forbidden under either spelling, but an
 * augmented second is indistinguishable from a minor third and passes.
 *
 * The raw distance is used for the octave check, so a compound leap is not
 * reduced to its simple class first.
 *
 * @param prev Starting note.
 * @param cur Ending note.
 * @returns True when the leap is forbidden in strict counterpoint.
 * @example
 * ```ts
 * import { isForbiddenMelodicLeap, parseNote } from '@libraz/libcantus';
 * isForbiddenMelodicLeap(parseNote('Ab4'), parseNote('B4')); // true — augmented second
 * isForbiddenMelodicLeap(68, 71); // false — the same pitches read as a minor third
 * ```
 * @category Voicing & Counterpoint
 */
export function isForbiddenMelodicLeap(prev: Note, cur: Note): boolean;
export function isForbiddenMelodicLeap(prev: number, cur: number): boolean;
export function isForbiddenMelodicLeap(prev: number | Note, cur: number | Note): boolean {
  if (typeof prev !== 'number' && typeof cur !== 'number') {
    const interval = spelledInterval(prev, cur);
    if (Math.abs(interval.semitones) > 12 || interval.number > 8) {
      return true;
    }
    if (simpleIntervalNumber(interval.number) === 7) {
      return true;
    }
    return isAlteredInterval(interval);
  }
  const semis = Math.abs(pitchOf(cur) - pitchOf(prev));
  return semis === 6 || semis === 10 || semis === 11 || semis > 12;
}

/** Whether a spelled interval is augmented or diminished rather than plain. */
function isAlteredInterval(interval: SpelledInterval): boolean {
  // The altered unison is left out: a chromatic inflection of the note a voice
  // already holds is ordinary voice leading, not a leap at all.
  return interval.number >= 2 && (interval.quality.startsWith('A') || interval.quality[0] === 'd');
}

/**
 * Whether a voice moves by an augmented interval — the melodic step no
 * sixteenth-century line takes, and the one a MIDI integer cannot show.
 *
 * The augmented unison is excluded: raising or lowering the note a voice already
 * holds is a chromatic inflection, not a leap.
 *
 * Every augmented interval sounds like a plain one — the augmented second like a
 * minor third, the augmented fourth like a diminished fifth — so MIDI integers
 * carry nothing this rule can read, and the numeric form always answers false.
 * It exists so a host can run the whole predicate set over a bare pitch pair;
 * take the spelled form wherever the exercise is written in notes.
 *
 * @param prev Starting note.
 * @param cur Ending note.
 * @returns True when the move spans an augmented second or wider.
 * @example
 * ```ts
 * import { isAugmentedMelodicInterval, parseNote } from '@libraz/libcantus';
 * isAugmentedMelodicInterval(parseNote('Ab4'), parseNote('B4')); // true — A2 in C minor
 * isAugmentedMelodicInterval(parseNote('A4'), parseNote('C5')); // false — m3
 * isAugmentedMelodicInterval(68, 71); // false — the same pitches carry no spelling
 * ```
 * @category Voicing & Counterpoint
 */
export function isAugmentedMelodicInterval(prev: Note, cur: Note): boolean;
export function isAugmentedMelodicInterval(prev: number, cur: number): boolean;
export function isAugmentedMelodicInterval(prev: number | Note, cur: number | Note): boolean {
  if (typeof prev === 'number' || typeof cur === 'number') {
    return false;
  }
  const interval = spelledInterval(prev, cur);
  return interval.number >= 2 && interval.quality.startsWith('A');
}

/** Reduce an interval to its simple class in [0, 11]. */
function simpleClass(semitones: number): number {
  return pitchClass(Math.abs(semitones));
}

/** Whether a simple interval class is a perfect kind (unison/octave or fifth). */
function isPerfectClass(cls: number): boolean {
  return cls === 0 || cls === 7;
}

/** Whether two voices move in the same direction (similar or parallel motion). */
function similarMotion(aMove: number, bMove: number): boolean {
  return aMove !== 0 && bMove !== 0 && aMove > 0 === bMove > 0;
}

/** Whether both voices actually move (neither is stationary — excludes oblique motion). */
function bothVoicesMove(aMove: number, bMove: number): boolean {
  return aMove !== 0 && bMove !== 0;
}

/**
 * Whether two voices move into consecutive perfect intervals of the same kind
 * (fifth-to-fifth, octave-to-octave, unison-to-unison).
 *
 * Both true parallels (similar motion) and anti-parallels — the same perfect
 * class reached by contrary motion, e.g. octave to octave with the voices moving
 * in opposite directions — are flagged, as both are forbidden in strict two-voice
 * counterpoint. The rule requires that both voices actually move: oblique motion
 * (either voice stationary) and the no-change case (identical pitches) are excluded.
 *
 * A fifth expanding to a twelfth counts (same perfect class); a fifth moving to
 * an octave does not (different perfect kinds — the direct/hidden case owned by
 * {@link createsHiddenParallelPerfect}).
 *
 * The perfect classes are what they sound like under any spelling, so spelled
 * notes and MIDI integers give the same answer here.
 *
 * @category Voicing & Counterpoint
 */
export function createsParallelPerfect(aPrev: Note, aCur: Note, bPrev: Note, bCur: Note): boolean;
export function createsParallelPerfect(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean;
export function createsParallelPerfect(
  aPrev: number | Note,
  aCur: number | Note,
  bPrev: number | Note,
  bCur: number | Note,
): boolean {
  const a0 = pitchOf(aPrev);
  const a1 = pitchOf(aCur);
  const b0 = pitchOf(bPrev);
  const b1 = pitchOf(bCur);
  if (!bothVoicesMove(a1 - a0, b1 - b0)) {
    return false;
  }
  const nowClass = simpleClass(a1 - b1);
  const prevClass = simpleClass(a0 - b0);
  return isPerfectClass(nowClass) && nowClass === prevClass;
}

/**
 * Whether two voices move in consecutive parallel octaves (or unisons) by
 * similar motion.
 *
 * This is a strict subset of {@link createsParallelPerfect}: a similar-motion
 * octave-to-octave is the perfect-class-zero case that predicate already flags
 * (and it additionally catches the contrary-motion anti-parallel). Callers that
 * tally parallel violations should therefore use {@link createsParallelPerfect}
 * alone to avoid double counting; this predicate remains for callers wanting a
 * dedicated similar-motion octave test.
 *
 * @category Voicing & Counterpoint
 */
export function createsParallelOctave(aPrev: Note, aCur: Note, bPrev: Note, bCur: Note): boolean;
export function createsParallelOctave(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean;
export function createsParallelOctave(
  aPrev: number | Note,
  aCur: number | Note,
  bPrev: number | Note,
  bCur: number | Note,
): boolean {
  const a0 = pitchOf(aPrev);
  const a1 = pitchOf(aCur);
  const b0 = pitchOf(bPrev);
  const b1 = pitchOf(bCur);
  if (!similarMotion(a1 - a0, b1 - b0)) {
    return false;
  }
  return simpleClass(a1 - b1) === 0 && simpleClass(a0 - b0) === 0;
}

/**
 * Whether two voices move in consecutive parallel unisons — both landing on the
 * same pitch, having shared a pitch on the previous move.
 *
 * @category Voicing & Counterpoint
 */
export function createsParallelUnison(aPrev: Note, aCur: Note, bPrev: Note, bCur: Note): boolean;
export function createsParallelUnison(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean;
export function createsParallelUnison(
  aPrev: number | Note,
  aCur: number | Note,
  bPrev: number | Note,
  bCur: number | Note,
): boolean {
  const a0 = pitchOf(aPrev);
  const a1 = pitchOf(aCur);
  const b0 = pitchOf(bPrev);
  const b1 = pitchOf(bCur);
  if (a1 === a0 || b1 === b0) {
    return false;
  }
  return a1 === b1 && a0 === b0;
}

/**
 * Whether two voices reach a perfect interval by similar motion from an
 * imperfect one (a hidden/direct fifth or octave).
 *
 * How strictly the approach is judged is the caller's to say, because the two
 * textures do not agree about it:
 *
 * - `fourPart` (the default) applies the step exception of the chorale — the
 *   approach is allowed when the upper of the two voices moves by step, so only
 *   leaps into the perfect interval are flagged. That exception is written for
 *   the outer voices of a four-part texture, where the other two cover the
 *   arrival.
 * - `twoVoice` exempts no approach. With nothing between them, two voices
 *   moving the same way into a perfect fifth or octave expose it however the
 *   upper one got there, and strict sixteenth-century writing forbids it
 *   outright.
 *
 * @param strictness Which reading to judge the approach by.
 * @category Voicing & Counterpoint
 */
export function createsHiddenParallelPerfect(
  aPrev: Note,
  aCur: Note,
  bPrev: Note,
  bCur: Note,
  strictness?: 'fourPart' | 'twoVoice',
): boolean;
export function createsHiddenParallelPerfect(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
  strictness?: 'fourPart' | 'twoVoice',
): boolean;
export function createsHiddenParallelPerfect(
  aPrev: number | Note,
  aCur: number | Note,
  bPrev: number | Note,
  bCur: number | Note,
  strictness: 'fourPart' | 'twoVoice' = 'fourPart',
): boolean {
  const a0 = pitchOf(aPrev);
  const a1 = pitchOf(aCur);
  const b0 = pitchOf(bPrev);
  const b1 = pitchOf(bCur);
  const aMove = a1 - a0;
  const bMove = b1 - b0;
  if (!similarMotion(aMove, bMove)) {
    return false;
  }
  const nowClass = simpleClass(a1 - b1);
  const prevClass = simpleClass(a0 - b0);
  // Approaching the same perfect class (e.g. fifth to fifth) is a true parallel
  // owned by createsParallelPerfect; approaching a different perfect interval
  // (fifth to octave, or vice versa) is the hidden/direct case flagged here.
  if (!isPerfectClass(nowClass) || prevClass === nowClass) {
    return false;
  }
  const upperMove = a1 >= b1 ? aMove : bMove;
  if (strictness === 'fourPart' && Math.abs(upperMove) <= 2) {
    return false; // upper voice moves by step — direct interval is acceptable
  }
  return true;
}

/**
 * Whether two voices arrive at a perfect octave or unison by contrary motion
 * with the upper voice leaping down — the *ottava battuta* the sixteenth-century
 * theorists forbid.
 *
 * The stepwise arrival is allowed, as is the same octave reached with the upper
 * voice rising, so only the downward leap into the perfect class is flagged.
 *
 * @category Voicing & Counterpoint
 */
export function createsBattuta(aPrev: Note, aCur: Note, bPrev: Note, bCur: Note): boolean;
export function createsBattuta(aPrev: number, aCur: number, bPrev: number, bCur: number): boolean;
export function createsBattuta(
  aPrev: number | Note,
  aCur: number | Note,
  bPrev: number | Note,
  bCur: number | Note,
): boolean {
  const a0 = pitchOf(aPrev);
  const a1 = pitchOf(aCur);
  const b0 = pitchOf(bPrev);
  const b1 = pitchOf(bCur);
  const aMove = a1 - a0;
  const bMove = b1 - b0;
  if (!bothVoicesMove(aMove, bMove) || similarMotion(aMove, bMove)) {
    return false;
  }
  if (simpleClass(a1 - b1) !== 0) {
    return false;
  }
  const upperMove = a1 >= b1 ? aMove : bMove;
  return upperMove < -2;
}

/**
 * Whether two voices overlap: the upper voice descends below where the lower
 * voice just was, or the lower voice rises above where the upper voice just was.
 * Distinct from a simultaneous voice crossing.
 *
 * @param upperPrev Previous note of the upper voice.
 * @param upperCur Current note of the upper voice.
 * @param lowerPrev Previous note of the lower voice.
 * @param lowerCur Current note of the lower voice.
 * @category Voicing & Counterpoint
 */
export function createsVoiceOverlap(
  upperPrev: Note,
  upperCur: Note,
  lowerPrev: Note,
  lowerCur: Note,
): boolean;
export function createsVoiceOverlap(
  upperPrev: number,
  upperCur: number,
  lowerPrev: number,
  lowerCur: number,
): boolean;
export function createsVoiceOverlap(
  upperPrev: number | Note,
  upperCur: number | Note,
  lowerPrev: number | Note,
  lowerCur: number | Note,
): boolean {
  const u0 = pitchOf(upperPrev);
  const u1 = pitchOf(upperCur);
  const l0 = pitchOf(lowerPrev);
  const l1 = pitchOf(lowerCur);
  return u1 < l0 || l1 > u0;
}

/**
 * Whether two adjacent upper voices are spaced more than a maximum apart
 * (commonly an octave). Bass-to-tenor spacing is conventionally exempt, so this
 * is meant for the upper voice pairs.
 *
 * @param upper The higher voice.
 * @param lower The lower voice.
 * @param maxSemitones Maximum allowed spacing in semitones (default an octave).
 * @category Voicing & Counterpoint
 */
export function exceedsSpacing(upper: Note, lower: Note, maxSemitones?: number): boolean;
export function exceedsSpacing(upper: number, lower: number, maxSemitones?: number): boolean;
export function exceedsSpacing(
  upper: number | Note,
  lower: number | Note,
  maxSemitones = 12,
): boolean {
  return Math.abs(pitchOf(upper) - pitchOf(lower)) > maxSemitones;
}

/**
 * Whether a leading tone resolves correctly upward to the tonic.
 *
 * @param prev The leading-tone note.
 * @param cur The following note.
 * @param key Key context supplying the tonic.
 * @returns True when `prev` is the leading tone and `cur` is the tonic a step above.
 * @category Voicing & Counterpoint
 */
export function isLeadingToneResolution(prev: Note, cur: Note, key: KeyLike): boolean;
export function isLeadingToneResolution(prev: number, cur: number, key: KeyLike): boolean;
export function isLeadingToneResolution(
  prev: number | Note,
  cur: number | Note,
  key: KeyLike,
): boolean {
  const prevPitch = pitchOf(prev);
  const curPitch = pitchOf(cur);
  const tonic = pitchClass(toKeyScale(key).rootPc);
  const leading = (tonic + 11) % 12;
  if (pitchClass(prevPitch) !== leading || pitchClass(curPitch) !== tonic) {
    return false;
  }
  return curPitch > prevPitch && curPitch - prevPitch <= 2;
}

export type { VoiceIndependenceOptions, VoiceIndependenceReport } from './independence.js';
export { voiceIndependence } from './independence.js';
export { classifySpelledInterval } from './internal.js';
