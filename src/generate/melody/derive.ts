/**
 * Derived motif statements: replaying a planned relation on the statement it
 * derives from at the pitch level that suits its phrase best, writing a
 * variation where no relation is named, and the repair a statement's
 * register-forced notes pass through.
 *
 * A statement is a time-ordered list of absolute-beat notes. A relation's
 * shape goes through {@link transformMotif} alone, so a derivation here and a
 * transformation a caller asks for directly cannot come to disagree. The
 * level a relation is replayed at is not part of its shape: a transposition
 * or an inversion keeps its kind at any level, so the planned `semitones` or
 * `degrees` is a preference, weighed against the register and the harmony.
 */

import type { MotifRelationSummary } from '../../analyze/melody/relation.js';
import { NoSolutionError } from '../../core/errors/index.js';
import { BEAT_EPS } from '../../core/meter/index.js';
import type { KeyScale } from '../../core/types.js';
import { shiftByScaleDegrees } from '../../theory/scale/index.js';
import { type MotifCell, type MotifNote, transformMotif } from '../motif/index.js';
import { type PitchSlot, searchPitches } from './pitch-dp.js';

/** What a statement's placement, variation or repair needs to know about the phrase it sits in. */
export type PhraseFrame = {
  /** Lowest pitch of the phrase's register. */
  low: number;
  /** Highest pitch of the phrase's register. */
  high: number;
  /** The pitches a searched note may take at a beat, by its position class. */
  candidatesAt: (beat: number) => readonly number[];
  /** The per-note pitch cost of a note sounding at a beat. */
  costAt: (beat: number) => (pitch: number) => number;
  /** The pitch the phrase's target curve asks for at a beat. */
  targetAt: (beat: number) => number;
  /** How many notes of a statement do not fit the plan's harmony, read after `before`. */
  misfits: (notes: readonly MotifNote[], before: readonly MotifNote[]) => number;
  /** The phrase's start beat, reported by a failure. */
  at: number;
  /** Upper bound every search table is charged against. */
  budget: number | undefined;
};

/** Cost per semitone a variation's step departs from the matching step of its source. */
const VARIATION_STEP_COST = 0.2;
/** Octave a pitch-keeping relation, or a variation's outer notes, may move by. */
const OCTAVE = 12;
/** Cost per semitone of a placed statement's mean distance from the target curve. */
const LEVEL_TARGET_COST = 0.1;
/** Cost per step a placed statement's level departs from the planned one. */
const LEVEL_PLAN_COST = 0.02;

/** Semitone reach either way of the levels a chromatic relation is looked for at. */
const LEVEL_REACH = 24;
/** Scale-degree reach either way of the levels a tonal transposition is looked for at. */
const TONAL_LEVEL_REACH = 14;

/** Scale a cell's timing about its first onset, unless the ratio leaves it as it is. */
function stretched(cell: MotifCell, timeRatio: number): MotifCell {
  return timeRatio === 1 ? cell : transformMotif(cell, 'augment', timeRatio);
}

