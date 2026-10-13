// Articulation names of ts/src/core/instrument/articulation.ts.

#include "core/instrument/articulation.h"

#include <cstddef>

namespace cantus {

std::string_view to_string(Articulation articulation) {
  return kArticulationNames[static_cast<std::size_t>(articulation)];
}

std::optional<Articulation> parse_articulation(std::string_view name) {
  for (std::size_t i = 0; i < kArticulationNames.size(); ++i) {
    if (kArticulationNames[i] == name) {
      return ARTICULATIONS[i];
    }
  }
  return std::nullopt;
}

std::vector<std::string_view> articulation_names() {
  return std::vector<std::string_view>(kArticulationNames.begin(), kArticulationNames.end());
}

}  // namespace cantus
