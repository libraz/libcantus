/**
 * @file search.h
 * @brief Internal pieces of ts/src/generate/harmonize/search.ts: one Viterbi pass over the
 *        segments.
 */
#ifndef CANTUS_SRC_GENERATE_HARMONIZE_SEARCH_H_
#define CANTUS_SRC_GENERATE_HARMONIZE_SEARCH_H_

#include <set>
#include <vector>

#include "cantus/core/types.h"
#include "cantus/theory/scale.h"
#include "generate/harmonize/internal.h"

namespace cantus {

/** The cheapest chord path through a fixed melody and key, and its cost. */
struct HarmonizePass {
  double cost = 0;
  std::vector<std::size_t> path;
};

/** Run one Viterbi harmonization pass over a fixed melody and key (`harmonizeOnce`). */
HarmonizePass harmonize_once(const std::vector<NoteEvent>& melody, const KeyScale& key,
                             const std::vector<Candidate>& candidates,
                             const std::vector<Segment>& segments,
                             const std::vector<double>& jitter,
                             const std::set<std::size_t>& phrase_ends,
                             const std::set<std::size_t>& articulated);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_HARMONIZE_SEARCH_H_
