/**
 * @file key_fit.h
 * @brief Internal pieces of ts/src/generate/harmonize/key-fit.ts: how well a key and a register
 *        suit the melody being harmonized.
 */
#ifndef CANTUS_SRC_GENERATE_HARMONIZE_KEY_FIT_H_
#define CANTUS_SRC_GENERATE_HARMONIZE_KEY_FIT_H_

#include <vector>

#include "cantus/core/types.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Register cost of a placed melody: a small penalty for notes outside a comfortable range. */
double tessitura_cost(const std::vector<NoteEvent>& melody);

/** How badly a placed melody sits in the key it is about to be harmonized in. */
double key_fit_cost(const std::vector<NoteEvent>& melody, const KeyScale& key);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_HARMONIZE_KEY_FIT_H_
