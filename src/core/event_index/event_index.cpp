// The note-event index of ts/src/core/event-index/index.ts.

#include "core/event_index/event_index.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "js/math.h"

namespace cantus {

namespace {

constexpr double kNegativeInfinity = -std::numeric_limits<double>::infinity();

/** Number of leading notes starting at or before `beat` (`upperBound`). */
std::size_t upper_bound(const std::vector<IndexedNoteEvent>& values, double beat) {
  std::size_t low = 0;
  std::size_t high = values.size();
  while (low < high) {
    std::size_t middle = (low + high) / 2;
    if (values[middle].note.startBeat <= beat) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

}  // namespace

std::string_view to_string(OnsetTieBreak tie_break) {
  switch (tie_break) {
    case OnsetTieBreak::kHighest:
      return "highest";
    case OnsetTieBreak::kLowest:
      return "lowest";
    case OnsetTieBreak::kLast:
      return "last";
  }
  return "highest";
}

std::optional<OnsetTieBreak> parse_onset_tie_break(std::string_view name) {
  for (OnsetTieBreak candidate :
       {OnsetTieBreak::kHighest, OnsetTieBreak::kLowest, OnsetTieBreak::kLast}) {
    if (to_string(candidate) == name) {
      return candidate;
    }
  }
  return std::nullopt;
}

std::vector<NoteEvent> sorted_note_events(const std::vector<NoteEvent>& events) {
  std::vector<NoteEvent> sorted = events;
  // Stable, so events sharing an onset keep the order they were given in.
  std::stable_sort(sorted.begin(), sorted.end(), [](const NoteEvent& a, const NoteEvent& b) {
    return a.startBeat - b.startBeat < 0;
  });
  return sorted;
}

NoteEventIndex::NoteEventIndex(const std::vector<NoteEvent>& events,
                               const NoteEventIndexOptions& options)
    : tie_break_(options.tieBreak.value_or(OnsetTieBreak::kHighest)) {
  NoteEventAssertOptions asserted;
  asserted.allowNonPositiveDuration = options.allowNonPositiveDuration;
  asserted.budget = options.budget;
  assert_note_events(events, options.name.value_or("note events"), asserted);
  notes_.reserve(events.size());
  for (std::size_t i = 0; i < events.size(); ++i) {
    notes_.push_back(IndexedNoteEvent{events[i], i, events[i].startBeat + events[i].durationBeat});
  }
  std::stable_sort(notes_.begin(), notes_.end(),
                   [](const IndexedNoteEvent& a, const IndexedNoteEvent& b) {
                     double difference = a.note.startBeat - b.note.startBeat;
                     return difference != 0 ? difference < 0 : a.originalIndex < b.originalIndex;
                   });
}

const std::vector<double>& NoteEventIndex::end_tree() const {
  if (!max_end_tree_.empty()) {
    return max_end_tree_;
  }
  tree_size_ = 1;
  while (tree_size_ < notes_.size()) {
    tree_size_ *= 2;
  }
  std::vector<double> tree(tree_size_ * 2, kNegativeInfinity);
  for (std::size_t index = 0; index < notes_.size(); ++index) {
    tree[tree_size_ + index] = notes_[index].endBeat;
  }
  for (std::size_t index = tree_size_ - 1; index > 0; --index) {
    tree[index] = js::max(tree[index * 2], tree[index * 2 + 1]);
  }
  max_end_tree_ = std::move(tree);
  return max_end_tree_;
}

std::ptrdiff_t NoteEventIndex::latest_active_index(std::size_t exclusive, double beat) const {
  const std::vector<double>& tree = end_tree();
  struct Finder {
    const std::vector<double>& tree;
    std::size_t exclusive;
    std::size_t count;
    double beat;
    std::ptrdiff_t find(std::size_t node, std::size_t start, std::size_t end) const {
      if (start >= exclusive || tree[node] <= beat + BEAT_EPS) {
        return -1;
      }
      if (end - start == 1) {
        return start < count ? static_cast<std::ptrdiff_t>(start) : -1;
      }
      std::size_t mid = (start + end) / 2;
      std::ptrdiff_t right = find(node * 2 + 1, mid, end);
      return right >= 0 ? right : find(node * 2, start, mid);
    }
  };
  return Finder{tree, exclusive, notes_.size(), beat}.find(1, 0, tree_size_);
}

std::optional<IndexedNoteEvent> NoteEventIndex::at(double beat) const {
  // A query beat comes from wherever the host got it, so it is checked like any entry argument.
  assert_finite_number(beat, "beat");
  std::ptrdiff_t index = latest_active_index(upper_bound(notes_, beat + BEAT_EPS), beat);
  if (index < 0) {
    return std::nullopt;
  }
  double onset = notes_[static_cast<std::size_t>(index)].note.startBeat;
  std::optional<IndexedNoteEvent> best;
  for (std::ptrdiff_t candidate = index; candidate >= 0; --candidate) {
    const IndexedNoteEvent& indexed = notes_[static_cast<std::size_t>(candidate)];
    if (indexed.note.startBeat != onset) {
      break;
    }
    if (indexed.note.durationBeat <= 0 || indexed.note.startBeat - BEAT_EPS > beat ||
        beat >= indexed.endBeat - BEAT_EPS) {
      continue;
    }
    if (!best) {
      best = indexed;
      continue;
    }
    if (tie_break_ == OnsetTieBreak::kLast) {
      continue;
    }
    int difference = indexed.note.pitch - best->note.pitch;
    // Equal pitches name no voice apart, so they are settled on the lower original index.
    bool wins = difference == 0 ? indexed.originalIndex < best->originalIndex
                                : (difference > 0) == (tie_break_ == OnsetTieBreak::kHighest);
    if (wins) {
      best = indexed;
    }
  }
  return best;
}

bool NoteEventIndex::attacks_at(double beat) const {
  assert_finite_number(beat, "beat");
  // Only a sounding note attacks: a zero-length artefact must not make this true where at() finds
  // nothing.
  auto index = static_cast<std::ptrdiff_t>(upper_bound(notes_, beat + BEAT_EPS)) - 1;
  while (index >= 0) {
    const IndexedNoteEvent& candidate = notes_[static_cast<std::size_t>(index)];
    if (std::fabs(candidate.note.startBeat - beat) >= BEAT_EPS) {
      return false;
    }
    if (candidate.note.durationBeat > 0) {
      return true;
    }
    index -= 1;
  }
  return false;
}

std::vector<double> NoteEventIndex::onsets_between(double start_beat, double end_beat) const {
  assert_finite_number(start_beat, "startBeat");
  assert_finite_number(end_beat, "endBeat");
  std::vector<double> result;
  std::size_t index = upper_bound(notes_, start_beat + BEAT_EPS);
  while (index < notes_.size()) {
    const IndexedNoteEvent& indexed = notes_[index];
    double onset = indexed.note.startBeat;
    if (onset >= end_beat - BEAT_EPS) {
      break;
    }
    index += 1;
    if (indexed.note.durationBeat <= 0) {
      continue;
    }
    if (result.empty() || std::fabs(result.back() - onset) >= BEAT_EPS) {
      result.push_back(onset);
    }
  }
  return result;
}

}  // namespace cantus
