/**
 * Fluent, immutable object model over the functional core.
 *
 * Each class wraps one of the library's plain data types (spelled notes,
 * chords, key/scales) and delegates every operation to the existing pure
 * functions. All instances are immutable: fields are read-only, transforming
 * methods return new instances, and getters hand out defensive copies of any
 * mutable data.
 */

import { detectChord, detectChordBest } from '../analyze/detect/index.js';
import {
  analyzeChord,
  type BorrowedSource,
  borrowedSource,
  type Cadence,
  type ChordAnalysis,
  chordToRoman,
  detectCadence,
  functionOf,
  type HarmonicFunction,
  isBorrowedChord,
  isMinorKey,
  romanToChord,
} from '../analyze/functional/index.js';
import {
  formatNote,
  midiToNote,
  type Note as NoteData,
  noteToMidi,
  noteToPitchClass,
  parseNote,
  type SpelledInterval,
  spelledInterval,
} from '../core/pitch/index.js';
import type { KeyScale } from '../core/types.js';
import { negativeHarmonyMirror } from '../generate/reharmony/index.js';
import {
  type Chord as ChordData,
  type ChordQuality,
  chordFromDegree,
  chordPitchClasses,
  diatonicSeventh,
  diatonicTriad,
  makeChord,
} from '../theory/chord/index.js';
import {
  availableTensions,
  avoidNotes,
  type ChordScaleMatch,
  chordScales,
} from '../theory/chordscale/index.js';
import {
  isScaleTone,
  majorKey,
  minorKey,
  scaleByName,
  scaleTonesInDegreeOrder,
} from '../theory/scale/index.js';
import { spellChord, spellScale } from '../theory/spelling/index.js';
import { formatChordSymbol, parseChordSymbol } from '../theory/symbol/index.js';
import {
  type StyledVoicingOptions,
  type VoicingOptions,
  voiceChord,
  voiceChordStyled,
  voiceProgression,
} from '../theory/voicing/index.js';

/** Reduce any integer to a pitch class in [0, 11]. */
function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Defensive copy of a plain note. */
function copyNote(data: NoteData): NoteData {
  const copy: NoteData = { letter: data.letter, alter: data.alter };
  if (data.octave !== undefined) {
    copy.octave = data.octave;
  }
  return copy;
}

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

/** Spell a bare pitch class as an octave-less note with a sharp/flat preference. */
function spellPitchClassBare(pc: number, spelling: 'sharp' | 'flat'): NoteData {
  const spelled = midiToNote(60 + mod12(pc), spelling);
  return { letter: spelled.letter, alter: spelled.alter };
}

/**
 * An immutable spelled note: a diatonic letter plus a chromatic alteration and
 * an optional octave. Wraps the plain note object and delegates to the pitch
 * module; every transformation returns a new instance.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Note } from '@libraz/libcantus';
 * Note.of('C4').transpose(7).name; // 'G4'
 * ```
 */
export class Note {
  readonly #data: NoteData;

  /**
   * Wrap a plain note object.
   *
   * @param data The spelled note; it is copied, never retained or mutated.
   */
  constructor(data: NoteData) {
    this.#data = copyNote(data);
  }

  /**
   * Parse scientific pitch notation (e.g. `'C#4'`, `'Bb'`, `'F##3'`).
   *
   * @param name The note text.
   * @returns The parsed note.
   * @throws If the text is not a valid note.
   */
  static of(name: string): Note {
    return new Note(parseNote(name));
  }

  /**
   * Name a MIDI number (middle C = C4 = 60) as a note.
   *
   * @param midi The MIDI number.
   * @param spelling Whether to prefer sharps or flats for black keys.
   * @returns The spelled note, with octave.
   */
  static fromMidi(midi: number, spelling: 'sharp' | 'flat' = 'sharp'): Note {
    return new Note(midiToNote(midi, spelling));
  }

  /**
   * Wrap an existing plain note object.
   *
   * @param data The plain note.
   * @returns The wrapped note.
   */
  static fromData(data: NoteData): Note {
    return new Note(data);
  }

