/**
 * @file internal.h
 * @brief Internal pieces of ts/src/generate/plan/internal.ts: plan helpers shared with modules
 *        outside generate/plan.
 */
#ifndef CANTUS_SRC_GENERATE_PLAN_INTERNAL_H_
#define CANTUS_SRC_GENERATE_PLAN_INTERNAL_H_

#include <cstdint>

#include "cantus/core/meter.h"

namespace cantus {

/** How a position stands in the bar: a strong pulse, a weak pulse, or off the pulses. */
enum class PositionClass : std::uint8_t { kStrong, kWeak, kOff };

/** The TS name of a position class ("strong", "weak" or "off"). */
const char* position_class_name(PositionClass position);

/** The class of a position under a meter map (`positionClass`). */
PositionClass position_class(double beat, const MeterMap& meters);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_PLAN_INTERNAL_H_
