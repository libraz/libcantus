/**
 * @file contour.h
 * @brief Internal helpers of ts/src/analyze/melody/contour.ts. The public entry point is declared
 *        in cantus/analyze/melody.h.
 */
#ifndef CANTUS_SRC_ANALYZE_MELODY_CONTOUR_H_
#define CANTUS_SRC_ANALYZE_MELODY_CONTOUR_H_

#include "analyze/melody/internal.h"
#include "cantus/analyze/melody.h"

namespace cantus {

/** The shape of notes that are already ordered, one per onset (`melodicContour`, past its guard).
 */
MelodicContour contour_of(const std::vector<NoteEvent>& line);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_MELODY_CONTOUR_H_
