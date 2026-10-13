/**
 * @file borrowed.h
 * @brief Internal helpers of ts/src/analyze/functional/borrowed.ts: borrowed chords (modal
 *        interchange) and the Neapolitan, on data already read into its narrow form. The public
 *        entry points are declared in cantus/analyze/functional.h.
 */
#ifndef CANTUS_SRC_ANALYZE_FUNCTIONAL_BORROWED_H_
#define CANTUS_SRC_ANALYZE_FUNCTIONAL_BORROWED_H_

#include "cantus/analyze/functional.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"

namespace cantus {

/** `borrowedSource` on data already read into its narrow form (`borrowedSourceOf`). */
Nullable<BorrowedSource> borrowed_source_of(const Chord& chord, const KeyScale& key);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FUNCTIONAL_BORROWED_H_
