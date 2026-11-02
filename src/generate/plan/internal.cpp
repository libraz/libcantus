// The position classes and the final downbeat of ts/src/generate/plan/internal.ts.

#include "generate/plan/internal.h"

#include "cantus/core/limits.h"
#include "generate/plan/limits.gen.h"
#include "js/math.h"

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

double final_downbeat(const PlannedPhrase& phrase, const MeterMap& meters) {
  double downbeat = bar_start_beat(phrase.startBeat, meters);
  while (downbeat + beats_per_bar_at(downbeat, meters) < phrase.endBeat - BEAT_EPS) {
    downbeat += beats_per_bar_at(downbeat, meters);
  }
  return js::max(downbeat, phrase.startBeat);
}

const PlannedChord* chord_entry_at(const CompositionPlan& plan, double beat) {
  for (const PlannedChord& chord : plan.harmony) {
    if (beat >= chord.startBeat && beat < chord.endBeat) {
      return &chord;
    }
  }
  return nullptr;
}

}  // namespace cantus
