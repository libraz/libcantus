// The position classes of ts/src/generate/plan/internal.ts.

#include "generate/plan/internal.h"

#include "generate/plan/limits.gen.h"

namespace cantus {

const char* position_class_name(PositionClass position) {
  switch (position) {
    case PositionClass::kStrong:
      return "strong";
    case PositionClass::kWeak:
      return "weak";
    case PositionClass::kOff:
      return "off";
  }
  return "off";
}

PositionClass position_class(double beat, const MeterMap& meters) {
  int weight = metric_weight(beat, meters);
  return weight >= PLAN_STRONG_WEIGHT ? PositionClass::kStrong
         : weight > 0                 ? PositionClass::kWeak
                                      : PositionClass::kOff;
}

}  // namespace cantus
