import type { ChordMatch, DetectChordOptions } from '../analyze/detect/index.js';
import { detectChord, detectChordBest } from '../analyze/detect/index.js';
import {
  type AnalyzeChordOptions,
  analyzeChord,
  type BorrowedSource,
  borrowedSource,
  type ChordAnalysis,
  type ChordToRomanOptions,
  chordToRoman,
  type ExplainRomanOptions,
  explainRoman,
  functionOf,
  type HarmonicFunction,
  isBorrowedChord,
  type RomanExplanation,
  secondaryDominantOf,
} from '../analyze/functional/index.js';
import { InvalidInputError, type ParseResult, unwrapParse } from '../core/errors/index.js';
import type {
  IntervalLike,
  Note as NoteData,
  NoteLike,
  NoteNameOptions,
  SpelledInterval,
} from '../core/pitch/index.js';
import {
  noteToPitchClass,
  pitchClassOf,
  toNoteData,
  toSpelledInterval,
  transposeByInterval,
  transposeNote,
} from '../core/pitch/index.js';
import type { KeyScale } from '../core/types.js';
import { assertFiniteNumber } from '../core/validation/index.js';
import {
  type BorrowedChord,
  modalInterchangePalette,
  negativeHarmonyMirror,
  type SubstituteOptions,
  type Substitution,
  substituteChord,
} from '../generate/reharmony/index.js';
import {
  type Chord as ChordData,
  type ChordQuality,
  type ChordSpan,
  type ChordSpec,
  type ChordToneRole,
  chordPitchClasses,
  chordSpecOf,
  chordToneRole,
  chordToneSpellings,
  isChordMember,
  makeChord,
  type PitchSpelling,
  spanFromChord,
  transposeChord,
} from '../theory/chord/index.js';
import {
  type AvailableTensionsOptions,
  type AvoidNotesOptions,
  availableTensions,
  avoidNotes,
  type ChordScaleMatch,
  type ChordScaleReportEntry,
  chordScaleReport,
  chordScales,
} from '../theory/chordscale/index.js';
import { figuredBassOf, realizeFiguredBass } from '../theory/figured-bass/index.js';
import { type KeyLike, type ScaleNameInput, toKeyScale } from '../theory/scale/index.js';
import { spellChord, spellChordFromRoot, spellPitchClass } from '../theory/spelling/index.js';
import {
  type ChordSymbolOptions,
  formatChordSymbol,
  tryParseChordSymbol,
} from '../theory/symbol/index.js';
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

/** Whether a spelling hint still names the pitch class it is attached to. */
function hintMatches(hint: PitchSpelling | undefined, pc: number | undefined): boolean {
  return hint !== undefined && pc !== undefined && mod12(noteToPitchClass(hint)) === mod12(pc);
}

/** Move an explicit spelling hint without turning it into a derived key spelling. */
function transposeHint(
  hint: PitchSpelling | undefined,
  semitones: number,
): PitchSpelling | undefined {
  if (hint === undefined) {
    return undefined;
  }
  const moved = transposeNote(hint, semitones);
  return { letter: moved.letter, alter: moved.alter };
}

/**
 * Move an explicit spelling hint by a spelled interval.
 *
 * The interval's diatonic number picks the letter, so a C chord taken up an
 * augmented fourth is spelled F# and up a diminished fifth Gb — the distinction
 * {@link transposeHint} cannot make from a semitone count alone.
 */
function transposeHintByInterval(
  hint: PitchSpelling | undefined,
  interval: SpelledInterval,
): PitchSpelling | undefined {
  if (hint === undefined) {
    return undefined;
  }
  const moved = transposeByInterval(hint, interval);
  return { letter: moved.letter, alter: moved.alter };
}

/**
 * Move a chord's per-tone spelling hints with the chord.
 *
 * Every tone takes the same letter distance, so the distances between them
 * survive: the German sixth's augmented sixth is still five letters above its
 * root afterwards, whichever letters the two of them land on.
 */
function transposeToneHints(
  hints: PitchSpelling[] | undefined,
  semitones: number,
): PitchSpelling[] | undefined {
  return hints?.map((hint) => {
    const moved = transposeNote(hint, semitones);
    return { letter: moved.letter, alter: moved.alter };
  });
}

