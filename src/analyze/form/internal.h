/**
 * @file internal.h
 * @brief Internal helpers of ts/src/analyze/form/internal.ts: bar-level evidence shared by the
 *        form analyses. Everything here works in absolute quarter-note beats and 0-based bar
 *        indices, so a pickup is bar -1. first_sounding_beat() lives in analyze/grid.h.
 */
#ifndef CANTUS_SRC_ANALYZE_FORM_INTERNAL_H_
#define CANTUS_SRC_ANALYZE_FORM_INTERNAL_H_

#include <array>
#include <cstddef>
#include <optional>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"

namespace cantus {

/**
 * How many bars a span covers, in the meters in force across it (`barSpanOf`): the whole bars
 * between the two ends, plus the part of each end bar the span actually holds.
 */
double bar_span_of(double start_beat, double end_beat, const MeterArg& meter);

/** Hold a score inside the [0, 1] range every confidence in this module reports (`clamp01`). */
double clamp01(double value);

/** Remainder carrying the sign of the divisor (`floorMod`). */
double floor_mod(double value, double modulus);

/** Index of the last bar a span occupies; never before the span's first bar (`lastBarOf`). */
double last_bar_of(const MeterArg& meter, double span_start, double span_end);

/** One bar of the analysed span, with what sounds in it (`BarSlice`). */
struct BarSlice {
  /** 0-based bar index; negative inside a pickup. */
  double index = 0;
  /** First beat of the bar. */
  double startBeat = 0;
  /** End of the bar, exclusive. */
  double endBeat = 0;
  /** Every note overlapping the bar, in input order, as indices into the notes sliced. */
  std::vector<std::size_t> notes;
  /** Pitch-class weights over the bar, indexed 0-11. */
  std::array<double, 12> weights{};
  /** Sum of those weights; zero for a silent bar. */
  double totalWeight = 0;
};

/**
 * Cut a span into its bars and weigh what sounds in each (`sliceBars`).
 * @throws BudgetExceededError if the bars or their note memberships exceed the budget.
 */
std::vector<BarSlice> slice_bars(const std::vector<NoteEvent>& notes, const MeterArg& meter,
                                 double span_start, double span_end, std::optional<double> budget);

/** Cosine similarity of two non-negative weight vectors, in [0, 1] (`weightSimilarity`). */
double weight_similarity(const std::array<double, 12>& a, const std::array<double, 12>& b);

/** How much the harmony changes at the start of slice `index`, in [0, 1] (`harmonicNovelty`). */
double harmonic_novelty(const std::vector<BarSlice>& slices, std::size_t index);

/** Sum independent evidence into one strength in [0, 1] (`combineEvidence`). */
double combine_evidence(const std::vector<double>& strengths);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FORM_INTERNAL_H_
