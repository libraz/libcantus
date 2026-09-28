/**
 * Aggregate of the composition-plan module: the plan record, its validator,
 * derivation from a reference profile, and evaluation of a melody against it.
 *
 * Re-exported from `generate/index.ts` and the package root. The contour
 * target `plannedContourAt` is shared by the melody generator and the evaluator
 * through `types.ts` directly and stays off this barrel.
 */

export type { CompositionPlanOptions, PreserveWeights } from './derive.js';
export { deriveCompositionPlan } from './derive.js';
export type {
  CompositionEvaluation,
  CompositionViolation,
  EvaluateCompositionOptions,
} from './evaluate.js';
export { evaluateComposition } from './evaluate.js';
export { planTimeline } from './timeline.js';
export type {
  CompositionPlan,
  PlannedChord,
  PlannedMotif,
  PlannedPhrase,
  PlannedRhythm,
  PlannedSection,
} from './types.js';
export { COMPOSITION_PLAN_VERSION } from './types.js';
export { assertCompositionPlan } from './validate.js';
