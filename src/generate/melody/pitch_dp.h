/**
 * @file pitch_dp.h
 * @brief Internal pieces of ts/src/generate/melody/pitch-dp.ts: the chain search a melody's pitches
 *        are chosen by, a Viterbi pass over one statement's notes.
 *
 * A state is a pitch together with the direction of the leap that reached it, so a leap followed
 * by motion the same way can be charged without looking two notes back. Per-note costs arrive
 * precomputed from the caller; this module owns only the interval costs and the search.
 */
#ifndef CANTUS_SRC_GENERATE_MELODY_PITCH_DP_H_
#define CANTUS_SRC_GENERATE_MELODY_PITCH_DP_H_

#include <functional>
#include <optional>
#include <vector>

namespace cantus {

/** One note of a chain search (`PitchSlot`). */
struct PitchSlot {
  /** The pitches this note may take; an empty list makes the chain unsolvable. */
  std::vector<double> candidates;
  /** The note's own cost for a candidate pitch. */
  std::function<double(double)> cost;
  /** Whether the note is held at its one candidate rather than searched. */
  bool fixed = false;
};

/** An extra cost on the step into note `index` (from note `index - 1`), added to the interval cost.
 */
using StepCost = std::function<double(std::size_t index, double from, double to)>;

/**
 * Find the cheapest pitch line through a chain of notes (`searchPitches`); ties go to the earliest
 * state visited. Absent when no line satisfies every hard constraint.
 * @throws BudgetExceededError if a per-note table exceeds the budget.
 */
std::optional<std::vector<double>> search_pitches(const std::vector<PitchSlot>& slots,
                                                  std::optional<double> budget,
                                                  const StepCost& extra = {});

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_MELODY_PITCH_DP_H_
