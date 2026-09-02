import { InvalidInputError } from '../core/errors/index.js';
import type { Note as NoteData, NoteLike } from '../core/pitch/index.js';
import { toNoteData } from '../core/pitch/index.js';
import { assertInteger, assertMidiPitch } from '../core/validation/index.js';
import {
  type VoiceIndependenceOptions,
  type VoiceIndependenceReport,
  voiceIndependence,
} from '../theory/counterpoint/index.js';
import {
  checkPartWriting,
  checkSpecies,
  type PartWritingOptions,
  type PartWritingViolation,
  type Species,
  type SpeciesOptions,
  type SpelledVoicing,
  spellVoicing,
} from '../theory/partwriting/index.js';
import {
  type EvaluateSafetyOptions,
  enumerateSafePitches,
  evaluateSafety,
  type SafetyQuery,
  type SafetyResult,
  type VoiceSnapshot,
} from '../theory/safety/index.js';
import { type KeyLike, type ResolvedKey, resolveKey } from '../theory/scale/index.js';
import { spellPitch } from '../theory/spelling/index.js';
import { type ChordLike, toChordData } from '../theory/symbol/index.js';
import {
  nextVoicing,
  SATB_RANGES,
  type StyledVoicingOptions,
  type VoiceRange,
  type VoicingOptions,
  voiceChord,
  voiceChordStyled,
  voiceLeadingCost,
} from '../theory/voicing/index.js';
import { Note } from './note.js';
import { assertDataArray, assertKeyArgument } from './shared.js';

/**
 * The plain form of a {@link Voicing}: the sounding MIDI pitches in voice
 * order, lowest voice first.
 *
 * Voice order, not sorted order. A voicing is normally ascending, and one that
 * is not is exactly what a voice crossing is — the class keeps the order it was
 * built with so the crossing survives to be reported, so a caller reading the
 * lowest sounding pitch takes the minimum rather than the first entry.
 *
 * The voicing functions all speak this array, so the class hands out exactly
 * what they take rather than a wrapper of its own.
 */
export type VoicingData = number[];

/**
 * Options controlling {@link Voicing.independence}.
 *
 * Everything {@link voiceIndependence} accepts, plus the key its two lines are
 * spelled in.
 */
export type VoicingIndependenceOptions = VoiceIndependenceOptions & {
  /**
   * The key both lines are spelled in. Without it the pitches are read as MIDI
   * and spelled with sharps, the reading {@link toNoteData} takes of a bare
   * number; the spelling decides only whether two voices moving alike keep the
   * same interval and which intervals count as perfect consonances.
   */
  key?: KeyLike;
};

/**
 * The context a candidate pitch is judged in, with the voices of this voicing
 * standing as the other parts.
 *
 * The same query serves {@link Voicing.safetyOf} and
 * {@link Voicing.safePitches}: it is everything {@link SafetyQuery} carries
 * except the candidate and the other voices, which the voicing supplies, with
 * the chord and key taken in whichever form the caller holds them. It is
 * derived from the query itself, so a field the safety module adds arrives
 * here rather than being silently dropped on the way.
 */
export type VoicingSafetyQuery = Omit<
  SafetyQuery,
  'candidatePitch' | 'otherVoices' | 'chord' | 'key'
> & {
  /** The chord sounding under the candidate, or null when none is known. */
  chord: ChordLike | null;
  /** The prevailing key. */
  key: KeyLike;
  /**
   * The voicing these voices moved from, aligned voice for voice with this
   * one. It is what lets the parallel, hidden-parallel and voice-crossing
   * rules apply: without a previous pitch per voice there is no motion to read.
   */
  previous?: Voicing;
};

/**
 * Defensive copy of the pitches, each checked as a sounding pitch.
 *
 * The order is the caller's and is never sorted into place. A voicing is
 * ascending, but a voicing that is not is exactly what {@link checkPartWriting}
 * reports as voice crossing, and sorting here would silently repair the fault
 * the check exists to find.
 */
function copyPitches(pitches: readonly number[]): number[] {
  assertDataArray(pitches, 'voicing pitches');
  if (pitches.length === 0) {
    throw new InvalidInputError('a voicing must contain at least one pitch');
  }
  // Every pitch is checked rather than copied blind: a voicing holding a NaN
  // leads, spells and scores as a voicing that looks real, and the failure
  // surfaces wherever the number is finally used. MIDI is the bound the safety
  // and voicing functions already hold their pitches to.
  return pitches.map((pitch, index) => assertMidiPitch(pitch, `pitches[${index}]`));
}

