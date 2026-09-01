import type { MotifRelation } from '../analyze/melody/index.js';
import { melodicSimilarity, motifFromNotes, relateMotifs } from '../analyze/melody/index.js';
import type { ChordTimeline } from '../analyze/timeline/index.js';
import type { TimeSignature } from '../core/meter/index.js';
import type { NoteEvent } from '../core/types.js';
import { assertNoteEvent } from '../core/validation/index.js';
import type {
  GenerationContextInput,
  MotifCell,
  MotifContour,
  MotifNote,
  MotifOptions,
  MotifTransform,
} from '../generate/index.js';
import {
  developMotif,
  generateMotif,
  motifToNoteEvents,
  transformMotif,
} from '../generate/index.js';
import { type KeyLike, toKeyScale } from '../theory/scale/index.js';
import { type ChordLike, toChordData } from '../theory/symbol/index.js';
import type { ScoreOptions } from './score.js';
import { Score } from './score.js';
import { assertDataObject, assertDataObjects, withoutNegativeZero } from './shared.js';
import type { Timeline } from './timeline.js';

/**
 * How a motif is generated: what {@link MotifOptions} asks for, with the key
 * and the chord taken the way the rest of the class API takes them.
 */
export type MotifGenerateOptions = {
  /** The key the line is written in: a name, plain key data, or a {@link Key}. */
  key: KeyLike;
  /**
   * The chord the downbeats spell out, when the line is written over one: a
   * chord symbol, plain chord data, or a {@link Chord}. Without it no note is
   * pulled to a chord tone.
   */
  chord?: ChordLike | null;
  /** Length of the motif in bars of `ts`. */
  bars: number;
  /**
   * Meter the bars are counted in, which sets the bar length.
   *
   * @defaultValue 4/4
   */
  ts?: TimeSignature;
  /**
   * Melodic contour shape the line follows.
   *
   * @defaultValue `'arch'`
   */
  contour?: MotifContour;
  /**
   * Probability in [0, 1] that a note is nudged by a single diatonic step;
   * sugar for the context's `complexity.ornament`, which wins where both are
   * given.
   *
   * @defaultValue 0
   */
  jitter?: number;
  /**
   * The generation context. Its `complexity.ornament` is the jitter and its
   * `seed` fixes which notes are nudged.
   *
   * @defaultValue `{ seed: 0 }`
   */
  ctx?: GenerationContextInput;
};

/** Defensive copy of one note, carrying only the fields a motif note holds. */
function copyNote(note: MotifNote): MotifNote {
  return {
    pitch: withoutNegativeZero(note.pitch),
    startBeat: withoutNegativeZero(note.startBeat),
    durationBeat: withoutNegativeZero(note.durationBeat),
  };
}

/**
 * Defensive copy of a cell, its notes checked as they are copied.
 *
 * A note that never sounds is refused, which is the policy the transforms
 * themselves hold: a cell is written material rather than an imported track,
 * and a zero-length note in one would be tiled and transformed as though it
 * were a note.
 *
 * The notes keep the order they arrive in rather than being sorted into time
 * order: the transforms read the first note of the array as the cell's pivot
 * and its head, and a retrograde is exactly the cell whose notes no longer run
 * forwards.
 */
function copyCell(cell: MotifCell): MotifCell {
  assertDataObject(cell, 'motif cell');
  return {
    notes: assertDataObjects<NoteEvent>(cell.notes, 'motif notes').map((note, index) =>
      copyNote(assertNoteEvent(note, `motif notes[${index}]`)),
    ),
  };
}

/** The chord data a {@link MotifGenerateOptions.chord} value names, if any. */
function chordFrom(chord: ChordLike | null | undefined): MotifOptions['chord'] {
  return chord === undefined || chord === null ? chord : toChordData(chord);
}

