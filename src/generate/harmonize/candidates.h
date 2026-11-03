/**
 * @file candidates.h
 * @brief Internal pieces of ts/src/generate/harmonize/candidates.ts: the chords the search may
 *        place, gated by the harmonic dial.
 */
#ifndef CANTUS_SRC_GENERATE_HARMONIZE_CANDIDATES_H_
#define CANTUS_SRC_GENERATE_HARMONIZE_CANDIDATES_H_

#include <array>
#include <cstddef>
#include <string_view>
#include <vector>

#include "cantus/generate/harmonize.h"
#include "cantus/theory/scale.h"
#include "generate/harmonize/internal.h"

namespace cantus {

/** REHARMONIZE_STRENGTHS as names, indexed by ReharmonizeStrength. */
inline constexpr std::array<std::string_view,
                            static_cast<std::size_t>(ReharmonizeStrength::kBorrowed) + 1>
    kReharmonizeStrengthNames =
#include "generate/harmonize/reharmonize_strengths.gen.inc"
    ;
static_assert(!kReharmonizeStrengthNames.back().empty(),
              "REHARMONIZE_STRENGTHS and ReharmonizeStrength disagree");

/** Every named reharmonization strength, in dial order (`REHARMONIZE_STRENGTHS`). */
std::vector<std::string_view> reharmonize_strength_names();

/** Where a named reharmonization strength sits on the harmonic dial (`REHARMONIZE_DIAL`). */
double reharmonize_dial(ReharmonizeStrength strength);

/** Enumerate candidate chords for the key, gated by the harmonic dial (`buildCandidates`). */
std::vector<Candidate> build_candidates(const KeyScale& key, double harmonic);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_HARMONIZE_CANDIDATES_H_
