/**
 * @file melody.h
 * @brief Internal pieces of ts/src/generate/melody/index.ts: generateMelody once its plan is
 *        checked and its context is resolved.
 */
#ifndef CANTUS_SRC_GENERATE_MELODY_MELODY_H_
#define CANTUS_SRC_GENERATE_MELODY_MELODY_H_

#include <optional>
#include <vector>

#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/plan.h"

namespace cantus {

/**
 * The context a melody is drawn under (`melodyContext`): an explicit seed or algorithm version
 * wins, the plan fills in the rest.
 * @throws InvalidInputError if the context supplies an `rng`.
 */
ResolvedContext melody_context(const CompositionPlan& plan,
                               const std::optional<GenerationContextInput>& input);

/** generateMelody from the point the plan is checked, its budget read and its context resolved. */
std::vector<NoteEvent> generate_melody_with(const CompositionPlan& plan,
                                            std::optional<double> budget,
                                            const ResolvedContext& resolved);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_MELODY_MELODY_H_
