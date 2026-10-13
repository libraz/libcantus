/**
 * @file name.h
 * @brief Internal key-name readers of ts/src/theory/scale/name.ts.
 */
#ifndef CANTUS_SRC_THEORY_SCALE_NAME_H_
#define CANTUS_SRC_THEORY_SCALE_NAME_H_

#include <optional>
#include <string_view>

#include "cantus/core/pitch.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** The scale word a mask is written with, or nullopt (`scaleNameOfMask`). */
std::optional<std::string_view> scale_name_of_mask(int mask);

/**
 * Read a key name to the whole key it denotes (`resolveKeyName`).
 * @throws InvalidInputError if the text names no key.
 */
ResolvedKey resolve_key_name(std::string_view text, const NoteNameOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SCALE_NAME_H_
