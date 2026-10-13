/**
 * @file internal.h
 * @brief Tempo-map indexing of ts/src/core/tempo/internal.ts.
 *
 * TS remembers the index of each map it has read; here every call builds its own, and
 * TempoReader holds one for the many conversions of a pass.
 */
#ifndef CANTUS_SRC_CORE_TEMPO_INTERNAL_H_
#define CANTUS_SRC_CORE_TEMPO_INTERNAL_H_

#include <cstddef>
#include <vector>

#include "cantus/core/tempo.h"
#include "core/tempo/limits.gen.h"

namespace cantus {

/** One tempo map as it read when the index was built (`TempoIndex`). */
struct TempoIndex {
  /** Onsets in map order. */
  std::vector<double> startBeats;
  /** Tempo of each entry. */
  std::vector<double> bpms;
  /** Seconds from the origin to each entry's onset: the prefix sum of the segments before it. */
  std::vector<double> secondsBefore;
};

/** The index of `map` (`tempoIndexOf`). */
TempoIndex tempo_index_of(const TempoMap& map);

/** Index of the tempo in force at `beat` (`tempoSegmentAt`). */
std::size_t tempo_segment_at(const TempoMap& map, double beat);

/** Seconds from the origin to `beat` (`elapsedSecondsAt`). */
double elapsed_seconds_at(const TempoMap& map, double beat);

/** Seconds from the origin to `beat`, against an index already in hand (`elapsedSecondsIn`). */
double elapsed_seconds_in(const TempoIndex& index, double beat);

/** The beat reached after `seconds` (`beatAtElapsedSeconds`). */
double beat_at_elapsed_seconds(const TempoMap& map, double seconds);

/** The beat reached after `seconds`, against an index already in hand (`beatAtElapsedIn`). */
double beat_at_elapsed_in(const TempoIndex& index, double seconds);

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_TEMPO_INTERNAL_H_
