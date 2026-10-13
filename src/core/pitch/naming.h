/**
 * @file naming.h
 * @brief Internal entry points of ts/src/core/pitch/naming.ts beside the public API.
 */
#ifndef CANTUS_SRC_CORE_PITCH_NAMING_H_
#define CANTUS_SRC_CORE_PITCH_NAMING_H_

#include <string>
#include <string_view>

#include "cantus/core/pitch.h"
#include "core/pitch/limits.gen.h"

namespace cantus {

/** The greatest number of characters a bare note name takes in a system (`maxNoteNameLength`). */
int max_note_name_length(NoteNameSystem system);

/**
 * Read a note name in the given system or the one the name is written in (`readNoteName`).
 * @throws InvalidInputError if no system reads it.
 */
NoteData read_note_name(std::string_view text, const NoteNameOptions& opts = {});

/** Write a note name; the letter must already be reduced to 0..6 (`writeNoteName`). */
std::string write_note_name(const NoteData& note, const NoteNameOptions& opts = {});

/** Read a key name in the given system or the one the name is written in (`readKeyName`). */
KeyName read_key_name(std::string_view text, const NoteNameOptions& opts = {});

/** Write a key name; the tonic's letter reduced and its octave dropped (`writeKeyName`). */
std::string write_key_name(const KeyName& key, const NoteNameOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_PITCH_NAMING_H_
