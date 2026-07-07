import {
  type Cadence,
  type ChordAnalysis,
  detectCadence,
  type HarmonicFunction,
} from '../analyze/functional/index.js';
import type { Note as NoteData } from '../core/pitch/index.js';
import type { KeyScale } from '../core/types.js';
import type { Chord as ChordData } from '../theory/chord/index.js';
import { type VoicingOptions, voiceProgression } from '../theory/voicing/index.js';
import type { Chord } from './chord.js';
import type { Key } from './key.js';

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
    this.#chords = [...chords];
    this.#key = key;
  }

  /** A copy of the chord sequence. */
  get chords(): readonly Chord[] {
    return [...this.#chords];
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
