/**
 * @file timeline.h
 * @brief Internal pieces of ts/src/generate/plan/timeline.ts: a plan's harmony read as a chord
 *        timeline, without the validation.
 */
#ifndef CANTUS_SRC_GENERATE_PLAN_TIMELINE_H_
#define CANTUS_SRC_GENERATE_PLAN_TIMELINE_H_

#include "cantus/analyze/timeline.h"
#include "cantus/generate/plan.h"

namespace cantus {

/** planTimeline without the validation, for callers that validated the plan on their own way in. */
ChordTimeline plan_chord_timeline(const CompositionPlan& plan);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_PLAN_TIMELINE_H_
