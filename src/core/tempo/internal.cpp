// Tempo-map indexing of ts/src/core/tempo/internal.ts.

#include "core/tempo/internal.h"

#include <cstddef>

namespace cantus {

namespace {

/** Index of the last entry of `ascending` not above `value`, or 0 (`segmentBy`). */
std::size_t segment_by(const std::vector<double>& ascending, double value) {
  std::ptrdiff_t low = 0;
  std::ptrdiff_t high = static_cast<std::ptrdiff_t>(ascending.size()) - 1;
  while (low < high) {
    std::ptrdiff_t mid = (low + high + 1) >> 1;
    if (ascending[static_cast<std::size_t>(mid)] <= value) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return static_cast<std::size_t>(low);
}

}  // namespace

TempoIndex tempo_index_of(const TempoMap& map) {
  TempoIndex index;
  double elapsed = 0;
  for (std::size_t i = 0; i < map.size(); ++i) {
    const TempoEvent& event = map[i];
    if (i > 0) {
      elapsed +=
          ((event.startBeat - index.startBeats[i - 1]) * SECONDS_PER_MINUTE) / index.bpms[i - 1];
    }
    index.startBeats.push_back(event.startBeat);
    index.bpms.push_back(event.bpm);
    index.secondsBefore.push_back(elapsed);
  }
  return index;
}

std::size_t tempo_segment_at(const TempoMap& map, double beat) {
  return segment_by(tempo_index_of(map).startBeats, beat);
}

double elapsed_seconds_at(const TempoMap& map, double beat) {
  return elapsed_seconds_in(tempo_index_of(map), beat);
}

double elapsed_seconds_in(const TempoIndex& index, double beat) {
  std::size_t at = segment_by(index.startBeats, beat);
  return index.secondsBefore[at] +
         ((beat - index.startBeats[at]) * SECONDS_PER_MINUTE) / index.bpms[at];
}

double beat_at_elapsed_seconds(const TempoMap& map, double seconds) {
  return beat_at_elapsed_in(tempo_index_of(map), seconds);
}

double beat_at_elapsed_in(const TempoIndex& index, double seconds) {
  std::size_t at = segment_by(index.secondsBefore, seconds);
  return index.startBeats[at] +
         ((seconds - index.secondsBefore[at]) * index.bpms[at]) / SECONDS_PER_MINUTE;
}

}  // namespace cantus
