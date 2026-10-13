/**
 * @file validate.h
 * @brief Internal checks of ts/src/analyze/reference/validate.ts beside the public
 *        assert_reference_profile() in cantus/analyze/reference.h: the checks of a distribution
 *        and of a span, shared with the reader of a profile that arrives as wire data.
 */
#ifndef CANTUS_SRC_ANALYZE_REFERENCE_VALIDATE_H_
#define CANTUS_SRC_ANALYZE_REFERENCE_VALIDATE_H_

#include <string_view>
#include <vector>

#include "cantus/analyze/reference.h"

namespace cantus {

/**
 * Require `end_beat` not to precede `start_beat`, once both are known finite
 * (`assertSpanOrder`).
 * @throws InvalidInputError otherwise.
 */
void assert_span_order(double start_beat, double end_beat, std::string_view name);

/**
 * Require one share of a distribution to be at least 0; `name` is the share's own path
 * (the check inside `assertMassDistribution`'s loop).
 * @throws InvalidInputError otherwise.
 */
void assert_mass_share(double share, std::string_view name);

/**
 * Require the shares of a distribution to sum to 1 within MASS_TOLERANCE, except when
 * `allow_all_zero` holds and the sum is 0 (the closing check of `assertMassDistribution`).
 * @throws InvalidInputError otherwise.
 */
void assert_mass_sum(double sum, std::string_view name, bool allow_all_zero);

/**
 * Require a fixed-length distribution of non-negative mass summing to 1, except when
 * `allow_all_zero` holds and every share is 0 (`assertMassDistribution`).
 * @throws InvalidInputError otherwise.
 */
void assert_mass_distribution(const std::vector<double>& shares, double length,
                              std::string_view name, bool allow_all_zero);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_REFERENCE_VALIDATE_H_
