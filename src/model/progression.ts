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
import type { SubstituteOptions, SubstitutionType } from '../generate/reharmony/index.js';
import { substituteChord } from '../generate/reharmony/index.js';
import type { Chord as ChordData, ChordSpan } from '../theory/chord/index.js';
import { chordFromSpan } from '../theory/chord/index.js';
import { type ScaleChoice, scalesForChanges } from '../theory/chordscale/index.js';
import { type VoicingOptions, voiceProgression } from '../theory/voicing/index.js';
import type { Chord } from './chord.js';
import { Chord as ChordClass } from './chord.js';
import type { Key, KeyData } from './key.js';
import { Key as KeyClass } from './key.js';
import { Timeline } from './timeline.js';

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
   * A new progression with every chord replaced by what `fn` returns for it.
   *
   * The result is a progression rather than an array, and it carries this
   * progression's key context, so a transformation stays inside the class
   * instead of dropping out of it and having to be rebuilt. This progression is
   * untouched.
   *
   * The key reaches the returned chords the way the constructor attaches it, so
   * a chord `fn` built without one is still spelled and analyzed in this key.
   *
   * @param fn Called with each chord and its 0-based index.
   * @returns The mapped progression.
   * @example
   * ```ts
   * import { Chord, Key, Progression } from '@libraz/libcantus';
   * const progression = new Progression([Chord.parse('C'), Chord.parse('G')], Key.major('C'));
   * const moved = progression.map((chord) => chord.transpose(2));
   * moved.toString(); // 'D A'
   * moved.key?.toString(); // 'C major'
   * progression.toString(); // 'C G' — the original is unchanged
   * ```
   */
  map(fn: (chord: Chord, index: number) => Chord): Progression {
    return new Progression(
      this.#chords.map((chord, index) => fn(chord, index)),
      this.#key,
    );
  }

  /**
   * A new progression holding only the chords `pred` accepts, in order.
   *
   * The key context travels with them and this progression is untouched.
   *
   * @param pred Called with each chord and its 0-based index.
   * @returns The filtered progression, empty when nothing is accepted.
   * @example
   * ```ts
   * import { Chord, Key, Progression } from '@libraz/libcantus';
   * const progression = new Progression(
   *   [Chord.parse('C'), Chord.parse('Am'), Chord.parse('F'), Chord.parse('G')],
   *   Key.major('C'),
   * );
   * progression.filter((chord) => chord.quality === 'maj').toString(); // 'C F G'
   * ```
   */
  filter(pred: (chord: Chord, index: number) => boolean): Progression {
    return new Progression(
      this.#chords.filter((chord, index) => pred(chord, index)),
      this.#key,
    );
  }

  /**
   * A stretch of this progression, as a progression carrying the same key.
   *
   * The bounds read as `Array.prototype.slice` reads them: `end` is exclusive,
   * a negative index counts from the end, and an omitted bound runs to the edge.
   *
   * @param start First chord of the stretch; defaults to the beginning.
   * @param end One past the last chord; defaults to the end.
   * @returns The sliced progression.
   * @example
   * ```ts
   * import { Chord, Key, Progression } from '@libraz/libcantus';
   * const progression = new Progression(
   *   [Chord.parse('C'), Chord.parse('Am'), Chord.parse('F')],
   *   Key.major('C'),
   * );
   * progression.slice(1).toString(); // 'Am F'
   * progression.slice(0, 2).toString(); // 'C Am'
   * ```
   */
  slice(start?: number, end?: number): Progression {
    return new Progression(this.#chords.slice(start, end), this.#key);
  }

  /**
   * This progression followed by another run of chords.
   *
   * The result carries this progression's key context; a key the other
   * progression carried is dropped, because two keys cannot both analyze one
   * chord sequence. Re-key the result with {@link Progression.withKey} where the
   * second run is the one to read it in.
   *
   * @param other The chords to append, as a progression or a plain array.
   * @returns The joined progression.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * const key = Key.major('C');
   * key.progression('I', 'vi').concat(key.progression('IV', 'V')).roman();
   * // ['I', 'vi', 'IV', 'V']
   * ```
   */
  concat(other: Progression | readonly Chord[]): Progression {
    // Read structurally rather than with `instanceof`: the package ships an ESM
    // and a CommonJS build, so a consumer reaching the two through different
    // conditions holds two `Progression` classes.
    const chords: readonly Chord[] = 'chords' in other ? other.chords : other;
    return new Progression([...this.#chords, ...chords], this.#key);
  }

  /**
   * The position of the first chord equal to `chord`.
   *
   * Equality is {@link Chord.equals}, not reference identity, so a chord built
   * separately is found as long as it names the same harmony.
   *
   * @param chord The chord to look for.
   * @returns The 0-based position, or -1 when the progression holds no such
   *   chord.
   * @example
   * ```ts
   * import { Chord, Progression } from '@libraz/libcantus';
   * const progression = new Progression([Chord.parse('C'), Chord.parse('G7')]);
   * progression.indexOf(Chord.of('G', 'dom7')); // 1
   * progression.indexOf(Chord.parse('F')); // -1
   * ```
   */
  indexOf(chord: Chord): number {
    return this.#chords.findIndex((mine) => mine.equals(chord));
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
   * Classify the motion at every chord change, not only the closing one.
   *
   * One entry per adjacent pair, so entry `i` is the motion from chord `i` to
   * chord `i + 1` and the list is one shorter than the progression. A pair that
   * cadences not at all keeps its place with a null `type`, which is what lets a
   * caller read a cadence back against the chord it arrives on — a progression
   * has no beats to name it by.
   *
   * The chord before each pair is supplied from the progression itself, so a
   * cadential six-four is recognized as one wherever it stands.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @param opts `voicing` is the pitches sounding under the whole progression,
   *   one voicing per chord as {@link Progression.voice} produces them, from
   *   which each pair takes its own two — without it no authentic cadence can be
   *   graded perfect or imperfect. `alternatives` collects the readings each
   *   pair came close to, and `approach` is the chord sounding before the
   *   progression began, which only the first pair has no predecessor of its
   *   own for. See {@link DetectCadenceOptions}, whose fields these are.
   * @returns One cadence per adjacent pair, in order.
   * @throws If no key is given and none is carried.
   * @example
   * ```ts
   * import { Chord, Key, Progression } from '@libraz/libcantus';
   * const progression = new Progression(
   *   [Chord.parse('C'), Chord.parse('F'), Chord.parse('G7'), Chord.parse('C')],
   *   Key.major('C'),
   * );
   * progression.cadences().map((cadence) => cadence.type); // [null, 'half', 'authentic']
   * ```
   */
  cadences(
    key?: Key,
    opts?: { voicing?: number[][]; alternatives?: boolean; approach?: Chord },
  ): CadenceResult[] {
    const resolved = this.#resolveKey(key);
    const found: CadenceResult[] = [];
    for (let index = 1; index < this.#chords.length; index += 1) {
      const from = this.#chords[index - 1];
      const to = this.#chords[index];
      if (from === undefined || to === undefined) {
        continue;
      }
      const approach = index >= 2 ? this.#chords[index - 2] : opts?.approach;
      const pair = opts?.voicing;
      found.push(
        detectCadence(from.data, to.data, resolved.scale, {
          ...(opts?.alternatives === undefined ? {} : { alternatives: opts.alternatives }),
          ...(approach === undefined ? {} : { approach: approach.data }),
          ...(pair === undefined
            ? {}
            : { voicing: [pair[index - 1] ?? [], pair[index] ?? []] as [number[], number[]] }),
        }),
      );
    }
    return found;
  }

  /**
   * A copy of this progression with one chord replaced by a substitute.
   *
   * The substitutions are the ones {@link substituteChord} proposes for that
   * chord in this progression's key, and the first of the named kind is taken.
   * Each is spelled the way the key writes it, so the tritone substitute of G7
   * in C major arrives as Db7 rather than C#7.
   *
   * @param index 0-based position of the chord to replace; a negative index
   *   counts from the end, as {@link Progression.at} counts it.
   * @param type Which substitution relationship to realize.
   * @param opts `melodyPcs` keeps only substitutes that contain those pitch
   *   classes, so a melody stays consonant against the new harmony; see
   *   {@link SubstituteOptions}.
   * @returns The progression with the substitute in place.
   * @throws If the index names no chord, if the progression carries no key
   *   context, or if that chord has no substitution of the named kind.
   * @example
   * ```ts
   * import { Chord, Key, Progression } from '@libraz/libcantus';
   * const progression = new Progression([Chord.parse('G7'), Chord.parse('C')], Key.major('C'));
   * progression.substitute(0, 'tritone').toString(); // 'Db7 C'
   * ```
   */
  substitute(index: number, type: SubstitutionType, opts?: SubstituteOptions): Progression {
    const position = index < 0 ? this.#chords.length + index : index;
    const target = this.#chords[position];
    if (target === undefined) {
      throw new InvalidInputError(
        `progression has no chord at index ${index}; it holds ${this.#chords.length}`,
      );
    }
    const key = this.#resolveKey();
    const chosen = substituteChord(target.data, key.scale, opts).find(
      (candidate) => candidate.type === type,
    );
    if (chosen === undefined) {
      throw new InvalidInputError(
        `no ${type} substitution for ${target.symbol()} in ${key.toString()}`,
      );
    }
    const chords = [...this.#chords];
    chords[position] = new ChordClass(chosen.chord);
    return new Progression(chords, key);
  }

  /**
   * Place the chords on a regular grid, giving each the same number of beats.
   *
   * The inverse of {@link Timeline.progression}, which drops the time axis
   * again. A carried key becomes the one key region under the span.
   *
   * @param beatsEach How long each chord sounds.
   * @returns The timeline.
   * @throws If `beatsEach` is not a positive finite number of beats.
   * @example
   * ```ts
   * import { Chord, Key, Progression } from '@libraz/libcantus';
   * const progression = new Progression([Chord.parse('C'), Chord.parse('G7')], Key.major('C'));
   * progression.timeline(4).at(5)?.symbol(); // 'G7'
   * ```
   */
  timeline(beatsEach: number): Timeline {
    return Timeline.fromProgression(this, beatsEach);
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
