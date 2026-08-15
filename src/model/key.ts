import type { DetectKeyOptions, KeyMatch, KeyVariant } from '../analyze/detect/index.js';
import { detectKey, detectKeyBest } from '../analyze/detect/index.js';
import { isMinorKey, romanToChord } from '../analyze/functional/index.js';
import { InvalidInputError } from '../core/errors/index.js';
import type { IntervalLike, Note as NoteData, SpelledInterval } from '../core/pitch/index.js';
import { spelledInterval, toSpelledInterval, transposeByInterval } from '../core/pitch/index.js';
import type { KeyScale } from '../core/types.js';
import { assertFiniteNumber, assertInteger } from '../core/validation/index.js';
import {
  type ChordQuality,
  chordFromDegree,
  diatonicSeventh,
  diatonicTriad,
} from '../theory/chord/index.js';
import {
  dominantKeyOf,
  enharmonicKeyOf,
  isScaleTone,
  type KeyMode,
  type KeyRelation,
  keyFromFifths,
  keyRelationBetween,
  keySignatureFifths,
  majorKey,
  minorKey,
  parallelKeyOf,
  relatedKeysOf,
  relativeKeyOf,
  type ScaleNameInput,
  type SpelledKey,
  scaleByName,
  scaleTonesInDegreeOrder,
  subdominantKeyOf,
} from '../theory/scale/index.js';
import { spellScale } from '../theory/spelling/index.js';
import { Chord } from './chord.js';
import { Interval } from './interval.js';
import { Note } from './note.js';
import { mod12, spellPitchClassBare } from './shared.js';

/** A detected key paired with the score and scale form that produced it. */
export type DetectedKeyMatch = Omit<KeyMatch, 'key'> & { key: Key };

/** Widest signature a key is actually written with, in fifths. */
const MAX_CONVENTIONAL_FIFTHS = 7;

/** How many degrees a scale needs before thirds can be stacked on it. */
const HEPTATONIC_DEGREES = 7;

/** The tonic a mode's reference scale is spelled on; C spells both modes plainly. */
const REFERENCE_TONIC: NoteData = { letter: 0, alter: 0 };

/**
 * The interval between two tonics. Both are read octave-less, so the answer is
 * the ascending interval within one octave however the notes were built.
 */
