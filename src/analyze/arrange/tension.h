/**
 * @file tension.h
 * @brief Internal entry point of ts/src/analyze/arrange/tension.ts beside the public API in
 *        cantus/analyze/arrange.h: the sampling pass over a harmony a host supplies.
 */
#ifndef CANTUS_SRC_ANALYZE_ARRANGE_TENSION_H_
#define CANTUS_SRC_ANALYZE_ARRANGE_TENSION_H_

#include <optional>
#include <vector>

#include "analyze/arrange/tracks.h"

namespace cantus {

/** Where the samples sit and how far they run. */
struct TensionGrid {
  /** The grid's origin, a whole number of steps from beat 0. */
  double sample_start = 0;
  /** The beat the music starts on. */
  double music_start = 0;
  /** The end of the last sounding note. */
  double total_beats = 0;
  double step = 1;
};

/**
 * Sample the tension of prepared tracks against a harmony at regular beats; the sampling budget
 * is checked before the first sample is taken.
 */
std::vector<TensionPoint> sample_tension(const std::vector<PreparedTrack>& prepared,
                                         const ArrangementHarmony& harmony, SafetyProfile profile,
                                         const MeterMap& meters, const TensionGrid& grid,
                                         std::optional<double> budget);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_ARRANGE_TENSION_H_
