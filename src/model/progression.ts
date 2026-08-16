import {
  type AnalyzeChordOptions,
  type CadenceResult,
  type ChordAnalysis,
  type ChordToRomanOptions,
  type DetectCadenceOptions,
  detectCadence,
  type HarmonicFunction,
} from '../analyze/functional/index.js';
import { InvalidInputError } from '../core/errors/index.js';
import type { IntervalLike } from '../core/pitch/index.js';
import type { Chord as ChordData, ChordSpan } from '../theory/chord/index.js';
import { chordFromSpan } from '../theory/chord/index.js';
import { type ScaleChoice, scalesForChanges } from '../theory/chordscale/index.js';
import { type VoicingOptions, voiceProgression } from '../theory/voicing/index.js';
import type { Chord } from './chord.js';
import { Chord as ChordClass } from './chord.js';
import type { Key, KeyData } from './key.js';
import { Key as KeyClass } from './key.js';

/**
 * The plain form of a {@link Progression}: the chords as plain data, and the
 * carried key as its own plain data when the progression has one.
 */
export type ProgressionData = { chords: ChordData[]; key: KeyData | undefined };

/**
 * An immutable ordered sequence of chords, optionally carrying a {@link Key}
 * context shared by its analysis methods.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Key } from '@libraz/libcantus';
 * const key = Key.major('C');
 * key.chord(2).progressionTo(key.chord(5), key.chord(1)).roman();
 * // ['ii', 'V', 'I']
 * ```
 */
export class Progression {
  readonly #chords: readonly Chord[];
  readonly #key: Key | undefined;

  /**
   * Wrap a chord sequence.
   *
   * @param chords The chords in order; the array is copied.
   * @param key Optional key context for analysis methods.
   */
  constructor(chords: readonly Chord[], key?: Key) {
    this.#chords = Object.freeze(Progression.#attachKey(chords, key));
    this.#key = key;
  }

