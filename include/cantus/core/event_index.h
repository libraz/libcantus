/**
 * @file event_index.h
 * @brief Public C++ API of ts/src/core/event-index: a sorted index of note events answering
 *        which note sounds at a beat, whether one attacks there, and where onsets fall.
 */
#ifndef CANTUS_CORE_EVENT_INDEX_H_
#define CANTUS_CORE_EVENT_INDEX_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/types.h"

namespace cantus {

/** One note of the index with its place in the input (`IndexedNoteEvent`). */
struct IndexedNoteEvent {
  NoteEvent note;
  /** Position of the note in the array the index was built from. */
  std::size_t originalIndex = 0;
  /** `startBeat + durationBeat`. */
  double endBeat = 0;
};

/** How notes sharing an onset are told apart (`OnsetTieBreak`). */
enum class OnsetTieBreak : std::uint8_t { kHighest, kLowest, kLast };

/** The TS name of a tie-break ("highest", "lowest" or "last"). */
std::string_view to_string(OnsetTieBreak tie_break);

/** The tie-break named `name`, or nullopt. */
std::optional<OnsetTieBreak> parse_onset_tie_break(std::string_view name);

/** Options of NoteEventIndex (`NoteEventIndexOptions`). */
struct NoteEventIndexOptions {
  /** Accept notes that never sound. */
  std::optional<bool> allowNonPositiveDuration;
  /** Simultaneous onsets resolve to the highest pitch when absent. */
  std::optional<OnsetTieBreak> tieBreak;
  /** Upper bound on the event count. */
  std::optional<double> budget;
  /** What the events are, for the validation error message. */
  std::optional<std::string> name;
};

/**
 * Notes sorted by onset, queried by beat (`NoteEventIndex`). The search structure behind at() is
 * built on its first use, so an index is not safe to query from several threads at once.
 */
class NoteEventIndex {
 public:
  /**
   * Validate and index `events` (`createNoteEventIndex`).
   * @throws InvalidInputError if an event is malformed.
   * @throws BudgetExceededError if there are more events than the budget.
   */
  explicit NoteEventIndex(const std::vector<NoteEvent>& events,
                          const NoteEventIndexOptions& options = {});

  /** The notes in onset order, ties in input order. */
  const std::vector<IndexedNoteEvent>& notes() const noexcept { return notes_; }

  /**
   * The latest-onset note sounding at `beat`, simultaneous onsets resolved by the tie-break.
   * @throws InvalidInputError if `beat` is not finite.
   */
  std::optional<IndexedNoteEvent> at(double beat) const;

  /**
   * Whether one or more sounding notes attack at `beat`.
   * @throws InvalidInputError if `beat` is not finite.
   */
  bool attacks_at(double beat) const;

  /**
   * Unique sounding-note attack beats strictly inside `(start_beat, end_beat)`.
   * @throws InvalidInputError if either bound is not finite.
   */
  std::vector<double> onsets_between(double start_beat, double end_beat) const;

 private:
  /** The segment tree of end beats, built on first use. */
  const std::vector<double>& end_tree() const;
  /** Index of the latest note starting before `exclusive` still sounding past `beat`, or -1. */
  std::ptrdiff_t latest_active_index(std::size_t exclusive, double beat) const;

  std::vector<IndexedNoteEvent> notes_;
  OnsetTieBreak tie_break_;
  mutable std::vector<double> max_end_tree_;
  mutable std::size_t tree_size_ = 0;
};

/** Create an index (`createNoteEventIndex`). */
inline NoteEventIndex create_note_event_index(const std::vector<NoteEvent>& events,
                                              const NoteEventIndexOptions& options = {}) {
  return NoteEventIndex(events, options);
}

}  // namespace cantus

#endif  // CANTUS_CORE_EVENT_INDEX_H_
