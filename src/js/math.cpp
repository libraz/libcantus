#include "js/math.h"

#include <cmath>
#include <limits>

namespace cantus::js {

namespace {

constexpr double kInfinity = std::numeric_limits<double>::infinity();
constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

template <class It>
double max_of(It first, It last) {
  double result = -kInfinity;
  bool nan = false;
  for (; first != last; ++first) {
    double v = *first;
    if (std::isnan(v)) {
      nan = true;
    } else if (v > result || (v == 0 && result == 0 && !std::signbit(v))) {
      result = v;
    }
  }
  return nan ? kNaN : result;
}

template <class It>
double min_of(It first, It last) {
  double result = kInfinity;
  bool nan = false;
  for (; first != last; ++first) {
    double v = *first;
    if (std::isnan(v)) {
      nan = true;
    } else if (v < result || (v == 0 && result == 0 && std::signbit(v))) {
      result = v;
    }
  }
  return nan ? kNaN : result;
}

}  // namespace

double round(double x) {
  if (!std::isfinite(x)) {
    return x;
  }
  double t = std::floor(x);
  double r = x - t >= 0.5 ? t + 1 : t;
  if (r == 0 && (x < 0 || std::signbit(x))) {
    return -0.0;
  }
  return r;
}

double max(std::initializer_list<double> values) { return max_of(values.begin(), values.end()); }
double max(const std::vector<double>& values) { return max_of(values.begin(), values.end()); }
double min(std::initializer_list<double> values) { return min_of(values.begin(), values.end()); }
double min(const std::vector<double>& values) { return min_of(values.begin(), values.end()); }

double sign(double x) {
  if (std::isnan(x) || x == 0) {
    return x;
  }
  return x > 0 ? 1.0 : -1.0;
}

std::uint32_t to_uint32(double x) {
  if (!std::isfinite(x)) {
    return 0;
  }
  // fmod of an integral double by 2^32 is exact, so the result fits in uint32 after the shift.
  double m = std::fmod(std::trunc(x), 4294967296.0);
  if (m < 0) {
    m += 4294967296.0;
  }
  return static_cast<std::uint32_t>(m);
}

std::int32_t to_int32(double x) { return static_cast<std::int32_t>(to_uint32(x)); }

std::int32_t imul(double a, double b) {
  return static_cast<std::int32_t>(to_uint32(a) * to_uint32(b));
}

}  // namespace cantus::js
