// Bar-level evidence shared by the form analyses: ts/src/analyze/form/internal.ts.

#include "analyze/form/internal.h"

#include <algorithm>
#include <cmath>

#include "analyze/adjacency.h"
#include "analyze/histogram.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"

namespace cantus {

double bar_span_of(double start_beat, double end_beat, const MeterArg& meter) {
  double first_bar = bar_index_at(start_beat, meter);
  double last_bar = bar_index_at(end_beat, meter);
  auto part_of = [&](double beat, double bar) {
    double bar_start = bar_position_to_beat(BarPosition{bar, 0}, meter);
    double bar_length = beats_per_bar_at(bar_start, meter);
    return bar_length > 0 ? (beat - bar_start) / bar_length : 0;
  };
  return last_bar - first_bar + part_of(end_beat, last_bar) - part_of(start_beat, first_bar);
}

double clamp01(double value) { return js::min(1, js::max(0, value)); }

double resolve_span_end(std::optional<double> total_beats, double start_beat, double sounding_end,
                        std::string_view name) {
  if (!total_beats) {
    return js::max(start_beat, sounding_end);
  }
  assert_range(*total_beats, js::min(0, start_beat), kMaxSafeInteger, name);
  return js::max(start_beat, *total_beats);
}

double last_bar_of(const MeterArg& meter, double span_start, double span_end) {
  double first_bar = bar_index_at(span_start, meter);
  double bar = bar_index_at(js::max(span_start, span_end), meter);
  if (bar > first_bar && bar_position_to_beat(BarPosition{bar, 0}, meter) >= span_end - BEAT_EPS) {
    return bar - 1;
  }
  return bar;
}

std::vector<BarSlice> slice_bars(const std::vector<NoteEvent>& notes, const MeterArg& meter,
                                 double span_start, double span_end, std::optional<double> budget) {
  double first_bar = bar_index_at(span_start, meter);
  double last_bar = last_bar_of(meter, span_start, span_end);
  double bar_count = last_bar - first_bar + 1;
  assert_generation_budget(bar_count, "form bars", budget);

  std::vector<std::vector<std::size_t>> buckets(static_cast<std::size_t>(bar_count));
  double memberships = 0;
  for (std::size_t index = 0; index < notes.size(); ++index) {
    const NoteEvent& note = notes[index];
    double note_end = note.startBeat + note.durationBeat;
    double from = js::max(first_bar, bar_index_at(note.startBeat, meter));
    double to =
        js::min(last_bar, bar_index_at(js::max(note.startBeat, note_end - BEAT_EPS), meter));
    memberships += js::max(0, to - from + 1);
    assert_generation_budget(memberships, "form note-to-bar memberships", budget);
    for (double bar = from; bar <= to; bar += 1) {
      buckets[static_cast<std::size_t>(bar - first_bar)].push_back(index);
    }
  }

  std::vector<BarSlice> slices;
  for (double bar = first_bar; bar <= last_bar; bar += 1) {
    BarSlice slice;
    slice.index = bar;
    slice.startBeat = bar_position_to_beat(BarPosition{bar, 0}, meter);
    slice.endBeat = bar_position_to_beat(BarPosition{bar + 1, 0}, meter);
    slice.notes = std::move(buckets[static_cast<std::size_t>(bar - first_bar)]);
    WindowWeights weighed =
        window_weights(notes, &slice.notes, slice.startBeat, slice.endBeat, meter);
    slice.weights = weighed.weights;
    slice.totalWeight = weighed.totalWeight;
    slices.push_back(std::move(slice));
  }
  return slices;
}

double weight_similarity(const std::array<double, 12>& a, const std::array<double, 12>& b) {
  double dot = 0;
  double norm_a = 0;
  double norm_b = 0;
  for (std::size_t i = 0; i < a.size(); ++i) {
    double x = a[i];
    double y = b[i];
    dot += x * y;
    norm_a += x * x;
    norm_b += y * y;
  }
  if (norm_a <= BEAT_EPS && norm_b <= BEAT_EPS) {
    return 1;
  }
  if (norm_a <= BEAT_EPS || norm_b <= BEAT_EPS) {
    return 0;
  }
  return clamp01(dot / std::sqrt(norm_a * norm_b));
}

double harmonic_novelty(const std::vector<BarSlice>& slices, std::size_t index) {
  if (index >= slices.size()) {
    return 0;
  }
  const BarSlice& current = slices[index];
  if (index == 0) {
    // The first slice of the analysed span, wherever the span was cut from: an excerpt taken
    // from bar 9 opens on bar 9. Only a pickup, which is bar -1, is not an opening.
    return current.index >= 0 ? 1 : 0;
  }
  return 1 - weight_similarity(slices[index - 1].weights, current.weights);
}

double combine_evidence(const std::vector<double>& strengths) {
  double remaining = 1;
  for (double strength : strengths) {
    remaining *= 1 - clamp01(strength);
  }
  return clamp01(1 - remaining);
}

}  // namespace cantus
