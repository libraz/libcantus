/**
 * @file modes.h
 * @brief Internal helpers of ts/src/analyze/detect/modes.ts: the church-mode candidates of
 *        detect_key(). ModalScaleName and ModalCandidate are declared in cantus/analyze/detect.h.
 */
#ifndef CANTUS_SRC_ANALYZE_DETECT_MODES_H_
#define CANTUS_SRC_ANALYZE_DETECT_MODES_H_

#include <array>
#include <optional>
#include <variant>
#include <vector>

#include "cantus/analyze/detect.h"

namespace cantus {

/** The modal candidates, in the order they break a tie among themselves (`MODAL_CANDIDATES`). */
const std::vector<ModalCandidate>& modal_candidates();

/** Derive the key profile of a mode from the profile of its parallel key (`modalProfileVector`). */
std::array<double, 12> modal_profile_vector(const KeyProfilePair& profile,
                                            const ModalCandidate& candidate);

/**
 * Resolve the `modes` option of detect_key() to the candidates to rank (`resolveModalCandidates`);
 * always in candidate order.
 */
std::vector<ModalCandidate> resolve_modal_candidates(
    const std::optional<std::variant<bool, std::vector<ModalScaleName>>>& modes);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_DETECT_MODES_H_
