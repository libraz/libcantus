/**
 * @file euclid.h
 * @brief Internal pieces of ts/src/generate/drums/euclid.ts: the Bjorklund onset pattern.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_EUCLID_H_
#define CANTUS_SRC_GENERATE_DRUMS_EUCLID_H_

#include <vector>

namespace cantus {

/**
 * Distribute `pulses` as evenly as possible across `steps`, then rotate (`euclideanRhythm`).
 * @throws InvalidInputError if `steps` is not a positive integer or a count is not an integer.
 * @throws BudgetExceededError if `steps` exceeds the generation budget.
 */
std::vector<bool> euclidean_rhythm(double pulses, double steps, double rotation = 0);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_EUCLID_H_
