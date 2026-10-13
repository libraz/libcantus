/**
 * @file internal.h
 * @brief Internal helpers of ts/src/analyze/reference/internal.ts: reference-profile helpers
 *        shared with modules outside analyze/reference.
 */
#ifndef CANTUS_SRC_ANALYZE_REFERENCE_INTERNAL_H_
#define CANTUS_SRC_ANALYZE_REFERENCE_INTERNAL_H_

#include <optional>
#include <vector>

#include "cantus/analyze/reference.h"

namespace cantus {

/** Duration-weighted mean pitch of notes that all sound for a positive length (`weightedMean`). */
double weighted_mean(const std::vector<NoteEvent>& notes);

/**
 * How the line reads within one phrase, from the line's notes whose onsets fall in it, each cut
 * off at the phrase's end; null when fewer than two do (`phraseMelody`).
 */
Nullable<ReferencePhraseMelody> phrase_melody(const std::vector<NoteEvent>& line, double start_beat,
                                              double end_beat, double line_mean,
                                              const MeterMap& meters, std::optional<double> budget);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_REFERENCE_INTERNAL_H_
