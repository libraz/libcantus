import { InvalidInputError } from '../errors/index.js';
import {
  assertInteger,
  assertMidiPitch,
  assertOneOf,
  assertPositiveInt,
  describeRejected,
} from '../validation/index.js';
import type { Articulation } from './articulation.js';
import { ARTICULATIONS } from './articulation.js';

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
  /**
   * Voices dubbed over the kit on a pass of their own, by MIDI note number.
   *
   * A tambourine or a shaker riding a groove whose backbeat already commits
   * both hands is a second pass, not a third hand: it is played over the kit,
   * so it takes no limb from the kit and none from another overdub. Such a
   * voice is still held in a hand on its own pass, so it keeps its `reach`
   * entry and remains a voice of the instrument; this names which of them are
   * played that way.
   */
  overdub?: readonly number[];
};

/**
 * An instrument the library can check a passage against.
 *
 * @category Core
 */
export type InstrumentProfile = StringedProfile | PercussionProfile;

declare const checked: unique symbol;

/**
 * A neck whose every field has been checked against the domain it declares.
 *
 * @category Core
 */
export type ValidatedStringedProfile = StringedProfile & { readonly [checked]: true };

/**
 * A kit whose every field has been checked against the domain it declares.
 *
 * @category Core
 */
export type ValidatedPercussionProfile = PercussionProfile & { readonly [checked]: true };

/**
 * A profile whose every field has been checked against the domain it declares.
 *
 * The mark is carried by the type alone — nothing is added to the object, so a
 * validated profile serializes exactly as the plain one it was made from. Its
 * only source is {@link toInstrumentProfile}, which is what makes the mark worth
 * anything: the routines that read a profile note by note take this rather than
 * a plain {@link InstrumentProfile}, so a path that skipped the checks does not
 * compile instead of failing on the one passage that happens to expose it.
 *
 * @category Core
 */
export type ValidatedProfile = ValidatedStringedProfile | ValidatedPercussionProfile;

/**
 * Anything that names an instrument: a plain {@link InstrumentProfile}, or a
 * value that serializes to one such as the `Instrument` class.
 *
 * Every entry point that takes an instrument takes this, so a caller holding
 * the class hands it over as it is instead of unwrapping it for one call and
 * wrapping it again for the next.
 *
 * @category Core
 */
export type InstrumentProfileLike =
  | InstrumentProfile
  | {
      /** The profile data this value stands for. */
      toJSON(): InstrumentProfile;
    };

/**
 * Resolve any instrument-shaped value to a plain {@link InstrumentProfile}.
 *
 * The counterpart of {@link toNoteData} for instruments: an entry point takes
 * whatever form the caller has — the profile a project file holds, one of the
 * built-in profiles, or an `Instrument` instance — and gets one shape back. An
 * instance is accepted through its `toJSON` method rather than by its type,
 * because the core layer cannot import the model layer that defines the class.
 *
 * @param value A plain profile, or a value whose `toJSON` returns one.
 * @param name What the instrument is called in an error message, so a caller
 *   holding several of them hears which one was malformed.
 * @returns The validated profile.
 * @throws If the value names no instrument, or the instrument it names is
 *   contradictory — a neck with no strings, a fret count that is no count, or a
 *   kit no limb reaches.
 * @category Core
 */
export function toInstrumentProfile(
  value: InstrumentProfileLike,
  name = 'instrument',
): ValidatedProfile {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidInputError(`${name} must be an instrument profile; received ${typeof value}`);
  }
  const data =
    'toJSON' in value && typeof value.toJSON === 'function'
      ? value.toJSON()
      : (value as InstrumentProfile);
  const kind: unknown = data?.kind;
  if (kind !== 'stringed' && kind !== 'percussion') {
    throw new InvalidInputError(
      `${name} must be a stringed or percussion profile; received kind ${String(kind)}`,
    );
  }
  assertProfile(data);
  // The only place the mark is applied, and it is applied to a profile every
  // check has just passed: see {@link ValidatedProfile}.
  return data as ValidatedProfile;
}