/** The shape a relation gives a cell, before it is placed at any pitch level. */
function shaped(cell: MotifCell, relation: MotifRelationSummary): MotifCell {
  switch (relation.kind) {
    case 'repetition':
    case 'tonalTransposition':
      return cell;
    case 'transposition':
      return stretched(cell, relation.timeRatio);
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
 * The pitch levels a relation may be replayed at: an octave either way of the
 * source for a pitch-keeping relation, any level but 0 for a transposition
 * (0 would be a repetition), any level for the inversion and retrograde family,
 * and any scale-degree shift but 0 within {@link TONAL_LEVEL_REACH} for a tonal
 * transposition.
 *
 * @param kind The relation kind.
 * @param low Lowest chromatic level to list.
 * @param high Highest chromatic level to list.
 * @returns The levels, ascending.
 */
export function relationLevels(
  kind: MotifRelationSummary['kind'],
  low = -LEVEL_REACH,
  high = LEVEL_REACH,
): number[] {
  const between = (from: number, to: number, skipZero: boolean) => {
    const levels: number[] = [];
    for (let level = Math.ceil(from); level <= to; level += 1) {
      if (!(skipZero && level === 0)) levels.push(level);
    }
    return levels;
  };
  switch (kind) {
    case 'repetition':
    case 'augmentation':
    case 'diminution':
      return [-OCTAVE, 0, OCTAVE];
    case 'transposition':
      return between(low, high, true);
    case 'tonalTransposition':
      return between(-TONAL_LEVEL_REACH, TONAL_LEVEL_REACH, true);
    case 'inversion':
    case 'retrograde':
    case 'retrogradeInversion':
      return between(low, high, false);
  }
}

/**
 * Replay a relation on a source statement at a pitch level.
 *
 * The relation's shape is applied, then the result is placed so its first
 * note sounds `level` semitones from the source's first note — or, for a tonal
 * transposition, every note moved `level` scale degrees in `key` — and its
 * first onset falls on `startBeat`.
 *
 * @param source The source statement, in time order.
 * @param relation The relation to replay; its own `semitones` and `degrees` are not read.
 * @param level The pitch level: semitones, or scale degrees for a tonal transposition.
 * @param startBeat Where the derived statement begins.
 * @param key The key a tonal transposition moves inside.
 * @returns The derived statement, in time order.
 */
export function replayAt(
  source: readonly MotifNote[],
  relation: MotifRelationSummary,
  level: number,
  startBeat: number,
  key: KeyScale,
): MotifNote[] {
  const head = source[0] as MotifNote;
  const cell = shaped({ notes: source.map((n) => ({ ...n })) }, relation);
  const first = cell.notes[0] as MotifNote;
  const offset = startBeat - first.startBeat;
  const shift = head.pitch + level - first.pitch;
  return cell.notes.map((n) => ({
    ...n,
    pitch:
      relation.kind === 'tonalTransposition'
        ? shiftByScaleDegrees(n.pitch, level, key)
        : n.pitch + shift,
    startBeat: n.startBeat + offset,
  }));
}

/**
 * A statement cut at `endBeat`: notes starting there or later are dropped and
 * the rest end by it.
 *
 * @param notes The statement, in time order.
 * @param endBeat Where the statement's span ends.
 * @returns The cut statement.
 */
export function clipStatement(notes: readonly MotifNote[], endBeat: number): MotifNote[] {
  return notes
    .filter((n) => n.startBeat < endBeat - BEAT_EPS)
    .map((n) => ({ ...n, durationBeat: Math.min(n.durationBeat, endBeat - n.startBeat) }));
}

/** How many of a statement's notes fall outside the register. */
function outsideCount(notes: readonly MotifNote[], frame: PhraseFrame): number {
  return notes.filter((n) => n.pitch < frame.low || n.pitch > frame.high).length;
}

/** Whether `level` ranks before `best` by distance from the planned level, then by value. */
function nearerLevel(level: number, best: number, planned: number): boolean {
  const distance = Math.abs(level - planned);
  const bestDistance = Math.abs(best - planned);
  return distance < bestDistance || (distance === bestDistance && level < best);
}

/**
 * Replace the notes marked `forced` with pitches from their own candidates,
 * holding every other note.
 *
 * @param notes The statement, in time order.
 * @param forced Per note, whether it must be replaced.
 * @param frame The phrase it sits in.
 * @returns The repaired statement.
 * @throws {NoSolutionError} If no replacement line exists.
 */
export function repairStatement(
  notes: readonly MotifNote[],
  forced: readonly boolean[],
  frame: PhraseFrame,
): MotifNote[] {
  const slots: PitchSlot[] = notes.map((n, index) =>
    forced[index]
      ? {
          candidates: frame.candidatesAt(n.startBeat),
          cost: frame.costAt(n.startBeat),
          fixed: false,
        }
      : { candidates: [n.pitch], cost: () => 0, fixed: true },
  );
  const pitches = searchPitches(slots, frame.budget);
  if (pitches === null) {
    throw new NoSolutionError(
      `no repair fits the statement into the register ${frame.low}..${frame.high}`,
      { at: frame.at },
    );
  }
  return notes.map((n, index) => ({ ...n, pitch: pitches[index] as number }));
}

/**
 * Place a derived statement: its source replayed through the relation at the
 * level that suits the phrase best, cut at the statement's end.
 *
 * The levels tried are those of {@link relationLevels} that keep every note
 * inside the register. Each is charged the notes the harmony reading rejects
 * after `before`, a pull toward the target curve and a smaller pull toward the
 * planned level; the cheapest wins, the nearer to the planned level and then
 * the lower on a tie. When no level fits the register whole, the level leaving
 * the fewest notes outside it is taken and only those notes are replaced. A
 * harmony misfit a level leaves is kept: the transformation takes precedence.
 *
 * @param source The source statement, in time order.
 * @param relation The relation to replay.
 * @param startBeat Where the statement begins.
 * @param endBeat Where the statement ends.
 * @param key The key a tonal transposition moves inside.
 * @param frame The phrase it sits in.
 * @param before The phrase's notes preceding the statement, in time order.
 * @returns The placed statement, in time order.
 * @throws {NoSolutionError} If the register-forced notes admit no replacement.
 */
export function placeDerived(
  source: readonly MotifNote[],
  relation: MotifRelationSummary,
  startBeat: number,
  endBeat: number,
  key: KeyScale,
  frame: PhraseFrame,
  before: readonly MotifNote[],
): MotifNote[] {
  const planned =
    relation.kind === 'tonalTransposition' ? (relation.degrees ?? 0) : relation.semitones;
  const replay = (level: number) =>
    clipStatement(replayAt(source, relation, level, startBeat, key), endBeat);
  const base = replay(0).map((n) => n.pitch);
  const levels = relationLevels(
    relation.kind,
    Math.max(-LEVEL_REACH, frame.low - Math.min(...base)),
    Math.min(LEVEL_REACH, frame.high - Math.max(...base)),
  );
  let best: { level: number; notes: MotifNote[]; cost: number } | null = null;
  for (const level of levels) {
    const notes = replay(level);
    if (outsideCount(notes, frame) > 0) {
      continue;
    }
    const distance =
      notes.reduce((sum, n) => sum + Math.abs(n.pitch - frame.targetAt(n.startBeat)), 0) /
      notes.length;
    const cost =
      frame.misfits(notes, before) +
      LEVEL_TARGET_COST * distance +
      LEVEL_PLAN_COST * Math.abs(level - planned);
    if (
      best === null ||
      cost < best.cost ||
      (cost === best.cost && nearerLevel(level, best.level, planned))
    ) {
      best = { level, notes, cost };
    }
  }
  if (best !== null) {
    return best.notes;
  }
  let fallback: { level: number; notes: MotifNote[]; outside: number } | null = null;
  for (const level of relationLevels(relation.kind)) {
    const notes = replay(level);
    const outside = outsideCount(notes, frame);
    if (
      fallback === null ||
      outside < fallback.outside ||
      (outside === fallback.outside && nearerLevel(level, fallback.level, planned))
    ) {
      fallback = { level, notes, outside };
    }
  }
  const notes = (fallback as { notes: MotifNote[] }).notes;
  return repairStatement(
    notes,
    notes.map((n) => n.pitch < frame.low || n.pitch > frame.high),
    frame,
  );
}

/**
 * Write a variation of a source statement: its rhythm, first and last pitch
 * kept, the notes between searched with a pull toward the source's steps.
 * Outer notes outside the register move an octave together when that brings
 * both inside, and are searched with the rest otherwise.
 *
 * @param source The source statement, in time order.
 * @param startBeat Where the variation begins.
 * @param frame The phrase the variation sits in.
 * @returns The variation, in time order.
 * @throws {NoSolutionError} If no line joins the outer notes.
 */
export function varyStatement(
  source: readonly MotifNote[],
  startBeat: number,
  frame: PhraseFrame,
): MotifNote[] {
  const offset = startBeat - (source[0] as MotifNote).startBeat;
  const last = source.length - 1;
  const inside = (pitch: number) => pitch >= frame.low && pitch <= frame.high;
  const outer = [(source[0] as MotifNote).pitch, (source[last] as MotifNote).pitch];
  const shift = [0, OCTAVE, -OCTAVE].find((s) => outer.every((pitch) => inside(pitch + s)));
  const notes = source.map((n) => ({ ...n, startBeat: n.startBeat + offset }));
  const slots: PitchSlot[] = notes.map((n, index) =>
    (index === 0 || index === last) && shift !== undefined
      ? { candidates: [n.pitch + shift], cost: () => 0, fixed: true }
      : {
          candidates: frame.candidatesAt(n.startBeat),
          cost: frame.costAt(n.startBeat),
          fixed: false,
        },
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
