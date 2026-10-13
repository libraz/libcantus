/**
 * @file tonicization.h
 * @brief Internal helpers of ts/src/analyze/functional/tonicization.ts: which chords point at a
 *        degree a key can make a local tonic. The degrees themselves come from
 *        theory/tendency/tendency.h.
 */
#ifndef CANTUS_SRC_ANALYZE_FUNCTIONAL_TONICIZATION_H_
#define CANTUS_SRC_ANALYZE_FUNCTIONAL_TONICIZATION_H_

#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "theory/tendency/tendency.h"

namespace cantus {

/**
 * The scale degree a chromatic chord tonicizes as a numeral names it, or null when it tonicizes
 * nothing (`appliedTarget`).
 */
Nullable<TonicizableDegree> applied_target(const Chord& chord, const KeyScale& key);

/** Whether a chord is an applied dominant (`isAppliedDominant`). */
bool is_applied_dominant(const Chord& chord, const KeyScale& key);

/** Whether a chord points at a degree the key can tonicize (`pointsAtTonicizableDegree`). */
bool points_at_tonicizable_degree(const Chord& chord, const KeyScale& key);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FUNCTIONAL_TONICIZATION_H_
