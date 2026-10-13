// Resolving any key-shaped value to a key/scale: ts/src/theory/scale/coerce.ts.

#include <string>

#include "cantus/core/pitch.h"
#include "cantus/theory/scale.h"
#include "js/number.h"
#include "theory/scale/name.h"

namespace cantus {

namespace {

/** Validate a plain key/scale and return it in the canonical shape (`normalizedKeyScale`). */
KeyScale normalized_key_scale(const KeyScale& scale) {
  assert_mode_mask(scale.modeMask12, "key.modeMask12");
  if ((scale.modeMask12 & 1) == 0) {
    // Every scale contains its own root, and the rest of the library reads bit 0 as given.
    throw InvalidInputError("key.modeMask12 must include its root; received " +
                            js::to_string(scale.modeMask12));
  }
  return KeyScale{pitch_class_of(scale.rootPc), scale.modeMask12};
}

}  // namespace

KeyScale to_key_scale(const KeyArg& value) {
  if (const auto* name = std::get_if<std::string>(&value.value())) {
    return resolve_key_name(*name).scale;
  }
  return normalized_key_scale(std::get<KeyData>(value.value()).scale);
}

}  // namespace cantus
