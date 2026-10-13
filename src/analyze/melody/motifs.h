/**
 * @file motifs.h
 * @brief Internal helpers of ts/src/analyze/melody/motifs.ts. The public entry points are
 *        declared in cantus/analyze/melody.h.
 */
#ifndef CANTUS_SRC_ANALYZE_MELODY_MOTIFS_H_
#define CANTUS_SRC_ANALYZE_MELODY_MOTIFS_H_

#include <vector>

#include "cantus/analyze/melody.h"

namespace cantus {

/** `motifFromNotes` over notes that are already ordered, one per onset. */
MotifData motif_of_line(const std::vector<NoteEvent>& ordered);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_MELODY_MOTIFS_H_
