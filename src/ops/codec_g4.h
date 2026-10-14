/**
 * @file codec_g4.h
 * @brief Wire codec of the types of generate/harmonize and generate/reharmony: output fields.
 */
#ifndef CANTUS_SRC_OPS_CODEC_G4_H_
#define CANTUS_SRC_OPS_CODEC_G4_H_

#include "cantus/generate/harmonize.h"
#include "cantus/generate/reharmony.h"
#include "ops/codec.h"
#include "ops/codec_a1a.h"
#include "ops/codec_t1.h"
#include "ops/codec_t2.h"

namespace cantus {

inline json::Value to_json(MelodyToneRole role) { return json::Value(to_string(role)); }
inline json::Value to_json(SubstitutionType type) { return json::Value(to_string(type)); }

}  // namespace cantus

namespace cantus::ops {

/** A result writes its key scale first, as resolveKey does. */
void write_fields(const HarmonizeResult& v, FieldWriter& w);

CANTUS_JSON_FIELDS(ClassifiedMelodyTone, noteIndex, role, ornamental)
CANTUS_JSON_FIELDS(HarmonizedNoteRole, noteIndex, role)
CANTUS_JSON_FIELDS(Substitution, chord, type, roman, function)
CANTUS_JSON_FIELDS(BorrowedChord, chord, roman, source)

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_G4_H_
