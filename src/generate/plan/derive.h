/**
 * @file derive.h
 * @brief Internal pieces of ts/src/generate/plan/derive.ts: deriveCompositionPlan once its
 *        reference is checked, its options are read and its context is resolved.
 */
#ifndef CANTUS_SRC_GENERATE_PLAN_DERIVE_H_
#define CANTUS_SRC_GENERATE_PLAN_DERIVE_H_

#include <array>
#include <functional>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/analyze/reference.h"
#include "cantus/generate/context.h"
#include "cantus/generate/plan.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Every preserve dimension, in declaration order (`PRESERVE_ASPECTS`). */
std::vector<std::string_view> preserve_aspects();

/** One weight of a PreserveWeights by the name of its dimension, or nullptr for an unknown name. */
const std::optional<double>* preserve_weight(const PreserveWeights& weights,
                                             std::string_view aspect);

/** The preserve weights with an omitted one read as 1. */
struct ResolvedWeights {
  double form = 1;
  double phraseLengths = 1;
  double harmonicFunction = 1;
  double harmonicRhythm = 1;
  double motifRelations = 1;
  double registerShape = 1;
  double rhythm = 1;
};

/** The weight of a ResolvedWeights by the name of its dimension, or nullptr for an unknown name. */
double* preserve_slot(ResolvedWeights& weights, std::string_view aspect);

/** What deriveCompositionPlan has read of its options by the time it reads the reference's melody.
 */
struct DeriveRequest {
  ResolvedWeights preserve;
  std::optional<PlanRegisterRange> requestedRegister;
  /** `resolveKey(opts.key)`, run when the plan's keys are laid out; empty for no key asked. */
  std::function<ResolvedKey()> requestedKey;
  /**
   * The key index each reference chord was written with, where a caller's own number must reach
   * the plan as written (a negative zero stays one); empty to take the typed profile's.
   */
  std::vector<double> chordKeys;
  /** Charges the motif selection's cell count against the caller's budget. */
  std::function<void(double)> chargeMotifSelection;
};

/** deriveCompositionPlan from the point its context is resolved. */
CompositionPlan derive_composition_plan_with(const ReferenceProfile& profile,
                                             const DeriveRequest& request,
                                             const ResolvedContext& ctx);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_PLAN_DERIVE_H_
