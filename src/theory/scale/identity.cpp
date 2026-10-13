// A key's whole identity, and the one resolver that produces it: ts/src/theory/scale/identity.ts.

#include <string>

#include "cantus/core/pitch.h"
#include "cantus/theory/scale.h"
#include "js/number.h"
#include "theory/scale/masks.h"
#include "theory/scale/name.h"

namespace cantus {

namespace {

/** A carried tonic, refused when it spells a pitch class the scale is not rooted on. */
NoteData carried_tonic(const NoteData& tonic, const KeyScale& scale) {
  if (note_to_pitch_class(tonic) != scale.rootPc) {
    throw InvalidInputError("tonic " + format_note(tonic) +
                            " does not match the scale root pitch class " +
                            js::to_string(scale.rootPc) +
                            "; pass a tonic that spells the scale root, or omit it to have one "
                            "chosen");
  }
  return NoteData{tonic.letter, tonic.alter, std::nullopt};
}

}  // namespace

ResolvedKey resolve_key(const KeyArg& value) {
  if (const auto* name = std::get_if<std::string>(&value.value())) {
    return resolve_key_name(*name);
  }
  const KeyData& carried = std::get<KeyData>(value.value());
  KeyScale scale = to_key_scale(value);
  NoteData tonic =
      carried.tonic ? carried_tonic(*carried.tonic, scale) : spelled_key_of(scale).tonic;
  KeyVariant variant = KeyVariant::kModal;
  if (carried.variant) {
    assert_key_variant(*carried.variant, scale.modeMask12);
    variant = *carried.variant;
  } else {
    variant = variant_of_mask(scale.modeMask12);
  }
  return ResolvedKey{scale, tonic, variant};
}

KeyScale scale_of(const ResolvedKey& key) {
  mask_of(key.scale, "key.scale");
  return key.scale;
}

}  // namespace cantus
