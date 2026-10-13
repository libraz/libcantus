// Scale systems: which pitch organisations functional harmony was built for, of
// ts/src/theory/scale/system.ts.

#include <array>
#include <string>
#include <utility>
#include <vector>

#include "cantus/theory/scale.h"
#include "theory/scale/masks.h"

namespace cantus {

namespace {

/** One entry of SCALE_SYSTEMS, with the system still by name. */
struct ScaleSystemRow {
  std::string_view name;
  std::string_view system;
};

constexpr std::array<ScaleSystemRow, kNamedScales.size() + kWorldScales.size()> kScaleSystems = {
#include "theory/scale/scale_systems.gen.inc"
};
static_assert(!kScaleSystems.back().name.empty(), "SCALE_SYSTEMS misses a built-in scale");

/** The system each built-in scale name belongs to. */
ScaleSystem system_of_name(std::string_view name) {
  for (const ScaleSystemRow& row : kScaleSystems) {
    if (row.name == name) {
      return *parse_scale_system(row.system);
    }
  }
  return ScaleSystem::kNonFunctional;
}

/** System of each built-in mask, the Western register first (`SYSTEM_BY_MASK`). */
const std::vector<std::pair<int, ScaleSystem>>& system_by_mask() {
  static const std::vector<std::pair<int, ScaleSystem>> table = [] {
    std::vector<std::pair<int, ScaleSystem>> out;
    auto add = [&out](const NamedScaleMask& entry) {
      for (const auto& known : out) {
        if (known.first == entry.mask) {
          return;
        }
      }
      out.emplace_back(entry.mask, system_of_name(entry.name));
    };
    for (const NamedScaleMask& entry : kNamedScales) {
      add(entry);
    }
    for (const NamedScaleMask& entry : kWorldScales) {
      add(entry);
    }
    return out;
  }();
  return table;
}

std::vector<ScaleSystemEntry> scale_system_entries() {
  std::vector<ScaleSystemEntry> out;
  for (const ScaleSystemRow& row : kScaleSystems) {
    out.push_back(ScaleSystemEntry{row.name, *parse_scale_system(row.system)});
  }
  return out;
}

}  // namespace

const std::vector<ScaleSystemEntry> SCALE_SYSTEMS = scale_system_entries();

std::string_view to_string(ScaleSystem system) {
  switch (system) {
    case ScaleSystem::kCommonPractice:
      return "common-practice";
    case ScaleSystem::kModal:
      return "modal";
    case ScaleSystem::kNonFunctional:
      return "non-functional";
  }
  return "";
}

std::optional<ScaleSystem> parse_scale_system(std::string_view name) {
  for (ScaleSystem system :
       {ScaleSystem::kCommonPractice, ScaleSystem::kModal, ScaleSystem::kNonFunctional}) {
    if (to_string(system) == name) {
      return system;
    }
  }
  return std::nullopt;
}

ScaleSystem scale_system_of(std::string_view name) {
  std::optional<std::string_view> canonical = resolve_scale_name(name);
  if (!canonical) {
    throw InvalidInputError("Unknown scale: " + std::string(name));
  }
  return system_of_name(*canonical);
}

std::optional<ScaleSystem> scale_system_of(const KeyScale& scale) {
  int mask = mask_of(scale, "scale");
  for (const auto& [known, system] : system_by_mask()) {
    if (known == mask) {
      return system;
    }
  }
  return std::nullopt;
}

bool supports_functional_harmony(std::string_view name) {
  return scale_system_of(name) != ScaleSystem::kNonFunctional;
}

bool supports_functional_harmony(const KeyScale& scale) {
  return scale_system_of(scale) != ScaleSystem::kNonFunctional;
}

}  // namespace cantus
