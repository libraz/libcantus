/**
 * @file validation.h
 * @brief Internal typed guards of ts/src/core/validation, beside the public ones.
 */
#ifndef CANTUS_SRC_CORE_VALIDATION_VALIDATION_H_
#define CANTUS_SRC_CORE_VALIDATION_VALIDATION_H_

#include <array>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <limits>
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

/** `Number.MIN_VALUE`, the smallest positive double. */
inline constexpr double kMinValue = std::numeric_limits<double>::denorm_min();

/** `Number.isSafeInteger(value)`. */
bool is_safe_integer(double value) noexcept;

/** The enumerator whose name in `names` (indexed by the enumerators) is `name`, if any. */
template <class Enum, class Names>
std::optional<Enum> parse_named(const Names& names, std::string_view name) {
  for (std::size_t i = 0; i < std::size(names); ++i) {
    if (names[i] == name) {
      return static_cast<Enum>(i);
    }
  }
  return std::nullopt;
}

/** The enumerator whose row in `rows` (indexed by the enumerators) has `name` in `field`. */
template <class Enum, class Rows, class Field>
std::optional<Enum> parse_named(const Rows& rows, std::string_view name, Field field) {
  for (std::size_t i = 0; i < std::size(rows); ++i) {
    if (rows[i].*field == name) {
      return static_cast<Enum>(i);
    }
  }
  return std::nullopt;
}

/** Every enumerator of a list indexed by the enumerators, in order. */
template <class Enum, class Names>
std::vector<Enum> enumerators_of(const Names& names) {
  std::vector<Enum> out;
  for (std::size_t i = 0; i < std::size(names); ++i) {
    out.push_back(static_cast<Enum>(i));
  }
  return out;
}

/** The names of a list, for assert_one_of(). */
template <std::size_t N>
std::vector<std::string_view> names_of(const std::array<std::string_view, N>& names) {
  return {names.begin(), names.end()};
}

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

/**
 * `describeRejected(v)`: "null", a quoted string (its first MAX_ECHOED_LENGTH code units, then
 * " (truncated from N characters)"), or the `typeof` name.
 */
std::string describe_rejected(const json::Value& v);

/** The decimal text of an index, as `${index}` writes it. */
std::string index_text(std::size_t index);

/** `${name}[${index}]`, the name TS gives an element of a checked array. */
inline std::string indexed_name(std::string_view name, std::size_t index) {
  return join_name(name, "[") + index_text(index) + "]";
}

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_VALIDATION_VALIDATION_H_
