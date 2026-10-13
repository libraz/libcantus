/**
 * @file augmented_sixth.h
 * @brief Internal helpers of ts/src/analyze/functional/augmented-sixth.ts: recognizing the
 *        augmented sixths on chords and keys already read, and the whole-symbol names they carry
 *        in a Roman-numeral text. The public entry points are declared in
 *        cantus/analyze/functional.h.
 */
#ifndef CANTUS_SRC_ANALYZE_FUNCTIONAL_AUGMENTED_SIXTH_H_
#define CANTUS_SRC_ANALYZE_FUNCTIONAL_AUGMENTED_SIXTH_H_

#include <string_view>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** The pitch class of the lowered submediant, the bass every kind stands on (`bassPcOf`). */
int augmented_sixth_bass_pc(const KeyScale& key);

/** `augmentedSixthKind` on chord data the analysis layer already holds (`augmentedSixthKindOf`). */
Nullable<AugmentedSixthKind> augmented_sixth_kind_of(const Chord& chord, const KeyArg& key);

/**
 * `augmentedSixthFromPitchClasses` for the callers inside the analysis layer
 * (`augmentedSixthOverBass`).
 */
Nullable<Chord> augmented_sixth_over_bass(const std::vector<double>& pcs, double bass_pc,
                                          const KeyArg& key);

/** The chord an augmented-sixth symbol names in a key, or null for other text. */
Nullable<Chord> augmented_sixth_from_symbol(std::string_view symbol, const KeyArg& key);

/** The symbol a chord renders as when it is an augmented sixth, else null. */
Nullable<std::string_view> augmented_sixth_symbol(const Chord& chord, const KeyArg& key);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FUNCTIONAL_AUGMENTED_SIXTH_H_
