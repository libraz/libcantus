/**
 * @file histogram.h
 * @brief Internal helpers of ts/src/analyze/histogram.ts: pitch-class weight histograms over a
 *        span of notes, shared by chord inference and key inference.
 */
#ifndef CANTUS_SRC_ANALYZE_HISTOGRAM_H_
#define CANTUS_SRC_ANALYZE_HISTOGRAM_H_

#include <array>
#include <cstddef>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"

namespace cantus {

/**
 * How much one note counts towards a pitch-class histogram (`noteWeight`). `meter` supplies the
 * metric accent; null counts every onset alike.
 */
double note_weight(const NoteEvent& note, double beats, const MeterArg* meter = nullptr);

/** An equal-slot grid: slot `i` covers `[origin + i * slotBeats, + slotBeats)` (`SlotGrid`). */
struct SlotGrid {
  /** First beat of slot 0. */
  double origin = 0;
  /** Length of one slot in beats. */
  double slotBeats = 0;
};

/** Options of bucket_notes_by_slot(). */
struct BucketOptions {
  /** Labels the budget error. */
  std::string_view name;
  /** Bounds the total number of note-to-slot memberships. */
  std::optional<double> budget;
};

/**
 * Sort notes into the slots of an equal grid they overlap (`bucketNotesBySlot`). Notes are kept by
 * identity as their index in `notes`, in input order.
 * @throws BudgetExceededError if the memberships exceed the budget.
 */
std::vector<std::vector<std::size_t>> bucket_notes_by_slot(const std::vector<NoteEvent>& notes,
                                                           const SlotGrid& grid, double slot_count,
                                                           const BucketOptions& opts);

/** A window's pitch-class weight histogram and the summaries drawn from it (`WindowWeights`). */
struct WindowWeights {
  /** Weight per pitch class, indexed 0-11. */
  std::array<double, 12> weights{};
  /** Sum of every pitch class's weight. */
  double totalWeight = 0;
  /** The single largest pitch-class weight. */
  double maxWeight = 0;
};

/** How many beats of a note sound inside `[window_start, window_end)` (`noteOverlap`). */
double note_overlap(const NoteEvent& note, double window_start, double window_end);

/** Whether a note starts inside `[window_start, window_end)` (`onsetInWindow`). */
bool onset_in_window(const NoteEvent& note, double window_start, double window_end);

/**
 * Weigh the pitch classes sounding across `[window_start, window_end)` (`windowWeights`). `notes`
 * are indices into `all`, or every note of it when `selection` is null.
 */
WindowWeights window_weights(const std::vector<NoteEvent>& all,
                             const std::vector<std::size_t>* selection, double window_start,
                             double window_end, const MeterArg& meter);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_HISTOGRAM_H_
