/**
 * Derived motif statements: replaying a planned relation on the statement it
 * derives from, writing a variation where no relation is named, and the local
 * repair every derived or developed statement passes through afterwards.
 *
 * A statement is a time-ordered list of absolute-beat notes. Replaying a
 * relation goes through {@link transformMotif} alone, so a derivation here and
 * a transformation a caller asks for directly cannot come to disagree.
 */

import type { MotifRelationSummary } from '../../analyze/melody/relation.js';
import { NoSolutionError } from '../../core/errors/index.js';
import type { KeyScale } from '../../core/types.js';
import { type MotifCell, type MotifNote, transformMotif } from '../motif/index.js';
import { type PitchSlot, searchPitches } from './pitch-dp.js';

/** What a repair or a variation search needs to know about the phrase a statement sits in. */
export type PhraseFrame = {
  /** Lowest pitch of the phrase's register. */
  low: number;
  /** Highest pitch of the phrase's register. */
  high: number;
  /** Every pitch in the register, ascending. */
  candidates: readonly number[];
  /** The per-note pitch cost of a note sounding at a beat. */
  costAt: (beat: number) => (pitch: number) => number;
  /**
   * Per note of a statement, whether it must be replaced: outside the register,
   * or not fitting the plan's harmony when read after the notes of `before`.
   */
  needsRepair: (notes: readonly MotifNote[], before: readonly MotifNote[]) => boolean[];
  /** Whether a replacement pitch fits at a beat whatever its neighbours: inside the register, and a chord tone on a pulse. */
  fits: (pitch: number, beat: number) => boolean;
  /** The phrase's start beat, reported by a failure. */
  at: number;
  /** Upper bound every search table is charged against. */
  budget: number | undefined;
};

/** Cost per semitone a variation's step departs from the matching step of its source. */
const VARIATION_STEP_COST = 0.2;
/** Octave a statement is moved by when repair alone cannot bring it into the register. */
const OCTAVE = 12;

/** Scale a cell's timing about its first onset, unless the ratio leaves it as it is. */
function stretched(cell: MotifCell, timeRatio: number): MotifCell {
  return timeRatio === 1 ? cell : transformMotif(cell, 'augment', timeRatio);
}

/** The pitch transformation a relation names, before anchoring. */
function transformed(cell: MotifCell, relation: MotifRelationSummary, key: KeyScale): MotifCell {
  switch (relation.kind) {
    case 'repetition':
      return cell;
    case 'transposition':
      return stretched(
        transformMotif(cell, 'transposeChromatic', relation.semitones),
        relation.timeRatio,
      );
    case 'tonalTransposition':
      return transformMotif(cell, 'transposeDiatonic', relation.degrees, key);
    case 'inversion':
      return stretched(transformMotif(cell, 'invert'), relation.timeRatio);
    case 'retrograde':
      return transformMotif(cell, 'retrograde');
    case 'retrogradeInversion':
      return transformMotif(transformMotif(cell, 'invert'), 'retrograde');
    case 'augmentation':
      return transformMotif(cell, 'augment', relation.timeRatio);
    case 'diminution':
      return transformMotif(cell, 'diminish', 1 / relation.timeRatio);
  }
}

/**
 * Replay a relation on a source statement.
 *
 * After the named transformation the result is moved so its first note sounds
 * `relation.semitones` above the source's first note, and its first onset
 * falls on `startBeat`.
 *
 * @param source The source statement, in time order.
 * @param relation The relation to replay.
 * @param startBeat Where the derived statement begins.
 * @param key The key a tonal transposition moves inside.
 * @returns The derived statement, in time order, before repair.
 */
export function deriveStatement(
  source: readonly MotifNote[],
  relation: MotifRelationSummary,
  startBeat: number,
  key: KeyScale,
): MotifNote[] {
  const head = source[0] as MotifNote;
  const cell = transformed({ notes: source.map((n) => ({ ...n })) }, relation, key);
  const first = cell.notes[0] as MotifNote;
  const anchored = transformMotif(
    cell,
    'transposeChromatic',
    head.pitch + relation.semitones - first.pitch,
  );
  const offset = startBeat - first.startBeat;
  return anchored.notes.map((n) => ({ ...n, startBeat: n.startBeat + offset }));
}

