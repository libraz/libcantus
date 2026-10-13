/**
 * Rhythm-analysis helpers shared with modules outside `analyze/rhythm`, kept
 * off the analysis's own public surface.
 */

import type { MeterMap } from '../../core/meter/index.js';
import {
  barStartBeat,
  isCompound,
  meterAt,
  metricWeight,
  pulseBeats,
} from '../../core/meter/index.js';
import { BEAT_EPS } from '../adjacency.js';

/** Whether `value` is a whole multiple of `unit`, within float tolerance. */
function isMultipleOf(value: number, unit: number): boolean {
  if (unit <= 0) {
    return false;
  }
  const ratio = value / unit;
  return Math.abs(ratio - Math.round(ratio)) < BEAT_EPS;
}

/**
 * A position's rhythmic level: 2–5 on a main pulse (`metricWeight` plus 2), 1
 * on the pulse's first subdivision (half a pulse in a simple meter, a third in
 * a compound one), 0 elsewhere.
 */
export function rhythmLevel(beatInQuarters: number, meters: MeterMap): number {
  const ts = meterAt(beatInQuarters, meters);
  const offset = beatInQuarters - barStartBeat(beatInQuarters, meters);
  const pulse = pulseBeats(ts);
  if (isMultipleOf(offset, pulse)) {
    return metricWeight(beatInQuarters, meters) + 2;
  }
  const subUnit = pulse / (isCompound(ts) ? 3 : 2);
  return isMultipleOf(offset, subUnit) ? 1 : 0;
}

/** Bin an inter-onset interval to {@link RHYTHM_IOI_BINS}, clamped to its ends. */
export function ioiBinIndex(ioi: number): number {
  const exponent = Math.min(4, Math.max(-4, Math.round(2 * Math.log2(ioi)) / 2));
  return Math.round((exponent + 4) / 0.5);
}
