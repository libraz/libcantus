/**
 * Reference-profile helpers shared with modules outside `analyze/reference`,
 * kept off the profile builder's own public surface.
 */

import type { MeterMap } from '../../core/meter/index.js';
import type { NoteEvent } from '../../core/types.js';
import { BEAT_EPS } from '../adjacency.js';
import { melodicContour } from '../melody/contour.js';
import { analyzeRhythm } from '../rhythm/index.js';
import type { ReferencePhraseMelody } from './types.js';

/** Duration-weighted mean pitch of notes that all sound for a positive length. */
export function weightedMean(notes: readonly NoteEvent[]): number {
  let weighted = 0;
  let total = 0;
  for (const note of notes) {
    weighted += note.pitch * note.durationBeat;
    total += note.durationBeat;
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * How the line reads within one phrase, from the line's notes whose onsets
 * fall in it, each cut off at the phrase's end; null when fewer than two do.
 */
export function phraseMelody(
  line: readonly NoteEvent[],
  startBeat: number,
  endBeat: number,
  lineMean: number,
  meters: MeterMap,
  budget: number | undefined,
): ReferencePhraseMelody | null {
  const inside = line
    .filter((note) => note.startBeat >= startBeat - BEAT_EPS && note.startBeat < endBeat - BEAT_EPS)
    .map((note) => ({
      ...note,
      durationBeat: Math.min(note.startBeat + note.durationBeat, endBeat) - note.startBeat,
    }));
  const first = inside[0];
  if (first === undefined || inside.length < 2) {
    return null;
  }
  let low = first.pitch;
  let peak = first;
  for (const note of inside) {
    low = Math.min(low, note.pitch);
    if (note.pitch > peak.pitch) {
      peak = note;
    }
  }
  const length = endBeat - startBeat;
  const outline: number[] = [];
  for (let k = 0; k < 8; k += 1) {
    const at = startBeat + ((k + 0.5) * length) / 8;
    // The note sounding at the sample point, or the last one before it: a rest holds.
    let held = first;
    for (const note of inside) {
      if (note.startBeat > at + BEAT_EPS) {
        break;
      }
      held = note;
    }
    outline.push(held.pitch - lineMean);
  }
  const rhythm = analyzeRhythm(inside, { meters, totalBeats: endBeat, budget });
  return {
    shape: melodicContour(inside).shape,
    low,
    high: peak.pitch,
    mean: weightedMean(inside),
    peakPitch: peak.pitch,
    peakPosition: Math.min(1, Math.max(0, (peak.startBeat - startBeat) / length)),
    outline,
    onsetDensity: rhythm.onsetDensity,
    restRatio: rhythm.restRatio,
  };
}
