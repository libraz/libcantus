/**
 * @file weights.h
 * @brief Internal readers of ProfileWeightOverrides by field name, for the entry points that
 *        check a caller's overrides themselves before `profileWeights` reads them.
 */
#ifndef CANTUS_SRC_THEORY_SAFETY_WEIGHTS_H_
#define CANTUS_SRC_THEORY_SAFETY_WEIGHTS_H_

#include <optional>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/theory/safety.h"

namespace cantus {

/** The member of ProfileWeightOverrides a weight field name selects, or nullptr for no such field.
 */
std::optional<double> ProfileWeightOverrides::*weight_override_member(std::string_view field);

/** The overrides a caller named, as (field, value) in the order of the weight table. */
std::vector<std::pair<std::string_view, double>> named_weight_overrides(
    const ProfileWeightOverrides& overrides);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SAFETY_WEIGHTS_H_
