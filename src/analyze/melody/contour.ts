/**
 * The shape of a line: which way it moves, and what that adds up to.
 *
 * A contour is the melody with its pitches forgotten — the sequence of ups and
 * downs alone — which is what lets a phrase be called an arch whatever key it
 * is in and whatever intervals it is built from.
 */

import type { NoteEvent } from '../../core/types.js';
import type { MelodicPhrase } from './internal.js';
import { intervalsOf, orderedNotes, phraseNotes } from './internal.js';

/**
 * Share of a line's total motion that has to run one way before the line is
 * called ascending, descending, or an arch.
 *
 * A melody that climbs an octave with one dip on the way is heard as ascending,
 * so the classification is a dominance test rather than a strict-monotonicity
 * one. Below this share the line is reported as a wave, which is the honest
 * answer for something that changes direction repeatedly.
 */
const DIRECTIONAL_SHARE = 0.75;
/**
 * Step direction between two consecutive notes.
 *
 * @category Arrangement & Analysis
 */
export type ContourDirection = 'up' | 'down' | 'same';
/**
 * The overall shape of a line.
 *
 * The first four names are the vocabulary the motif generator's contours are
 * written in, and mean the same here. `'static'` is the shape a generator never
 * asks for and an analysis regularly meets: a line that does not move. A line
 * that dips and comes back — an arch upside down — reads as `'wave'`, since the
 * shared vocabulary has no name of its own for it.
 *
 * A wave has to turn more than once to be heard as one, so a cell the generator
 * writes for `'wave'` reads back as `'wave'` only from three bars up; the one-
 * and two-bar cells turn once and read as `'arch'`. The other three shapes come
 * back under their own name at every length.
 *
 * @category Arrangement & Analysis
 */
export type MelodicContourShape = 'arch' | 'ascending' | 'descending' | 'wave' | 'static';
/**
 * The abstract shape of a line: its step directions and what they add up to.
 *
 * @category Arrangement & Analysis
 */
export type MelodicContour = {
  /** One direction per adjacent pair of notes, in time order. */
  directions: ContourDirection[];
  /** What the directions add up to. */
  shape: MelodicContourShape;
  /** Index of the highest note; ties keep the earliest, and -1 for a line with no notes. */
  peakIndex: number;
  /** Index of the lowest note; ties keep the earliest, and -1 for a line with no notes. */
  troughIndex: number;
  /** Semitone distance from the lowest note to the highest. */
  range: number;
  /** Why the line was given that shape. */
  rationale: string;
};
/**
 * Where the highest and lowest notes of a line sit; ties keep the earliest.
 *
 * A line with no notes has neither, and answers -1 for both rather than 0,
 * which would name a note the caller cannot reach.
 */
function extremes(notes: readonly NoteEvent[]): { peak: number; trough: number } {
  if (notes.length === 0) {
    return { peak: -1, trough: -1 };
  }
  let peak = 0;
  let trough = 0;
  for (let i = 1; i < notes.length; i += 1) {
    if ((notes[i]?.pitch ?? 0) > (notes[peak]?.pitch ?? 0)) {
      peak = i;
    }
    if ((notes[i]?.pitch ?? 0) < (notes[trough]?.pitch ?? 0)) {
      trough = i;
    }
  }
  return { peak, trough };
}
/**
 * Read the shape of a line.
 *
 * The step directions are the literal answer; the shape is what they add up to.
 * A line is called ascending or descending when most of its motion runs one way,
 * not only when every step does — a climb with one dip in it is still heard as a
 * climb — and an arch when it rises to an interior peak and comes back down.
 * Anything that keeps changing direction is a wave, and a line that does not move
 * is static.
 *
 * The line is expected to be monophonic, as {@link analyzeVoice} expects a voice
 * to be; split polyphonic material into lines first. Notes struck together are
 * read as one event, the highest of them standing for it — a chord and the note
 * after it trace one step, not a climb through the chord — so a piano part read
 * whole answers for its top voice rather than for a line no one plays.
 *
 * @param notes The line: a motif, or plain note events. Notes that never sound
 *   are dropped, and notes sharing an onset are folded to their top voice.
 * @returns The directions, the shape, the peak and trough, and a rationale. A
 *   line with no sounding notes is static with a range of 0, and its peak and
 *   trough are -1: there is no note for them to point at.
 * @example
 * ```ts
 * import { melodicContour } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 64, startBeat: 1, durationBeat: 1 },
 *   { pitch: 60, startBeat: 2, durationBeat: 1 },
 * ];
 * melodicContour(notes).shape; // 'arch'
 * ```
 * @category Arrangement & Analysis
 */
export function melodicContour(notes: MelodicPhrase): MelodicContour {
  const line = orderedNotes(phraseNotes(notes), 'contour notes');
  const intervals = intervalsOf(line);
  const directions: ContourDirection[] = intervals.map((step) =>
    step > 0 ? 'up' : step < 0 ? 'down' : 'same',
  );
  const { peak, trough } = extremes(line);
  const range = (line[peak]?.pitch ?? 0) - (line[trough]?.pitch ?? 0);
  const motion = intervals.reduce((sum, step) => sum + Math.abs(step), 0);
  if (motion === 0) {
    return {
      directions,
      shape: 'static',
      peakIndex: peak,
      troughIndex: trough,
      range: 0,
      rationale:
        line.length < 2
          ? 'Too short to have a direction, so the line is static'
          : 'Every note at the same pitch, so the line is static',
    };
  }

  const first = line[0]?.pitch ?? 0;
  const last = line[line.length - 1]?.pitch ?? 0;
  const net = last - first;
  const directness = Math.abs(net) / motion;
  const share = Math.round(directness * 100);
  if (directness >= DIRECTIONAL_SHARE) {
    const shape = net > 0 ? 'ascending' : 'descending';
    return {
      directions,
      shape,
      peakIndex: peak,
      troughIndex: trough,
      range,
      rationale: `${share}% of the motion runs ${net > 0 ? 'up' : 'down'}, so the line is ${shape}`,
    };
  }

  const peakPitch = line[peak]?.pitch ?? 0;
  const archMotion = peakPitch - first + (peakPitch - last);
  if (peak > 0 && peak < line.length - 1 && archMotion >= DIRECTIONAL_SHARE * motion) {
    return {
      directions,
      shape: 'arch',
      peakIndex: peak,
      troughIndex: trough,
      range,
      rationale: `Rises to its peak at note ${peak + 1} of ${line.length} and falls back, so the line is an arch`,
    };
  }
  return {
    directions,
    shape: 'wave',
    peakIndex: peak,
    troughIndex: trough,
    range,
    rationale: `Changes direction without settling either way (${share}% of the motion nets out), so the line is a wave`,
  };
}