/**
 * Spell a line of pitches in a key.
 *
 * A bare number is spelled by the key rather than read as a sharp-spelled MIDI
 * note, so a cantus firmus given as pitches is written the way the voicing it
 * is judged against is: the rules that read letters — the augmented second, the
 * diminished fourth — cannot be applied to two lines spelled by different
 * rules.
 */
function spellLine(line: readonly NoteLike[], key: ResolvedKey): NoteData[] {
  return line.map((value) =>
    typeof value === 'number' ? spellPitch(value, key.tonic, key) : toNoteData(value),
  );
}

/**
 * A line of pitches as notes: spelled by the key when one is known, and read as
 * sharp-spelled MIDI when none is — the reading {@link toNoteData} takes of a
 * bare number.
 */
function lineOf(pitches: readonly number[], key: ResolvedKey | undefined): NoteData[] {
  return key === undefined ? pitches.map((pitch) => toNoteData(pitch)) : spellLine(pitches, key);
}

/**
 * The key a chord argument carries, when it was given as a `Chord` holding one.
 *
 * Read by shape rather than by type, the way every other boundary here reads a
 * key, so a `Chord` built by a second copy of the module is still understood.
 * Plain chord data carries no key and yields nothing.
 */
function carriedKeyOf(chord: ChordLike): KeyLike | undefined {
  if (typeof chord !== 'object' || chord === null) {
    return undefined;
  }
  const key = (chord as { key?: unknown }).key;
  return typeof key === 'object' && key !== null ? (key as KeyLike) : undefined;
}

/**
 * The voicing options with the chord's own key filled in.
 *
 * A chord that carries a key passes it to the voicer, so the leading tone is
 * neither doubled nor left unresolved and the letters the augmented-interval
 * rule reads are known. An explicit `opts.key` wins, which is the order
 * `Chord.voice` resolves them in — the two entry points would otherwise voice
 * the same chord differently.
 */
function withCarriedKey(chord: ChordLike, opts?: VoicingOptions): VoicingOptions | undefined {
  if (opts?.key !== undefined) {
    return opts;
  }
  const key = carriedKeyOf(chord);
  return key === undefined ? opts : { ...opts, key };
}

/**
 * An immutable voicing: the pitches one chord sounds at one moment, lowest
 * voice first (index 0 = the bass), the voice order {@link voiceChord} and
 * {@link SATB_RANGES} already use.
 *
 * The order given is kept rather than sorted: a voicing whose voices are out of
 * order is one whose voices cross, which is a fault {@link Voicing.checkTo}
 * reports rather than one the class quietly repairs.
 *
 * The voicing, part-writing, counterpoint and safety functions all take the
 * same array of voices; this holds it once and passes it to each of them. Two
 * of the methods read the pitches as a line rather than a chord —
 * {@link Voicing.species} and {@link Voicing.independence}, which judge a
 * written part slot by slot — and say so.
 *
 * The individual counterpoint predicates (`createsParallelPerfect`,
 * `createsVoiceCrossing`, and the rest) stay standalone functions: they judge
 * one pair of voices at one moment, which is a question about two pitches
 * rather than about a voicing. {@link Voicing.checkTo} is the bundled check.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Voicing } from '@libraz/libcantus';
 * Voicing.satb('C').pitches.length; // 4
 * ```
 */
export class Voicing {
  readonly #pitches: readonly number[];

  /**
   * Wrap a set of sounding pitches.
   *
   * @param pitches MIDI pitches, lowest voice first; the array is copied,
   *   never retained or mutated, and its order is kept. A doubled pitch is
   *   kept too, since doubling is how a four-voice texture states a triad.
   * @throws If the array is empty, or a pitch is not an integer in 0..127.
   */
  constructor(pitches: readonly number[]) {
    this.#pitches = Object.freeze(copyPitches(pitches));
  }

  /**
   * Wrap a set of sounding pitches.
   *
   * @param pitches MIDI pitches, lowest voice first.
   * @returns The voicing.
   * @throws If the array is empty, or a pitch is not an integer in 0..127.
   */
  static of(pitches: readonly number[]): Voicing {
    return new Voicing(pitches);
  }

