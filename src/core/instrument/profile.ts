import { InvalidInputError } from '../errors/index.js';
import type { Articulation } from './articulation.js';

/**
 * Every limb a percussionist strikes with, in declaration order.
 *
 * @category Core
 */
export const LIMBS = Object.freeze(['rightHand', 'leftHand', 'rightFoot', 'leftFoot'] as const);

/**
 * One limb of a percussionist.
 *
 * @category Core
 */
export type Limb = (typeof LIMBS)[number];

/**
 * Fields every instrument profile carries, whatever its family.
 *
 * @category Core
 */
export type InstrumentProfileCommon = {
  /** Instrument name, for issue messages and for the caller's own display. */
  name: string;
  /** Techniques this instrument can produce; anything else it cannot play. */
  articulations: readonly Articulation[];
  /** Greatest number of notes that can sound at once. */
  polyphony: number;
};

/**
 * A fretted or fretless string instrument, described by what it is rather than
 * by the range it happens to have.
 *
 * The sounding range follows from `tuning` and `frets`: string `s` sounds
 * `tuning[s] .. tuning[s] + frets`. Storing `[min, max]` instead would make a
 * five-string bass, a drop tuning, a seven-string guitar and an extended-range
 * neck four unrelated special cases, and would leave "the neck is not long
 * enough" indistinguishable from "the note is below the instrument".
 *
 * @category Core
 */
export type StringedProfile = InstrumentProfileCommon & {
  kind: 'stringed';
  /** Open-string MIDI pitch per string, lowest-sounding string first. */
  tuning: readonly number[];
  /** Highest fret number; fret 0 is the open string. */
  frets: number;
  /** Greatest fret span one hand can hold down at once. */
  maxStretch: number;
  /**
   * The neck has no frets. Positions are continuous, so intonation is the
   * player's and a slide is unbroken; in twelve-tone equal temperament the
   * positions coincide with fret numbers, so range and stretch are read the
   * same way.
   */
  fretless?: boolean;
};

/**
 * A percussion setup, described by the voices within reach of each limb.
 *
 * A kit's constraint is not range but limbs: a voice no limb can reach is not
 * on the instrument, and two voices needing the same limb at the same instant
 * cannot both sound.
 *
 * @category Core
 */
export type PercussionProfile = InstrumentProfileCommon & {
  kind: 'percussion';
  /** The limbs the player has available. */
  limbs: readonly Limb[];
  /** Limbs that can strike each voice, in preference order, keyed by MIDI note. */
  reach: Readonly<Record<number, readonly Limb[]>>;
};

/**
 * An instrument the library can check a passage against.
 *
 * @category Core
 */
export type InstrumentProfile = StringedProfile | PercussionProfile;

/**
 * A fretting-hand position: which string, and how far up the neck.
 *
 * @category Core
 */
export type StringFingering = {
  /** Index into the `tuning` of a {@link StringedProfile}. */
  string: number;
  /** Fret number; 0 is the open string. */
  fret: number;
};

/** Reject a profile whose own description is contradictory. */
function assertProfile(profile: InstrumentProfile): void {
  if (profile.kind === 'stringed') {
    if (profile.tuning.length === 0) {
      throw new InvalidInputError(`${profile.name} must have at least one string`);
    }
    if (!Number.isInteger(profile.frets) || profile.frets < 0) {
      throw new InvalidInputError(`${profile.name} frets must be a non-negative integer`);
    }
    return;
  }
  if (Object.keys(profile.reach).length === 0) {
    throw new InvalidInputError(`${profile.name} must have at least one voice within reach`);
  }
}

/**
 * The limbs a kit can actually strike a voice with.
 *
 * A `reach` entry names the limbs that are placed to hit a voice; `limbs` names
 * the limbs the player has. A voice reachable only by a limb the player has not
 * got is not on the instrument, so the two are read together everywhere rather
 * than the reach alone.
 *
 * @param profile The kit.
 * @param pitch MIDI pitch, or `undefined` for a note that is not there.
 * @returns The available limbs in preference order; empty when none can strike.
 * @category Core
 */
