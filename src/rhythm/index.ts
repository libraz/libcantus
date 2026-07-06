/**
 * Deterministic rhythm generation over a metric grid.
 *
 * Builds a fixed-resolution grid across one or more bars of a time signature
 * and decides, per grid slot, whether it becomes a note onset. Onset
 * probability follows the metric-accent hierarchy from the `meter` module, so
 * strong positions (downbeats, secondary pulses) are favored over weak
 * off-pulse subdivisions. Given a seed the output is fully reproducible.
 *
 * Positions and durations are measured in quarter-note beats, matching the
 * library-wide convention.
 */

import { createRng } from '../drums/rng.js';
import { beatsPerBar, metricWeight, type TimeSignature } from '../meter/index.js';

/** A single rhythmic note: an onset position and how long it sounds. */
export type RhythmEvent = {
  /** Onset position in quarter-note beats, absolute from the start of the span. */
  position: number;
  /** Duration in quarter-note beats, extending to the next onset. */
  duration: number;
};

/** Options controlling {@link generateRhythm}. */
export type RhythmOptions = {
  /** Seed for the deterministic PRNG. Default 0. */
  seed?: number;
  /** Number of bars to generate. Default 1. */
  bars?: number;
  /**
   * Grid resolution as the number of equal grid steps per quarter-note beat.
   * The default of 2 yields an eighth-note grid; 4 yields a sixteenth-note
   * grid, 3 an eighth-note triplet grid, and so on.
   */
  subdivision?: number;
  /**
   * Overall onset density in [0, 1]. Scales the per-slot onset probability, so
   * higher values fill more grid slots. Default 0.5.
   */
  density?: number;
};

const DEFAULT_SUBDIVISION = 2;
const DEFAULT_DENSITY = 0.5;
const DEFAULT_BARS = 1;

/**
 * Map a metric weight (0–3 from {@link metricWeight}) to a base onset
 * probability before density scaling. Strong positions are much more likely to
 * carry an onset than weak ones; the curve is intentionally small and explicit
 * so its behavior is easy to inspect and test.
 *
 * @param weight The metric weight, 0 (off-pulse) to 3 (downbeat).
 * @returns A base onset probability in [0, 1].
 */
export function onsetWeightCurve(weight: number): number {
  switch (weight) {
    case 3:
      return 1;
    case 2:
      return 0.8;
    case 1:
      return 0.55;
    default:
      return 0.25;
  }
}

/**
 * Generate a deterministic rhythmic pattern over `bars` bars of a time
 * signature. A grid is built at the chosen subdivision; each slot becomes an
 * onset with a probability derived from its metric weight scaled by `density`
 * and sampled from the seeded PRNG. The first slot (the downbeat) is always an
 * onset. Each event's duration extends to the next onset, and the last event
 * extends to the end of the span.
 *
 * @param ts The time signature.
 * @param opts Generation options.
 * @returns Onset events sorted by position, non-overlapping, covering the span.
 */
export function generateRhythm(ts: TimeSignature, opts: RhythmOptions = {}): RhythmEvent[] {
  const seed = opts.seed ?? 0;
  const bars = opts.bars ?? DEFAULT_BARS;
  const subdivision = opts.subdivision ?? DEFAULT_SUBDIVISION;
  const density = opts.density ?? DEFAULT_DENSITY;

  const spanBeats = beatsPerBar(ts) * bars;
  const step = 1 / subdivision;
  const slotCount = Math.round(spanBeats * subdivision);
  const rng = createRng(seed);

  const positions: number[] = [];
  for (let i = 0; i < slotCount; i += 1) {
    const position = i * step;
    if (i === 0) {
      positions.push(position);
      continue;
    }
    const weight = metricWeight(position, ts);
    const probability = onsetWeightCurve(weight) * density;
    if (rng.prob(probability)) {
      positions.push(position);
    }
  }

  const events: RhythmEvent[] = [];
  for (let i = 0; i < positions.length; i += 1) {
    const position = positions[i] ?? 0;
    const nextPosition = positions[i + 1] ?? spanBeats;
    events.push({ position, duration: nextPosition - position });
  }
  return events;
}

/**
 * Onset density of a generated pattern: the mean number of onsets per bar.
 *
 * @param events Events from {@link generateRhythm}.
 * @param ts The time signature.
 * @returns The onset count divided by the number of bars the events span.
 */
export function rhythmDensity(events: RhythmEvent[], ts: TimeSignature): number {
  if (events.length === 0) {
    return 0;
  }
  const last = events[events.length - 1];
  const spanBeats = (last?.position ?? 0) + (last?.duration ?? 0);
  const bars = spanBeats / beatsPerBar(ts);
  return bars > 0 ? events.length / bars : 0;
}
