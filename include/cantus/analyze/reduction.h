/**
 * @file reduction.h
 * @brief Public C++ API of ts/src/analyze/reduction: which chords carry a progression and which
 *        decorate it.
 */
#ifndef CANTUS_ANALYZE_REDUCTION_H_
#define CANTUS_ANALYZE_REDUCTION_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/analyze/timeline.h"
#include "cantus/analyze/voice.h"
#include "cantus/theory/chord.h"

namespace cantus {

/** The place a chord holds in a progression (`ReductionLevel`). */
enum class ReductionLevel : std::uint8_t { kStructural, kPassing, kNeighbor };

/** The TS name of a level ("structural", "passing" or "neighbor"). */
std::string_view to_string(ReductionLevel level);

/** The level named `name`, or nullopt. */
std::optional<ReductionLevel> parse_reduction_level(std::string_view name);

/** Every level, in the order of REDUCTION_LEVELS. */
std::vector<ReductionLevel> reduction_levels();

/** What a reduction treats as the frame (`ReductionBasis`). */
enum class ReductionBasis : std::uint8_t { kFunction, kDuration };

/** The TS name of a basis ("function" or "duration"). */
std::string_view to_string(ReductionBasis basis);

/** The basis named `name`, or nullopt. */
std::optional<ReductionBasis> parse_reduction_basis(std::string_view name);

/** A chord with the place it holds, the beats it holds it for, and a short rationale. */
struct ReducedChord {
  Chord chord;
  double startBeat = 0;
  double endBeat = 0;
  ReductionLevel level = ReductionLevel::kStructural;
  std::string rationale;
};

/** Options of reduce_progression() (`ReduceProgressionOptions`). */
struct ReduceProgressionOptions {
  /** Which reading decides what the frame is; the functional one by default. */
  std::optional<ReductionBasis> basis;
};

/**
 * Reduce a chord progression to its frame, labelling every chord (`reduceProgression`). One entry
 * comes back per timeline segment, in the same order.
 * @param timeline The chord timeline to reduce.
 * @param key The prevailing key, or the key in force at a given beat.
 * @param opts Which reading decides the frame.
 * @throws InvalidInputError if the timeline is not valid or a key is not a key.
 */
std::vector<ReducedChord> reduce_progression(const ChordTimeline& timeline, const KeyContext& key,
                                             const ReduceProgressionOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_ANALYZE_REDUCTION_H_
