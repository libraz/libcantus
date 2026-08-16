import { InvalidInputError } from '../core/errors/index.js';
import type {
  Articulation,
  InstrumentProfile,
  InstrumentProfileLike,
  Limb,
  PercussionProfile,
  PlayabilityReport,
  StringedProfile,
  StringFingering,
} from '../core/instrument/index.js';
import {
  BASS_4_STRING,
  BASS_5_STRING,
  canSound,
  fingeringsFor,
  foldIntoRange,
  GUITAR_DROP_D,
  GUITAR_STANDARD,
  instrumentRange,
  playability,
  toInstrumentProfile,
} from '../core/instrument/index.js';
import type { NoteLike } from '../core/pitch/index.js';
import { toNoteData } from '../core/pitch/index.js';
import type { NoteEvent } from '../core/types.js';
import { assertInteger, assertPositiveInt } from '../core/validation/index.js';
import type { TransposingInstrument } from '../theory/transposition/index.js';
import { toSoundingPitch } from '../theory/transposition/index.js';
import { Note } from './note.js';

/** Whether two lists hold the same values in the same order. */
function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Whether two kits place the same limbs on the same voices. */
function sameReach(a: PercussionProfile['reach'], b: PercussionProfile['reach']): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => sameList(a[Number(key)] ?? [], b[Number(key)] ?? []))
  );
}

/**
 * A copy of a profile, lists and all, so a caller's object cannot become
 * library state and a profile handed out cannot be edited from underneath the
 * instrument that holds it.
 */
function copyProfile(profile: InstrumentProfile): InstrumentProfile {
  const common = {
    name: profile.name,
    articulations: [...profile.articulations],
    polyphony: profile.polyphony,
  };
  if (profile.kind === 'stringed') {
    const stringed: StringedProfile = {
      kind: 'stringed',
      ...common,
      tuning: [...profile.tuning],
      frets: profile.frets,
      maxStretch: profile.maxStretch,
    };
    // Carried only when the neck has none, so a profile that was copied and one
    // that was written by hand serialize to the same object.
    if (profile.fretless === true) {
      stringed.fretless = true;
    }
    return stringed;
  }
  const reach: Record<number, readonly Limb[]> = {};
  for (const [pitch, limbs] of Object.entries(profile.reach)) {
    reach[Number(pitch)] = [...limbs];
  }
  return { kind: 'percussion', ...common, limbs: [...profile.limbs], reach };
}

/**
 * A copy of a profile whose numbers the instrument can hold.
 *
 * A fret count that is not a whole number, or a string tuned to no pitch,
 * describes an instrument that answers every question and means none of them:
 * the range it reports, the positions it offers and the passages it accepts are
 * all read off these numbers.
 */
function checkedProfile(profile: InstrumentProfileLike): InstrumentProfile {
  const copy = copyProfile(toInstrumentProfile(profile));
  assertPositiveInt(copy.polyphony, `${copy.name} polyphony`);
  if (copy.kind === 'stringed') {
    for (const [index, open] of copy.tuning.entries()) {
      assertInteger(open, `${copy.name} tuning[${index}]`);
    }
    assertInteger(copy.maxStretch, `${copy.name} maxStretch`, 0);
  } else {
    for (const pitch of Object.keys(copy.reach)) {
      assertInteger(Number(pitch), `${copy.name} reach pitch`);
    }
  }
  // The instrument module's own reading of the profile settles the rest: a
  // fret count that is no count, a neck with no strings, or a kit no limb
  // reaches is refused here rather than at the first passage checked against it.
  instrumentRange(copy);
  return copy;
}

/**
 * An immutable instrument: what it physically is — an open-string tuning and a
 * fret count, or the voices each limb reaches — with the range, the positions
 * and the playability checks of the instrument module bound to it. A thin
 * convenience wrapper over a plain {@link InstrumentProfile}.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Instrument } from '@libraz/libcantus';
 * Instrument.guitar().fingerings(64).length; // 6
 * Instrument.bass4().canSound(27); // false
 * ```
 */
export class Instrument {
  readonly #profile: InstrumentProfile;

  private constructor(profile: InstrumentProfile) {
    this.#profile = profile;
  }

