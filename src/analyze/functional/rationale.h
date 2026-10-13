/**
 * @file rationale.h
 * @brief Internal helpers of ts/src/analyze/functional/rationale.ts: the vocabulary the analyze
 *        layer explains itself in. RejectedCandidate is declared in cantus/analyze/functional.h.
 */
#ifndef CANTUS_SRC_ANALYZE_FUNCTIONAL_RATIONALE_H_
#define CANTUS_SRC_ANALYZE_FUNCTIONAL_RATIONALE_H_

#include <string>
#include <string_view>

#include "cantus/analyze/functional.h"

namespace cantus {

/** Sentence-case a lower-case term standing at the head of a rationale (`capitalize`). */
std::string capitalize(std::string_view text);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FUNCTIONAL_RATIONALE_H_
