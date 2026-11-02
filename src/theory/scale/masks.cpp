// Mode masks and named scales of ts/src/theory/scale/masks.ts.

#include "theory/scale/masks.h"

#include <string>

#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

const std::vector<NamedScaleMask> NAMED_SCALES(kNamedScales.begin(), kNamedScales.end());
const std::vector<NamedScaleMask> WORLD_SCALES(kWorldScales.begin(), kWorldScales.end());
const std::vector<ScaleAlias> SCALE_ALIASES(kScaleAliases.begin(), kScaleAliases.end());

std::string_view to_string(KeyVariant variant) {
  return kKeyVariantNames[static_cast<std::size_t>(variant)];
}

std::optional<KeyVariant> parse_key_variant(std::string_view name) {
  for (std::size_t i = 0; i < kKeyVariantNames.size(); ++i) {
    if (kKeyVariantNames[i] == name) {
      return static_cast<KeyVariant>(i);
    }
  }
  return std::nullopt;
}

int mask_from_offsets(const std::vector<double>& offsets) {
  int mask = 1;
  for (std::size_t index = 0; index < offsets.size(); ++index) {
    double offset = assert_integer(offsets[index], "offsets[" + index_text(index) + "]");
    mask |= 1 << static_cast<int>(js::floor_mod(offset, 12));
  }
  return mask;
}

int assert_mode_mask(double mode_mask12, std::string_view name) {
  return static_cast<int>(assert_integer(mode_mask12, name, 1, CHROMATIC_MASK));
}

int mask_of(const KeyScale& scale, std::string_view name) {
  return assert_mode_mask(scale.modeMask12, join_name(name, ".modeMask12"));
}

std::optional<std::string_view> resolve_scale_name(std::string_view name) {
  for (const NamedScaleMask& entry : kNamedScales) {
    if (entry.name == name) {
      return entry.name;
    }
  }
  for (const NamedScaleMask& entry : kWorldScales) {
    if (entry.name == name) {
      return entry.name;
    }
  }
  for (const ScaleAlias& entry : kScaleAliases) {
    if (entry.alias == name) {
      return entry.name;
    }
  }
  return std::nullopt;
}

std::optional<int> named_scale_mask(std::string_view name) {
  std::optional<std::string_view> canonical = resolve_scale_name(name);
  if (!canonical) {
    return std::nullopt;
  }
  for (const NamedScaleMask& entry : kNamedScales) {
    if (entry.name == *canonical) {
      return entry.mask;
    }
  }
  for (const NamedScaleMask& entry : kWorldScales) {
    if (entry.name == *canonical) {
      return entry.mask;
    }
  }
  return std::nullopt;
}

int require_scale_mask(std::string_view name, std::string_view label) {
  std::optional<int> mask = named_scale_mask(name);
  if (!mask) {
    throw InvalidInputError("Unknown " + std::string(label) + ": " + std::string(name));
  }
  return *mask;
}

bool is_minor_mask(int mode_mask12) {
  return ((mode_mask12 >> 3) & 1) == 1 && ((mode_mask12 >> 4) & 1) == 0;
}

KeyVariant variant_of_mask(int mode_mask12) {
  assert_mode_mask(mode_mask12);
  for (std::size_t i = 0; i < kVariantMasks.size(); ++i) {
    if (kVariantMasks[i].mask == mode_mask12) {
      return static_cast<KeyVariant>(i);
    }
  }
  return KeyVariant::kModal;
}

void assert_key_variant(KeyVariant variant, int mode_mask12) {
  // Read as a mask before it is compared with one: modal matches no named mask, so a value that is
  // no mask at all would agree with it.
  assert_mode_mask(mode_mask12);
  bool matches = true;
  if (variant == KeyVariant::kModal) {
    for (const NamedScaleMask& named : kVariantMasks) {
      if (named.mask == mode_mask12) {
        matches = false;
      }
    }
  } else {
    matches = kVariantMasks[static_cast<std::size_t>(variant)].mask == mode_mask12;
  }
  if (!matches) {
    throw InvalidInputError("variant " + std::string(to_string(variant)) +
                            " does not match the scale mask " + js::to_string(mode_mask12) +
                            "; pass the scale that variant names, or omit the variant");
  }
}

}  // namespace cantus
