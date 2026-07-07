import { isMinorKey, romanToChord } from '../analyze/functional/index.js';
import type { Note as NoteData } from '../core/pitch/index.js';
import type { KeyScale } from '../core/types.js';
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
