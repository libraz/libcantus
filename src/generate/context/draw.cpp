// The position-addressed samplers of ts/src/generate/context/draw.ts.

#include "generate/context/draw.h"

#include <cmath>
#include <string>
#include <utility>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "cantus/generate/context.h"
#include "core/random/internal.h"
#include "core/validation/validation.h"
#include "js/number.h"
#include "json/json.h"

namespace cantus {

namespace {

/** One draw from a positional source, held to the range the source promises (`drawFrom`). */
double draw_from(const PositionalDraw& source, const SeedPath& path) {
  double draw = source(path);
  if (!(draw >= 0 && draw < 1)) {
    throw InvalidInputError("positional draw must be in [0, 1); received " + js::to_string(draw));
  }
  return draw;
}

}  // namespace

const SeedPath& assert_seed_path(const SeedPath& path, std::string_view name) {
  for (std::size_t index = 0; index < path.size(); ++index) {
    const double* step = std::get_if<double>(&path[index]);
    if (step != nullptr && !std::isfinite(*step)) {
      throw InvalidInputError(std::string(name) + "[" + index_text(index) +
                              "] must be a string or a finite number; received " +
                              describe_rejected(json::Value(*step)));
    }
  }
  return path;
}

Draw::Draw(PositionalDraw source, SeedPath prefix)
    : source_(std::move(source)), prefix_(std::move(prefix)) {}

Draw::Draw(const PositionalRng& rng, SeedPath prefix)
    : Draw([rng](const SeedPath& path) { return rng.at(path); }, std::move(prefix)) {}

SeedPath Draw::under_prefix(const SeedPath& path) const {
  SeedPath full = prefix_;
  full.insert(full.end(), path.begin(), path.end());
  return full;
}

double Draw::at(const SeedPath& path) const { return draw_from(source_, under_prefix(path)); }

bool Draw::prob(double p, const SeedPath& path) const {
  return include_at(source_, p, under_prefix(path));
}

std::int64_t Draw::range(std::int64_t lo, std::int64_t hi, const SeedPath& path) const {
  auto low = static_cast<double>(lo);
  auto high = static_cast<double>(hi);
  assert_range_bounds(low, high);
  return static_cast<std::int64_t>(low + std::floor(at(path) * (high - low + 1)));
}

double Draw::float_(double lo, double hi, const SeedPath& path) const {
  assert_float_bounds(lo, hi);
  return scale_unit_draw(at(path), lo, hi);
}

}  // namespace cantus