/**
 * A short melodic cell, and the transformations that make a piece out of one.
 *
 * A motif is the smallest thing a composer works with: a handful of notes that
 * come back inverted, in retrograde, a step higher, twice as slow. The library
 * generates one and transforms one, but every step hands back a bare cell that
 * has to be named again on the way into the next, and the key travels beside it
 * by hand. A `Motif` carries the cell, so a subject and its answer are two
 * expressions rather than two variables.
 *
 * The cell holds notes and nothing else: the key it was written in is not part
 * of it, since the same figure is worth restating in another key, and the
 * members that need one are given it.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Motif } from '@libraz/libcantus';
 * const subject = Motif.generate({ key: 'C major', bars: 1 });
 * subject.transform('invert').relateTo(subject)?.kind; // 'inversion'
 * ```
 */
export class Motif {
  readonly #cell: MotifCell;

  /**
   * Wrap a plain motif cell.
   *
   * @param cell The notes of the cell; copied, never retained.
   * @throws If a note carries a value the transforms cannot hold.
   */
  constructor(cell: MotifCell) {
    this.#cell = copyCell(cell);
  }

  /**
   * Generate a seed motif.
   *
   * The line follows the requested contour in diatonic steps from the tonic,
   * snapped to the key; with a chord in hand, the notes landing on bar
   * downbeats are pulled to the nearest chord tone.
   *
   * @param opts Key, chord, length, contour, jitter and context; see
   *   {@link MotifGenerateOptions}.
   * @returns The generated motif.
   * @throws If the key or the chord names none, or a dial is outside [0, 1].
   * @example
   * ```ts
   * import { Motif } from '@libraz/libcantus';
   * const motif = Motif.generate({ key: 'C major', bars: 2, contour: 'ascending' });
   * motif.notes.length; // 4
   * ```
   */
  static generate(opts: MotifGenerateOptions): Motif {
    return new Motif(
      generateMotif({ ...opts, key: toKeyScale(opts.key), chord: chordFrom(opts.chord) }),
    );
  }

  /**
   * Read a run of notes as a motif.
   *
   * This is how a caller names a cell it already has — a subject lifted out of
   * a score, a phrase a player typed in. Only the fields a motif note carries
   * are kept, so notes that arrived from a score leave their dynamics behind.
   *
   * @param notes The cell, in the order the transforms should read it.
   * @returns The motif.
   * @throws If a note carries a value the transforms cannot hold.
   */
  static fromNotes(notes: readonly NoteEvent[]): Motif {
    return new Motif({ notes: [...notes] });
  }

  /** Rebuild a motif from the plain data {@link Motif.data} hands out. */
  static fromData(cell: MotifCell): Motif {
    return new Motif(cell);
  }

  /** Rebuild a motif from its {@link Motif.toJSON} output. */
  static fromJSON(cell: MotifCell): Motif {
    return new Motif(cell);
  }

  /** The notes of the cell, in the order the transforms read them. */
  get notes(): MotifNote[] {
    return this.#cell.notes.map(copyNote);
  }

