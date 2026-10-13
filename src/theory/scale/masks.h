/**
 * @file masks.h
 * @brief Internal tables and helpers of ts/src/theory/scale/masks.ts.
 */
#ifndef CANTUS_SRC_THEORY_SCALE_MASKS_H_
#define CANTUS_SRC_THEORY_SCALE_MASKS_H_

#include <array>
#include <cstddef>
#include <string_view>

#include "cantus/core/types.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** NAMED_SCALES, in declaration order. */
inline constexpr std::array<NamedScaleMask, 23> kNamedScales = {
#include "theory/scale/named_scales.gen.inc"
};
static_assert(!kNamedScales.back().name.empty(), "NAMED_SCALES has fewer entries than declared");

/** WORLD_SCALES, in declaration order. */
inline constexpr std::array<NamedScaleMask, 19> kWorldScales = {
#include "theory/scale/world_scales.gen.inc"
};
static_assert(!kWorldScales.back().name.empty(), "WORLD_SCALES has fewer entries than declared");

/** SCALE_ALIASES, in declaration order. */
inline constexpr std::array<ScaleAlias, 7> kScaleAliases = {
#include "theory/scale/scale_aliases.gen.inc"
};
static_assert(!kScaleAliases.back().alias.empty(), "SCALE_ALIASES has fewer entries than declared");

/** KEY_VARIANTS as names, indexed by KeyVariant. */
inline constexpr std::array<std::string_view, static_cast<std::size_t>(KeyVariant::kModal) + 1>
    kKeyVariantNames = {
#include "theory/scale/key_variants.gen.inc"
};
static_assert(!kKeyVariantNames.back().empty(), "KEY_VARIANTS and KeyVariant disagree");

/** VARIANT_MASKS: the mask of every variant but modal, indexed by KeyVariant. */
inline constexpr std::array<NamedScaleMask, static_cast<std::size_t>(KeyVariant::kModal)>
    kVariantMasks = {
#include "theory/scale/variant_masks.gen.inc"
};
static_assert(kVariantMasks[0].name == kKeyVariantNames[0] &&
                  kVariantMasks[1].name == kKeyVariantNames[1] &&
                  kVariantMasks[2].name == kKeyVariantNames[2] &&
                  kVariantMasks[3].name == kKeyVariantNames[3],
              "VARIANT_MASKS and KEY_VARIANTS disagree");

/** Whether a mode mask has a minor third and no major third (`isMinorMask`). */
bool is_minor_mask(int mode_mask12);

/** The checked mode mask of a key or scale (`maskOf`), named `<name>.modeMask12`. */
int mask_of(const KeyScale& scale, std::string_view name = "key");

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SCALE_MASKS_H_
