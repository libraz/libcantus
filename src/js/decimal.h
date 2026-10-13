/**
 * @file decimal.h
 * @brief Locale-independent decimal conversion shared by the JSON layer and the number helpers.
 *
 * `std::from_chars` / `std::to_chars` are used where the standard library provides them for
 * `double`; elsewhere a "C"-locale `strtod` and a round-trip search over `snprintf` stand in.
 * Define CANTUS_JS_HAVE_FROM_CHARS_DOUBLE / CANTUS_JS_HAVE_TO_CHARS_DOUBLE to 0 or 1 to override
 * the detection.
 */
#ifndef CANTUS_JS_DECIMAL_H_
#define CANTUS_JS_DECIMAL_H_

#include <string>
#include <string_view>

#if __has_include(<version>)
#include <version>
#endif

#ifndef CANTUS_JS_HAVE_FROM_CHARS_DOUBLE
#if defined(__cpp_lib_to_chars) && __cpp_lib_to_chars >= 201611L
#define CANTUS_JS_HAVE_FROM_CHARS_DOUBLE 1
#elif defined(_LIBCPP_VERSION) && _LIBCPP_VERSION >= 200000
#define CANTUS_JS_HAVE_FROM_CHARS_DOUBLE 1
#elif defined(_GLIBCXX_RELEASE) && _GLIBCXX_RELEASE >= 11
#define CANTUS_JS_HAVE_FROM_CHARS_DOUBLE 1
#else
#define CANTUS_JS_HAVE_FROM_CHARS_DOUBLE 0
#endif
#endif

#ifndef CANTUS_JS_HAVE_TO_CHARS_DOUBLE
#if defined(__cpp_lib_to_chars) && __cpp_lib_to_chars >= 201611L
#define CANTUS_JS_HAVE_TO_CHARS_DOUBLE 1
#elif defined(_LIBCPP_VERSION) && _LIBCPP_VERSION >= 140000
#define CANTUS_JS_HAVE_TO_CHARS_DOUBLE 1
#elif defined(_GLIBCXX_RELEASE) && _GLIBCXX_RELEASE >= 11
#define CANTUS_JS_HAVE_TO_CHARS_DOUBLE 1
#else
#define CANTUS_JS_HAVE_TO_CHARS_DOUBLE 0
#endif
#endif

namespace cantus::js::detail {

/**
 * Correctly rounded value of a decimal literal `-?digits[.digits][e[+-]digits]` (either digit
 * run may be empty but not both). Overflow gives ±Infinity, underflow ±0.
 */
double parse_decimal(std::string_view literal);

/**
 * Shortest round-trip decimal digits of a finite, nonzero, positive `x`.
 *
 * @param x Value to convert.
 * @param exponent Receives n such that x ≈ 0.d1d2…dk × 10^n (ES Number::toString's n).
 * @return The digits d1…dk without trailing zeros.
 */
std::string shortest_digits(double x, int& exponent);

}  // namespace cantus::js::detail

#endif  // CANTUS_JS_DECIMAL_H_