  /** Where the cell stops sounding, measured from its own first onset. */
  get totalBeats(): number {
    if (this.#cell.notes.length === 0) {
      return 0;
    }
    const start = Math.min(...this.#cell.notes.map((note) => note.startBeat));
    const end = Math.max(...this.#cell.notes.map((note) => note.startBeat + note.durationBeat));
    return end - start;
  }

  /** A copy of the underlying plain cell. */
  get data(): MotifCell {
    return { notes: this.#cell.notes.map(copyNote) };
  }

  /**
   * The cell put through one of the classical transformations.
   *
   * `invert` reflects the pitches about the first note and `retrograde` mirrors
   * the onsets about the cell's span, both self-inverse; `augment` and
   * `diminish` scale the note values by `amount` and its reciprocal;
   * `transposeChromatic` moves by semitones; `transposeDiatonic` and `sequence`
   * move by scale degrees with a key in hand, and by semitones without one.
   *
   * @param kind The transformation.
   * @param amount Semitones, scale degrees, or the time factor, as the
   *   transformation reads it.
   * @param key Key context for the diatonic transformations: a name, plain key
   *   data, or a {@link Key}.
   * @returns The transformed motif.
   * @throws If a transformed pitch would leave the MIDI range.
   * @example
   * ```ts
   * import { Motif } from '@libraz/libcantus';
   * const motif = Motif.fromNotes([
   *   { pitch: 60, startBeat: 0, durationBeat: 1 },
   *   { pitch: 62, startBeat: 1, durationBeat: 1 },
   * ]);
   * motif.transform('transposeDiatonic', 1, 'C major').notes[0]?.pitch; // 62
   * ```
   */
  transform(kind: MotifTransform, amount?: number, key?: KeyLike): Motif {
    return new Motif(
      transformMotif(this.#cell, kind, amount, key === undefined ? undefined : toKeyScale(key)),
    );
  }

  /**
   * The cell laid across a span and snapped to the harmony under it.
   *
   * The cell is tiled back to back to fill the bars asked for; the notes
   * carrying structural weight are pulled to the nearest chord tone of the
   * segment sounding there, and the ones between them are kept in the key.
   *
   * @param timeline The harmony to snap against, as a {@link Timeline} or the
   *   plain chord timeline the analysis layer hands out.
   * @param key The key the passing notes are kept in.
   * @param bars How many bars to fill.
   * @param ts Meter the bars are counted in; 4/4 when none is named.
   * @returns The developed motif.
   * @throws If the bar count is not a positive integer.
   */
  develop(
    timeline: Timeline | ChordTimeline,
    key: KeyLike,
    bars: number,
    ts?: TimeSignature,
  ): Motif {
    // Read through the public surface rather than by `instanceof`, so a
    // timeline built by a second copy of the module develops like any other.
    const chords = 'chordTimeline' in timeline ? timeline.chordTimeline : timeline;
    return new Motif(developMotif(this.#cell, chords, toKeyScale(key), bars, ts));
  }

  /**
   * How this motif stands to another: the transformation that turns one into
   * the other, named.
   *
   * @param other The statement to name against this one.
   * @param key Key context for the tonal reading; without it, an answer that
   *   only holds diatonically is not recognised.
   * @returns The relation, or null when the two stand in none.
   */
  relateTo(other: Motif, key?: KeyLike): MotifRelation | null {
    return relateMotifs(
      motifFromNotes(this.#cell.notes),
      motifFromNotes(other.notes),
      key === undefined ? undefined : toKeyScale(key),
    );
  }

  /**
   * How alike two lines are, in [0, 1].
   *
   * What {@link Motif.relateTo} answers null for still scores here: this is the
   * measure for a variant that adds a passing note or drops one, rather than
   * for the exact transformations.
   *
   * @param other The line to compare with.
   * @returns The likeness: 1 for the same line, a transposition of it included.
   */
  similarityTo(other: Motif): number {
    return melodicSimilarity(this.#cell.notes, other.notes);
  }

  /**
   * The cell as a score, so it reaches the rest of the class API.
   *
   * @param opts The meter, tempo and key to read the notes against; see
   *   {@link ScoreOptions}.
   * @returns The score holding the cell.
   */
  toScore(opts?: ScoreOptions): Score {
    return Score.of(motifToNoteEvents(this.#cell), opts);
  }

  /**
   * Whether another motif holds the same notes in the same order.
   *
   * The comparison is made through the other motif's public data, so two
   * motifs built by different copies of the module still compare. The order is
   * part of it: the transformations read the first note of the cell as its
   * pivot, so two cells sounding alike but read from different ends are not
   * the same motif.
   *
   * @param other The motif to compare.
   * @returns True when the cells hold the same notes in the same order.
   */
  equals(other: Motif): boolean {
    const theirs = other.data;
    return (
      this.#cell.notes.length === theirs.notes.length &&
      this.#cell.notes.every((note, index) => sameNote(note, theirs.notes[index]))
    );
  }

  /** The plain form of the cell, for `JSON.stringify`. */
  toJSON(): MotifCell {
    return this.data;
  }
}

/** Whether two notes sound the same pitch over the same stretch. */
function sameNote(note: MotifNote, other: MotifNote | undefined): boolean {
  return (
    other !== undefined &&
    note.pitch === other.pitch &&
    note.startBeat === other.startBeat &&
    note.durationBeat === other.durationBeat
  );
}