/**
 * Resolve any instrument-shaped value to a plain {@link StringedProfile}.
 *
 * What {@link toInstrumentProfile} is for an entry point that reads any
 * instrument, this is for one that only has a neck to work with: a bass line
 * placed on strings and frets cannot be written for a kit, and saying so by
 * name is more use than a missing `tuning` surfacing later as a note the
 * generator could not place.
 *
 * @param value A plain profile, or a value whose `toJSON` returns one.
 * @param name What the instrument is called in an error message.
 * @returns The validated profile, narrowed to the stringed family.
 * @throws If the value names no instrument, or names one with no strings.
 * @category Core
 */
export function toStringedProfile(
  value: InstrumentProfileLike,
  name = 'instrument',
): ValidatedStringedProfile {
  const profile = toInstrumentProfile(value, name);
  if (profile.kind !== 'stringed') {
    throw new InvalidInputError(
      `${name} must be a stringed instrument; ${profile.name} has no strings`,
    );
  }
  return profile;
}

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

/**
 * Greatest fret number a neck can carry.
 *
 * A fret sounds an open string a semitone higher per fret, so a neck longer
 * than the MIDI compass names positions that sound no pitch. Bounding it here
 * is what keeps every routine that walks the instrument by octaves — the range,
 * the fingerings, the folding — finite for every profile the library accepts.
 */
const MAX_FRETS = 127;

/**
 * Greatest number of notes one instrument may sound at once.
 *
 * The MIDI compass is 128 pitches, so an instrument sounding more than that at
 * one instant is sounding one of them twice — which is a voicing question
 * rather than a property of the instrument.
 */
const MAX_POLYPHONY = 128;

/**
 * Reject a profile whose own description is contradictory.
 *
 * Every field the library goes on to read is checked, not only the ones that
 * describe the family: a profile read out of a project file or written by a
 * JavaScript caller may be missing any of them, and a missing one does not
 * fail where it is missing. A `maxStretch` of `undefined` makes every span
 * comparison false, so a chord no hand can hold reads as playable; a missing
 * `polyphony` turns every group into one that exceeds it, and says so in a
 * message with `undefined` in it. Neither is a diagnosis a caller can act on.
 */
function assertProfile(profile: InstrumentProfile): void {
  if (typeof profile.name !== 'string' || profile.name === '') {
    throw new InvalidInputError(
      `instrument name must be a non-empty string; received ${describeRejected(profile.name)}`,
    );
  }
  if (!Array.isArray(profile.articulations)) {
    throw new InvalidInputError(
      `${profile.name} articulations must be an array; received ${describeRejected(profile.articulations)}`,
    );
  }
  for (const [index, articulation] of profile.articulations.entries()) {
    assertOneOf(articulation, ARTICULATIONS, `${profile.name} articulations[${index}]`);
  }
  assertPositiveInt(profile.polyphony, `${profile.name} polyphony`, MAX_POLYPHONY);
  if (profile.kind === 'stringed') {
    if (!Array.isArray(profile.tuning) || profile.tuning.length === 0) {
      throw new InvalidInputError(`${profile.name} must have at least one string`);
    }
    for (const [index, open] of profile.tuning.entries()) {
      assertMidiPitch(open, `${profile.name} tuning[${index}]`);
    }
    assertInteger(profile.frets, `${profile.name} frets`, 0, MAX_FRETS);
    // A hand holds down frets, so the span it can hold is a fret count: zero is
    // a player who only sounds open strings, and anything wider than the neck
    // is a stretch the neck has nowhere to put.
    assertInteger(profile.maxStretch, `${profile.name} maxStretch`, 0, MAX_FRETS);
    return;
  }
  if (!Array.isArray(profile.limbs) || profile.limbs.length === 0) {
    throw new InvalidInputError(`${profile.name} must have at least one limb`);
  }
  for (const [index, limb] of profile.limbs.entries()) {
    assertOneOf(limb, LIMBS, `${profile.name} limbs[${index}]`);
  }
  if (typeof profile.reach !== 'object' || profile.reach === null) {
    throw new InvalidInputError(
      `${profile.name} reach must be a table of limbs by voice; received ${describeRejected(profile.reach)}`,
    );
  }
  const voices = Object.keys(profile.reach);
  for (const key of voices) {
    assertMidiPitch(Number(key), `${profile.name} reach pitch`);
  }
  // A voice is on the kit only when a limb the player has can strike it, so a
  // reach table naming limbs the player has not got describes a kit with
  // nothing on it — and a range read off one has no low or high to report.
  if (voices.every((key) => reachOf(profile, Number(key)).length === 0)) {
    throw new InvalidInputError(`${profile.name} must have at least one voice within reach`);
  }
  // An overdub is still held in a hand, on a pass of its own, so it is read
  // through the reach and the limbs like every other voice: naming one the
  // player cannot hold leaves it off the instrument rather than in dispute.
  for (const pitch of profile.overdub ?? []) {
    assertMidiPitch(pitch, `${profile.name} overdub pitch`);
  }
}