  /**
   * Realize a chord as an explicit tertian voicing in a chosen style — close,
   * drop-2, drop-3, shell or rootless — independent of the SATB range search
   * {@link Voicing.satb} runs.
   *
   * @param chord A chord symbol, plain chord data, or a {@link Chord}.
   * @param opts Styled voicing options; defaults to a close voicing at octave 4.
   * @returns The voicing, ascending.
   * @throws If the voicing would not fit inside MIDI 0..127 at the given
   *   octave, or if the style leaves no voice sounding.
   * @example
   * ```ts
   * import { Voicing } from '@libraz/libcantus';
   * Voicing.forChord('Dm7', { style: 'drop2' }).pitches.length; // 4
   * ```
   */
  static forChord(chord: ChordLike, opts?: StyledVoicingOptions): Voicing {
    return new Voicing(voiceChordStyled(chord, opts));
  }

  /**
   * Realize a chord as one pitch per voice inside the voice ranges, defaulting
   * to the four {@link SATB_RANGES}.
   *
   * The bass takes the chord's slash bass when it has one, otherwise the root;
   * the result is compact, centred in its ranges, and free of voice crossing.
   *
   * A chord that carries a key passes it to the voicer, so the leading tone is
   * not doubled; an explicit `opts.key` overrides it. That is the order
   * {@link Chord.voice} resolves them in, and the two answer alike.
   *
   * @param chord A chord symbol, plain chord data, or a {@link Chord}.
   * @param opts Voicing options; defaults to four voices in {@link SATB_RANGES}.
   * @returns The voicing, ascending.
   * @throws If no voicing fits the given ranges.
   * @example
   * ```ts
   * import { Voicing } from '@libraz/libcantus';
   * Voicing.satb('Cmaj7').range.min >= 40; // true — the bass stays in its compass
   * ```
   */
  static satb(chord: ChordLike, opts?: VoicingOptions): Voicing {
    return new Voicing(voiceChord(toChordData(chord), withCarriedKey(chord, opts)));
  }

  /**
   * Wrap a plain pitch array, as {@link Voicing.data} hands it out.
   *
   * @param data The MIDI pitches.
   * @returns The voicing.
   * @throws If the array is empty, or a pitch is not an integer in 0..127.
   */
  static fromData(data: readonly number[]): Voicing {
    return new Voicing(data);
  }

  /**
   * Rebuild a voicing from its {@link Voicing.toJSON} output.
   *
   * @param data The serialized pitches.
   * @returns The voicing.
   * @throws If the array is empty, or a pitch is not an integer in 0..127.
   */
  static fromJSON(data: readonly number[]): Voicing {
    return new Voicing(data);
  }

  /**
   * A copy of the default four-voice SATB ranges, ascending: the compass
   * {@link Voicing.satb} voices into and {@link Voicing.checkTo} judges a
   * four-voice exercise against.
   */
  static get satbRanges(): VoiceRange[] {
    return SATB_RANGES.map((range) => ({ min: range.min, max: range.max }));
  }

