/**
 * @file difficulty.h
 * @brief Internal pieces of ts/src/generate/context/difficulty.ts: the ceiling's own check.
 */
#ifndef CANTUS_SRC_GENERATE_CONTEXT_DIFFICULTY_H_
#define CANTUS_SRC_GENERATE_CONTEXT_DIFFICULTY_H_

#include <string_view>

namespace cantus {

/**
 * Reject a ceiling outside the scale the profiles and reports share (`assertDifficulty`).
 * @throws InvalidInputError if `difficulty` is outside [1, 5].
 */
double assert_difficulty(double difficulty, std::string_view label = "complexity difficulty");

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_CONTEXT_DIFFICULTY_H_