/** Move a chord's per-tone spelling hints by a spelled interval. */
function transposeToneHintsByInterval(
  hints: PitchSpelling[] | undefined,
  interval: SpelledInterval,
): PitchSpelling[] | undefined {
  return hints?.map((hint) => {
    const moved = transposeByInterval(hint, interval);
    return { letter: moved.letter, alter: moved.alter };
  });
}

/**
 * Defensive copy of a plain chord.
 *
 * The root and bass are reduced to pitch classes by the same helper
 * {@link makeChord} uses, because this is the other way a chord is built: data
 * arriving from a project file or a plugin would otherwise keep a root of 25
 * that every getter reports verbatim and `equals` compares against a 1 it never
 * matches.
 *
 * Enharmonic spelling hints (`rootSpelling`/`bassSpelling`, populated by
 * `parseChordSymbol`, and the per-tone `toneSpellings` an augmented sixth
 * carries) are carried through so a flat-named chord round-trips through the
 * class API — but only while they still name their own pitch class. A stale
 * hint is dropped here rather than passed on, so that everything downstream,
 * including the derived bass spelling, reads a hint it can trust.
 */
function copyChord(data: ChordData): ChordData {
  const copy: ChordData = {
    rootPc: pitchClassOf(data.rootPc),
    quality: data.quality,
    // Each offset is checked rather than copied blind: a chord holding a NaN
    // interval voices, spells and formats as a chord that looks real, and the
    // failure surfaces wherever the number is finally used.
    intervals: data.intervals.map((interval, index) =>
      assertFiniteNumber(interval, `chord intervals[${index}]`),
    ),
  };
  if (data.bassPc !== undefined) {
    copy.bassPc = pitchClassOf(data.bassPc);
  }
  const tones = chordToneSpellings(data);
  if (tones !== undefined) {
    copy.toneSpellings = tones;
  }
  if (hintMatches(data.rootSpelling, data.rootPc) && data.rootSpelling !== undefined) {
    copy.rootSpelling = { letter: data.rootSpelling.letter, alter: data.rootSpelling.alter };
  }
  if (hintMatches(data.bassSpelling, data.bassPc) && data.bassSpelling !== undefined) {
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
    return this.#dataWithKey(this.#key);
  }

  /** Build a read view whose missing spellings are derived from `key`. */
  #dataWithKey(key: Key | undefined): ChordData {
    const out = copyChord(this.#given);
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
    const bassNote = typeof bass === 'string' ? Note.parse(bass) : undefined;
    const bassPc = bassNote !== undefined ? bassNote.pitchClass : (bass as number | undefined);
    const rootNote = typeof root === 'string' ? Note.parse(root) : undefined;
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
   * The chord a figured bass names: a bass note, the figures written under it,
   * and the key that supplies every interval the figures leave unaltered.
   *
   * The inverse of {@link Chord.figuredBass}, and a static because the figures
   * build a chord rather than read one. The result carries the given bass as
   * its slash bass, so an inversion reads as one wherever a bass is measured
   * against a root, and it keeps the letters the figures asked for. A moving
   * figure such as `4-3` yields the chord it resolves into.
   *
   * No key context is attached — the key here decides what the figures mean,
   * not how the chord is later analyzed — so use {@link Chord.withKey} to carry
   * one on.
   *
   * @param bass The bass note, spelled, as a note name, a MIDI number, or a
   *   {@link Note}; its octave, if any, is not used.
   * @param figures The figures written under the bass; empty for an unfigured
   *   note.
   * @param key The prevailing key; a key name, a plain key/scale, or a
   *   {@link Key}.
   * @returns The chord the figures name (without key context).
   * @throws If the figures are malformed or name no chord, if the key is not
   *   heptatonic, or if the figures sound a chord no {@link ChordQuality}
   *   names.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.fromFiguredBass('B', '6', 'C major').symbol(); // 'G/B'
   * Chord.fromFiguredBass('G', '#', 'C minor').symbol(); // 'G'
   * ```
   */
  static fromFiguredBass(bass: NoteLike, figures: string, key: KeyLike): Chord {
    return new Chord(realizeFiguredBass(toNoteData(bass), figures, toKeyScale(key)));
  }

  /**
   * Parse a lead-sheet chord symbol (e.g. `'Cmaj7'`, `'F#m7b5'`, `'C/G'`).
   *
   * A symbol is English unless a system is asked for: unlike {@link Key.parse},
   * which reads the notation system off the name, `'B'` here is always the B
   * natural until `'german'` says otherwise.
   *
   * @param symbol The chord symbol.
   * @param opts `system` reads the root and bass in that notation system
   *   instead of English.
   * @returns The chord (without key context).
   * @throws If the root or quality is not recognized. Use
   *   {@link Chord.tryParse} where failure is ordinary, such as a chord field
   *   read on every keystroke.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('H7', { system: 'german' }).symbol(); // 'B7'
   * ```
   */
  static parse(symbol: string, opts?: NoteNameOptions): Chord {
    return unwrapParse(Chord.tryParse(symbol, opts));
  }

  /**
   * Parse a lead-sheet chord symbol, reporting failure instead of throwing it.
   *
   * The same reading as {@link Chord.parse}, for the callers where a symbol
   * that does not parse yet is the normal state of the input rather than a
   * fault: a chord field can show what is wrong with what has been typed so far
   * without a `try` around every keystroke.
   *
   * @param symbol The chord symbol.
   * @param opts `system` reads the root and bass in that notation system
   *   instead of English.
   * @returns The chord (without key context), or the error explaining why the
   *   text is not one.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * const result = Chord.tryParse('Cmaj7(#11)');
   * result.ok ? result.value.symbol() : result.error.message; // 'Cmaj7#11'
   * ```
   */
  static tryParse(symbol: string, opts?: NoteNameOptions): ParseResult<Chord> {
    const parsed = tryParseChordSymbol(symbol, opts);
    return parsed.ok ? { ok: true, value: new Chord(parsed.value) } : parsed;
  }

  /**
   * Identify the chords matching a set of pitches, best interpretation first.
   *
   * @param pitches MIDI pitches or bare pitch classes.
   * @param opts How to interpret the input; see {@link DetectChordOptions}.
   * @returns Ranked chord interpretations (may be empty).
   */
  static detect(pitches: readonly number[], opts?: DetectChordOptions): Chord[] {
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
    pitches: readonly number[],
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
  static detectBest(pitches: readonly number[], opts?: DetectChordOptions): Chord | null {
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

  /**
   * The chord read structurally: the triad it is built on, its seventh, and the
   * alterations, additions and omissions on top of them.
   *
   * The reading comes from the tones themselves, so a chord no symbol names —
   * a detected pitch set, a custom interval template — still describes itself;
   * only a template with no structural reading at all falls back to the one its
   * quality names.
   *
   * @throws If the chord's template has no reading and its quality is unknown.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('Cmaj7').spec.base; // 'maj'
   * Chord.parse('C/E').spec.bassPc; // 4
   * ```
   */
  get spec(): ChordSpec {
    return chordSpecOf(this.#data);
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
   * A slash bass is one of them, because the chord sounds it.
   *
   * @param opts Set `includeBass: false` to enumerate the interval template
   *   alone, leaving a slash bass out.
   * @returns Pitch classes ascending in [0, 11].
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('F/G').pitchClasses(); // [0, 5, 7, 9]
   * Chord.parse('F/G').pitchClasses({ includeBass: false }); // [0, 5, 9]
   * ```
   */
  pitchClasses(opts?: { includeBass?: boolean }): number[] {
    return chordPitchClasses(this.#data, opts);
  }

  /**
   * Whether a pitch is one of the chord's tones, ignoring octave.
   *
   * A slash bass counts, as it does in {@link Chord.pitchClasses}: the chord
   * sounds it.
   *
   * @param pitch A MIDI pitch or a bare pitch class.
   * @returns True when the pitch class belongs to the chord.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('Cmaj7').contains(64); // true
   * Chord.parse('Cmaj7').contains(62); // false
   * ```
   */
  contains(pitch: number): boolean {
    return isChordMember(pitch, this.#data);
  }

  /**
   * A pitch's harmonic role in the chord: root, third, fifth, sixth, or
   * seventh.
   *
   * The role follows the pitch's interval above the root, so it answers for the
   * chord's own template rather than for the interval alone: the diminished
   * fifth of a half-diminished seventh is its fifth, while the same interval
   * over a chord that already has a perfect fifth is a `#11` tension and has no
   * basic role.
   *
   * @param pitch A MIDI pitch or a bare pitch class.
   * @returns The chord-tone role, or null when the pitch is a tension or a
   *   foreign note.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('Cmaj7').roleOf(67); // 'fifth'
   * Chord.parse('Cmaj7').roleOf(62); // null
   * ```
   */
  roleOf(pitch: number): ChordToneRole | null {
    return chordToneRole(pitch, this.#data);
  }

  /**
   * The chord's Roman numeral in a key.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @param opts Applied-numeral rendering options.
   * @returns The Roman numeral string.
   * @throws If no key is given and none is carried.
   */
  roman(key?: Key, opts?: ChordToRomanOptions): string {
    return chordToRoman(this.#data, this.#resolveKey(key).scale, opts);
  }

  /**
   * The chord's Roman numeral together with the reasoning behind it: the degree
   * its root was read as, the quality that set the numeral's case and suffix,
   * and what became of the bass.
   *
   * The numeral is exactly the one {@link Chord.roman} gives for the same
   * arguments, so this is that method with its rationale attached — for
   * teaching material, and for any interface whose users argue with the
   * analysis. Ask for `alternatives` to see the numerals the other option
   * settings would have rendered, and why this one was rendered instead.
   *
   * @param key Key to analyze in; a key name, a plain key/scale, or a
   *   {@link Key}. Falls back to the carried context.
   * @param opts The rendering options {@link Chord.roman} takes, plus
   *   `alternatives` to collect the readings this one turned down; see
   *   {@link ExplainRomanOptions}.
   * @returns The numeral, its rationale, and the rejected readings.
   * @throws If no key is given and none is carried.
   * @example
   * ```ts
   * import { Chord, Key } from '@libraz/libcantus';
   * Chord.parse('G7').explain(Key.major('C')).roman; // 'V7'
   * Chord.parse('D7').explain('C major', { alternatives: true }).alternatives.length;
   * ```
   */
  explain(key?: KeyLike, opts?: ExplainRomanOptions): RomanExplanation {
    return explainRoman(this.#data, this.#resolveScale(key), opts);
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
   * Full functional analysis: function, borrowing, Roman numeral, and the
   * rationale behind them.
   *
   * @param key Key to analyze in; falls back to the carried context.
   * @param opts Applied-numeral rendering options, plus `alternatives` to
   *   collect the readings this analysis turned down; see
   *   {@link AnalyzeChordOptions}.
   * @returns The chord analysis.
   * @throws If no key is given and none is carried.
   * @example
   * ```ts
   * import { Chord, Key } from '@libraz/libcantus';
   * Chord.parse('D7').analyze(Key.major('C'), { alternatives: true }).alternatives.length;
   * ```
   */
  analyze(key?: Key, opts?: AnalyzeChordOptions): ChordAnalysis {
    return analyzeChord(this.#data, this.#resolveKey(key).scale, opts);
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
   * The chord written as the figures a bass would carry under it: `6`, `64`,
   * `7`, `65`, `43`, `42`, or nothing at all for a root-position triad, with an
   * accidental on any interval the key does not already give.
   *
   * The bass the figures are measured above is the chord's own slash bass, or
   * its root in root position.
   *
   * @param key Key deciding which intervals need no accidental; a key name, a
   *   plain key/scale, or a {@link Key}. Falls back to the carried context.
   * @returns The figures, as `realizeFiguredBass` reads them.
   * @throws If no key is given and none is carried, if the key is not
   *   heptatonic, or if no figure names the chord — its bass is not one of its
   *   tones, its tones do not stack in diatonic thirds above that bass, or it
   *   is an added-tone or extended chord the notation has no abbreviation for.
   * @example
   * ```ts
   * import { Chord, Key } from '@libraz/libcantus';
   * Chord.parse('G/B').figuredBass(Key.major('C')); // '6'
   * Chord.parse('G7/D').figuredBass('C major'); // '43'
   * ```
   */
  figuredBass(key?: KeyLike): string {
    return figuredBassOf(this.#data, this.#resolveScale(key));
  }

  /**
   * The chords that can stand in for this one in a key: its tritone substitute,
   * the diatonic triads a third away that share two of its tones, the
   * parallel-mode chords with its harmonic function, and its chromatic
   * mediants.
   *
   * Each candidate carries the relationship it realizes, its Roman numeral, and
   * its harmonic function in the key.
   *
   * @param key Key the substitution is read in; a key name, a plain key/scale,
   *   or a {@link Key}. Falls back to the carried context.
   * @param opts Set `melodyPcs` to the pitch classes a melody holds over this
   *   chord, so only substitutions that keep every one of them a chord tone are
   *   proposed.
   * @returns The deduplicated candidates; the chords are plain data, spelled
   *   the way the key writes them.
   * @throws If no key is given and none is carried.
   * @example
   * ```ts
   * import { Chord, Key } from '@libraz/libcantus';
   * const subs = Chord.parse('G7').withKey(Key.major('C')).substitutions();
   * subs.find((sub) => sub.type === 'tritone')?.chord.rootPc; // 1
   * ```
   */
  substitutions(key?: KeyLike, opts?: SubstituteOptions): Substitution[] {
    return substituteChord(this.#data, this.#resolveScale(key), opts);
  }

  /**
   * The modal-interchange palette of the chord's key: the parallel mode's
   * triads that the key itself does not contain, plus the Neapolitan, each with
   * its Roman numeral and its borrowing source.
   *
   * The palette belongs to the key rather than to this chord, so it is the same
   * list for every chord in it; it is reachable here because a chord is where a
   * caller looking for somewhere else to go already is.
   *
   * @param key Key to borrow into; a key name, a plain key/scale, or a
   *   {@link Key}. Falls back to the carried context.
   * @returns The borrowed chords, spelled the way the mode they come from
   *   writes them.
   * @throws If no key is given and none is carried.
   * @example
   * ```ts
   * import { Chord, formatChordSymbol, Key } from '@libraz/libcantus';
   * const palette = Chord.parse('C').withKey(Key.major('C')).modalInterchange();
   * palette.map((borrowed) => formatChordSymbol(borrowed.chord));
   * // ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Db']
   * ```
   */
  modalInterchange(key?: KeyLike): BorrowedChord[] {
    return modalInterchangePalette(this.#resolveScale(key));
  }

  /**
   * The chord rendered as a lead-sheet symbol (e.g. `'Cmaj7'`, `'F#m7'`, `'C/G'`).
   *
   * @param opts Set `flats: true` to spell the root/bass with flats, or
   *   `system` to write them in another notation system.
   * @returns The chord symbol.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('Bb7').symbol({ system: 'german' }); // 'B7'
   * ```
   */
  symbol(opts?: ChordSymbolOptions): string {
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
   * The V7 that tonicizes this chord: a dominant seventh a perfect fifth above
   * this chord's root.
   *
   * The target is the chord itself, so no key is involved and a borrowed or
   * chromatic chord gets its dominant as readily as a diatonic one. A root
   * spelling this chord supplied moves with the root, so `Eb` gives `Bb7`.
   *
   * @returns The secondary dominant, keeping any key context.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('Eb').secondaryDominant().symbol(); // 'Bb7'
   * ```
   */
  secondaryDominant(): Chord {
    // #given, not #data: only a caller-supplied spelling is transposed, so a
    // spelling the key derived stays derived and follows the attached key.
    return new Chord(secondaryDominantOf(this.#given), this.#key);
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
      throw new InvalidInputError('cannot invert a chord with no intervals');
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
    const rootSpelling = transposeHint(this.#given.rootSpelling, semitones);
    const bassSpelling = transposeHint(this.#given.bassSpelling, semitones);
    const toneSpellings = transposeToneHints(this.#given.toneSpellings, semitones);
    if (rootSpelling !== undefined) {
      moved.rootSpelling = rootSpelling;
    }
    if (bassSpelling !== undefined) {
      moved.bassSpelling = bassSpelling;
    }
    if (toneSpellings !== undefined) {
      moved.toneSpellings = toneSpellings;
    }
    return new Chord(moved, this.#key?.transpose(semitones));
  }

  /**
   * Transpose the chord by a spelled interval.
   *
   * Unlike {@link Chord.transpose}, which picks letters from a semitone count,
   * the interval's diatonic number decides them: a C chord up an augmented
   * fourth is F#, up a diminished fifth Gb. As with the semitone form, the
   * quality and interval template are carried over and a carried key moves with
   * the chord.
   *
   * @param interval An interval name (e.g. `'A4'`, `'-m3'`), plain interval
   *   data, or an {@link Interval}; a descending interval moves down.
   * @returns The transposed chord, in the transposed key when one is carried.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('C').transposeBy('A4').symbol(); // 'F#'
   * Chord.parse('C').transposeBy('d5').symbol(); // 'Gb'
   * ```
   */
  transposeBy(interval: IntervalLike): Chord {
    const spelled = toSpelledInterval(interval);
    const moved = transposeChord(this.#given, spelled.semitones);
    // #given, not #data: only a caller-supplied spelling is transposed, so a
    // spelling the key derived stays derived and follows the transposed key.
    const rootSpelling = transposeHintByInterval(this.#given.rootSpelling, spelled);
    const bassSpelling = transposeHintByInterval(this.#given.bassSpelling, spelled);
    const toneSpellings = transposeToneHintsByInterval(this.#given.toneSpellings, spelled);
    if (rootSpelling !== undefined) {
      moved.rootSpelling = rootSpelling;
    }
    if (bassSpelling !== undefined) {
      moved.bassSpelling = bassSpelling;
    }
    if (toneSpellings !== undefined) {
      moved.toneSpellings = toneSpellings;
    }
    return new Chord(moved, this.#key?.transposeBy(spelled));
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
   * The scales that fit over this chord, each with the tones it does not state
   * sorted by what may be done with them: the ones to avoid outright, the ones
   * a line may pass through, and the ones that may be added freely as color.
   *
   * {@link Chord.scales} ranks the same scales in the same order; this is that
   * ranking read as playing advice, so a caller does not have to pair it with
   * {@link Chord.avoidNotes} and {@link Chord.tensions} once per scale.
   *
   * @param limit Greatest number of scales to report; all of them by default.
   * @returns One entry per reported scale, best fit first; see
   *   {@link ChordScaleReportEntry}.
   * @throws If `limit` is not a positive integer.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.of('C', 'maj7').scaleReport(1)[0]?.passing; // [5]
   * ```
   */
  scaleReport(limit?: number): ChordScaleReportEntry[] {
    return chordScaleReport(this.#data, limit);
  }

  /**
   * The available tensions (usable non-chord, non-avoid scale tones) of a
   * scale over this chord.
   *
   * @param scaleName A named scale, rooted on the chord root.
   * @param opts Set `resolvesTo` to the plain chord this one resolves to, so a
   *   dominant resolving down a fifth onto a minor tonic takes the tensions
   *   that resolution makes available; see {@link AvailableTensionsOptions}.
   * @returns Tension pitch classes, ascending in [0, 11].
   * @throws If `scaleName` is not a built-in scale.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.of('G', 'dom7').tensions('phrygianDominant', {
   *   resolvesTo: Chord.of('C', 'min').data,
   * }); // [3, 8]
   * ```
   */
  tensions(scaleName: ScaleNameInput, opts?: AvailableTensionsOptions): number[] {
    return availableTensions(this.#data, scaleName, opts);
  }

  /**
   * The avoid notes (scale tones a semitone above a chord tone) of a scale
   * over this chord.
   *
   * @param scaleName A named scale, rooted on the chord root.
   * @param opts Set `use: 'melodic'` to judge a line rather than a voicing, so
   *   a tone a line may pass through is not counted; see
   *   {@link AvoidNotesOptions}.
   * @returns Avoid-note pitch classes, ascending in [0, 11].
   * @throws If `scaleName` is not a built-in scale.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.of('C', 'maj7').avoidNotes('ionian'); // [5]
   * Chord.of('C', 'maj7').avoidNotes('ionian', { use: 'melodic' }); // []
   * ```
   */
  avoidNotes(scaleName: ScaleNameInput, opts?: AvoidNotesOptions): number[] {
    return avoidNotes(this.#data, scaleName, opts);
  }

  /**
   * Spell the chord tones with letter names, root first, in the key's spelling.
   *
   * A chord that already knows how its root is spelled — one from
   * `Chord.parse`, or `Chord.of` with a named root — can spell itself with no
   * key at all; a key is only needed to choose a spelling for a bare pitch
   * class.
   *
   * A slash bass outside the chord tones is appended, so the spelled notes
   * are the notes the chord sounds — the same set {@link Chord.pitchClasses}
   * reports.
   *
   * @param key Key providing the spelled tonic; falls back to the carried
   *   context, then to the chord's own root spelling.
   * @returns Spelled octave-less notes in the chord's own (tertian) order,
   *   with any foreign slash bass last.
   * @throws If no key is given, none is carried, and the chord has no root
   *   spelling of its own.
   */
  spell(key?: Key): Note[] {
    const resolved = key ?? this.#key;
    // An explicit key must select the spelling view before any derived hints
    // are read; only caller-provided hints in #given are independent of it.
    const data = this.#dataWithKey(resolved);
    let tones: NoteData[];
    if (resolved === undefined) {
      const root = data.rootSpelling;
      if (root === undefined) {
        throw new InvalidInputError(
          'chord has no key context and no root spelling; pass a Key, attach one with withKey(), or build the chord from a symbol',
        );
      }
      tones = spellChordFromRoot(data, root);
    } else {
      tones = spellChord(data, resolved.tonic.data, resolved.scale);
    }
    const bassPc = data.bassPc;
    const bass = data.bassSpelling;
    if (
      bassPc !== undefined &&
      bass !== undefined &&
      !tones.some((tone) => mod12(noteToPitchClass(tone)) === mod12(bassPc))
    ) {
      tones = [...tones, { letter: bass.letter, alter: bass.alter }];
    }
    return tones.map((note) => new Note(note));
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
   * The chord placed at a beat, as the {@link ChordSpan} the arrangement and
   * generation functions take.
   *
   * The interval template is recorded only when it departs from the one the
   * quality names, so a standard chord yields the same span it always did while
   * a custom template is not lost. Key context and spelling hints are not part
   * of a span and are left behind.
   *
   * @param startBeat Beat the chord starts on.
   * @returns The span describing this chord at that beat.
   * @throws If `startBeat` is not finite, or the chord's quality is unknown.
   * @example
   * ```ts
   * import { Chord } from '@libraz/libcantus';
   * Chord.parse('Cmaj7').span(4); // { rootPc: 0, quality: 'maj7', startBeat: 4 }
   * ```
   */
  span(startBeat: number): ChordSpan {
    return spanFromChord(this.#data, startBeat);
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
    // Key context is intentionally not serialized. Persist only spelling hints
    // the caller provided, so a restored chord can be re-spelled by a new key.
    return copyChord(this.#given);
  }

  /**
   * The chord symbol, so a template literal or a log line reads as the chord.
   *
   * @returns The symbol, e.g. `'Cmaj7'`.
   */
  toString(): string {
    return this.symbol();
  }

  /**
   * Resolve the key/scale for a method that takes any key-shaped value:
   * explicit first, then carried, by the same rule {@link Chord.roman} follows.
   */
  #resolveScale(key?: KeyLike): KeyScale {
    return key === undefined ? this.#resolveKey().scale : toKeyScale(key);
  }

  /** Resolve the key for an analysis method: explicit first, then carried. */
  #resolveKey(key?: Key): Key {
    const resolved = key ?? this.#key;
    if (resolved === undefined) {
      throw new InvalidInputError(
        'chord has no key context; pass a Key or attach one with withKey()',
      );
    }
    return resolved;
  }
}
