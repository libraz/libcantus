/**
 * @file internal.h
 * @brief The hash behind hierarchical seeds and position-addressed draws, beside
 *        ts/src/core/random/internal.ts.
 */
#ifndef CANTUS_SRC_CORE_RANDOM_INTERNAL_H_
#define CANTUS_SRC_CORE_RANDOM_INTERNAL_H_

#include <cstdint>

#include "cantus/core/random.h"
#include "core/random/limits.gen.h"

namespace cantus {

/**
 * Hash a root seed and a path to a 32-bit word within one keyspace (`hashPath`).
 * @throws InvalidInputError if a numeric segment is not finite.
 */
std::uint32_t hash_path(std::uint32_t domain, std::uint32_t root, const SeedPath& path);

/** A unit draw scaled into [lo, hi), a result rounded up to `hi` pulled below it. */
double scale_unit_draw(double unit, double lo, double hi);

/**
 * The checks an integer draw in [lo, hi] makes before it draws (`assertRangeBounds`).
 * @throws InvalidInputError if a bound or the span is not a safe integer, or lo > hi.
 */
void assert_range_bounds(double lo, double hi);

/**
 * The checks a float draw in [lo, hi) makes before it draws (`assertFloatBounds`).
 * @throws InvalidInputError if a bound or the span is not finite, or lo > hi.
 */
void assert_float_bounds(double lo, double hi);

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_RANDOM_INTERNAL_H_
