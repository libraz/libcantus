/**
 * @file similarity.h
 * @brief Internal helpers of ts/src/analyze/melody/similarity.ts: the likeness of two lines
 *        already ordered. The public entry points are declared in cantus/analyze/melody.h.
 */
#ifndef CANTUS_SRC_ANALYZE_MELODY_SIMILARITY_H_
#define CANTUS_SRC_ANALYZE_MELODY_SIMILARITY_H_

#include <vector>

#include "cantus/analyze/melody.h"

namespace cantus {

/** `compareMelodies` over two lines of notes that are already ordered, one per onset. */
MelodicComparison compare_ordered(const std::vector<NoteEvent>& left,
                                  const std::vector<NoteEvent>& right);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_MELODY_SIMILARITY_H_
