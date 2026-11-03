/**
 * @file number.h
 * @brief ECMAScript number-to-string and string-to-number conversions.
 */
#ifndef CANTUS_JS_NUMBER_H_
#define CANTUS_JS_NUMBER_H_

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace cantus::js {

/** `String(x)`: ES Number::toString with the shortest round-trip digits. */
std::string to_string(double x);

/**
 * `x.toFixed(digits)` by the ES algorithm (exact; half-way cases round away from zero).
 * @throws std::range_error when digits is outside [0, 100], with V8's message.
 */
std::string to_fixed(double x, int digits);

/** `Number(s)` for a WTF-8 string: StringToNumber, including 0x/0o/0b and Infinity. */
double number(std::string_view s);

/** `Number.parseInt(s, radix)`; a radix of 0 (or undefined) means 10 with 0x detection. */
double parse_int(std::string_view s, double radix = 0);

/** `values.join(separator)` of an array of numbers. */
template <class T>
std::string join(const std::vector<T>& values, std::string_view separator) {
  std::string out;
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (i > 0) {
      out += separator;
    }
    out += to_string(static_cast<double>(values[i]));
  }
  return out;
}

}  // namespace cantus::js

#endif  // CANTUS_JS_NUMBER_H_
