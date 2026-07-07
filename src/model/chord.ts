import { detectChord, detectChordBest } from '../analyze/detect/index.js';
import {
  analyzeChord,
  type BorrowedSource,
  borrowedSource,
  type ChordAnalysis,
  chordToRoman,
  functionOf,
  type HarmonicFunction,
  isBorrowedChord,
} from '../analyze/functional/index.js';
import { negativeHarmonyMirror } from '../generate/reharmony/index.js';
import {
  type Chord as ChordData,
  type ChordQuality,
  chordPitchClasses,
  makeChord,
} from '../theory/chord/index.js';
import {
  availableTensions,
  avoidNotes,
  type ChordScaleMatch,
  chordScales,
} from '../theory/chordscale/index.js';
import { spellChord } from '../theory/spelling/index.js';
import { formatChordSymbol, parseChordSymbol } from '../theory/symbol/index.js';
import {
  type StyledVoicingOptions,
  type VoicingOptions,
  voiceChord,
  voiceChordStyled,
} from '../theory/voicing/index.js';
import type { Key } from './key.js';
import { Note } from './note.js';
import { Progression } from './progression.js';
import { mod12 } from './shared.js';

/**
 * Defensive copy of a plain chord.
 *
 * Any enharmonic spelling hints (`rootSpelling`/`bassSpelling`, populated by
 * `parseChordSymbol`) are carried through so a flat-named chord round-trips
 * through the class API; a hint that no longer matches its pitch class is
 * simply ignored by the formatter.
 */
function copyChord(data: ChordData): ChordData {
  const copy: ChordData = {
    rootPc: data.rootPc,
    quality: data.quality,
    intervals: [...data.intervals],
  };
  if (data.bassPc !== undefined) {
    copy.bassPc = data.bassPc;
  }
  if (data.rootSpelling !== undefined) {
    copy.rootSpelling = { letter: data.rootSpelling.letter, alter: data.rootSpelling.alter };
  }
  if (data.bassSpelling !== undefined) {
    copy.bassSpelling = { letter: data.bassSpelling.letter, alter: data.bassSpelling.alter };
  }
  return copy;
}

/**
 * An immutable chord: a root pitch class, quality, interval template, and
 * optional slash bass, optionally carrying a {@link Key} context. Analysis
 * methods (`roman`, `function`, `analyze`, ...) use an explicitly passed key
 * first and fall back to the carried context.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Chord } from '@libraz/libcantus';
 * Chord.parse('Cmaj7').invert(1).symbol(); // 'Cmaj7/E' (third in the bass)
 * ```
 */
export class Chord {
  readonly #data: ChordData;
  readonly #key: Key | undefined;

  /**
   * Wrap a plain chord object.
   *
   * @param data The chord; it is copied, never retained or mutated.
   * @param key Optional key context for analysis methods.
   */
  constructor(data: ChordData, key?: Key) {
    this.#data = copyChord(data);
    this.#key = key;
  }

  /**
   * Build a chord from a root and quality.
   *
   * @param root Root as a note name (e.g. `'Eb'`) or a pitch class.
   * @param quality The chord quality.
   * @param bass Optional slash-chord bass pitch class.
   * @returns The chord (without key context).
   */
  static of(root: string | number, quality: ChordQuality, bass?: number): Chord {
    const rootPc = typeof root === 'string' ? Note.of(root).pitchClass : root;
    return new Chord(makeChord(rootPc, quality, bass));
  }

  /**
   * Wrap an existing plain chord object.
   *
   * @param data The plain chord.
   * @returns The wrapped chord (without key context).
   */
  static from(data: ChordData): Chord {
    return new Chord(data);
  }

  /**
   * Parse a lead-sheet chord symbol (e.g. `'Cmaj7'`, `'F#m7b5'`, `'C/G'`).
   *
   * @param symbol The chord symbol.
   * @returns The chord (without key context).
   * @throws If the root or quality is not recognized.
   */
  static parse(symbol: string): Chord {
    return new Chord(parseChordSymbol(symbol));
  }

  /**
   * Identify the chords matching a set of pitches, best interpretation first.
   *
   * @param pitches MIDI pitches or bare pitch classes.
   * @returns Ranked chord interpretations (may be empty).
   */
  static detect(pitches: number[]): Chord[] {
    return detectChord(pitches).map(
      (match) => new Chord(makeChord(match.rootPc, match.quality, match.bassPc)),
    );
  }

