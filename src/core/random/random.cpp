// The seeded generator of ts/src/core/random/index.ts (mulberry32).

#include "cantus/core/random.h"

#include <cmath>

#include "cantus/core/validation.h"
#include "core/random/internal.h"

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
  auto low = static_cast<double>(lo);
  auto high = static_cast<double>(hi);
  assert_range_bounds(low, high);
  return static_cast<std::int64_t>(low + std::floor(next() * (high - low + 1)));
}

double Rng::float_(double lo, double hi) {
  assert_float_bounds(lo, hi);
  return scale_unit_draw(next(), lo, hi);
}

}  // namespace cantus
