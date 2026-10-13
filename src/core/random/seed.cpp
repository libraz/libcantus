// Hierarchical seeds of ts/src/core/random/seed.ts.

#include "core/random/internal.h"

namespace cantus {

std::uint32_t derive_seed(std::uint32_t root, const SeedPath& path) {
  return hash_path(DOMAIN_SEED, root, path);
}

}  // namespace cantus
