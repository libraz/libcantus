/**
 * Plan helpers shared with modules outside `generate/plan`, kept off the plan
 * builder's own public surface.
 */

import type { MeterMap } from '../../core/meter/index.js';
import { BEAT_EPS, barStartBeat, beatsPerBarAt, metricWeight } from '../../core/meter/index.js';
import type { CompositionPlan, PlannedChord, PlannedPhrase } from './types.js';

/** How a position stands in the bar: a strong pulse, a weak pulse, or off the pulses. */
export type PositionClass = 'strong' | 'weak' | 'off';

/** Metric weight from which a pulse counts as strong. */
export const STRONG_WEIGHT = 2;

/**
 * The class of a position under a meter map.
 *
 * @param beat The position, in quarter-note beats.
 * @param meters The meter map.
 * @returns `'strong'` from metric weight 2, `'weak'` at weight 1, `'off'` at 0.
 */
export function positionClass(beat: number, meters: MeterMap): PositionClass {
  const weight = metricWeight(beat, meters);
  return weight >= STRONG_WEIGHT ? 'strong' : weight > 0 ? 'weak' : 'off';
}

/**
 * The downbeat of a phrase's final bar, or the phrase start when that comes
 * later: where the generator's closing hold begins, dropping every onset after
 * the note it holds.
 *
 * @param phrase The phrase.
 * @param meters The meter map.
 * @returns The beat.
 */
export function finalDownbeat(phrase: PlannedPhrase, meters: MeterMap): number {
  let downbeat = barStartBeat(phrase.startBeat, meters);
  while (downbeat + beatsPerBarAt(downbeat, meters) < phrase.endBeat - BEAT_EPS) {
    downbeat += beatsPerBarAt(downbeat, meters);
  }
  return Math.max(downbeat, phrase.startBeat);
}

/**
 * The planned chord sounding at a beat.
 *
 * @param plan The plan.
 * @param beat The position, in quarter-note beats.
 * @returns The first chord whose span holds the beat, or `undefined` where none does.
 */
export function chordEntryAt(plan: CompositionPlan, beat: number): PlannedChord | undefined {
  return plan.harmony.find((chord) => beat >= chord.startBeat && beat < chord.endBeat);
}
