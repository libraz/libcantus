import { isConsonantInterval, isPerfectInterval } from '../interval/index.js';
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
 * Whether a melodic move is a forbidden leap (tritone or diminished/augmented
 * seventh-class interval).
 *
 * @param prev Starting pitch.
 * @param cur Ending pitch.
 * @returns True when the leap is forbidden in strict counterpoint.
 */
export function isForbiddenMelodicLeap(prev: number, cur: number): boolean {
  const semis = Math.abs(cur - prev) % 12;
  return semis === 6 || semis === 11;
}

/**
 * Whether two voices move into consecutive parallel perfect intervals
 * (unison, fifth, or octave held identical across the move).
 */
export function createsParallelPerfect(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean {
  if (aCur === aPrev || bCur === bPrev) {
    return false;
  }
  const now = aCur - bCur;
  const prev = aPrev - bPrev;
  return isPerfectInterval(now) && isPerfectInterval(prev) && now === prev && now !== 0;
}

/**
 * Whether two voices move in parallel octaves (both intervals reduce to an
 * octave/unison class).
 */
export function createsParallelOctave(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean {
  if (aCur === aPrev || bCur === bPrev) {
    return false;
  }
  const now = aCur - bCur;
  const prev = aPrev - bPrev;
  const octNow = Math.abs(now) % 12 === 0 && now !== 0;
  const octPrev = Math.abs(prev) % 12 === 0 && prev !== 0;
  return octNow && octPrev;
}

/**
 * Whether two voices reach a perfect interval by similar motion from an
 * imperfect one (hidden/direct parallels).
 */
export function createsHiddenParallelPerfect(
  aPrev: number,
  aCur: number,
  bPrev: number,
  bCur: number,
): boolean {
  const thisMotion = aCur - aPrev;
  const otherMotion = bCur - bPrev;
  if (thisMotion === 0 || otherMotion === 0) {
    return false;
  }
  if (thisMotion > 0 !== otherMotion > 0) {
    return false;
  }
  const now = aCur - bCur;
  const prev = aPrev - bPrev;
  return isPerfectInterval(now) && !isPerfectInterval(prev);
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
