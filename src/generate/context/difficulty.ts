/**
 * The playing-difficulty ceiling, as the generators apply it.
 *
 * A ceiling is not an intensity: a passage can be harmonically involved and
 * easy to play, or plain and hard. So difficulty never proposes material — it
 * only rejects what the other complexity dials proposed, and only on the
 * timing layer, where speed is what stands in the way. Whether the note exists
 * on the instrument at all, and whether the hand can hold the shape, belong to
 * the instrument profile and hold regardless of the ceiling.
 */

import { assertRange } from '../../core/validation/index.js';

/** The ceiling's lowest and highest levels. */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;

/**
 * Strokes per second one limb sustains at each level, from a beginner's plain
 * eighths to the wrist speed a rudimental player keeps up.
 */
const STROKES_PER_SECOND = [3, 5, 8, 12, 16] as const;

/**
 * Frets per second the fretting hand travels at each level. A shift is a
 * displacement, so the figure is a rate rather than a count of notes.
 */
const FRETS_PER_SECOND = [6, 12, 20, 32, 50] as const;

/** Seconds one quarter-note beat lasts at a tempo. */
function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/** Read a per-level table at a possibly fractional level, interpolating. */
function atLevel(table: readonly number[], difficulty: number): number {
  const level = Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, difficulty));
  const lower = Math.floor(level);
  const upper = Math.ceil(level);
  const low = table[lower - 1] ?? table[0] ?? 0;
  const high = table[upper - 1] ?? low;
  return low + (high - low) * (level - lower);
}

/** Reject a ceiling outside the scale the profiles and reports share. */
export function assertDifficulty(difficulty: number, label = 'complexity difficulty'): number {
  return assertRange(difficulty, MIN_DIFFICULTY, MAX_DIFFICULTY, label);
}

/**
 * Whether a player at this ceiling keeps up a stream of strokes on one voice.
 *
 * @param stepBeats Gap between consecutive strokes, in quarter-note beats.
 * @param bpm Tempo, or undefined when the caller gave none.
 * @param difficulty The ceiling, or undefined for no ceiling.
 * @returns True when the stream is inside the ceiling, and whenever either the
 *   ceiling or the tempo is unknown — a limit nobody stated constrains nothing.
 */
export function sustainsStrokes(
  stepBeats: number,
  bpm: number | undefined,
  difficulty: number | undefined,
): boolean {
  if (difficulty === undefined || bpm === undefined || stepBeats <= 0) {
    return true;
  }
  const rate = 1 / (stepBeats * secondsPerBeat(bpm));
  return rate <= atLevel(STROKES_PER_SECOND, difficulty);
}

/**
 * Whether the fretting hand covers a leap in the time available.
 *
 * @param semitones Distance moved; on a fretted neck one fret is one semitone.
 * @param stepBeats Time to move it in, in quarter-note beats.
 * @param bpm Tempo, or undefined when the caller gave none.
 * @param difficulty The ceiling, or undefined for no ceiling.
 * @returns True when the shift is inside the ceiling, and whenever either the
 *   ceiling or the tempo is unknown.
 */
export function sustainsShift(
  semitones: number,
  stepBeats: number,
  bpm: number | undefined,
  difficulty: number | undefined,
): boolean {
  if (difficulty === undefined || bpm === undefined || stepBeats <= 0) {
    return true;
  }
  const seconds = stepBeats * secondsPerBeat(bpm);
  return Math.abs(semitones) / seconds <= atLevel(FRETS_PER_SECOND, difficulty);
}
