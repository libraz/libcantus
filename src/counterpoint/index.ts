import { isConsonantInterval } from '../interval/index.js';
import type { KeyScale } from '../types.js';

/** Reduce a MIDI pitch (or pitch class) to a pitch class in [0, 11]. */
function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

/**
 * Whether an upper voice has crossed below a lower voice.
 *
 * @param upperPitch Pitch of the nominally higher voice.
 * @param lowerPitch Pitch of the nominally lower voice.
 * @returns True when the upper voice sits below the lower voice.
 */
export function createsVoiceCrossing(upperPitch: number, lowerPitch: number): boolean {
  return upperPitch < lowerPitch;
}

/**
 * Whether two simultaneous pitches form a dissonance.
 *
 * @param a First pitch.
 * @param b Second pitch.
 * @param twoVoice When true, the perfect fourth counts as dissonant.
 * @returns True when the vertical interval is dissonant.
 */
export function createsVerticalDissonance(a: number, b: number, twoVoice: boolean): boolean {
  return !isConsonantInterval(a - b, twoVoice);
}

/**
 * Whether a melodic move is a forbidden leap: a tritone, either seventh (minor
 * or major), or any leap wider than an octave.
 *
 * Operates on the raw absolute distance, so compound leaps are not reduced to
 * their simple class before the octave check.
 *
 * @param prev Starting pitch.
 * @param cur Ending pitch.
 * @returns True when the leap is forbidden in strict counterpoint.
 */
export function isForbiddenMelodicLeap(prev: number, cur: number): boolean {
  const semis = Math.abs(cur - prev);
  return semis === 6 || semis === 10 || semis === 11 || semis > 12;
}

/** Reduce an interval to its simple class in [0, 11]. */
function simpleClass(semitones: number): number {
  return Math.abs(semitones) % 12;
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
 */
export function createsParallelPerfect(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean {
  if (!bothVoicesMove(aCur - aPrev, bCur - bPrev)) {
    return false;
  }
  const nowClass = simpleClass(aCur - bCur);
  const prevClass = simpleClass(aPrev - bPrev);
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
 */
export function createsParallelOctave(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean {
  if (!similarMotion(aCur - aPrev, bCur - bPrev)) {
    return false;
  }
  return simpleClass(aCur - bCur) === 0 && simpleClass(aPrev - bPrev) === 0;
}

/**
 * Whether two voices move in consecutive parallel unisons — both landing on the
 * same pitch, having shared a pitch on the previous move.
 */
export function createsParallelUnison(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean {
  if (aCur === aPrev || bCur === bPrev) {
    return false;
  }
  return aCur === bCur && aPrev === bPrev;
}

/**
 * Whether two voices reach a perfect interval by similar motion from an
 * imperfect one (a hidden/direct fifth or octave).
 *
 * The traditional step exception is applied: the approach is allowed when the
 * upper of the two voices moves by step, so only leaps into the perfect
 * interval are flagged.
 */
export function createsHiddenParallelPerfect(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean {
  const aMove = aCur - aPrev;
  const bMove = bCur - bPrev;
  if (!similarMotion(aMove, bMove)) {
    return false;
  }
  const nowClass = simpleClass(aCur - bCur);
  const prevClass = simpleClass(aPrev - bPrev);
  // Approaching the same perfect class (e.g. fifth to fifth) is a true parallel
  // owned by createsParallelPerfect; approaching a different perfect interval
  // (fifth to octave, or vice versa) is the hidden/direct case flagged here.
  if (!isPerfectClass(nowClass) || prevClass === nowClass) {
    return false;
  }
  const upperMove = aCur >= bCur ? aMove : bMove;
  if (Math.abs(upperMove) <= 2) {
    return false; // upper voice moves by step — direct interval is acceptable
  }
  return true;
}

/**
 * Whether two voices overlap: the upper voice descends below where the lower
 * voice just was, or the lower voice rises above where the upper voice just was.
 * Distinct from a simultaneous voice crossing.
 *
 * @param upperPrev Previous pitch of the upper voice.
 * @param upperCur Current pitch of the upper voice.
 * @param lowerPrev Previous pitch of the lower voice.
 * @param lowerCur Current pitch of the lower voice.
 */
export function createsVoiceOverlap(
  upperPrev: number,
  upperCur: number,
  lowerPrev: number,
  lowerCur: number,
): boolean {
  return upperCur < lowerPrev || lowerCur > upperPrev;
}

/**
 * Whether two adjacent upper voices are spaced more than a maximum apart
 * (commonly an octave). Bass-to-tenor spacing is conventionally exempt, so this
 * is meant for the upper voice pairs.
 *
 * @param upperPitch Pitch of the higher voice.
 * @param lowerPitch Pitch of the lower voice.
 * @param maxSemitones Maximum allowed spacing in semitones (default an octave).
 */
export function exceedsSpacing(upperPitch: number, lowerPitch: number, maxSemitones = 12): boolean {
  return Math.abs(upperPitch - lowerPitch) > maxSemitones;
}

/**
 * Whether a leading tone resolves correctly upward to the tonic.
 *
 * @param prev The leading-tone pitch.
 * @param cur The following pitch.
 * @param key Key context supplying the tonic.
 * @returns True when `prev` is the leading tone and `cur` is the tonic a step above.
 */
export function isLeadingToneResolution(prev: number, cur: number, key: KeyScale): boolean {
  const tonic = pitchClass(key.rootPc);
  const leading = (tonic + 11) % 12;
  if (pitchClass(prev) !== leading || pitchClass(cur) !== tonic) {
    return false;
  }
  return cur > prev && cur - prev <= 2;
}