  /**
   * Wrap a plain instrument profile, whether a built-in one or a caller's own.
   *
   * An `Instrument` is accepted too, and comes back as an equal one: the
   * factory is the boundary a profile crosses everywhere in the library, so it
   * takes the same {@link InstrumentProfileLike} every other entry point does
   * rather than making a caller unwrap what it already holds.
   *
   * @param profile The plain profile, or an instrument standing for one.
   * @returns The wrapped instrument.
   * @throws If the profile describes no instrument: a neck with no strings, a
   *   fret count that is not a whole number, a kit no limb reaches, or a
   *   tuning, stretch or voice count that is not finite.
   * @example
   * ```ts
   * import { GUITAR_DROP_D } from '../../src/core/index.js';
   * import { Instrument } from '@libraz/libcantus';
   * Instrument.of(GUITAR_DROP_D).range().low; // 38
   * ```
   */
  static of(profile: InstrumentProfileLike): Instrument {
    return new Instrument(checkedProfile(profile));
  }

  /**
   * Six-string guitar in standard tuning: E2 A2 D3 G3 B3 E4.
   *
   * @returns The instrument.
   */
  static guitar(): Instrument {
    return Instrument.of(GUITAR_STANDARD);
  }

  /**
   * Six-string guitar in drop D: the lowest string down a tone to D2, the rest
   * standard.
   *
   * @returns The instrument.
   */
  static guitarDropD(): Instrument {
    return Instrument.of(GUITAR_DROP_D);
  }

  /**
   * Electric bass in standard tuning: E1 A1 D2 G2.
   *
   * @returns The instrument.
   */
  static bass4(): Instrument {
    return Instrument.of(BASS_4_STRING);
  }

  /**
   * Five-string bass with the low B: B0 E1 A1 D2 G2.
   *
   * @returns The instrument.
   * @example
   * ```ts
   * import { Instrument } from '@libraz/libcantus';
   * Instrument.bass5().range().low; // 23
   * ```
   */
  static bass5(): Instrument {
    return Instrument.of(BASS_5_STRING);
  }

  /**
   * Rebuild an instrument from the plain profile {@link Instrument.data} hands
   * out.
   *
   * @param data The plain profile.
   * @returns The wrapped instrument.
   * @throws If the profile describes no instrument; see {@link Instrument.of}.
   */
  static fromData(data: InstrumentProfile): Instrument {
    return Instrument.of(data);
  }

  /**
   * Rebuild an instrument from its {@link Instrument.toJSON} output.
   *
   * @param data The serialized profile.
   * @returns The wrapped instrument.
   * @throws If the profile describes no instrument; see {@link Instrument.of}.
   */
  static fromJSON(data: InstrumentProfile): Instrument {
    return Instrument.of(data);
  }

  /** The instrument's name, as its profile carries it. */
  get name(): string {
    return this.#profile.name;
  }

  /** Which family the instrument belongs to. */
  get kind(): InstrumentProfile['kind'] {
    return this.#profile.kind;
  }

  /** Greatest number of notes that can sound at once. */
  get polyphony(): number {
    return this.#profile.polyphony;
  }

