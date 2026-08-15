/**
 * Pitch-class weight histograms over a span of notes.
 *
 * Chord inference and key inference both ask the same question of a stretch of
 * music — how much of each pitch class is sounding, and how prominently — so
 * they read it from one place. Sharing the histogram is what lets a chord
 * boundary and a key boundary be compared on the same scale.
 */

import type { TimeSignature } from '../core/meter/index.js';
import { metricWeight } from '../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../core/pitch/index.js';
import type { NoteEvent } from '../core/types.js';

const EPS = 1e-9;

/** A window's pitch-class weight histogram and the summaries drawn from it. */
export type WindowWeights = {
  /** Weight per pitch class, indexed 0-11. */
  weights: number[];
  /** Sum of every pitch class's weight. */
  totalWeight: number;
  /** The single largest pitch-class weight. */
  maxWeight: number;
  /** Lowest sounding MIDI pitch, or +Infinity when the window is empty. */
  lowestPitch: number;
};

/**
 * Weigh the pitch classes sounding across `[windowStart, windowEnd)`.
 *
 * A note contributes its overlap with the window, scaled by velocity and, when
 * its onset falls inside the window, by a metric-accent bonus. Weighing by
 * overlap rather than by full duration is what makes the result additive over
 * adjacent windows: a note held across a boundary counts in each window only
 * for the part of it that sounds there.
 *
 * @param notes The notes to weigh; those not overlapping the window are ignored.
 * @param windowStart First beat of the window.
 * @param windowEnd End of the window, exclusive.
 * @param ts Time signature supplying the metric accents.
 * @returns The histogram and its summaries.
 */
export function windowWeights(
  notes: readonly NoteEvent[],
  windowStart: number,
  windowEnd: number,
  ts: TimeSignature,
): WindowWeights {
  const weights = new Array<number>(12).fill(0);
  let lowestPitch = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    const noteEnd = note.startBeat + note.durationBeat;
    const overlap = Math.min(noteEnd, windowEnd) - Math.max(note.startBeat, windowStart);
    if (overlap <= EPS) {
      continue;
    }
    const velocityFactor = note.velocity !== undefined ? note.velocity / 127 : 1;
    const onsetInWindow = note.startBeat >= windowStart - EPS && note.startBeat < windowEnd - EPS;
    const accent = onsetInWindow ? 1 + metricWeight(note.startBeat, ts) / 3 : 1;
    const pc = pitchClass(note.pitch);
    weights[pc] = (weights[pc] ?? 0) + overlap * velocityFactor * accent;
    if (note.pitch < lowestPitch) {
      lowestPitch = note.pitch;
    }
  }
  let totalWeight = 0;
  let maxWeight = 0;
  for (const w of weights) {
    totalWeight += w;
    maxWeight = Math.max(maxWeight, w);
  }
  return { weights, totalWeight, maxWeight, lowestPitch };
}