/**
 * Whether a voice is dubbed over the kit rather than played by the limbs
 * holding it together.
 *
 * An overdubbed voice is recorded on a pass of its own, so it shares limbs
 * neither with the kit nor with another overdub — which is what lets a shaker
 * sound through a bar whose every stroke is already spoken for.
 *
 * @param profile The kit.
 * @param pitch MIDI pitch, or `undefined` for a note that is not there.
 * @returns True when the kit names this voice as an overdub.
 * @category Core
 */
export function isOverdub(profile: PercussionProfile, pitch: number | undefined): boolean {
  if (pitch === undefined) {
    return false;
  }
  return (profile.overdub ?? []).includes(pitch);
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
export function instrumentRange(profile: InstrumentProfileLike): { low: number; high: number } {
  return rangeIn(toInstrumentProfile(profile));
}

/** {@link instrumentRange} on a profile that has already been checked. */
export function rangeIn(profile: ValidatedProfile): { low: number; high: number } {
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
export function canSound(profile: InstrumentProfileLike, pitch: number): boolean {
  const resolved = toInstrumentProfile(profile, 'instrument');
  assertMidiPitch(pitch, 'pitch');
  return soundsIn(resolved, pitch);
}

/** {@link canSound} on a profile that has already been checked. */
export function soundsIn(profile: ValidatedProfile, pitch: number): boolean {
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
export function fingeringsFor(profile: InstrumentProfileLike, pitch: number): StringFingering[] {
  const stringed = toStringedProfile(profile, 'instrument');
  assertMidiPitch(pitch, 'pitch');
  return fingeringsIn(stringed, pitch);
}

/** {@link fingeringsFor} on a profile that has already been checked. */
export function fingeringsIn(stringed: ValidatedStringedProfile, pitch: number): StringFingering[] {
  const out: StringFingering[] = [];
  for (let string = 0; string < stringed.tuning.length; string += 1) {
    const open = stringed.tuning[string];
    if (open === undefined) {
      continue;
    }
    const fret = pitch - open;
    if (fret >= 0 && fret <= stringed.frets) {
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
 * @returns The nearest octave transposition the instrument sounds, taking the
 *   upper one when two are equally near; the pitch unchanged when no
 *   transposition of it is available.
 *
 * @example
 * ```ts
 * import { BASS_4_STRING, foldIntoRange } from '@libraz/libcantus';
 * foldIntoRange(27, BASS_4_STRING); // 39 — Eb1 is under the low E
 * ```
 * @category Core
 */
export function foldIntoRange(pitch: number, profile: InstrumentProfileLike): number {
  const resolved = toInstrumentProfile(profile, 'instrument');
  assertMidiPitch(pitch, 'pitch');
  return foldIn(pitch, resolved);
}

/** {@link foldIntoRange} on a profile that has already been checked. */
export function foldIn(pitch: number, resolved: ValidatedProfile): number {
  if (soundsIn(resolved, pitch)) {
    return pitch;
  }
  const { low, high } = rangeIn(resolved);
  // Every octave of the pitch that lies inside the instrument is weighed, and
  // the least distant of the ones it sounds wins: on a gapped range the octave
  // below can be nearer than the octave above, and answering with the first one
  // found upward would change the voice rather than the register. The walk
  // starts at the first octave inside the instrument rather than stepping up to
  // it one octave at a time, so a pitch far outside the range costs no loop.
  const first = pitch + 12 * Math.ceil((low - pitch) / 12);
  let best: number | undefined;
  for (let candidate = first; candidate <= high; candidate += 12) {
    if (!soundsIn(resolved, candidate)) {
      continue;
    }
    // Not strictly nearer: the candidates rise, so an equal distance means the
    // upper octave, which is the one a player reaches for.
    if (best === undefined || Math.abs(candidate - pitch) <= Math.abs(best - pitch)) {
      best = candidate;
    }
  }
  return best ?? pitch;
}