export function reachOf(profile: PercussionProfile, pitch: number | undefined): readonly Limb[] {
  if (pitch === undefined) {
    return [];
  }
  return (profile.reach[pitch] ?? []).filter((limb) => profile.limbs.includes(limb));
}

/**
 * The lowest and highest pitch an instrument sounds.
 *
 * For a string instrument this is derived from the tuning and the fret count,
 * never stored; for a kit it is the extent of the voices the player's limbs
 * reach. The range is not necessarily gapless — use {@link canSound} to ask
 * about one pitch.
 *
 * @param profile The instrument.
 * @returns The extreme sounding pitches, inclusive.
 *
 * @example
 * ```ts
 * import { BASS_5_STRING, instrumentRange } from '@libraz/libcantus';
 * instrumentRange(BASS_5_STRING).low; // 23, low B
 * ```
 * @category Core
 */
export function instrumentRange(profile: InstrumentProfile): { low: number; high: number } {
  assertProfile(profile);
  if (profile.kind === 'stringed') {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const open of profile.tuning) {
      low = Math.min(low, open);
      high = Math.max(high, open + profile.frets);
    }
    return { low, high };
  }
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const key of Object.keys(profile.reach)) {
    const pitch = Number(key);
    // A voice only an absent limb reaches is not on this kit, so it does not
    // stretch the range either — otherwise the range would promise a pitch
    // {@link canSound} denies.
    if (reachOf(profile, pitch).length === 0) {
      continue;
    }
    low = Math.min(low, pitch);
    high = Math.max(high, pitch);
  }
  return { low, high };
}

/**
 * Whether the instrument has this pitch at all.
 *
 * This is the first of the three playability layers: no amount of skill or
 * rehearsal puts a note on an instrument that has no position for it.
 *
 * @param profile The instrument.
 * @param pitch MIDI pitch.
 * @returns True when some string and fret, or some limb the player has,
 *   produces it.
 * @category Core
 */
export function canSound(profile: InstrumentProfile, pitch: number): boolean {
  assertProfile(profile);
  if (profile.kind === 'stringed') {
    return profile.tuning.some((open) => pitch >= open && pitch - open <= profile.frets);
  }
  return reachOf(profile, pitch).length > 0;
}

/**
 * Every position on the neck that sounds a pitch, lowest string first.
 *
 * @param profile The instrument.
 * @param pitch MIDI pitch.
 * @returns One entry per string that reaches the pitch; empty when none does.
 * @category Core
 */
export function fingeringsFor(profile: StringedProfile, pitch: number): StringFingering[] {
  assertProfile(profile);
  const out: StringFingering[] = [];
  for (let string = 0; string < profile.tuning.length; string += 1) {
    const open = profile.tuning[string];
    if (open === undefined) {
      continue;
    }
    const fret = pitch - open;
    if (fret >= 0 && fret <= profile.frets) {
      out.push({ string, fret });
    }
  }
  return out;
}

/**
 * Move a pitch by whole octaves until the instrument can sound it.
 *
 * This is what a player does with a line written below the instrument: the note
 * comes back an octave up, keeping its pitch class and its place in the phrase.
 * Substituting a different scale degree, or refusing the passage outright, is
 * the wrong answer for a bass line.
 *
 * @param pitch MIDI pitch to place.
 * @param profile The instrument.
 * @returns The nearest octave transposition the instrument sounds, searching
 *   upward first; the pitch unchanged when no transposition of it is available.
 *
 * @example
 * ```ts
 * import { BASS_4_STRING, foldIntoRange } from '@libraz/libcantus';
 * foldIntoRange(27, BASS_4_STRING); // 39 — Eb1 is under the low E
 * ```
 * @category Core
 */
export function foldIntoRange(pitch: number, profile: InstrumentProfile): number {
  if (canSound(profile, pitch)) {
    return pitch;
  }
  const { low, high } = instrumentRange(profile);
  for (let candidate = pitch + 12; candidate <= high; candidate += 12) {
    if (canSound(profile, candidate)) {
      return candidate;
    }
  }
  for (let candidate = pitch - 12; candidate >= low; candidate -= 12) {
    if (canSound(profile, candidate)) {
      return candidate;
    }
  }
  return pitch;
}
