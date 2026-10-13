// Rhythm-analysis helpers shared beyond the module: ts/src/analyze/rhythm/internal.ts.

#include "analyze/rhythm/internal.h"

#include <cmath>

#include "analyze/adjacency.h"
#include "cantus/core/limits.h"
#include "js/math.h"

namespace cantus {

namespace {

/** Whether `value` is a whole multiple of `unit`, within float tolerance (`isMultipleOf`). */
bool is_multiple_of(double value, double unit) {
  if (unit <= 0) {
    return false;
  }
  double ratio = value / unit;
  return std::fabs(ratio - js::round(ratio)) < BEAT_EPS;
}

}  // namespace

int rhythm_level(double beat_in_quarters, const MeterArg& meters) {
  TimeSignature ts = meter_at(beat_in_quarters, meters);
  double offset = beat_in_quarters - bar_start_beat(beat_in_quarters, meters);
  double pulse = pulse_beats(ts);
  if (is_multiple_of(offset, pulse)) {
    return metric_weight(beat_in_quarters, meters) + 2;
  }
  double sub_unit = pulse / (is_compound(ts) ? 3 : 2);
  return is_multiple_of(offset, sub_unit) ? 1 : 0;
}

int ioi_bin_index(double ioi) {
  double exponent =
      js::min(IOI_MAX_EXPONENT, js::max(IOI_MIN_EXPONENT, js::round(2 * js::log2(ioi)) / 2));
  return static_cast<int>(js::round((exponent - IOI_MIN_EXPONENT) / IOI_EXPONENT_STEP));
}

}  // namespace cantus
