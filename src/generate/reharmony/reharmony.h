/**
 * @file reharmony.h
 * @brief Internal pieces of ts/src/generate/reharmony/index.ts: substituteChord once its chord and
 *        key are read.
 */
#ifndef CANTUS_SRC_GENERATE_REHARMONY_REHARMONY_H_
#define CANTUS_SRC_GENERATE_REHARMONY_REHARMONY_H_

#include <functional>
#include <optional>
#include <vector>

#include "cantus/generate/reharmony.h"

namespace cantus {

/**
 * substituteChord from the point its chord and key are read. `settle_source` is called where the
 * source chord is first read as a chord of a known quality, and `melody_pcs` where the
 * substitutions are filtered; it returns the pitch classes a candidate has to hold, if any.
 */
std::vector<Substitution> substitute_chord_with(
    const Chord& source, const ResolvedKey& key, const std::function<void()>& settle_source,
    const std::function<std::optional<std::vector<int>>()>& melody_pcs);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_REHARMONY_REHARMONY_H_
