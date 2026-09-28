/**
 * Plan helpers shared with modules outside `generate/plan`, kept off the plan
 * builder's own public surface.
 */

import type { MeterMap } from '../../core/meter/index.js';
import { metricWeight } from '../../core/meter/index.js';

/** How a position stands in the bar: a strong pulse, a weak pulse, or off the pulses. */
export type PositionClass = 'strong' | 'weak' | 'off';

/** Metric weight from which a pulse counts as strong. */
const STRONG_WEIGHT = 2;

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
