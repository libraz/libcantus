// A plan's harmony as a chord timeline: ts/src/generate/plan/timeline.ts.

#include "generate/plan/timeline.h"

#include "cantus/analyze/functional.h"
#include "cantus/theory/chord.h"

namespace cantus {

ChordTimeline plan_timeline(const CompositionPlan& plan) {
  return plan_chord_timeline(assert_composition_plan(plan));
}

ChordTimeline plan_chord_timeline(const CompositionPlan& plan) {
  std::vector<ChordSpan> spans;
  for (const PlannedChord& chord : plan.harmony) {
    const ResolvedKey& key = plan.keys[static_cast<std::size_t>(chord.key)];
    spans.push_back(span_from_chord(roman_to_chord(chord.roman, KeyArg(key)), chord.startBeat));
  }
  return chord_timeline_from_chords(spans, plan.span.endBeat);
}

}  // namespace cantus
