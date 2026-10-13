// Whether two beats are the same instant, and whether one note follows another:
// ts/src/analyze/adjacency.ts.

#include "analyze/adjacency.h"

#include <cmath>

namespace cantus {

bool same_instant(double beat, double other) { return std::fabs(beat - other) <= BEAT_EPS; }

bool adjacent(double prev_end, double next_start) {
  return std::fabs(next_start - prev_end) <= HUMANIZE_ADJACENCY;
}

bool has_ended(double prev_end, double beat) { return prev_end <= beat + HUMANIZE_ADJACENCY; }

}  // namespace cantus
