/**
 * @file cost.h
 * @brief Internal pieces of ts/src/generate/harmonize/cost.ts: what a reading of the melody costs
 *        (melody fit, functional flow and phrase ends).
 */
#ifndef CANTUS_SRC_GENERATE_HARMONIZE_COST_H_
#define CANTUS_SRC_GENERATE_HARMONIZE_COST_H_

#include <vector>

#include "cantus/core/types.h"
#include "cantus/theory/scale.h"
#include "generate/harmonize/internal.h"

namespace cantus {

/** Melody-fit cost of a candidate over a segment's structural notes (`emissionCost`). */
double emission_cost(const Segment& seg, const Candidate& cand,
                     const std::vector<NoteEvent>& melody, const KeyScale& key);

/** Functional-flow cost of moving from one candidate chord to the next, per beat of the slot. */
double transition_cost(const Candidate& prev, const Candidate& cur, int tonic_pc);

/**
 * Bonus for closing a phrase on the tonic, over the whole of what that slot is worth
 * (`phraseEndBonus`); `prev` is null when the phrase is a single chord long.
 */
double phrase_end_bonus(const Candidate* prev, const Candidate& cur, int tonic_pc,
                        const Segment& seg, const std::vector<NoteEvent>& melody);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_HARMONIZE_COST_H_
