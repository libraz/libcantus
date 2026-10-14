/**
 * @file melody.h
 * @brief Public C++ API of ts/src/generate/melody: a melody written from a composition plan.
 *
 * The plan is a hard constraint where the generator is free: every root, every span no motif
 * covers and every closing note keeps its phrase's register and offers only the pitches its
 * position class admits. Every draw is addressed by phrase index and absolute beat, so changing one
 * phrase's plan leaves every phrase that does not derive from it sounding as it did.
 */
#ifndef CANTUS_GENERATE_MELODY_H_
#define CANTUS_GENERATE_MELODY_H_

#include <optional>
#include <vector>

#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/plan.h"

namespace cantus {

/** Options of generate_melody() (`MelodyOptions`). */
struct MelodyOptions {
  /**
   * The generation context; its `seed` and `algorithmVersion` take precedence over the plan's. A
   * supplied `rng` is refused: every draw is addressed under a seed.
   */
  std::optional<GenerationContextInput> ctx;
  /** Upper bound on the onset grid and on the pitch search. */
  std::optional<double> budget;
};

/**
 * Write a melody that follows a composition plan (`generateMelody`); the notes are in time order.
 * @throws InvalidInputError if the plan, the options or the context are malformed, or the context
 *   supplies an `rng`.
 * @throws NoSolutionError if a phrase's register admits no line; `at` is the phrase's start beat.
 * @throws BudgetExceededError if the onset grid or the pitch search would exceed the budget.
 */
std::vector<NoteEvent> generate_melody(const CompositionPlan& plan, const MelodyOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_GENERATE_MELODY_H_
