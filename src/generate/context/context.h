/**
 * @file context.h
 * @brief Internal pieces of ts/src/generate/context/index.ts: the path segment that separates
 *        algorithm versions, and the context a generator's own dial is merged into.
 */
#ifndef CANTUS_SRC_GENERATE_CONTEXT_CONTEXT_H_
#define CANTUS_SRC_GENERATE_CONTEXT_CONTEXT_H_

#include <optional>
#include <string_view>

#include "cantus/core/meter.h"
#include "cantus/generate/context.h"

namespace cantus {

/** Path segment separating one algorithm version's draws from another's (`VERSION_SEGMENT`). */
inline constexpr std::string_view kVersionSegment = "v";

/** The meter every generator assumes when the caller names none (`DEFAULT_TS` of core/meter). */
extern const TimeSignature kGenerateDefaultTs;

/** A generator's own dial, merged into its context (`resolveContextWith`'s sugar). */
struct ContextSugar {
  std::optional<double> ornament;
};

/**
 * Merge a generator's own dial into a context (`resolveContextWith`): the context wins where both
 * name it.
 * @throws InvalidInputError as resolve_context() does, or if the sugar dial is outside [0, 1].
 */
ResolvedContext resolve_context_with(const std::optional<GenerationContextInput>& input,
                                     const ContextSugar& sugar);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_CONTEXT_CONTEXT_H_
