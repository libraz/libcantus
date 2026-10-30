// The Euclidean rhythm of ts/src/generate/drums/euclid.ts.

#include "generate/drums/euclid.h"

#include <cmath>
#include <cstddef>
#include <utility>

#include "cantus/core/validation.h"
#include "js/math.h"

namespace cantus {

namespace {

std::vector<bool> bjorklund(double pulses, double steps) {
  std::size_t total = static_cast<std::size_t>(steps);
  if (pulses == 0) {
    return std::vector<bool>(total, false);
  }
  if (pulses >= steps) {
    return std::vector<bool>(total, true);
  }
  std::size_t onsets = static_cast<std::size_t>(pulses);
  std::vector<std::vector<bool>> head(onsets, std::vector<bool>{true});
  std::vector<std::vector<bool>> remainder(total - onsets, std::vector<bool>{false});
  // At least one distribution: a single leftover rest still has to be placed.
  do {
    std::size_t count = head.size() < remainder.size() ? head.size() : remainder.size();
    std::vector<std::vector<bool>> next;
    for (std::size_t i = 0; i < count; ++i) {
      std::vector<bool> joined = head[i];
      joined.insert(joined.end(), remainder[i].begin(), remainder[i].end());
      next.push_back(std::move(joined));
    }
    remainder = head.size() > count
                    ? std::vector<std::vector<bool>>(head.begin() + count, head.end())
                    : std::vector<std::vector<bool>>(remainder.begin() + count, remainder.end());
    head = std::move(next);
  } while (remainder.size() > 1);
  std::vector<bool> out;
  for (const std::vector<bool>& group : head) {
    out.insert(out.end(), group.begin(), group.end());
  }
  for (const std::vector<bool>& group : remainder) {
    out.insert(out.end(), group.begin(), group.end());
  }
  return out;
}

}  // namespace

std::vector<bool> euclidean_rhythm(double pulses, double steps, double rotation) {
  assert_positive_int(steps, "euclidean steps");
  assert_integer(pulses, "euclidean pulses");
  assert_integer(rotation, "euclidean rotation");
  assert_generation_budget(steps, "euclidean pattern steps");
  double p = js::max(0, js::min(pulses, steps));
  std::vector<bool> base = bjorklund(p, steps);
  double shift = std::fmod(std::fmod(rotation, steps) + steps, steps);
  if (shift == 0) {
    return base;
  }
  std::vector<bool> out(base.size());
  for (std::size_t i = 0; i < base.size(); ++i) {
    double from = std::fmod(static_cast<double>(i) - shift + steps, steps);
    out[i] = base[static_cast<std::size_t>(from)];
  }
  return out;
}

}  // namespace cantus