function bareInterval(from: Note, to: Note): SpelledInterval {
  return spelledInterval(
    { letter: from.letter, alter: from.alter },
    { letter: to.letter, alter: to.alter },
  );
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
 * Key.major('C').chord(5).symbol(); // 'G' (the diatonic triad on scale degree 5)
 * ```
 */
export class Key {
  readonly #scale: KeyScale;
  readonly #tonic: Note;
  readonly #variant: KeyVariant | undefined;

  /**
   * Wrap a key/scale and its spelled tonic.
   *
   * @param scale The key/scale; its root is normalized to a pitch class.
   * @param tonic The spelled tonic anchoring letter-name spelling.
   * @param variant Optional detected scale form retained for display.
   */
  constructor(scale: KeyScale, tonic: Note, variant?: KeyVariant) {
    assertInteger(scale.rootPc, 'scale.rootPc');
    assertInteger(scale.modeMask12, 'scale.modeMask12', 1, 0b111111111111);
    if ((scale.modeMask12 & 1) === 0) {
      throw new InvalidInputError('scale.modeMask12 must include the tonic (bit 0)');
    }
    const rootPc = mod12(scale.rootPc);
    if (tonic.pitchClass !== rootPc) {
      throw new InvalidInputError(
        `tonic ${tonic.name} does not match the scale root pitch class ${rootPc}; ` +
          'pass a tonic that spells the scale root, or omit it to have one chosen',
      );
    }
    this.#scale = { rootPc, modeMask12: scale.modeMask12 };
    this.#tonic = tonic;
    this.#variant = variant;
  }

  /** Preserve detection metadata while replacing its plain key with this API's Key. */
  static #fromMatch(match: KeyMatch): DetectedKeyMatch {
    const key = new Key(
      match.key,
      bestTonicForScale(mod12(match.key.rootPc), match.key),
      match.variant,
    );
    return { ...match, key };
  }

  /**
   * Wrap a key the theory layer spelled, keeping its tonic exactly as given.
   *
   * The relation functions work in fifths space, so the tonic they hand back is
   * already the one the key is written with; re-deriving it from the pitch class
   * would throw that spelling away (Bb minor would come back as A# minor).
   */
  static #fromSpelled(spelled: SpelledKey): Key {
    return new Key(spelled.key, new Note(spelled.tonic));
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
   * @param root Tonic as a note name or a pitch class; a numeric root is
   *   spelled with whichever accidental side yields the fewest accidentals
   *   across the scale, exactly as {@link Key.major} does.
   * @returns The key.
   * @throws If the name is not a known scale.
   */
  static named(name: ScaleNameInput, root: string | number): Key {
    if (typeof root === 'string') {
      const tonic = Note.of(root);
      return new Key(scaleByName(name, tonic.pitchClass), tonic);
    }
    const scale = scaleByName(name, mod12(root));
    return new Key(scale, bestTonicForScale(mod12(root), scale));
  }

  /**
   * The key a key signature denotes: the inverse of {@link Key.fifths}.
   *
   * A signature names two keys — three sharps is both A major and F# minor — so
   * the mode decides which one is built. The tonic is spelled the way that key
   * is written, including the theoretical keys past ±7 (nine sharps is B#
   * major).
   *
   * @param fifths The signed number of sharps (positive) or flats (negative).
   * @param mode Which of the signature's two keys to build; defaults to major.
   * @returns The key.
   * @throws If `fifths` is not an integer in [-12, 12], or `mode` is neither
   *   `'major'` nor `'minor'`.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.fromFifths(-2).toString(); // 'Bb major'
   * Key.fromFifths(-2, 'minor').toString(); // 'G minor'
   * ```
   */
  static fromFifths(fifths: number, mode: KeyMode = 'major'): Key {
    return Key.#fromSpelled(keyFromFifths(fifths, mode));
  }

  /**
   * Wrap an existing `KeyScale`, synthesizing a spelled tonic when none is
   * given.
   *
   * The synthesized tonic is chosen the same way as for a numeric root
   * elsewhere: whichever accidental side spells the scale with the fewest
   * accidentals. This is what keeps `Key.of(detectKey(...).scale)` from handing
   * every downstream chord a double-sharp spelling.
   *
   * @param scale The key/scale to wrap.
   * @param tonic Optional spelled tonic; must spell the scale's root pitch class.
   * @returns The key.
   * @throws If the given tonic is not the scale's root pitch class.
   */
  static of(scale: KeyScale, tonic?: Note): Key {
    return new Key(scale, tonic ?? bestTonicForScale(mod12(scale.rootPc), scale));
  }

  /**
   * Rebuild a key from its {@link Key.toJSON} output.
   *
   * @param data The serialized key and tonic.
   * @returns The key.
   */
  static fromJSON(data: { scale: KeyScale; tonic: NoteData }): Key {
    return new Key(data.scale, new Note(data.tonic));
  }

  /**
   * Identify the keys a set of pitches fits, best interpretation first.
   *
   * The counterpart of {@link Chord.detect}.
   *
   * @param pitches MIDI pitches or bare pitch classes.
   * @param opts How to weigh the input; see {@link DetectKeyOptions}.
   * @returns Ranked keys (may be empty).
   */
  static detect(pitches: readonly number[], opts?: DetectKeyOptions): Key[] {
    return Key.detectMatches(pitches, opts).map((match) => match.key);
  }

  /**
   * Identify keys while retaining each candidate's score, fit, and scale form.
   *
   * @param pitches MIDI pitches or bare pitch classes.
   * @param opts How to weigh the input; see {@link DetectKeyOptions}.
   * @returns Ranked key matches (may be empty).
   */
  static detectMatches(pitches: readonly number[], opts?: DetectKeyOptions): DetectedKeyMatch[] {
    return detectKey(pitches, opts).map((match) => Key.#fromMatch(match));
  }

  /**
   * The single best key interpretation of a pitch set.
   *
   * @param pitches MIDI pitches or bare pitch classes.
   * @param opts How to weigh the input; see {@link DetectKeyOptions}.
   * @returns The top-ranked key, or null when nothing matches.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.detectBest([0, 2, 4, 5, 7, 9, 11])?.toString(); // 'C major'
   * ```
   */
  static detectBest(pitches: readonly number[], opts?: DetectKeyOptions): Key | null {
    const best = detectKeyBest(pitches, opts);
    return best === null ? null : Key.#fromMatch(best).key;
  }

  /**
   * Whether another key has the same tonic pitch class and mode.
   *
   * The spelled tonic is not compared: C# major and Db major are the same key
   * written two ways.
   *
   * @param other The key to compare.
   * @returns True when tonic and mode mask both match.
   */
  equals(other: Key): boolean {
    const scale = other.scale;
    return this.#scale.rootPc === scale.rootPc && this.#scale.modeMask12 === scale.modeMask12;
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
   * The key signature as a signed count of sharps (positive) or flats
   * (negative) — the `fifths` value a notation format such as MusicXML writes.
   *
   * A scale that is not a diatonic mode takes the signature of its parallel
   * major or minor, so A harmonic minor reports 0: its G# is written as an
   * accidental rather than in the signature.
   *
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('Db').fifths; // -5
   * Key.minor('A').fifths; // 0
   * ```
   */
  get fifths(): number {
    return keySignatureFifths(this.#tonic.data, this.#scale);
  }

  /** The detected scale form, when this key came from key detection. */
  get variant(): KeyVariant | undefined {
    return this.#variant;
  }

  /**
   * The scale's pitch classes in ascending scale-degree order (the tonic first).
   *
   * @returns One pitch class per scale degree.
   */
  pitchClasses(): number[] {
    return scaleTonesInDegreeOrder(this.#scale);
  }

  /**
   * The relative key: the same key signature read in the other mode.
   *
   * Because the new tonic is read off the circle of fifths rather than
   * transposed by semitones, the relative of Db major is Bb minor and not its
   * enharmonic A# minor.
   *
   * @returns The relative key, always a plain major or minor key.
   * @throws If this key's signature falls outside [-12, 12] fifths.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('C').relative().toString(); // 'A minor'
   * ```
   */
  relative(): Key {
    return Key.#fromSpelled(relativeKeyOf(this.#tonic.data, this.#scale));
  }

  /**
   * The parallel key: the other mode on the same tonic, which keeps this key's
   * tonic spelling — the parallel minor of C major is C minor, never B# minor.
   *
   * @returns The parallel key, always a plain major or minor key.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('C').parallel().toString(); // 'C minor'
   * ```
   */
  parallel(): Key {
    return Key.#fromSpelled(parallelKeyOf(this.#tonic.data, this.#scale));
  }

  /**
   * The dominant key: one sharp further round the circle of fifths, same mode.
   *
   * @returns The key a fifth above.
   * @throws If the resulting signature falls outside [-12, 12] fifths.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('C').dominantKey().toString(); // 'G major'
   * ```
   */
  dominantKey(): Key {
    return Key.#fromSpelled(dominantKeyOf(this.#tonic.data, this.#scale));
  }

  /**
   * The subdominant key: one flat further round the circle of fifths, same mode.
   *
   * @returns The key a fifth below.
   * @throws If the resulting signature falls outside [-12, 12] fifths.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('C').subdominantKey().toString(); // 'F major'
   * ```
   */
  subdominantKey(): Key {
    return Key.#fromSpelled(subdominantKeyOf(this.#tonic.data, this.#scale));
  }

  /**
   * The same sounding key written the other way round the circle of fifths.
   *
   * Only a spelling within ±7 fifths is offered, because that is as far as keys
   * are actually written: Db major answers with C# major, while C major has no
   * second spelling at all.
   *
   * @returns The other spelling of this key, or null when it has none.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('Db').enharmonic()?.toString(); // 'C# major'
   * Key.major('C').enharmonic(); // null
   * ```
   */
  enharmonic(): Key | null {
    const other = enharmonicKeyOf(this.#tonic.data, this.#scale);
    return other === null ? null : Key.#fromSpelled(other);
  }

  /**
   * The six closely related keys, each tagged with its relation.
   *
   * These are the keys a piece modulates to without a change of signature worth
   * more than one accidental: the relative and parallel keys, the dominant and
   * subdominant, and the relatives of those two.
   *
   * @returns The related keys in relation order.
   * @throws If a neighbouring signature falls outside [-12, 12] fifths.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('C')
   *   .relatedKeys()
   *   .map((related) => `${related.relation}: ${related.key}`);
   * // ['relative: A minor', 'parallel: C minor', 'dominant: G major', ...]
   * ```
   */
  relatedKeys(): { relation: KeyRelation; key: Key }[] {
    return relatedKeysOf(this.#tonic.data, this.#scale).map(({ relation, ...spelled }) => ({
      relation,
      key: Key.#fromSpelled(spelled),
    }));
  }

  /**
   * How another key stands to this one.
   *
   * Only the identity test looks at the tonic spelling; every other relation
   * compares tonic pitch class and mode mask, so C# minor and Db minor both
   * read as the relative of E major.
   *
   * @param other The key the relation is measured to.
   * @returns The relation, or null when `other` is none of this key's related
   *   keys.
   * @throws If a neighbouring signature of this key falls outside [-12, 12]
   *   fifths.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('C').relationTo(Key.minor('A')); // 'relative'
   * Key.major('C').relationTo(Key.minor('Eb')); // null
   * ```
   */
  relationTo(other: Key): KeyRelation | null {
    // The other key is read through its public accessors, not its private
    // fields, so a bundle that emits two copies of this class still compares.
    return keyRelationBetween(
      { tonic: this.#tonic.data, key: this.#scale },
      { tonic: other.tonic.data, key: other.scale },
    );
  }

  /**
   * A scale degree, counted from 1 the way musicians name degrees: `degree(1)`
   * is the tonic and `degree(5)` the dominant.
   *
   * @param n The 1-based scale degree.
   * @returns The spelled note on that degree.
   * @throws If `n` is not an integer within 1..(number of scale degrees) — seven
   *   for a diatonic key, five for a pentatonic one.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.minor('A').degree(4).name; // 'D'
   * ```
   */
  degree(n: number): Note {
    const notes = this.notes();
    assertInteger(n, 'degree', 1, notes.length);
    // The bounds check already guarantees the index; the tonic only satisfies
    // the compiler's view of an indexed read.
    return notes[n - 1] ?? this.#tonic;
  }

  /**
   * The key rooted on one of this key's scale degrees.
   *
   * Without an explicit `mode` the mode is read off the diatonic triad on that
   * degree: a major triad gives a major key, a minor or diminished one a minor
   * key. So the fourth degree of A minor gives D minor while the fourth degree
   * of C major gives F major. A scale with no diatonic triads — anything that
   * is not heptatonic — falls back to this key's own mode.
   *
   * @param n The 1-based scale degree, as {@link Key.degree} counts them.
   * @param mode The mode of the resulting key; inferred when omitted.
   * @returns The key on that degree.
   * @throws If `n` is outside the scale's degrees.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.minor('A').keyOnDegree(4).toString(); // 'D minor'
   * Key.minor('A').keyOnDegree(4, 'major').toString(); // 'D major'
   * ```
   */
  keyOnDegree(n: number, mode?: KeyMode): Key {
    const tonic = this.degree(n);
    return Key.#modeOn(mode ?? this.#modeOfDegree(n), tonic);
  }

  /**
   * The key on whose degree `n` this key's tonic sits: the inverse of
   * {@link Key.keyOnDegree}.
   *
   * D minor is the fourth degree of A minor, so D minor answers A minor here.
   *
   * @param n The 1-based degree this key's tonic should occupy in the result.
   * @param mode The mode of the resulting key; defaults to this key's own mode.
   * @returns The key that has this key's tonic on its `n`th degree.
   * @throws If `n` is not an integer in 1..7 — the result is a major or minor
   *   key, which has seven degrees.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.minor('D').keyHavingTonicAsDegree(4).toString(); // 'A minor'
   * ```
   */
  keyHavingTonicAsDegree(n: number, mode?: KeyMode): Key {
    const resolved = mode ?? (this.isMinor ? 'minor' : 'major');
    // The interval from degree 1 to degree n is a property of the mode, not of
    // the tonic, so it is read off the mode's scale built on C and then applied
    // downward to this tonic — which keeps the letter the interval names.
    const reference = spellScale(REFERENCE_TONIC, resolved === 'minor' ? minorKey(0) : majorKey(0));
    assertInteger(n, 'degree', 1, reference.length);
    const first = reference[0] as NoteData;
    const step = spelledInterval(first, reference[n - 1] as NoteData);
    const tonic = new Note(
      transposeByInterval(this.#tonic.data, {
        number: step.number,
        quality: step.quality,
        // Negating a zero span yields -0, which compares unequal to 0.
        semitones: step.semitones === 0 ? 0 : -step.semitones,
        descending: true,
      }),
    );
    return Key.#modeOn(resolved, tonic);
  }

  /** A plain major or minor key on a spelled tonic. */
  static #modeOn(mode: KeyMode, tonic: Note): Key {
    const rootPc = tonic.pitchClass;
    return new Key(mode === 'minor' ? minorKey(rootPc) : majorKey(rootPc), tonic);
  }

  /**
   * The mode a scale degree implies, read off its diatonic triad. Scales that
   * have no diatonic triads are tested by their degree count rather than by
   * letting {@link diatonicTriad} throw.
   */
  #modeOfDegree(n: number): KeyMode {
    if (this.pitchClasses().length !== HEPTATONIC_DEGREES) {
      return this.isMinor ? 'minor' : 'major';
    }
    const { quality } = diatonicTriad(n, this.#scale);
    return quality === 'min' || quality === 'dim' ? 'minor' : 'major';
  }

  /**
   * Transpose the key by a spelled interval, keeping the spelling the interval
   * names.
   *
   * Unlike {@link Key.transpose}, which picks a letter from the semitone count,
   * the interval's diatonic number decides the tonic's letter: G# minor down an
   * augmented fourth is D minor, while down a diminished fifth it is Dbb minor.
   * The mode mask is unchanged, so the scale keeps its shape.
   *
   * @param interval The interval to apply, as a name (`'A4'`, `'-A4'`), plain
   *   interval data, or an {@link Interval}; a descending interval moves down.
   * @returns The transposed key.
   * @throws If the value does not describe a spelled interval.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.minor('D').transposeBy('A4').toString(); // 'G# minor'
   * Key.minor('G#').transposeBy('-A4').toString(); // 'D minor'
   * ```
   */
  transposeBy(interval: IntervalLike): Key {
    const step = toSpelledInterval(interval);
    return new Key(
      { rootPc: mod12(this.#scale.rootPc + step.semitones), modeMask12: this.#scale.modeMask12 },
      new Note(transposeByInterval(this.#tonic.data, step)),
      this.#variant,
    );
  }

  /**
   * The spelled interval from this key's tonic to another key's tonic.
   *
   * Both tonics are octave-less, so the interval is measured within one
   * ascending octave: C major to Eb major is a minor third, and Eb major back
   * to C major is a major sixth.
   *
   * @param other The key to measure to.
   * @returns The interval between the two tonics.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('C').intervalTo(Key.major('F#')).name; // 'A4'
   * ```
   */
  intervalTo(other: Key): Interval {
    return Interval.fromData(bareInterval(this.#tonic, other.tonic));
  }

  /**
   * Transpose the key by a number of semitones.
   *
   * The mode mask is unchanged, so the scale keeps its shape; only the tonic
   * moves. The tonic's letter follows the semitone count, and the result is
   * then respelled to its enharmonic key whenever that letter would need a
   * signature of more than seven sharps or flats: Db major up a semitone reads
   * as D major rather than as Ebb major and its ten flats. A key that is
   * already written — anything within ±7 — is left exactly as it is, so C major
   * up six semitones stays F# major, and a key whose enharmonic is unwritable
   * too keeps the letter-transposed spelling.
   *
   * Use {@link Key.transposeBy} to transpose by a named interval instead, which
   * spells the tonic exactly as that interval demands.
   *
   * @param semitones The signed semitone offset.
   * @returns The transposed key.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('C').transpose(2).toString(); // 'D major'
   * Key.major('Db').transpose(1).toString(); // 'D major'
   * ```
   */
  transpose(semitones: number): Key {
    assertFiniteNumber(semitones, 'semitones');
    const rootPc = mod12(this.#scale.rootPc + Math.round(semitones));
    const scale = { rootPc, modeMask12: this.#scale.modeMask12 };
    const moved = new Key(scale, this.#tonic.transpose(semitones), this.#variant);
    if (Math.abs(moved.fifths) <= MAX_CONVENTIONAL_FIFTHS) {
      return moved;
    }
    // The enharmonic key supplies the tonic spelling only: the scale keeps this
    // key's own mask, so a harmonic minor or a pentatonic is respelled rather
    // than flattened into a plain major or minor key.
    const other = enharmonicKeyOf(moved.tonic.data, moved.scale);
    return other === null ? moved : new Key(scale, new Note(other.tonic), this.#variant);
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
   * @param degree 1-based scale degree of the chord root, as {@link Key.degree}
   *   counts them: 1 is the tonic and 5 the dominant.
   * @param quality Optional chord quality.
   * @returns The chord, with this key attached.
   * @throws Without a `quality`, if this key's scale is not heptatonic —
   *   stacking thirds needs seven degrees, so the pentatonic, blues,
   *   whole-tone, octatonic and chromatic scales have no diatonic triad. Pass
   *   an explicit `quality` for those.
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
   * @param degree 1-based scale degree of the chord root, as {@link Key.degree}
   *   counts them: 1 is the tonic and 5 the dominant.
   * @returns The triad, with this key attached.
   * @throws If this key's scale is not heptatonic; stacking thirds needs seven
   *   degrees. Use {@link Key.chord} with an explicit quality instead.
   */
  diatonicTriad(degree: number): Chord {
    return new Chord(diatonicTriad(degree, this.#scale), this);
  }

  /**
   * The diatonic seventh chord on a scale degree, carrying this key as context.
   *
   * @param degree 1-based scale degree of the chord root, as {@link Key.degree}
   *   counts them: 1 is the tonic and 5 the dominant.
   * @returns The seventh chord, with this key attached.
   * @throws If this key's scale is not heptatonic; stacking thirds needs seven
   *   degrees. Use {@link Key.chord} with an explicit quality instead.
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

  /**
   * The key's tonic and mode, so a template literal or a log line reads as the
   * key. Detected harmonic and melodic minor keys retain their scale form.
   *
   * @returns The name, e.g. `'C major'` or `'A minor'`.
   */
  toString(): string {
    if (this.#variant === 'harmonic' || this.#variant === 'melodic') {
      return `${this.#tonic.name} ${this.#variant} minor`;
    }
    return `${this.#tonic.name} ${this.isMinor ? 'minor' : 'major'}`;
  }
}
