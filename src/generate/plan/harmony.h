/**
 * @file harmony.h
 * @brief Internal pieces of ts/src/generate/plan/harmony.ts: how a melody note stands against a
 *        plan's harmony, shared by the melody generator and the evaluator.
 */
#ifndef CANTUS_SRC_GENERATE_PLAN_HARMONY_H_
#define CANTUS_SRC_GENERATE_PLAN_HARMONY_H_

#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/generate/plan.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** The key in force at a beat, read from the plan's own harmony (`planKeyAt`). */
std::function<ResolvedKey(double)> plan_key_at(const CompositionPlan& plan);

/**
 * The pitch classes a phrase may close on under a cadence: the cadence's scale degrees in the key
 * of the chord sounding at the closing beat, or for a deceptive cadence the tones of that chord;
 * absent when a deceptive cadence has no chord to read (`cadencePitchClasses`).
 */
std::optional<std::vector<int>> cadence_pitch_classes(const CompositionPlan& plan,
                                                      const ChordTimeline& timeline,
                                                      CadenceType cadence, double beat);

/**
 * A reader of which notes of a phrase line do not fit the plan's harmony (`planHarmonyMisfits`):
 * per note, nothing where it fits, or the labels it was given where it does not.
 */
using HarmonyMisfits = std::function<std::vector<std::optional<std::vector<std::string>>>(
    const std::vector<NoteEvent>&)>;

/** planHarmonyMisfits over a plan and the timeline it already holds. */
HarmonyMisfits plan_harmony_misfits(const CompositionPlan& plan, const ChordTimeline& timeline);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_PLAN_HARMONY_H_
