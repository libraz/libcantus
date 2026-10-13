// Position-addressed randomness of ts/src/core/random/positional.ts.

#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/random.h"
#include "cantus/core/validation.h"
#include "core/random/internal.h"
#include "js/number.h"

namespace cantus {

double PositionalRng::at(const SeedPath& path) const {
  return hash_path(DOMAIN_POSITION, seed_, path) / UINT32_RANGE;
}

bool include_at(const PositionalDraw& at, double complexity, const SeedPath& path) {
  assert_range(complexity, 0, 1, "complexity");
  double draw = at(path);
  // A substituted source is part of the contract; one returning 1, a negative value or NaN
  // would quietly break monotonicity rather than fail.
  if (!(draw >= 0 && draw < 1)) {
    throw InvalidInputError("positional draw must be in [0, 1); received " + js::to_string(draw));
  }
  return draw < complexity;
}

bool include_at(const PositionalRng& rng, double complexity, const SeedPath& path) {
  return include_at([&rng](const SeedPath& at_path) { return rng.at(at_path); }, complexity, path);
}

}  // namespace cantus
