// The algorithm version of ts/src/core/random/version.ts.

#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/random.h"
#include "cantus/core/validation.h"
#include "js/number.h"

namespace cantus {

std::uint32_t resolve_algorithm_version(std::optional<std::int64_t> requested) {
  if (!requested) {
    return ALGORITHM_VERSION;
  }
  double version = assert_integer(static_cast<double>(*requested), "algorithm version");
  if (version < MIN_ALGORITHM_VERSION || version > ALGORITHM_VERSION) {
    throw InvalidInputError("algorithm version " + js::to_string(version) +
                            " is not produced by this build; supported versions are " +
                            js::to_string(MIN_ALGORITHM_VERSION) + ".." +
                            js::to_string(ALGORITHM_VERSION));
  }
  return static_cast<std::uint32_t>(*requested);
}

}  // namespace cantus
