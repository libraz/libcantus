// The seeded generator of ts/src/core/random/index.ts (mulberry32).

#include "cantus/core/random.h"

#include <cmath>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "js/number.h"

namespace cantus {

double Rng::next() {
  state_ += 0x6d2b79f5U;
  std::uint32_t t = state_;
  t = (t ^ (t >> 15)) * (t | 1U);
  t ^= t + (t ^ (t >> 7)) * (t | 61U);
  return (t ^ (t >> 14)) / UINT32_RANGE;
}

bool Rng::prob(double p) {
  // Validate first: a draw consumed by a rejected call would shift the stream.
  assert_range(p, 0, 1, "probability");
  return next() < p;
}

std::int64_t Rng::range(std::int64_t lo, std::int64_t hi) {
  double low = assert_integer(static_cast<double>(lo), "range lower bound");
  double high = assert_integer(static_cast<double>(hi), "range upper bound");
  if (low > high) {
    throw InvalidInputError("range lower bound must not exceed upper bound; received " +
                            js::to_string(low) + " > " + js::to_string(high));
  }
  assert_integer(high - low, "range span", 0);
  return static_cast<std::int64_t>(low + std::floor(next() * (high - low + 1)));
}

double Rng::float_(double lo, double hi) {
  assert_finite_number(lo, "float lower bound");
  assert_finite_number(hi, "float upper bound");
  if (lo > hi) {
    throw InvalidInputError("float lower bound must not exceed upper bound; received " +
                            js::to_string(lo) + " > " + js::to_string(hi));
  }
  assert_finite_number(hi - lo, "float span");
  return lo + next() * (hi - lo);
}

}  // namespace cantus
