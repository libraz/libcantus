import type { ChordMatch, DetectChordOptions } from '../analyze/detect/index.js';
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
  type PitchSpelling,
  transposeChord,
} from '../theory/chord/index.js';
import {
  availableTensions,
  avoidNotes,
  type ChordScaleMatch,
  chordScales,
} from '../theory/chordscale/index.js';
import { spellChord, spellChordFromRoot, spellPitchClass } from '../theory/spelling/index.js';
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
 * Spell the slash bass of a chord whose root spelling is already settled.
 *
 * A bass that is one of the chord's own tones takes that tone's spelling, so
 * `Eb/Bb` never renders as `Eb/A#`; a bass outside the chord is spelled by the
 * key when one is available.
 */
function deriveBassSpelling(chord: ChordData, key: Key | undefined): PitchSpelling | undefined {
  const bassPc = chord.bassPc;
  if (bassPc === undefined) {
    return undefined;
  }
  const root = chord.rootSpelling;
  if (root !== undefined) {
    const index = chord.intervals.findIndex((i) => mod12(chord.rootPc + i) === bassPc);
    const tone = index >= 0 ? spellChordFromRoot(chord, root)[index] : undefined;
    if (tone !== undefined) {
      return { letter: tone.letter, alter: tone.alter };
    }
  }
  if (key === undefined) {
    return undefined;
  }
  const spelled = spellPitchClass(bassPc, key.tonic.data, key.scale);
  return { letter: spelled.letter, alter: spelled.alter };
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
  /** Exactly what the caller supplied: any spelling here is the caller's own. */
  readonly #given: ChordData;
  readonly #key: Key | undefined;

  /**
   * Wrap a plain chord object.
   *
   * @param data The chord; it is copied, never retained or mutated.
   * @param key Optional key context for analysis methods.
   */
  constructor(data: ChordData, key?: Key) {
    this.#given = copyChord(data);
    this.#key = key;
  }

  /**
   * The chord data with any missing spelling hint filled in from the key.
   *
   * Derived spellings are computed on read rather than baked in at construction,
   * so re-attaching a different key re-spells the chord instead of carrying the
   * first key's letters forever. A spelling the caller supplied always wins.
   */
  get #data(): ChordData {
    const out = copyChord(this.#given);
    const key = this.#key;
    if (out.rootSpelling === undefined && key !== undefined) {
      out.rootSpelling = spellPitchClass(out.rootPc, key.tonic.data, key.scale);
    }
    if (out.bassSpelling === undefined) {
      const bass = deriveBassSpelling(out, key);
      if (bass !== undefined) {
        out.bassSpelling = bass;
      }
    }
    return out;
  }

  /**
   * Build a chord from a root and quality.
   *
   * @param root Root as a note name (e.g. `'Eb'`) or a pitch class.
   * @param quality The chord quality.
   * @param bass Optional slash-chord bass, as a note name (e.g. `'Bb'`) or a
   *   pitch class. A named bass keeps its own spelling.
   * @returns The chord (without key context).
   */
  static of(root: string | number, quality: ChordQuality, bass?: string | number): Chord {
    const bassNote = typeof bass === 'string' ? Note.of(bass) : undefined;
    const bassPc = bassNote !== undefined ? bassNote.pitchClass : (bass as number | undefined);
    const rootNote = typeof root === 'string' ? Note.of(root) : undefined;
    const data = makeChord(
      rootNote !== undefined ? rootNote.pitchClass : (root as number),
      quality,
      bassPc,
    );
    if (rootNote !== undefined) {
      data.rootSpelling = { letter: rootNote.letter, alter: rootNote.alter };
    }
    if (bassNote !== undefined) {
      data.bassSpelling = { letter: bassNote.letter, alter: bassNote.alter };
    }
    return new Chord(data);
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
   * Alias of {@link Chord.from}, matching the `fromData` factory on the other
   * classes.
   *
   * @param data The plain chord.
   * @returns The wrapped chord (without key context).
   */
  static fromData(data: ChordData): Chord {
    return new Chord(data);
  }

  /**
   * Rebuild a chord from its {@link Chord.toJSON} output.
   *
   * The key context is not serialized, so the result carries none; re-attach
   * one with {@link Chord.withKey}.
   *
   * @param data The serialized chord.
   * @returns The wrapped chord.
   */
  static fromJSON(data: ChordData): Chord {
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
   * @param opts How to interpret the input; see {@link DetectChordOptions}.
   * @returns Ranked chord interpretations (may be empty).
   */
  static detect(pitches: number[], opts?: DetectChordOptions): Chord[] {
    return detectChord(pitches, opts).map(
      (match) => new Chord(makeChord(match.rootPc, match.quality, match.bassPc)),
    );
  }

  /**
   * Identify the chords matching a set of pitches, keeping each match's
   * recognition metadata beside the chord.
   *
   * {@link Chord.detect} discards the confidence signals a recognition UI needs
   * — whether the set matched exactly, which chord tones were missing, which
   * input notes were foreign, and which inversion the bass implies.
   *
   * @param pitches MIDI pitches or bare pitch classes.
   * @param opts How to interpret the input; see {@link DetectChordOptions}.
   * @returns Ranked interpretations, each with its chord and its match record.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * const [best] = Chord.detectMatches([60, 64, 67]);
   * best?.match.exact; // true
   * ```
   */
  static detectMatches(
    pitches: number[],
    opts?: DetectChordOptions,
  ): { chord: Chord; match: ChordMatch }[] {
    return detectChord(pitches, opts).map((match) => ({
      chord: new Chord(makeChord(match.rootPc, match.quality, match.bassPc)),
      match,
    }));
  }

  /**
   * The single best chord interpretation of a pitch set.
   *
   * @param pitches MIDI pitches or bare pitch classes.
   * @param opts How to interpret the input; see {@link DetectChordOptions}.
   * @returns The top-ranked chord, or null when nothing matches.
   */
  static detectBest(pitches: number[], opts?: DetectChordOptions): Chord | null {
    const best = detectChordBest(pitches, opts);
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

  /**
   * A copy of the underlying plain chord object, including the spellings
   * derived from any attached key.
   */
  get data(): ChordData {
    return this.#data;
  }

  /** The carried key context, if any. */
  get key(): Key | undefined {
    return this.#key;
  }

  /**
   * A copy of this chord carrying the given key context.
   *
   * Only a spelling the caller supplied (via `Chord.parse`, `Chord.of` with a
   * named root, or plain data carrying a hint) survives; a spelling that came
   * from a previously attached key is re-derived, so re-keying a progression
   * during a modulation does not keep the old key's letters and the order of
   * `withKey` calls does not affect the result.
   *
   * @param key The key context to attach.
   * @returns The new chord.
   */
  withKey(key: Key): Chord {
    return new Chord(this.#given, key);
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
   * A chord that carries a key passes it to the voicer, so the leading tone is
   * not doubled; an explicit `opts.key` overrides it.
   *
   * @param opts Voicing options; defaults to four SATB voices.
   * @returns MIDI pitches, ascending, one per voice.
   * @throws If no voicing fits the given ranges.
   */
  voice(opts?: VoicingOptions): number[] {
    const key = opts?.key ?? this.#key?.scale;
    return voiceChord(this.#data, key === undefined ? opts : { ...opts, key });
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
    const data = copyChord(this.#given);
    const intervals = data.intervals;
    const length = intervals.length;
    if (length === 0) {
      throw new Error('cannot invert a chord with no intervals');
    }
    const index = ((n % length) + length) % length;
    // The bass spelling follows from the root spelling in force at read time, so
    // it is derived rather than frozen in here.
    delete data.bassSpelling;
    if (index === 0) {
      delete data.bassPc;
    } else {
      data.bassPc = mod12(data.rootPc + (intervals[index] ?? 0));
    }
    return new Chord(data, this.#key);
  }

  /**
   * Transpose the chord by a number of semitones.
   *
   * The quality and interval template are carried over, so a chord that a
   * symbol round-trip could not express — a custom interval set, an inversion —
   * survives. A carried key moves with the chord, so the transposed chord keeps
   * the same degree and function inside the transposed key.
   *
   * @param semitones The signed semitone offset.
   * @returns The transposed chord, in the transposed key when one is carried.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('C/G').transpose(2).symbol(); // 'D/A'
   * ```
   */
  transpose(semitones: number): Chord {
    const moved = transposeChord(this.#given, semitones);
    return new Chord(moved, this.#key?.transpose(semitones));
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
   * A chord that already knows how its root is spelled — one from
   * `Chord.parse`, or `Chord.of` with a named root — can spell itself with no
   * key at all; a key is only needed to choose a spelling for a bare pitch
   * class.
   *
   * @param key Key providing the spelled tonic; falls back to the carried
   *   context, then to the chord's own root spelling.
   * @returns Spelled octave-less notes in the chord's own (tertian) order.
   * @throws If no key is given, none is carried, and the chord has no root
   *   spelling of its own.
   */
  spell(key?: Key): Note[] {
    const data = this.#data;
    const resolved = key ?? this.#key;
    if (resolved === undefined) {
      const root = data.rootSpelling;
      if (root === undefined) {
        throw new Error(
          'chord has no key context and no root spelling; pass a Key, attach one with withKey(), or build the chord from a symbol',
        );
      }
      return spellChordFromRoot(data, root).map((note) => new Note(note));
    }
    return spellChord(data, resolved.tonic.data, resolved.scale).map((note) => new Note(note));
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
    const b = other.data;
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

  /**
   * The chord symbol, so a template literal or a log line reads as the chord.
   *
   * @returns The symbol, e.g. `'Cmaj7'`.
   */
  toString(): string {
    return this.symbol();
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
