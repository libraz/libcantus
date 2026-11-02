// Pitch-class weight histograms over a span of notes: ts/src/analyze/histogram.ts.

#include "analyze/histogram.h"

#include <cmath>

#include "analyze/adjacency.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "js/math.h"

namespace cantus {

double note_weight(const NoteEvent& note, double beats, const MeterArg* meter) {
  double velocity_factor = note.velocity ? *note.velocity / MAX_VELOCITY : 1;
  double accent =
      meter == nullptr ? 1 : 1 + metric_weight(note.startBeat, *meter) / MAX_METRIC_WEIGHT;
  return beats * velocity_factor * accent;
}

std::vector<std::vector<std::size_t>> bucket_notes_by_slot(const std::vector<NoteEvent>& notes,
                                                           const SlotGrid& grid, double slot_count,
                                                           const BucketOptions& opts) {
  std::vector<std::vector<std::size_t>> buckets(static_cast<std::size_t>(slot_count));
  double memberships = 0;
  for (std::size_t index = 0; index < notes.size(); ++index) {
    const NoteEvent& note = notes[index];
    double first = js::max(0, std::floor((note.startBeat - grid.origin) / grid.slotBeats));
    double last_exclusive = js::min(
        slot_count, std::ceil((note.startBeat + note.durationBeat - grid.origin) / grid.slotBeats));
    memberships += js::max(0, last_exclusive - first);
    assert_generation_budget(memberships, opts.name, opts.budget);
    for (double slot = first; slot < last_exclusive; slot += 1) {
      buckets[static_cast<std::size_t>(slot)].push_back(index);
    }
  }
  return buckets;
}

double note_overlap(const NoteEvent& note, double window_start, double window_end) {
  return js::min(note.startBeat + note.durationBeat, window_end) -
         js::max(note.startBeat, window_start);
}

bool onset_in_window(const NoteEvent& note, double window_start, double window_end) {
  return within_beats(note.startBeat, window_start, window_end);
}

WindowWeights window_weights(const std::vector<NoteEvent>& all,
                             const std::vector<std::size_t>* selection, double window_start,
                             double window_end, const MeterArg& meter) {
  WindowWeights out;
  std::size_t count = selection != nullptr ? selection->size() : all.size();
  for (std::size_t k = 0; k < count; ++k) {
    const NoteEvent& note = all[selection != nullptr ? (*selection)[k] : k];
    double overlap = note_overlap(note, window_start, window_end);
    if (overlap <= BEAT_EPS) {
      continue;
    }
    int pc = pitch_class_of(note.pitch);
    // The accent is asked for only where the onset falls in the window: a note held across the
    // boundary is already counted for its part of it.
    double weight = note_weight(note, overlap,
                                onset_in_window(note, window_start, window_end) ? &meter : nullptr);
    out.weights[static_cast<std::size_t>(pc)] += weight;
  }
  for (double w : out.weights) {
    out.totalWeight += w;
    out.maxWeight = js::max(out.maxWeight, w);
  }
  return out;
}

}  // namespace cantus
