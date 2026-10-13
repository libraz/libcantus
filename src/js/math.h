/**
 * @file math.h
 * @brief `Math.*` and integer-conversion semantics of ECMAScript.
 *
 * log2 / exp / pow are ports of V8's fdlibm-derived `src/base/ieee754.cc` as shipped in Node 22
 * (V8 12.4.254.21), so results match `Math.log2`, `Math.exp`, `Math.pow` and `**` bit for bit.
 */
#ifndef CANTUS_JS_MATH_H_
#define CANTUS_JS_MATH_H_

#include <cstdint>
#include <initializer_list>
#include <vector>

namespace cantus::js {

/** `Math.round`: half-way cases round toward +Infinity; -0 is kept for results of zero below 0. */
double round(double x);

/** `Math.max`: NaN propagates, +0 > -0, an empty argument list gives -Infinity. */
double max(std::initializer_list<double> values);
/** `Math.max(...values)`. */
double max(const std::vector<double>& values);
/** `Math.max(a, b, rest...)`. */
template <class... Rest>
double max(double a, double b, Rest... rest) {
  return max({a, b, static_cast<double>(rest)...});
}

/** `Math.min`: NaN propagates, -0 < +0, an empty argument list gives +Infinity. */
double min(std::initializer_list<double> values);
/** `Math.min(...values)`. */
double min(const std::vector<double>& values);
/** `Math.min(a, b, rest...)`. */
template <class... Rest>
double min(double a, double b, Rest... rest) {
  return min({a, b, static_cast<double>(rest)...});
}

/** `Math.sign`: ±0 and NaN are returned unchanged. */
double sign(double x);

/** ES ToInt32 (`x | 0`). */
std::int32_t to_int32(double x);
/** ES ToUint32 (`x >>> 0`). */
std::uint32_t to_uint32(double x);
/** `Math.imul(a, b)`. */
std::int32_t imul(double a, double b);

/** `Math.log2`. */
double log2(double x);
/** `Math.exp`. */
double exp(double x);
/** `Math.pow(x, y)` and `x ** y`, including NaN for `(±1) ** ±Infinity`. */
double pow(double x, double y);

}  // namespace cantus::js

#endif  // CANTUS_JS_MATH_H_
