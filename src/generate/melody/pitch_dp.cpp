// The chain search of ts/src/generate/melody/pitch-dp.ts.

#include "generate/melody/pitch_dp.h"

#include <cmath>
#include <cstdint>
#include <limits>

#include "cantus/theory/counterpoint.h"
#include "core/validation/validation.h"
#include "generate/melody/limits.gen.h"

namespace cantus {

namespace {

constexpr double kInfinity = std::numeric_limits<double>::infinity();

/** Budget label every table of the search is charged under. */
constexpr const char* kSearchLabel = "melody pitch search";

/** Cost of a melodic step by its size: a repeated note, a step, a third, a fourth or fifth, wider.
 */
double interval_cost(double size) {
  if (size == 0) {
    return 0.2;
  }
  if (size <= 2) {
    return 0;
  }
  if (size <= PITCH_WIDEST_THIRD) {
    return 0.3;
  }
  if (size <= 7) {
    return 0.6;
  }
  return 1;
}

/** The leap state a step of `delta` semitones arrives in. */
int leap_of(double delta) {
  if (std::abs(delta) <= PITCH_WIDEST_THIRD) {
    return PITCH_NO_LEAP;
  }
  return delta > 0 ? PITCH_LEAP_UP : PITCH_LEAP_DOWN;
}

}  // namespace

PitchSlot pinned_slot(double pitch) {
  return PitchSlot{{pitch}, [](double) { return 0.0; }, true};
}

std::optional<std::vector<double>> search_pitches(const std::vector<PitchSlot>& slots,
                                                  std::optional<double> budget,
                                                  const StepCost& extra) {
  if (slots.empty()) {
    return std::vector<double>();
  }
  const PitchSlot& first = slots.front();
  std::vector<double> previous = allocate_candidate_table(
      static_cast<double>(first.candidates.size()), PITCH_LEAP_STATES, kSearchLabel, budget);
  std::fill(previous.begin(), previous.end(), kInfinity);
  for (std::size_t j = 0; j < first.candidates.size(); ++j) {
    previous[j * PITCH_LEAP_STATES + PITCH_NO_LEAP] = first.cost(first.candidates[j]);
  }
  std::vector<std::vector<std::int32_t>> backs;
  for (std::size_t k = 1; k < slots.size(); ++k) {
    const PitchSlot& before = slots[k - 1];
    const PitchSlot& slot = slots[k];
    std::vector<double> unary;
    for (double pitch : slot.candidates) {
      unary.push_back(slot.cost(pitch));
    }
    std::vector<double> current = allocate_candidate_table(
        static_cast<double>(slot.candidates.size()), PITCH_LEAP_STATES, kSearchLabel, budget);
    std::fill(current.begin(), current.end(), kInfinity);
    std::vector<std::int32_t> back = allocate_choice_table(
        static_cast<double>(slot.candidates.size()), PITCH_LEAP_STATES, kSearchLabel, budget);
    std::fill(back.begin(), back.end(), -1);
    bool both_fixed = before.fixed && slot.fixed;
    for (std::size_t from_index = 0; from_index * PITCH_LEAP_STATES < previous.size();
         ++from_index) {
      double from = before.candidates[from_index];
      // The size cost of each step out of `from`, infinity where it is forbidden. A step between
      // two held notes is never forbidden. The leap states of one pitch share it.
      std::vector<double> size_costs;
      for (int leap = 0; leap < PITCH_LEAP_STATES; ++leap) {
        std::size_t state = from_index * PITCH_LEAP_STATES + static_cast<std::size_t>(leap);
        double reached = previous[state];
        if (reached == kInfinity) {
          continue;
        }
        if (size_costs.empty()) {
          for (double to : slot.candidates) {
            size_costs.push_back(!both_fixed && is_forbidden_melodic_leap(from, to)
                                     ? kInfinity
                                     : interval_cost(std::abs(to - from)));
          }
        }
        for (std::size_t j = 0; j < slot.candidates.size(); ++j) {
          double to = slot.candidates[j];
          double size = size_costs[j];
          if (size == kInfinity) {
            continue;
          }
          double delta = to - from;
          bool continues =
              (leap == PITCH_LEAP_UP && delta > 0) || (leap == PITCH_LEAP_DOWN && delta < 0);
          double step = continues ? size + PITCH_LEAP_CONTINUATION_COST : size;
          double total = reached + step + unary[j] + (extra ? extra(k, from, to) : 0);
          std::size_t index = j * PITCH_LEAP_STATES + static_cast<std::size_t>(leap_of(to - from));
          if (total < current[index]) {
            current[index] = total;
            back[index] = static_cast<std::int32_t>(state);
          }
        }
      }
    }
    backs.push_back(std::move(back));
    previous = std::move(current);
  }
  std::ptrdiff_t best = -1;
  for (std::size_t state = 0; state < previous.size(); ++state) {
    if (previous[state] < kInfinity &&
        (best < 0 || previous[state] < previous[static_cast<std::size_t>(best)])) {
      best = static_cast<std::ptrdiff_t>(state);
    }
  }
  if (best < 0) {
    return std::nullopt;
  }
  std::vector<double> pitches(slots.size());
  std::size_t state = static_cast<std::size_t>(best);
  for (std::size_t k = slots.size(); k > 0; --k) {
    pitches[k - 1] = slots[k - 1].candidates[state / PITCH_LEAP_STATES];
    if (k > 1) {
      state = static_cast<std::size_t>(backs[k - 2][state]);
    }
  }
  return pitches;
}

}  // namespace cantus
