// The canonical note order of ts/src/core/event-index/order.ts.

#include "core/event_index/order.h"

#include <algorithm>

namespace cantus {

std::vector<std::size_t> canonical_note_order(const std::vector<NoteEvent>& notes) {
  std::vector<std::size_t> order(notes.size());
  for (std::size_t i = 0; i < notes.size(); ++i) {
    order[i] = i;
  }
  std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
    // left.startBeat - right.startBeat || left.pitch - right.pitch || a - b
    double by_onset = notes[a].startBeat - notes[b].startBeat;
    if (by_onset != 0) {
      return by_onset < 0;
    }
    if (notes[a].pitch != notes[b].pitch) {
      return notes[a].pitch < notes[b].pitch;
    }
    return a < b;
  });
  return order;
}

std::vector<NoteEvent> in_canonical_order(const std::vector<NoteEvent>& notes) {
  std::vector<NoteEvent> out;
  out.reserve(notes.size());
  for (std::size_t index : canonical_note_order(notes)) {
    out.push_back(notes[index]);
  }
  return out;
}

std::vector<std::size_t> sounding_indices(const std::vector<NoteEvent>& notes) {
  std::vector<std::size_t> out;
  for (std::size_t i = 0; i < notes.size(); ++i) {
    // The drop_silent_notes() predicate, kept by position.
    if (notes[i].durationBeat > 0) {
      out.push_back(i);
    }
  }
  return out;
}

}  // namespace cantus