  /** The note rendered as scientific pitch notation, e.g. `'G4'` or `'Bb'`. */
  get name(): string {
    return formatNote(this.#data);
  }

  /** The pitch class (0..11), ignoring octave. */
  get pitchClass(): number {
    return noteToPitchClass(this.#data);
  }

  /**
   * The MIDI number (middle C = C4 = 60).
   *
   * @throws If the note has no octave and therefore no fixed pitch.
   */
  get midi(): number {
    if (this.#data.octave === undefined) {
      throw new Error(`note ${this.name} has no octave, so it has no MIDI number`);
    }
    return noteToMidi(this.#data);
  }

  /** The diatonic letter number: 0..6 for C..B. */
  get letter(): number {
    return this.#data.letter;
  }

  /** The chromatic alteration in semitones: -1 flat, 0 natural, +1 sharp, ... */
  get alter(): number {
    return this.#data.alter;
  }

  /** The octave (scientific pitch notation), or undefined for a bare pitch class. */
  get octave(): number | undefined {
    return this.#data.octave;
  }

  /** A copy of the underlying plain note object. */
  get data(): NoteData {
    return copyNote(this.#data);
  }

  /**
   * Transpose by a signed number of semitones.
   *
   * When the note carries an octave the transposition happens in MIDI space and
   * the result is spelled with a sharp preference. An octave-less note stays
   * octave-less: only its pitch class is moved. Transposing by zero is the
   * identity: the original spelling is preserved (no enharmonic respelling).
   *
   * @param semitones The signed semitone offset.
   * @returns The transposed note.
   */
  transpose(semitones: number): Note {
    if (semitones === 0) {
      return new Note(this.#data);
    }
    if (this.#data.octave !== undefined) {
      return Note.fromMidi(this.midi + semitones);
    }
    return new Note(spellPitchClassBare(this.pitchClass + semitones, 'sharp'));
  }

  /**
   * The spelled interval from this note to another.
   *
   * @param other The second note.
   * @returns The diatonic number, quality, and semitone span.
   */
  intervalTo(other: Note): SpelledInterval {
    return spelledInterval(this.#data, other.#data);
  }

  /**
   * Whether another note has the same letter, alteration, and octave.
   *
   * @param other The note to compare.
   * @returns True if the spellings are identical.
   */
  equals(other: Note): boolean {
    return (
      this.#data.letter === other.#data.letter &&
      this.#data.alter === other.#data.alter &&
      this.#data.octave === other.#data.octave
    );
  }

  /**
   * The plain note data, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(note)` from collapsing to `{}`.
   *
   * @returns A copy of the underlying plain note object.
   */
  toJSON(): NoteData {
    return this.data;
  }
}

/**
 * An immutable spelled interval value: a diatonic number, a quality label, and
 * a signed semitone span. A thin convenience wrapper over the pitch module's
 * plain interval result.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Interval, Note } from '@libraz/libcantus';
 * Interval.between(Note.of('C4'), Note.of('G4')).name; // 'P5'
 * ```
 */
export class Interval {
  readonly #number: number;
  readonly #quality: string;
  readonly #semitones: number;

  private constructor(numberValue: number, quality: string, semitones: number) {
    this.#number = numberValue;
    this.#quality = quality;
    this.#semitones = semitones;
  }

  /**
   * The spelled interval between two notes.
   *
   * @param a The first note.
   * @param b The second note.
   * @returns The interval from `a` to `b`.
   */
  static between(a: Note, b: Note): Interval {
    const spelled = a.intervalTo(b);
    return new Interval(spelled.number, spelled.quality, spelled.semitones);
  }

  /**
   * Build an interval from explicit components.
   *
   * @param numberValue Diatonic size: 1 = unison, 2 = second, ... 8 = octave.
   * @param quality Quality label: `'P'`, `'M'`, `'m'`, or repeated `'A'`/`'d'`.
   * @param semitones Signed semitone span.
   * @returns The interval.
   */
  static of(numberValue: number, quality: string, semitones: number): Interval {
    return new Interval(numberValue, quality, semitones);
  }

  /** Diatonic size: 1 = unison, 2 = second, ... 8 = octave, and beyond. */
  get number(): number {
    return this.#number;
  }

  /** Quality label: `'P'`, `'M'`, `'m'`, or repeated `'A'`/`'d'`. */
  get quality(): string {
    return this.#quality;
  }

  /** Signed semitone span. */
  get semitones(): number {
    return this.#semitones;
  }

  /** A readable label composed of quality and number, e.g. `'P5'` or `'M3'`. */
  get name(): string {
    return `${this.#quality}${this.#number}`;
  }

  /**
   * The plain interval data, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(interval)` from collapsing to `{}`.
   *
   * @returns The diatonic number, quality, and semitone span.
   */
  toJSON(): SpelledInterval {
    return { number: this.#number, quality: this.#quality, semitones: this.#semitones };
  }
}

/** Resolve a string or numeric key root into a spelled tonic note. */
function resolveTonic(root: string | number, spelling: 'sharp' | 'flat'): Note {
  return typeof root === 'string' ? Note.of(root) : new Note(spellPitchClassBare(root, spelling));
}

/** Total accidentals a spelled tonic produces across a key's whole scale. */
function accidentalLoad(tonic: NoteData, scale: KeyScale): number {
  return spellScale(tonic, scale).reduce((sum, note) => sum + Math.abs(note.alter), 0);
}

/**
 * Choose the tonic spelling (sharp- or flat-side) that spells `scale` with the
 * fewest accidentals, so a numeric root never yields a double-flat/double-sharp
 * scale (e.g. pitch class 6 minor spells as F# minor, not Gb minor with Bbb).
 */
function bestTonicForScale(rootPc: number, scale: KeyScale): Note {
  const sharp = spellPitchClassBare(rootPc, 'sharp');
  const flat = spellPitchClassBare(rootPc, 'flat');
  if (sharp.letter === flat.letter && sharp.alter === flat.alter) {
    return new Note(sharp);
  }
  return accidentalLoad(flat, scale) <= accidentalLoad(sharp, scale)
    ? new Note(flat)
    : new Note(sharp);
}

/**
 * An immutable key/scale: a `KeyScale` (root pitch class plus mode mask) paired
 * with a spelled tonic that anchors letter-name spelling. Acts as the factory
 * for key-aware chords.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Key } from '@libraz/libcantus';
 * Key.major('C').chord(4).symbol(); // 'G' (the diatonic triad on scale degree 4)
 * ```
 */
export class Key {
  readonly #scale: KeyScale;
  readonly #tonic: Note;

  /**
   * Wrap a key/scale and its spelled tonic.
   *
   * @param scale The key/scale; its root is normalized to a pitch class.
   * @param tonic The spelled tonic anchoring letter-name spelling.
   */
  constructor(scale: KeyScale, tonic: Note) {
    this.#scale = { rootPc: mod12(scale.rootPc), modeMask12: scale.modeMask12 };
    this.#tonic = tonic;
  }

  /**
   * A major key.
   *
   * @param root Tonic as a note name (e.g. `'Eb'`) or a pitch class; a numeric
   *   root is spelled with whichever accidental side yields the fewest
   *   accidentals across the scale.
   * @returns The major key.
   */
  static major(root: string | number): Key {
    if (typeof root === 'string') {
      const tonic = Note.of(root);
      return new Key(majorKey(tonic.pitchClass), tonic);
    }
    const scale = majorKey(root);
    return new Key(scale, bestTonicForScale(root, scale));
  }

  /**
   * A natural-minor key.
   *
   * @param root Tonic as a note name or a pitch class; a numeric root is
   *   spelled with whichever accidental side yields the fewest accidentals
   *   across the scale.
   * @returns The minor key.
   */
  static minor(root: string | number): Key {
    if (typeof root === 'string') {
      const tonic = Note.of(root);
      return new Key(minorKey(tonic.pitchClass), tonic);
    }
    const scale = minorKey(root);
    return new Key(scale, bestTonicForScale(root, scale));
  }

  /**
   * A key on a named scale (e.g. `'dorian'`, `'harmonicMinor'`).
   *
   * @param name The scale name, a key of the scale module's named-scale table.
   * @param root Tonic as a note name or a pitch class.
   * @returns The key.
   * @throws If the name is not a known scale.
   */
  static named(name: string, root: string | number): Key {
    const tonic = resolveTonic(root, 'sharp');
    return new Key(scaleByName(name, tonic.pitchClass), tonic);
  }

  /**
   * Wrap an existing `KeyScale`, synthesizing a spelled tonic when none is
   * given (flat-preferred for minor-third scales, sharp-preferred otherwise).
   *
   * @param scale The key/scale to wrap.
   * @param tonic Optional spelled tonic.
   * @returns The key.
   */
  static of(scale: KeyScale, tonic?: Note): Key {
    const spelled =
      tonic ?? new Note(spellPitchClassBare(scale.rootPc, isMinorKey(scale) ? 'flat' : 'sharp'));
    return new Key(scale, spelled);
  }

  /** A copy of the underlying plain `KeyScale`. */
  get scale(): KeyScale {
    return { rootPc: this.#scale.rootPc, modeMask12: this.#scale.modeMask12 };
  }

  /** The spelled tonic. */
  get tonic(): Note {
    return this.#tonic;
  }

  /** The tonic pitch class (0..11). */
  get rootPc(): number {
    return this.#scale.rootPc;
  }

  /** Whether the scale has a minor third and no major third. */
  get isMinor(): boolean {
    return isMinorKey(this.#scale);
  }

  /**
   * The scale's pitch classes in ascending scale-degree order (degree 0 first).
   *
   * @returns One pitch class per scale degree.
   */
  pitchClasses(): number[] {
    return scaleTonesInDegreeOrder(this.#scale);
  }

  /**
   * The spelled scale, one note per degree (e.g. C D E F G A B for C major).
   *
   * @returns Spelled octave-less notes in scale-degree order.
   */
  notes(): Note[] {
    return spellScale(this.#tonic.data, this.#scale).map((note) => new Note(note));
  }

  /**
   * Alias of {@link Key.notes}.
   *
   * @returns Spelled octave-less notes in scale-degree order.
   */
  spell(): Note[] {
    return this.notes();
  }

  /**
   * The spelled scale as letter-name strings.
   *
   * @returns One name per scale degree.
   */
  noteNames(): string[] {
    return this.notes().map((note) => note.name);
  }

  /**
   * Build a chord on a scale degree, carrying this key as context.
   *
   * With an explicit quality the quality's interval template is attached to the
   * degree's diatonic root; without one the scale-correct diatonic triad is
   * stacked (e.g. a diminished triad on the leading tone of a major key).
   *
   * @param degree 0-based scale degree of the chord root.
   * @param quality Optional chord quality.
   * @returns The chord, with this key attached.
   */
  chord(degree: number, quality?: ChordQuality): Chord {
    const data =
      quality === undefined
        ? diatonicTriad(degree, this.#scale)
        : chordFromDegree(degree, quality, this.#scale);
    return new Chord(data, this);
  }

  /**
   * The diatonic triad on a scale degree, carrying this key as context.
   *
   * @param degree 0-based scale degree of the chord root.
   * @returns The triad, with this key attached.
   */
  diatonicTriad(degree: number): Chord {
    return new Chord(diatonicTriad(degree, this.#scale), this);
  }

  /**
   * The diatonic seventh chord on a scale degree, carrying this key as context.
   *
   * @param degree 0-based scale degree of the chord root.
   * @returns The seventh chord, with this key attached.
   */
  diatonicSeventh(degree: number): Chord {
    return new Chord(diatonicSeventh(degree, this.#scale), this);
  }

  /**
   * Build the chord denoted by a Roman numeral in this key (including applied
   * chords such as `'V7/V'`), carrying this key as context.
   *
   * @param text The Roman numeral.
   * @returns The chord, with this key attached.
   * @throws If the numeral is not valid.
   */
  roman(text: string): Chord {
    return new Chord(romanToChord(text, this.#scale), this);
  }

  /**
   * Whether a pitch belongs to the scale.
   *
   * @param x A MIDI pitch, bare pitch class, or note.
   * @returns True if the pitch class is a scale tone.
   */
  contains(x: number | Note): boolean {
    return isScaleTone(typeof x === 'number' ? x : x.pitchClass, this.#scale);
  }

  /**
   * The plain key data, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(key)` from collapsing to `{}`. The result pairs the
   * `KeyScale` with the spelled tonic, enough to reconstruct the key via
   * {@link Key.of}.
   *
   * @returns The key/scale and its spelled tonic.
   */
  toJSON(): { scale: KeyScale; tonic: NoteData } {
    return { scale: this.scale, tonic: this.#tonic.data };
  }
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