/**
 * Write a variation of a source statement: its rhythm, first and last pitch
 * kept, the notes between searched with a pull toward the source's steps.
 *
 * @param source The source statement, in time order.
 * @param startBeat Where the variation begins.
 * @param frame The phrase the variation sits in.
 * @returns The variation, in time order, before repair.
 * @throws {NoSolutionError} If no line joins the kept outer notes.
 */
export function varyStatement(
  source: readonly MotifNote[],
  startBeat: number,
  frame: PhraseFrame,
): MotifNote[] {
  const offset = startBeat - (source[0] as MotifNote).startBeat;
  const notes = source.map((n) => ({ ...n, startBeat: n.startBeat + offset }));
  const last = notes.length - 1;
  const slots: PitchSlot[] = notes.map((n, index) =>
    index === 0 || index === last
      ? { candidates: [n.pitch], cost: () => 0, fixed: true }
      : { candidates: frame.candidates, cost: frame.costAt(n.startBeat), fixed: false },
  );
  const pitches = searchPitches(
    slots,
    frame.budget,
    (index, from, to) =>
      VARIATION_STEP_COST *
      Math.abs(
        to - from - ((source[index] as MotifNote).pitch - (source[index - 1] as MotifNote).pitch),
      ),
  );
  if (pitches === null) {
    throw new NoSolutionError(`no variation line fits the register ${frame.low}..${frame.high}`, {
      at: frame.at,
    });
  }
  return notes.map((n, index) => ({ ...n, pitch: pitches[index] as number }));
}

/**
 * Replace the notes that need it, holding the rest; null when no replacement
 * line exists. A replaced note always fits on its own, so each pass settles
 * the notes it touches, and a later pass only takes up a neighbour whose own
 * fit leaned on a note that moved.
 */
function repairOnce(
  notes: readonly MotifNote[],
  frame: PhraseFrame,
  before: readonly MotifNote[],
): MotifNote[] | null {
  let line = notes.map((n) => ({ ...n }));
  for (let pass = 0; pass <= notes.length; pass += 1) {
    const flagged = frame.needsRepair(line, before);
    if (!flagged.includes(true)) {
      return line;
    }
    const slots: PitchSlot[] = line.map((n, index) =>
      flagged[index]
        ? {
            candidates: frame.candidates.filter((pitch) => frame.fits(pitch, n.startBeat)),
            cost: frame.costAt(n.startBeat),
            fixed: false,
          }
        : { candidates: [n.pitch], cost: () => 0, fixed: true },
    );
    const pitches = searchPitches(slots, frame.budget);
    if (pitches === null) {
      return null;
    }
    line = line.map((n, index) => ({ ...n, pitch: pitches[index] as number }));
  }
  return null;
}

/** The statement moved by `shift` semitones. */
function movedBy(notes: readonly MotifNote[], shift: number): MotifNote[] {
  return notes.map((n) => ({ ...n, pitch: n.pitch + shift }));
}

/**
 * Bring a statement into its phrase. A statement that leaves the register is
 * first moved a whole octave toward it, else away from it, when that brings
 * every note inside; then every note outside the register, and every note the
 * plan's harmony reading rejects in the context of `before`, is replaced by a
 * search that holds the others. Where no replacement exists the statement is
 * moved an octave toward the register and tried once more.
 *
 * @param notes The statement, in time order.
 * @param frame The phrase it sits in.
 * @param before The phrase's notes preceding the statement, in time order.
 * @returns The repaired statement.
 * @throws {NoSolutionError} If no placement can be repaired.
 */
export function repairStatement(
  notes: readonly MotifNote[],
  frame: PhraseFrame,
  before: readonly MotifNote[] = [],
): MotifNote[] {
  const outside = (n: MotifNote) => n.pitch < frame.low || n.pitch > frame.high;
  const toward = notes.some((n) => n.pitch > frame.high) ? -OCTAVE : OCTAVE;
  const placements: MotifNote[][] = [];
  if (notes.some(outside)) {
    for (const shift of [toward, -toward]) {
      const moved = movedBy(notes, shift);
      if (!moved.some(outside)) {
        placements.push(moved);
      }
    }
  }
  placements.push([...notes], movedBy(notes, toward));
  for (const placed of placements) {
    const repaired = repairOnce(placed, frame, before);
    if (repaired !== null) {
      return repaired;
    }
  }
  throw new NoSolutionError(
    `no repair fits the statement into the register ${frame.low}..${frame.high}`,
    {
      at: frame.at,
    },
  );
}
