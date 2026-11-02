/**
 * @file spelling.h
 * @brief Internal guard of ts/src/theory/spelling/index.ts.
 */
#ifndef CANTUS_SRC_THEORY_SPELLING_SPELLING_H_
#define CANTUS_SRC_THEORY_SPELLING_SPELLING_H_

#include <string_view>

#include "cantus/core/pitch.h"
#include "cantus/core/types.h"

namespace cantus {

/** Whether the key's scale is a seven-note scale (`isHeptatonic`). */
bool is_heptatonic(const KeyScale& key);

/** Shortest signed alteration, in [-6, 6], taking a letter's natural pitch class to `pc`
 * (`alterFor`). */
int alter_for(int letter, double pc);

/**
 * Reject a tonic that does not spell the key's own root (`assertTonicOf`).
 * @throws InvalidInputError naming `source` if the tonic sounds another pitch class.
 */
void assert_tonic_of(const NoteData& tonic, const KeyScale& key, std::string_view source);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SPELLING_SPELLING_H_
