/**
 * @file cadence.h
 * @brief Internal helpers of ts/src/analyze/functional/cadence.ts: cadence classification on
 *        chords and keys already read into their narrow form, and the cadential six-four. The
 *        public entry point is declared in cantus/analyze/functional.h.
 */
#ifndef CANTUS_SRC_ANALYZE_FUNCTIONAL_CADENCE_H_
#define CANTUS_SRC_ANALYZE_FUNCTIONAL_CADENCE_H_

#include <array>
#include <optional>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"

namespace cantus {

/** DetectCadenceOptions with its approach chord already coerced (`CadenceOptions`). */
struct CadenceOptions {
  std::optional<std::array<std::vector<double>, 2>> voicing;
  std::optional<bool> alternatives;
  std::optional<Chord> approach;
};

/** Whether a chord is the cadential six-four of the chord that follows it (`isCadentialSixFour`).
 */
bool is_cadential_six_four(const Chord& chord, const Chord& next, const KeyScale& key);

/** `detectCadence` on data already read into its narrow form (`cadenceBetween`). */
CadenceResult cadence_between(const Chord& from, const Chord& to, const KeyScale& key,
                              const CadenceOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FUNCTIONAL_CADENCE_H_
