/**
 * @file function.h
 * @brief Internal helpers of ts/src/analyze/functional/function.ts: harmonic function with the
 *        rule that settled it, and the parallel key. The public entry points are declared in
 *        cantus/analyze/functional.h.
 */
#ifndef CANTUS_SRC_ANALYZE_FUNCTIONAL_FUNCTION_H_
#define CANTUS_SRC_ANALYZE_FUNCTIONAL_FUNCTION_H_

#include <cstdint>

#include "cantus/analyze/functional.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Which rule of function_of() settled the function (`FunctionReason`). */
enum class FunctionReason : std::uint8_t {
  kNeapolitan,
  kAugmentedSixth,
  kApplied,
  kFlatSideMajor,
  kDegree,
};

/** A function and the rule that settled it. */
struct ReasonedFunction {
  HarmonicFunction function = HarmonicFunction::kTonic;
  FunctionReason reason = FunctionReason::kDegree;
};

/** `functionOf`, keeping the rule that decided the answer (`functionWithReason`). */
ReasonedFunction function_with_reason(const Chord& chord, const KeyScale& key);

/** The parallel key: same tonic, opposite mode (`parallelKey`). */
KeyScale parallel_key(const KeyArg& key);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FUNCTIONAL_FUNCTION_H_
