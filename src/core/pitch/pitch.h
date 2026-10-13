/**
 * @file pitch.h
 * @brief Internal entry points of ts/src/core/pitch/index.ts beside the public API.
 */
#ifndef CANTUS_SRC_CORE_PITCH_PITCH_H_
#define CANTUS_SRC_CORE_PITCH_PITCH_H_

#include <optional>
#include <string_view>

#include "cantus/core/pitch.h"
#include "core/pitch/limits.gen.h"

namespace cantus {

/**
 * Validate the fields of a spelled note, in the order TS checks them (`assertNote`). The fields
 * arrive as numbers so a computed note can be checked before it is narrowed.
 * @throws InvalidInputError naming `name` when a field is outside its range.
 */
NoteData assert_note_values(double letter, double alter, std::optional<double> octave,
                            std::string_view name);

/** assert_note_values() over a note, returned unchanged (`assertNote`). */
const NoteData& assert_note(const NoteData& note, std::string_view name);

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_PITCH_PITCH_H_
