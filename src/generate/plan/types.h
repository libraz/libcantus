/**
 * @file types.h
 * @brief Internal pieces of ts/src/generate/plan/types.ts: the contour target a planned phrase
 *        asks for, shared by the melody generator and the evaluator.
 */
#ifndef CANTUS_SRC_GENERATE_PLAN_TYPES_H_
#define CANTUS_SRC_GENERATE_PLAN_TYPES_H_

#include "cantus/analyze/melody.h"

namespace cantus {

/**
 * The contour a planned phrase asks for at relative position `t` in [0, 1], in [-1, 1] around its
 * register mean (`plannedContourAt`): a tent peaking at `peak_position` for an arch, a line for
 * ascending and descending, two tents for a wave, and flat for static.
 */
double planned_contour_at(MelodicContourShape shape, double peak_position, double t);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_PLAN_TYPES_H_