  /**
   * Attach the progression key to every chord member.
   *
   * The key is applied unconditionally, including to chords that already carry
   * one, so the members never disagree with the progression about which key
   * spells them and a re-key during a modulation reaches all of them.
   * {@link Chord.withKey} keeps a spelling the caller supplied and re-derives
   * the rest, so the result depends on neither the chords' previous key nor the
   * number of times a key was attached.
   */
  static #attachKey(chords: readonly Chord[], key: Key | undefined): Chord[] {
    return key === undefined ? [...chords] : chords.map((chord) => chord.withKey(key));
  }

  /**
   * Build a progression from the {@link ChordSpan} records the generators
   * return, keeping their order.
   *
   * The spans' `startBeat`, `degree`, and `secondaryDominant` are analysis
   * annotations that a chord sequence does not carry; only the harmony crosses
   * over. Keep the spans themselves if the timing matters.
   *
   * @param spans The chord spans, in order.
   * @param key Optional key context for the analysis methods.
   * @returns The progression.
   * @example
   * ```ts
   * import { generateProgression, Key, Progression } from '@libraz/libcantus';
   * const key = Key.major('C');
   * const spans = generateProgression({ key: key.scale, style: 'dance', bars: 4 });
   * Progression.fromSpans(spans, key).roman();
   * ```
   */
  static fromSpans(spans: readonly ChordSpan[], key?: Key): Progression {
    const chords = spans.map((span) => ChordClass.fromData(chordFromSpan(span)));
    return new Progression(chords, key);
  }

  /**
   * Rebuild a progression from its {@link Progression.toJSON} output.
   *
   * @param data The serialized chords and key.
   * @returns The progression.
   */
  static fromJSON(data: ProgressionData): Progression {
    const key = data.key === undefined ? undefined : KeyClass.fromJSON(data.key);
    const chords = data.chords.map((chord) => ChordClass.fromJSON(chord));
    return key === undefined ? new Progression(chords) : new Progression(chords, key);
  }

  /**
   * Wrap plain progression data, matching the `fromData` factory on the other
   * classes.
   *
   * @param data The plain progression, as {@link Progression.data} hands it out.
   * @returns The progression.
   */
  static fromData(data: ProgressionData): Progression {
    return Progression.fromJSON(data);
  }

  /**
   * The chord sequence.
   *
   * The array is the progression's own and is frozen rather than copied, so
   * reading it in a loop stays linear.
   */
  get chords(): readonly Chord[] {
    return this.#chords;
  }

  /** The carried key context, if any. */
  get key(): Key | undefined {
    return this.#key;
  }

  /**
   * A copy of the underlying plain progression data: the chords as plain
   * objects and the carried key, if any, as its own plain data.
   */
  get data(): ProgressionData {
    return this.toJSON();
  }

  /** The number of chords. */
  get length(): number {
    return this.#chords.length;
  }

  /**
   * The chord at an index.
   *
   * @param index 0-based position; a negative index counts from the end.
   * @returns The chord, or undefined when the index is out of range.
   */
  at(index: number): Chord | undefined {
    return this.#chords.at(index);
  }

  /** Iterate the chords in order, so a progression works with `for...of`. */
  [Symbol.iterator](): IterableIterator<Chord> {
    return this.#chords[Symbol.iterator]();
  }

  /**
   * Whether another progression holds the same chords in the same order.
   *
   * The key context is not compared: it is an analysis lens, not part of the
   * harmony. Chord equality follows {@link Chord.equals}.
   *
   * @param other The progression to compare.
   * @returns True when the chord sequences match.
   */
  equals(other: Progression): boolean {
    if (this.#chords.length !== other.length) {
      return false;
    }
    return this.#chords.every((chord, index) => {
      const theirs = other.at(index);
      return theirs !== undefined && chord.equals(theirs);
    });
  }

  /**
   * A copy of this progression with a chord appended.
   *
   * @param chord The chord to append.
   * @returns The new progression.
   */
  add(chord: Chord): Progression {
    return new Progression([...this.#chords, chord], this.#key);
  }

  /**
   * A copy of this progression carrying the given key context.
   *
   * @param key The key context to attach.
   * @returns The new progression.
   */
  withKey(key: Key): Progression {
    return new Progression(this.#chords, key);
  }

  /**
   * Voice the progression with smooth voice leading.
   *
   * @param opts Voicing options; defaults to four SATB voices.
   * @returns One ascending voicing (MIDI pitches) per chord.
   * @throws If any chord admits no voicing within the given ranges.
   */
  voice(opts?: VoicingOptions): number[][] {
    const key = opts?.key ?? this.#key?.scale;
    return voiceProgression(
      this.#chords.map((chord) => chord.data),
      key === undefined ? opts : { ...opts, key },
    );
  }

  /**
   * The Roman numeral of each chord in a key.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @param opts Applied-numeral rendering options.
   * @returns One numeral per chord.
   * @throws If no key is given and none is carried.
   */
  roman(key?: Key, opts?: ChordToRomanOptions): string[] {
    const resolved = this.#resolveKey(key);
    return this.#chords.map((chord) => chord.roman(resolved, opts));
  }

  /**
   * The harmonic function of each chord in a key.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @returns One function per chord.
   * @throws If no key is given and none is carried.
   */
  functions(key?: Key): HarmonicFunction[] {
    const resolved = this.#resolveKey(key);
    return this.#chords.map((chord) => chord.function(resolved));
  }

  /**
   * Analyze every chord and classify the closing cadence.
   *
   * The cadence is detected on the final chord pair and is null when the
   * progression has fewer than two chords.
   *
   * The options reach both analyses: `applied` and `alternatives` go to every
   * chord, and `voicing` — the pitches of the last two chords, as
   * {@link Progression.voice} produces them — to the cadence, which cannot tell
   * a perfect authentic cadence from an imperfect one without knowing the
   * soprano.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @param opts Applied-numeral rendering options, `alternatives` for the
   *   readings both analyses turned down, and `voicing` for the cadence's
   *   voice-leading detail; see {@link AnalyzeChordOptions} and
   *   {@link DetectCadenceOptions}.
   * @returns Per-chord analyses and the closing cadence.
   * @throws If no key is given and none is carried.
   * @example
   * ```ts
   * import { Chord, Key, Progression } from '@libraz/libcantus';
   * const progression = new Progression([Chord.parse('G7'), Chord.parse('C')], Key.major('C'));
   * const voiced = progression.voice();
   * progression.analyze(undefined, { voicing: [voiced[0] ?? [], voiced[1] ?? []] }).cadence
   *   ?.strength; // 'perfect'
   * ```
   */
  analyze(
    key?: Key,
    opts?: AnalyzeChordOptions & DetectCadenceOptions,
  ): { chords: ChordAnalysis[]; cadence: CadenceResult | null } {
    const resolved = this.#resolveKey(key);
    const chords = this.#chords.map((chord) => chord.analyze(resolved, opts));
    const from = this.#chords[this.#chords.length - 2];
    const to = this.#chords[this.#chords.length - 1];
    const cadence =
      from !== undefined && to !== undefined
        ? detectCadence(from.data, to.data, resolved.scale, opts)
        : null;
    return { chords, cadence };
  }

  /**
   * Choose one compatible scale for every chord, favoring smooth changes.
   *
   * @returns One scale choice per chord in this progression.
   */
  scales(): ScaleChoice[] {
    return scalesForChanges(this.#chords.map((chord) => chord.data));
  }

  /**
   * Transpose every chord by a number of semitones.
   *
   * A carried key moves with the chords, so the progression keeps its degrees
   * and functions in the new key.
   *
   * @param semitones The signed semitone offset.
   * @returns The transposed progression.
   * @example
   * ```ts
   * import { Chord, Progression } from '@libraz/libcantus';
   * new Progression([Chord.parse('C'), Chord.parse('G')]).transpose(2).toString(); // 'D A'
   * ```
   */
  transpose(semitones: number): Progression {
    const key = this.#key?.transpose(semitones);
    // The constructor hands the transposed key to every member, so a chord
    // spelled by this progression's key follows it instead of falling back to
    // sharps in a flat key.
    const chords = this.#chords.map((chord) => chord.transpose(semitones));
    return new Progression(chords, key);
  }

  /**
   * Transpose every chord by a spelled interval.
   *
   * Unlike {@link Progression.transpose}, which picks letters from a semitone
   * count, the interval's diatonic number decides them, so a progression taken
   * up an augmented fourth is spelled with sharps and one taken up a diminished
   * fifth with flats. A carried key moves with the chords.
   *
   * @param interval An interval name (e.g. `'A4'`, `'-m3'`), plain interval
   *   data, or an {@link Interval}; a descending interval moves down.
   * @returns The transposed progression.
   * @example
   * ```ts
   * import { Chord, Progression } from '@libraz/libcantus';
   * new Progression([Chord.parse('C'), Chord.parse('G7')]).transposeBy('A4').toString();
   * // 'F# C#7'
   * ```
   */
  transposeBy(interval: IntervalLike): Progression {
    const key = this.#key?.transposeBy(interval);
    // The constructor hands the transposed key to every member, so a chord
    // spelled by this progression's key follows it instead of falling back to
    // sharps in a flat key.
    const chords = this.#chords.map((chord) => chord.transposeBy(interval));
    return new Progression(chords, key);
  }

  /**
   * Transpose the progression so that its key becomes `target`.
   *
   * The interval between the two tonics moves the chords and decides their
   * spelling, so moving C major to Gb major writes flats while moving it to F#
   * major writes sharps. The result carries `target` itself, mode included: the
   * chords move by interval but the key is replaced rather than transposed, so
   * a target in another mode — a relative, parallel, or modal key — is the key
   * the progression is then analyzed in.
   *
   * @param target The key the transposed progression should be in.
   * @returns The transposed progression, carrying `target` as its key.
   * @throws If the progression carries no key context to measure from.
   * @example
   * ```ts
   * import { Chord, Key, Progression } from '@libraz/libcantus';
   * const progression = new Progression([Chord.parse('C'), Chord.parse('G7')], Key.major('C'));
   * progression.transposeTo(Key.major('Eb')).toString(); // 'Eb Bb7'
   * ```
   */
  transposeTo(target: Key): Progression {
    const from = this.#key;
    if (from === undefined) {
      throw new InvalidInputError(
        'progression has no key context; attach one with withKey() before transposing to another key',
      );
    }
    const interval = from.intervalTo(target);
    const chords = this.#chords.map((chord) => chord.transposeBy(interval));
    return new Progression(chords, target);
  }

  /**
   * The chord symbols separated by spaces, so a template literal or a log line
   * reads as the progression.
   *
   * @returns The symbols in order, e.g. `'C Am F G'`.
   */
  toString(): string {
    return this.#chords.map((chord) => chord.symbol()).join(' ');
  }

  /**
   * The plain progression data, for JSON serialization.
   *
   * Private class fields do not serialize, so this preserves both the chord
   * data and any carried key in `JSON.stringify(progression)`.
   *
   * @returns The chord data sequence and the carried key, if any.
   */
  toJSON(): ProgressionData {
    return {
      chords: this.#chords.map((chord) => chord.toJSON()),
      key: this.#key?.toJSON(),
    };
  }

  /** Resolve the key for an analysis method: explicit first, then carried. */
  #resolveKey(key?: Key): Key {
    const resolved = key ?? this.#key;
    if (resolved === undefined) {
      throw new InvalidInputError(
        'progression has no key context; pass a Key or attach one with withKey()',
      );
    }
    return resolved;
  }
}
