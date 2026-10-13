/**
 * @file relations.h
 * @brief Internal helpers of ts/src/theory/scale/relations.ts.
 */
#ifndef CANTUS_SRC_THEORY_SCALE_RELATIONS_H_
#define CANTUS_SRC_THEORY_SCALE_RELATIONS_H_

#include "cantus/core/pitch.h"
#include "cantus/core/types.h"

namespace cantus {

/** Whether a key is actually written on this tonic (`isWrittenTonic`). */
bool is_written_tonic(const NoteData& tonic, const KeyScale& key);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SCALE_RELATIONS_H_
