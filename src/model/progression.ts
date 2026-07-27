import {
  type Cadence,
  type ChordAnalysis,
  detectCadence,
  type HarmonicFunction,
} from '../analyze/functional/index.js';
import type { Note as NoteData } from '../core/pitch/index.js';
import type { KeyScale } from '../core/types.js';
import type { Chord as ChordData, ChordSpan } from '../theory/chord/index.js';
import { makeChord } from '../theory/chord/index.js';
import { type VoicingOptions, voiceProgression } from '../theory/voicing/index.js';
import type { Chord } from './chord.js';
import { Chord as ChordClass } from './chord.js';
import type { Key } from './key.js';
import { Key as KeyClass } from './key.js';

/**
 * An immutable ordered sequence of chords, optionally carrying a {@link Key}
 * context shared by its analysis methods.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Key } from '@libraz/libcantus';
 * const key = Key.major('C');
 * key.chord(1).progressionTo(key.chord(4), key.chord(0)).roman();
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
    this.#chords = Object.freeze([...chords]);
    this.#key = key;
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
    const chords = spans.map((span) => {
      const chord = ChordClass.from(makeChord(span.rootPc, span.quality, span.bassPc));
      return key === undefined ? chord : chord.withKey(key);
    });
    return key === undefined ? new Progression(chords) : new Progression(chords, key);
  }

  /**
   * Rebuild a progression from its {@link Progression.toJSON} output.
   *
   * @param data The serialized chords and key.
   * @returns The progression.
   */
  static fromJSON(data: {
    chords: ChordData[];
    key?: { scale: KeyScale; tonic: NoteData } | undefined;
  }): Progression {
    const key = data.key === undefined ? undefined : KeyClass.fromJSON(data.key);
    const chords = data.chords.map((chord) => ChordClass.fromJSON(chord));
    return key === undefined ? new Progression(chords) : new Progression(chords, key);
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
    return voiceProgression(
      this.#chords.map((chord) => chord.data),
      opts,
    );
  }

  /**
   * The Roman numeral of each chord in a key.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @returns One numeral per chord.
   * @throws If no key is given and none is carried.
   */
  roman(key?: Key): string[] {
    const resolved = this.#resolveKey(key);
    return this.#chords.map((chord) => chord.roman(resolved));
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
   * @param key Key to analyze in; falls back to the carried context.
   * @returns Per-chord analyses and the closing cadence.
   * @throws If no key is given and none is carried.
   */
  analyze(key?: Key): { chords: ChordAnalysis[]; cadence: Cadence } {
    const resolved = this.#resolveKey(key);
    const chords = this.#chords.map((chord) => chord.analyze(resolved));
    const from = this.#chords[this.#chords.length - 2];
    const to = this.#chords[this.#chords.length - 1];
    const cadence =
      from !== undefined && to !== undefined
        ? detectCadence(from.data, to.data, resolved.scale)
        : null;
    return { chords, cadence };
  }

  /**
   * The plain progression data, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(progression)` from collapsing to `{}`. The chords are
   * emitted as plain data and the carried key, when present, as its own data.
   *
   * @returns The chord data sequence and the carried key, if any.
   */
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
    const chords = this.#chords.map((chord) => {
      const moved = chord.transpose(semitones);
      // A chord that carried no key of its own is spelled by this progression's
      // key, so it has to receive the transposed one or it would fall back to
      // sharps in a flat key.
      return key !== undefined && moved.key === undefined ? moved.withKey(key) : moved;
    });
    return key === undefined ? new Progression(chords) : new Progression(chords, key);
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

  toJSON(): { chords: ChordData[]; key: { scale: KeyScale; tonic: NoteData } | undefined } {
    return {
      chords: this.#chords.map((chord) => chord.data),
      key: this.#key?.toJSON(),
    };
  }

  /** Resolve the key for an analysis method: explicit first, then carried. */
  #resolveKey(key?: Key): Key {
    const resolved = key ?? this.#key;
    if (resolved === undefined) {
      throw new Error('progression has no key context; pass a Key or attach one with withKey()');
    }
    return resolved;
  }
}
