/**
 * @file reduction.h
 * @brief Internal entry point of ts/src/analyze/reduction/index.ts beside the public API in
 *        cantus/analyze/reduction.h: the reduction over chords a host reads on demand.
 */
#ifndef CANTUS_SRC_ANALYZE_REDUCTION_REDUCTION_H_
#define CANTUS_SRC_ANALYZE_REDUCTION_REDUCTION_H_

#include <string>
#include <vector>

#include "analyze/timeline/timeline.h"
#include "cantus/analyze/reduction.h"

namespace cantus {

/** What a reduction says of one segment. */
struct ReductionVerdict {
  ReductionLevel level = ReductionLevel::kStructural;
  std::string rationale;
};

/**
 * The reduction of segment beats, one verdict per segment, with the chords read when the
 * reduction first needs them and the basis settled by the caller.
 */
std::vector<ReductionVerdict> reduce_progression_over(const std::vector<SegmentSpan>& segments,
                                                      const ChordReads& chords,
                                                      const KeyAtBeat& key_at,
                                                      ReductionBasis basis);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_REDUCTION_REDUCTION_H_
