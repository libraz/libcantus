/**
 * @file pivot.h
 * @brief Internal helpers of ts/src/analyze/functional/pivot.ts: pivot chords on keys already read
 *        into their narrow form. PivotChord and pivot_chords() are in cantus/analyze/functional.h.
 */
#ifndef CANTUS_SRC_ANALYZE_FUNCTIONAL_PIVOT_H_
#define CANTUS_SRC_ANALYZE_FUNCTIONAL_PIVOT_H_

#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/core/types.h"

namespace cantus {

/** `pivotChords` on keys already read into their narrow form (`pivotsBetween`). */
std::vector<PivotChord> pivots_between(const KeyScale& from, const KeyScale& to);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FUNCTIONAL_PIVOT_H_
