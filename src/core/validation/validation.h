/**
 * @file validation.h
 * @brief Internal typed guards of ts/src/core/validation, beside the public ones.
 */
#ifndef CANTUS_SRC_CORE_VALIDATION_VALIDATION_H_
#define CANTUS_SRC_CORE_VALIDATION_VALIDATION_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/validation.h"
#include "core/validation/limits.gen.h"
#include "json/json.h"

namespace cantus {

/** `Number.MAX_SAFE_INTEGER`. */
inline constexpr double kMaxSafeInteger = 9007199254740991.0;

/** `Number.isSafeInteger(value)`. */
bool is_safe_integer(double value) noexcept;

/** Require an integer pitch class in 0..11 (`assertPitchClass`). */
double assert_pitch_class(double value, std::string_view name = "pitch class");

/** Reject a range whose ends are not finite (`assertBounds`). */
void assert_bounds(double min, double max, std::string_view name);

/** The closing check of assertTimeSignature: a grouping's sum against the numerator. */
void assert_grouping_sum(double numerator, double sum, std::string_view name);

/** A zeroed `rows × columns` score table, charged against the budget (`allocateCandidateTable`). */
std::vector<double> allocate_candidate_table(double rows, double columns, std::string_view name,
                                             std::optional<double> budget = std::nullopt);

/** A zeroed `rows × columns` back-pointer table (`allocateChoiceTable`). */
std::vector<std::int32_t> allocate_choice_table(double rows, double columns, std::string_view name,
                                                std::optional<double> budget = std::nullopt);

/** `${name}` + `suffix`, the way TS builds a nested name. */
inline std::string join_name(std::string_view name, std::string_view suffix) {
  std::string out(name);
  out += suffix;
  return out;
}

/** The decimal text of an index, as `${index}` writes it. */
/**
 * `describeRejected(v)`: "null", a quoted string (its first MAX_ECHOED_LENGTH code units, then
 * " (truncated from N characters)"), or the `typeof` name.
 */
std::string describe_rejected(const json::Value& v);

std::string index_text(std::size_t index);

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_VALIDATION_VALIDATION_H_