  /** A copy of the techniques the instrument can produce. */
  get articulations(): Articulation[] {
    return [...this.#profile.articulations];
  }

  /** A copy of the underlying plain profile. */
  get data(): InstrumentProfile {
    return this.toJSON();
  }

  /**
   * The lowest and highest pitch the instrument sounds.
   *
   * Derived from the tuning and the fret count, or from the voices the
   * player's limbs reach, rather than stored — and not necessarily gapless, so
   * {@link Instrument.canSound} answers for one pitch.
   *
   * @returns The extreme sounding pitches as MIDI numbers, inclusive.
   * @example
   * ```ts
   * import { Instrument } from '@libraz/libcantus';
   * Instrument.guitar().range(); // { low: 40, high: 88 }
   * ```
   */
  range(): { low: number; high: number } {
    return instrumentRange(this.#profile);
  }

  /**
   * Whether the instrument has this pitch at all.
   *
   * @param pitch MIDI pitch.
   * @returns True when some string and fret, or some limb the player has,
   *   produces it.
   */
  canSound(pitch: number): boolean {
    return canSound(this.#profile, pitch);
  }

  /**
   * Every position on the neck that sounds a pitch, lowest string first.
   *
   * @param pitch MIDI pitch.
   * @returns One entry per string that reaches the pitch; empty when none does.
   * @throws If the instrument is a kit, which has no neck to place a pitch on.
   */
  fingerings(pitch: number): StringFingering[] {
    const profile = this.#profile;
    if (profile.kind !== 'stringed') {
      throw new InvalidInputError(`${profile.name} has no strings to finger`);
    }
    return fingeringsFor(profile, pitch);
  }

  /**
   * Move a pitch by whole octaves until the instrument can sound it, which is
   * what a player does with a line written below the instrument.
   *
   * @param pitch MIDI pitch to place.
   * @returns The nearest octave transposition the instrument sounds, searching
   *   upward first; the pitch unchanged when no transposition is available.
   * @example
   * ```ts
   * import { Instrument } from '@libraz/libcantus';
   * Instrument.bass4().foldIntoRange(27); // 39
   * ```
   */
  foldIntoRange(pitch: number): number {
    return foldIntoRange(pitch, this.#profile);
  }

  /**
   * The pitch this instrument sounds for a note written in its part.
   *
   * Most parts are written at the pitch they sound, but some are not: a guitar
   * part is printed an octave above concert pitch, and a part for an instrument
   * in B flat or in A is printed in a different key altogether. The instrument
   * is looked up by its own name, so an instrument the transposition table
   * carries needs nothing said; name a transposition to read a part for one it
   * does not, which is every instrument whose profile is the caller's own.
   *
   * The interval decides the letter, so the spelling of the part survives: on a
   * clarinet in A a written D sharp sounds B sharp, where a semitone count
   * alone would answer C natural and lose the letter the part is written on.
   *
   * @param note A note name, a MIDI number, plain note data, or a `Note`, as
   *   the player reads it.
   * @param transposition The written-to-sounding transposition to read the part
   *   under; the instrument's own name by default.
   * @returns The sounding note, at concert pitch.
   * @throws If the note is malformed, or the transposition is neither a known
   *   instrument name nor a spelled interval — which is what an instrument the
   *   table does not carry reports when none is named.
   * @example
   * ```ts
   * import { Instrument } from '@libraz/libcantus';
   * Instrument.guitar().soundingPitch('C4').name; // 'C3'
   * Instrument.bass4().soundingPitch('C4', '-P8').name; // 'C3'
   * ```
   */
  soundingPitch(note: NoteLike, transposition: TransposingInstrument = this.#profile.name): Note {
    return new Note(toSoundingPitch(toNoteData(note), transposition));
  }

  /**
   * Judge whether a passage can be played on this instrument, and how hard it
   * is.
   *
   * Nothing is rewritten or rejected: the report names what stands in the way,
   * and only the tempo-dependent layer consults `bpm`, so omitting the tempo
   * reports what the instrument alone decides.
   *
   * @param notes The passage, in any order. Drum hits qualify as note events.
   * @param bpm Tempo in quarter-note beats per minute; enables the layer that
   *   asks whether there is time for the movement.
   * @returns Difficulty, the issues found, and each note's string/fret or limb.
   * @throws If the notes are not note events, or the tempo is not a finite
   *   positive number of beats per minute.
   * @example
   * ```ts
   * import { Instrument } from '@libraz/libcantus';
   * const report = Instrument.bass4().playability([
   *   { pitch: 27, startBeat: 0, durationBeat: 1 },
   * ]);
   * report.issues[0]?.type; // 'noteOutOfRange'
   * ```
   */
  playability(notes: readonly NoteEvent[], bpm?: number): PlayabilityReport {
    return playability(notes, this.#profile, bpm);
  }

  /**
   * Whether another instrument is described identically.
   *
   * @param other The instrument to compare with.
   * @returns True when both profiles name the same instrument, string for
   *   string or voice for voice.
   */
  equals(other: Instrument): boolean {
    // The other instrument is read through its public surface rather than its
    // private field: a bundler that emits two copies of this class — as a
    // CommonJS build without shared chunks does for the root and /model
    // entries — would otherwise throw on the brand check.
    const a = this.#profile;
    const b = other.data;
    if (a.name !== b.name || a.kind !== b.kind || a.polyphony !== b.polyphony) {
      return false;
    }
    if (!sameList(a.articulations, b.articulations)) {
      return false;
    }
    if (a.kind === 'stringed') {
      return (
        b.kind === 'stringed' &&
        a.frets === b.frets &&
        a.maxStretch === b.maxStretch &&
        (a.fretless ?? false) === (b.fretless ?? false) &&
        sameList(a.tuning, b.tuning)
      );
    }
    return b.kind === 'percussion' && sameList(a.limbs, b.limbs) && sameReach(a.reach, b.reach);
  }

  /**
   * The plain profile, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(instrument)` from collapsing to `{}`.
   *
   * @returns A copy of the underlying profile, its lists included.
   */
  toJSON(): InstrumentProfile {
    return copyProfile(this.#profile);
  }

  /**
   * The instrument's name, so a template literal or a log line reads as the
   * instrument.
   *
   * @returns The name, e.g. `'guitar'`.
   * @example
   * ```ts
   * import { Instrument } from '@libraz/libcantus';
   * Instrument.guitar().toString(); // 'guitar'
   * ```
   */
  toString(): string {
    return this.#profile.name;
  }
}