  /**
   * The single best chord interpretation of a pitch set.
   *
   * @param pitches MIDI pitches or bare pitch classes.
   * @returns The top-ranked chord, or null when nothing matches.
   */
  static detectBest(pitches: number[]): Chord | null {
    const best = detectChordBest(pitches);
    return best === null ? null : new Chord(best);
  }

  /** The root pitch class (0..11). */
  get rootPc(): number {
    return this.#data.rootPc;
  }

  /** The chord quality. */
  get quality(): ChordQuality {
    return this.#data.quality;
  }

  /** A copy of the semitone offsets above the root. */
  get intervals(): number[] {
    return [...this.#data.intervals];
  }

  /** The slash-chord bass pitch class, or undefined in root position. */
  get bassPc(): number | undefined {
    return this.#data.bassPc;
  }

  /** A copy of the underlying plain chord object. */
  get data(): ChordData {
    return copyChord(this.#data);
  }

  /** The carried key context, if any. */
  get key(): Key | undefined {
    return this.#key;
  }

  /**
   * A copy of this chord carrying the given key context.
   *
   * @param key The key context to attach.
   * @returns The new chord.
   */
  withKey(key: Key): Chord {
    return new Chord(this.#data, key);
  }

  /**
   * The chord's sorted, deduplicated pitch classes.
   *
   * @returns Pitch classes ascending in [0, 11].
   */
  pitchClasses(): number[] {
    return chordPitchClasses(this.#data);
  }

  /**
   * The chord's Roman numeral in a key.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @returns The Roman numeral string.
   * @throws If no key is given and none is carried.
   */
  roman(key?: Key): string {
    return chordToRoman(this.#data, this.#resolveKey(key).scale);
  }

  /**
   * The chord's harmonic function (tonic / subdominant / dominant) in a key.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @returns The harmonic function.
   * @throws If no key is given and none is carried.
   */
  function(key?: Key): HarmonicFunction {
    return functionOf(this.#data, this.#resolveKey(key).scale);
  }

  /**
   * Full functional analysis: function, borrowing, and Roman numeral.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @returns The chord analysis.
   * @throws If no key is given and none is carried.
   */
  analyze(key?: Key): ChordAnalysis {
    return analyzeChord(this.#data, this.#resolveKey(key).scale);
  }

  /**
   * Whether the chord is borrowed from the parallel mode (modal interchange).
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @returns True if the chord is borrowed.
   * @throws If no key is given and none is carried.
   */
  isBorrowed(key?: Key): boolean {
    return isBorrowedChord(this.#data, this.#resolveKey(key).scale);
  }

  /**
   * The origin of a non-diatonic chord (parallel mode or Neapolitan), or null.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @returns The borrowing source, or null.
   * @throws If no key is given and none is carried.
   */
  borrowedSource(key?: Key): BorrowedSource {
    return borrowedSource(this.#data, this.#resolveKey(key).scale);
  }

  /**
   * The chord rendered as a lead-sheet symbol (e.g. `'Cmaj7'`, `'F#m7'`, `'C/G'`).
   *
   * @param opts Set `flats: true` to spell the root/bass with flats.
   * @returns The chord symbol.
   */
  symbol(opts?: { flats?: boolean }): string {
    return formatChordSymbol(this.#data, opts);
  }

  /**
   * Realize the chord as one MIDI pitch per voice, ascending.
   *
   * @param opts Voicing options; defaults to four SATB voices.
   * @returns MIDI pitches, ascending, one per voice.
   * @throws If no voicing fits the given ranges.
   */
  voice(opts?: VoicingOptions): number[] {
    return voiceChord(this.#data, opts);
  }

  /**
   * Realize the chord as a single styled voicing (`close`, `drop2`, `drop3`,
   * `shell`, or `rootless`), optionally constraining the top voice.
   *
   * @param opts Styled-voicing options; defaults to a close-position voicing.
   * @returns MIDI pitches, ascending.
   */
  styledVoicing(opts?: StyledVoicingOptions): number[] {
    return voiceChordStyled(this.#data, opts);
  }

  /**
   * The negative-harmony mirror of the chord about the key's tonic–dominant
   * axis (major becomes minor and vice versa).
   *
   * @param key Key providing the reflection axis; falls back to the carried
   *   context.
   * @returns The mirrored chord, keeping any key context.
   * @throws If no key is given and none is carried.
   */
  negativeHarmony(key?: Key): Chord {
    const resolved = this.#resolveKey(key);
    // Retain the key that anchored the reflection (explicit first, then carried)
    // so a later no-arg analysis method still has a key context.
    return new Chord(negativeHarmonyMirror(this.#data, resolved.scale), key ?? this.#key);
  }

  /**
   * The n-th inversion: a copy whose bass is the chord tone `n` steps above the
   * root in the interval template (`invert(1)` puts the third in the bass).
   * `n` wraps around the template length; negative values count backwards.
   *
   * `invert(0)` (and any `n` that wraps to it) is root position, so it carries
   * no slash bass and equals the original chord.
   *
   * @param n The inversion number.
   * @returns The inverted chord, keeping any key context.
   * @throws If the chord has no intervals.
   */
  invert(n: number): Chord {
    const intervals = this.#data.intervals;
    const length = intervals.length;
    if (length === 0) {
      throw new Error('cannot invert a chord with no intervals');
    }
    const index = ((n % length) + length) % length;
    const data = copyChord(this.#data);
    if (index === 0) {
      delete data.bassPc;
    } else {
      data.bassPc = mod12(this.#data.rootPc + (intervals[index] ?? 0));
    }
    return new Chord(data, this.#key);
  }

  /**
   * The named scales that fit over this chord, best fit first, rooted on the
   * chord root.
   *
   * @returns The matching scales.
   */
  scales(): ChordScaleMatch[] {
    return chordScales(this.#data);
  }

  /**
   * The available tensions (usable non-chord, non-avoid scale tones) of a
   * scale over this chord.
   *
   * @param scaleName A named scale, rooted on the chord root.
   * @returns Tension pitch classes, ascending in [0, 11].
   */
  tensions(scaleName: string): number[] {
    return availableTensions(this.#data, scaleName);
  }

  /**
   * The avoid notes (scale tones a semitone above a chord tone) of a scale
   * over this chord.
   *
   * @param scaleName A named scale, rooted on the chord root.
   * @returns Avoid-note pitch classes, ascending in [0, 11].
   */
  avoidNotes(scaleName: string): number[] {
    return avoidNotes(this.#data, scaleName);
  }

  /**
   * Spell the chord tones with letter names, root first, in the key's spelling.
   *
   * @param key Key providing the spelled tonic; falls back to the carried
   *   context.
   * @returns Spelled octave-less notes in the chord's own (tertian) order.
   * @throws If no key is given and none is carried.
   */
  spell(key?: Key): Note[] {
    const resolved = this.#resolveKey(key);
    return spellChord(this.#data, resolved.tonic.data, resolved.scale).map(
      (note) => new Note(note),
    );
  }

  /**
   * Start a progression with this chord followed by others, carrying this
   * chord's key context (if any).
   *
   * @param others The chords following this one.
   * @returns The progression.
   */
  progressionTo(...others: Chord[]): Progression {
    return new Progression([this, ...others], this.#key);
  }

  /**
   * Whether another chord has the same root, quality, intervals, and bass.
   * Key context is not compared.
   *
   * @param other The chord to compare.
   * @returns True if the chord data is identical.
   */
  equals(other: Chord): boolean {
    const a = this.#data;
    const b = other.#data;
    return (
      a.rootPc === b.rootPc &&
      a.quality === b.quality &&
      a.bassPc === b.bassPc &&
      a.intervals.length === b.intervals.length &&
      a.intervals.every((interval, i) => interval === b.intervals[i])
    );
  }

  /**
   * The plain chord data, for JSON serialization.
   *
   * @returns A copy of the underlying plain chord object.
   */
  toJSON(): ChordData {
    return this.data;
  }

  /** Resolve the key for an analysis method: explicit first, then carried. */
  #resolveKey(key?: Key): Key {
    const resolved = key ?? this.#key;
    if (resolved === undefined) {
      throw new Error('chord has no key context; pass a Key or attach one with withKey()');
    }
    return resolved;
  }
}
