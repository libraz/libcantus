/**
 * @file satb.h
 * @brief Internal helpers of ts/src/theory/voicing/satb.ts: how the voicing options resolve to
 *        ranges, spacing, candidate cap, key and previous chord. Every voicing entry point and the
 *        part-writing checker resolve them the same way.
 */
#ifndef CANTUS_SRC_THEORY_VOICING_SATB_H_
#define CANTUS_SRC_THEORY_VOICING_SATB_H_

#include <optional>
#include <vector>

#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/voicing.h"

namespace cantus {

/**
 * The per-voice ranges the options imply: explicit `ranges` win, four voices use SATB_RANGES, and
 * other counts get evenly spaced ranges (`resolveRanges`).
 * @throws InvalidInputError if the ranges are empty or malformed, or the voice count is not a
 *   positive integer.
 * @throws BudgetExceededError if there are too many ranges or a range spans too many pitches.
 */
std::vector<VoiceRange> resolve_ranges(const VoicingOptions& opts);

/**
 * The adjacent-voice spacing limit (`resolveMaxSpacing`).
 * @throws InvalidInputError if it is not a non-negative finite number.
 */
double resolve_max_spacing(const VoicingOptions& opts);

/** The prevailing key, resolved whole (`resolvedKeyOf`). */
std::optional<ResolvedKey> resolved_key_of(const VoicingOptions& opts);

/** The chord the current voicing came from (`resolvePreviousChord`). */
std::optional<Chord> resolve_previous_chord(const VoicingOptions& opts);

/**
 * The per-chord candidate-search cap (`resolveMaxCandidates`).
 * @throws InvalidInputError if it is not a positive integer within the cap.
 */
std::optional<double> resolve_max_candidates(const VoicingOptions& opts);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_VOICING_SATB_H_
