import type { DetectKeyOptions } from '../analyze/detect/index.js';
import { detectKey, detectKeyBest } from '../analyze/detect/index.js';
import { isMinorKey, romanToChord } from '../analyze/functional/index.js';
import type { Note as NoteData } from '../core/pitch/index.js';
import type { KeyScale } from '../core/types.js';
import { assertFiniteNumber } from '../core/validation/index.js';
import {
  type ChordQuality,
  chordFromDegree,
  diatonicSeventh,
  diatonicTriad,
} from '../theory/chord/index.js';
import {
  isScaleTone,
  majorKey,
  minorKey,
  scaleByName,
  scaleTonesInDegreeOrder,
} from '../theory/scale/index.js';
import { spellScale } from '../theory/spelling/index.js';
import { Chord } from './chord.js';
import { Note } from './note.js';
import { mod12, spellPitchClassBare } from './shared.js';

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
    const rootPc = mod12(scale.rootPc);
    if (tonic.pitchClass !== rootPc) {
      throw new RangeError(
        `tonic ${tonic.name} does not match the scale root pitch class ${rootPc}; ` +
          'pass a tonic that spells the scale root, or omit it to have one chosen',
      );
    }
    this.#scale = { rootPc, modeMask12: scale.modeMask12 };
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
   * @param root Tonic as a note name or a pitch class; a numeric root is
   *   spelled with whichever accidental side yields the fewest accidentals
   *   across the scale, exactly as {@link Key.major} does.
   * @returns The key.
   * @throws If the name is not a known scale.
   */
  static named(name: string, root: string | number): Key {
    if (typeof root === 'string') {
      const tonic = Note.of(root);
      return new Key(scaleByName(name, tonic.pitchClass), tonic);
    }
    const scale = scaleByName(name, mod12(root));
    return new Key(scale, bestTonicForScale(mod12(root), scale));
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
    return detectKey(pitches, opts).map((match) => Key.of(match.key));
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
    return best === null ? null : Key.of(best.key);
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
   * The scale's pitch classes in ascending scale-degree order (degree 0 first).
   *
   * @returns One pitch class per scale degree.
   */
  pitchClasses(): number[] {
    return scaleTonesInDegreeOrder(this.#scale);
  }

  /**
   * Transpose the key by a number of semitones.
   *
   * The mode mask is unchanged, so the scale keeps its shape; only the tonic
   * moves. The new tonic is spelled the way that key is conventionally written
   * — D major, not C## major.
   *
   * @param semitones The signed semitone offset.
   * @returns The transposed key.
   * @example
   * ```ts
   * import { Key } from '@libraz/libcantus';
   * Key.major('C').transpose(2).toString(); // 'D major'
   * ```
   */
  transpose(semitones: number): Key {
    assertFiniteNumber(semitones, 'semitones');
    const rootPc = mod12(this.#scale.rootPc + Math.round(semitones));
    return Key.of({ rootPc, modeMask12: this.#scale.modeMask12 });
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
   * @param degree 0-based scale degree of the chord root.
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
   * @param degree 0-based scale degree of the chord root.
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
   * key. Only the major/minor distinction is named, since a mask does not carry
   * a scale name.
   *
   * @returns The name, e.g. `'C major'` or `'A minor'`.
   */
  toString(): string {
    return `${this.#tonic.name} ${this.isMinor ? 'minor' : 'major'}`;
  }
}
