/**
 * @file draw.h
 * @brief Internal pieces of ts/src/generate/context/draw.ts: the sampler names and the path check.
 */
#ifndef CANTUS_SRC_GENERATE_CONTEXT_DRAW_H_
#define CANTUS_SRC_GENERATE_CONTEXT_DRAW_H_

#include <array>
#include <string_view>

#include "cantus/core/random.h"

namespace cantus {

/** The samplers a Draw carries, in declaration order (`DRAW_METHODS`). */
inline constexpr std::array<std::string_view, 4> kDrawMethods =
#include "generate/context/draw_methods.gen.inc"
    ;
static_assert(!kDrawMethods.back().empty(), "DRAW_METHODS and Draw disagree");

/**
 * Read the path a draw is addressed by (`assertSeedPath`).
 * @throws InvalidInputError if a numeric segment is not finite.
 */
const SeedPath& assert_seed_path(const SeedPath& path, std::string_view name = "draw path");

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_CONTEXT_DRAW_H_