  /** A copy of the sounding MIDI pitches, lowest voice first. */
  get pitches(): number[] {
    return [...this.#pitches];
  }

  /**
   * The compass the voicing occupies: its lowest and highest sounding pitch.
   *
   * Read as a {@link VoiceRange} so it can be handed straight back as a range
   * for another voice. The pitches are searched rather than read off the ends,
   * so a voicing whose voices cross still reports the compass it sounds.
   */
  get range(): VoiceRange {
    return { min: Math.min(...this.#pitches), max: Math.max(...this.#pitches) };
  }

  /** A copy of the underlying plain pitch array. */
  get data(): VoicingData {
    return this.toJSON();
  }

  /**
   * Spell the voicing as notes with letters and octaves, so the rules that read
   * letters can be applied to it.
   *
   * Each pitch is named against the key, and against the chord sounding under
   * it when one is given, so a chord tone takes the letter its interval above
   * the root implies: the third of a D major chord in C major spells F#, not
   * Gb.
   *
   * @param key A key name, a plain key/scale, or a {@link Key}.
   * @param chord The chord sounding, supplying the enharmonic evidence; without
   *   it the key alone decides.
   * @returns One spelled note per pitch, in voice order.
   * @throws If the value names no key or no chord.
   * @example
   * ```ts
   * import { Voicing } from '@libraz/libcantus';
   * Voicing.of([50, 57, 66, 69]).spell('C major', 'D').map((note) => note.name);
   * // ['D3', 'A3', 'F#4', 'A4']
   * ```
   */
  spell(key: KeyLike, chord?: ChordLike): Note[] {
    assertKeyArgument(key, 'voicing key');
    return this.#spelled(resolveKey(key), chord).map((note) => new Note(note));
  }

  /**
   * Voice a chord to follow smoothly from this voicing.
   *
   * Candidates are enumerated within the ranges `opts` names, or — when neither
   * `voices` nor `ranges` is given — within a one-octave window around each of
   * these pitches, so the answer keeps this voicing's voice count. Each is
   * scored by structural quality, motion from here, and a large penalty per
   * counterpoint violation. A chord that carries a key passes it to the voicer
   * unless `opts.key` names another one.
   *
   * The rules read from the chord being left — a chordal seventh's resolution,
   * a leading tone's resolution, and the cross relation between the two chords
   * — are scored only when `opts.previousChord` names that chord: a voicing
   * does not say what it was written on.
   *
   * @param chord A chord symbol, plain chord data, or a {@link Chord}.
   * @param opts Voicing options; when omitted, the ranges follow this voicing.
   * @returns The chosen voicing.
   * @throws If this voicing has fewer voices than the requested ranges, or no
   *   voicing fits them.
   * @example
   * ```ts
   * import { Voicing } from '@libraz/libcantus';
   * const tonic = Voicing.satb('C');
   * tonic.costTo(tonic.next('G7')) < 24; // true — the voices move economically
   * ```
   */
  next(chord: ChordLike, opts?: VoicingOptions): Voicing {
    return new Voicing(nextVoicing(this.pitches, toChordData(chord), withCarriedKey(chord, opts)));
  }

  /**
   * The voice-leading cost from this voicing to another: the summed absolute
   * semitone motion across voices, and nothing besides. What the motion breaks
   * is {@link Voicing.checkTo}'s question.
   *
   * @param other The voicing moved to.
   * @returns The cost, or `Infinity` when the two hold a different number of
   *   voices and are therefore not comparable.
   */
  costTo(other: Voicing): number {
    return voiceLeadingCost(this.pitches, other.pitches);
  }

  /**
   * Check the motion from this voicing to another against the four-part rules,
   * and report every rule the pair breaks.
   *
   * Both voicings are spelled in `key` against the chord each realizes, then
   * graded as a two-chord exercise: voice crossing, spacing and range inside
   * each chord, and parallel and hidden perfects, overlap, cross relations,
   * augmented melodic intervals and unresolved tendency tones between them.
   *
   * @param other The voicing moved to.
   * @param chords The chord this voicing realizes and the chord `other` does.
   * @param key The key the exercise is written in; it names the leading tone.
   * @param opts Ranges and the upper-voice spacing limit; a four-voice pair is
   *   judged against {@link SATB_RANGES} when no ranges are given.
   * @returns Every violation found, in musical order; an empty array for a
   *   clean pair.
   * @throws If a value names no chord or key, or the ranges are malformed or
   *   too few for the voices being checked.
   * @example
   * ```ts
   * import { Voicing } from '@libraz/libcantus';
   * const from = Voicing.of([48, 55, 64, 72]);
   * const to = Voicing.of([50, 57, 65, 69]);
   * from.checkTo(to, ['C', 'Dm'], 'C major').map((found) => found.kind);
   * // ['parallelFifth']
   * ```
   */
  checkTo(
    other: Voicing,
    chords: readonly [ChordLike, ChordLike],
    key: KeyLike,
    opts?: PartWritingOptions,
  ): PartWritingViolation[] {
    assertKeyArgument(key, 'voicing key');
    // The key is passed on whole rather than reduced to its pitch classes: the
    // exercise is graded on the letters it is written with, so an Ab minor is
    // spelled on flats here and everywhere the checker reads it.
    const resolved = resolveKey(key);
    const from = toChordData(chords[0]);
    const to = toChordData(chords[1]);
    const voicings: SpelledVoicing[] = [
      spellVoicing(this.pitches, from, resolved),
      spellVoicing(other.pitches, to, resolved),
    ];
    return checkPartWriting(voicings, [from, to], resolved, opts);
  }

  /**
   * Mark this voicing, read as a written counterpoint line, against a cantus
   * firmus in one of the five species.
   *
   * The pitches are the counterpoint, one per slot rather than one per voice:
   * this is the one place where the array is a line in time instead of a chord
   * in register. Both lines are spelled in `mode`, since half of what the
   * species rules forbid — the augmented second, the diminished fourth — is
   * invisible in a pitch.
   *
   * @param cantusFirmus The given voice, one note per measure, as note names,
   *   plain notes, MIDI pitches, or {@link Note} instances.
   * @param species Which species the exercise is written in.
   * @param mode The mode the exercise is in.
   * @param opts Note lengths, and which side the counterpoint is written on;
   *   the fifth species cannot be read without `durations`.
   * @returns Every violation found, in the order the exercise commits them.
   * @throws If the species is not one of the five, the cantus firmus is empty,
   *   or the fifth species is given without durations.
   * @example
   * ```ts
   * import { Voicing } from '@libraz/libcantus';
   * const counterpoint = Voicing.of([72, 69, 67, 71, 72]);
   * counterpoint.species(['C4', 'D4', 'E4', 'D4', 'C4'], 1, 'C major').length; // 0
   * ```
   */
  species(
    cantusFirmus: readonly NoteLike[],
    species: Species,
    mode: KeyLike,
    opts?: SpeciesOptions,
  ): PartWritingViolation[] {
    assertKeyArgument(mode, 'voicing mode');
    const resolved = resolveKey(mode);
    // Both lines are spelled by the same reading, so a cantus firmus given as
    // pitches is written the way this one is: the rules that read letters
    // cannot be applied to two lines spelled by different rules.
    return checkSpecies(
      spellLine(cantusFirmus, resolved),
      spellLine(this.#pitches, resolved),
      species,
      resolved,
      opts,
    );
  }

  /**
   * Measure how independent this voicing, read as a line, is from another.
   *
   * As in {@link Voicing.species} the pitches are slots in time, one per entry,
   * aligned with `other` slot for slot. Nothing here is a verdict: parallel
   * thirds report as parallel motion with a small separation, a pedal point as
   * oblique motion.
   *
   * @param other The line measured against this one, of the same length.
   * @param opts Attack flags, the treatment of the fourth, and the key both
   *   lines are spelled in.
   * @returns The motion breakdown, rhythmic complementarity, separation,
   *   crossings, and the longest perfect-consonance run.
   * @throws If the two lines differ in length, or an attack array is supplied
   *   at another length than the lines.
   */
  independence(other: Voicing, opts?: VoicingIndependenceOptions): VoiceIndependenceReport {
    // `key` is this class's own addition: it spells the two lines and has no
    // meaning below. Forwarding the bag whole would hand a `KeyLike` to a
    // delegate that today discards it and tomorrow may read a `key` of its
    // own, so it is taken out here rather than relied on being ignored.
    const { key, ...rest } = opts ?? {};
    const resolved = key === undefined ? undefined : resolveKey(key);
    return voiceIndependence(
      lineOf(this.#pitches, resolved),
      lineOf(other.pitches, resolved),
      rest,
    );
  }

  /**
   * Judge a candidate pitch placed against these voices.
   *
   * Every pitch of this voicing stands as another part sounding under the
   * candidate, so the vertical rules read them all; the motion rules need
   * `query.previous`, which gives each of those voices the pitch it came from.
   *
   * @param pitch The candidate MIDI pitch.
   * @param query The candidate's harmonic and voice-leading context.
   * @param opts Set `suggestions: false` to skip the search for safe
   *   replacements when the verdict is not safe.
   * @returns The verdict, reason bitmask, and optional resolution guidance.
   * @throws If the profile is unknown, a value names no chord or key, or a
   *   pitch is not a MIDI pitch in 0..127.
   * @example
   * ```ts
   * import { NoteSafety } from '@libraz/libcantus';
   * import { Voicing } from '@libraz/libcantus';
   * const sounding = Voicing.of([48, 55, 64]);
   * sounding.safetyOf(72, { profile: 'pop', chord: 'C', key: 'C major', strongBeat: true })
   *   .safety === NoteSafety.Safe; // true
   * ```
   */
  safetyOf(pitch: number, query: VoicingSafetyQuery, opts?: EvaluateSafetyOptions): SafetyResult {
    return evaluateSafety({ ...this.#context(query), candidatePitch: pitch }, opts);
  }

  /**
   * Enumerate the pitches placeable against these voices in a range, chord
   * tones first, each group descending.
   *
   * @param query The harmonic and voice-leading context, as
   *   {@link Voicing.safetyOf} reads it.
   * @param pitchLow Lowest MIDI pitch to consider (inclusive).
   * @param pitchHigh Highest MIDI pitch to consider (inclusive).
   * @returns The placeable pitches — those not judged dissonant.
   * @throws If the profile is unknown, a value names no chord or key, or a
   *   bound is not a MIDI pitch in 0..127 or is reversed.
   */
  safePitches(query: VoicingSafetyQuery, pitchLow: number, pitchHigh: number): number[] {
    return enumerateSafePitches(this.#context(query), pitchLow, pitchHigh);
  }

  /**
   * The n-th inversion of the voicing: the lowest voice taken up an octave, n
   * times over.
   *
   * A negative `n` takes the highest voice down an octave as many times, and
   * `invert(0)` is the voicing itself, voice order and all. Unlike
   * {@link Chord.invert}, which rotates a chord's interval template, this moves
   * real voices: inverting a four-voice texture four times leaves the same chord
   * an octave higher. A voicing that actually inverts comes back ascending,
   * since the voice that moved is no longer where it was.
   *
   * @param n How many voices to move, upward when positive.
   * @returns The inverted voicing, ascending; this voicing itself when `n` is 0.
   * @throws If `n` is not an integer in [-128, 128], or a voice would leave
   *   MIDI 0..127.
   * @example
   * ```ts
   * import { Voicing } from '@libraz/libcantus';
   * Voicing.of([60, 64, 67]).invert(1).pitches; // [64, 67, 72]
   * ```
   */
  invert(n: number): Voicing {
    assertInteger(n, 'voicing inversion', -128, 128);
    // No voice moves, so nothing about the voicing changes — including the order
    // its voices were written in. Falling through would sort them, and a voicing
    // whose voices cross is a fault `checkTo` reports rather than one the class
    // quietly repairs.
    if (n === 0) {
      return this;
    }
    // Each move is made in turn rather than in one arithmetic step: the voice
    // that is lowest after a move is not always the next one up, so which voice
    // moves second depends on where the first one landed.
    const pitches = [...this.#pitches].sort((a, b) => a - b);
    for (let moved = 0; moved < Math.abs(n); moved += 1) {
      const index = n > 0 ? 0 : pitches.length - 1;
      const pitch = (pitches[index] as number) + (n > 0 ? 12 : -12);
      pitches.splice(index, 1);
      pitches.push(assertMidiPitch(pitch, 'inverted voice'));
      pitches.sort((a, b) => a - b);
    }
    return new Voicing(pitches);
  }

  /**
   * Whether another voicing sounds the same pitches in the same order.
   *
   * A doubling counts: two voices on the same pitch are two voices, and a
   * three-voice texture is not the four-voice one that doubles its root.
   *
   * @param other The voicing to compare.
   * @returns True when the pitches match one for one.
   */
  equals(other: Voicing): boolean {
    // The other voicing is read through its public accessor rather than its
    // private field: a bundler that emits two copies of this class — as a
    // CommonJS build without shared chunks does for the root and /model
    // entries — would otherwise throw on the brand check.
    const theirs = other.pitches;
    return (
      this.#pitches.length === theirs.length &&
      this.#pitches.every((pitch, index) => pitch === theirs[index])
    );
  }

  /**
   * The plain pitch array, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(voicing)` from collapsing to `{}`.
   *
   * @returns A copy of the sounding MIDI pitches, in voice order.
   */
  toJSON(): VoicingData {
    return [...this.#pitches];
  }

  /**
   * The pitches separated by spaces, so a template literal or a log line reads
   * as the voicing.
   *
   * @returns The pitches in voice order, e.g. `'60 64 67'`.
   */
  toString(): string {
    return this.#pitches.join(' ');
  }

  /** Spell the voicing, by the key alone or against a chord as well. */
  #spelled(key: ResolvedKey, chord: ChordLike | undefined): NoteData[] {
    return chord === undefined
      ? spellLine(this.#pitches, key)
      : spellVoicing(this.pitches, toChordData(chord), key);
  }

  /** The safety context these voices supply, minus the candidate pitch. */
  #context(query: VoicingSafetyQuery): Omit<SafetyQuery, 'candidatePitch'> {
    const previous = query.previous?.pitches;
    const otherVoices: VoiceSnapshot[] = this.#pitches.map((pitch, index) => {
      const prevPitch = previous?.[index];
      return prevPitch === undefined ? { pitch } : { pitch, prevPitch };
    });
    return {
      profile: query.profile,
      chord: query.chord === null ? null : toChordData(query.chord),
      key: resolveKey(query.key).scale,
      otherVoices,
      strongBeat: query.strongBeat,
      prevPitch: query.prevPitch,
      vocalLow: query.vocalLow,
      vocalHigh: query.vocalHigh,
    };
  }
}
