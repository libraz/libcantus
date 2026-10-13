/**
 * Reading a {@link CompositionPlan}'s harmony as a chord timeline.
 *
 * Kept apart from the plan types so the public reader can validate its plan
 * without the types module importing the validator that imports it.
 */

import { romanToChord } from '../../analyze/functional/roman.js';
import { type ChordTimeline, chordTimelineFromChords } from '../../analyze/timeline/index.js';
import { spanFromChord } from '../../theory/chord/index.js';
import type { ResolvedKey } from '../../theory/scale/index.js';
import type { CompositionPlan } from './types.js';
import { assertCompositionPlan } from './validate.js';

/**
 * Read a plan's harmony as a chord timeline.
 *
 * The one way a generator or an evaluator reads chords out of a plan: each
 * entry in `plan.harmony` is resolved against its key and placed at its own
 * beat, so the timeline this returns always agrees with the plan it was built
 * from.
 *
 * @param plan The plan to read harmony from.
 * @returns A chord timeline spanning `plan.span`.
 * @throws {InvalidInputError} If the plan is not a valid composition plan.
 * @example
 * ```ts
 * import { planTimeline, resolveKey } from '@libraz/libcantus';
 * const plan = {
 *   planVersion: 1, seed: 0, algorithmVersion: 1,
 *   keys: [resolveKey('C major')], meters: [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }],
 *   span: { startBeat: 0, endBeat: 4, bars: 1 }, sections: [], phrases: [],
 *   harmony: [{ startBeat: 0, endBeat: 4, key: 0, roman: 'I' }], motifs: [],
 *   rhythm: { onsetLevels: [1, 0, 0, 0, 0, 0], interOnsetShares: new Array(17).fill(0).fill(1, 8, 9), syncopation: 0 },
 * };
 * planTimeline(plan).at(0); // the I chord in C major
 * ```
 * @category Composition
 */
export function planTimeline(plan: CompositionPlan): ChordTimeline {
  return planChordTimeline(assertCompositionPlan(plan));
}

/**
 * {@link planTimeline} without the validation, for callers that validated the
 * plan on their own way in.
 */
export function planChordTimeline(plan: CompositionPlan): ChordTimeline {
  const spans = plan.harmony.map((chord) => {
    const key = plan.keys[chord.key] as ResolvedKey;
    return spanFromChord(romanToChord(chord.roman, key), chord.startBeat);
  });
  return chordTimelineFromChords(spans, plan.span.endBeat);
}
