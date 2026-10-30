/**
 * @file internal.h
 * @brief Internal helpers of ts/src/analyze/rhythm/internal.ts: rhythm-analysis helpers shared
 *        with modules outside analyze/rhythm.
 */
#ifndef CANTUS_SRC_ANALYZE_RHYTHM_INTERNAL_H_
#define CANTUS_SRC_ANALYZE_RHYTHM_INTERNAL_H_

#include <optional>
#include <vector>

#include "cantus/analyze/rhythm.h"
#include "cantus/core/meter.h"

namespace cantus {

/** Whether `value` is a whole multiple of `unit`, within float tolerance (`isMultipleOf`). */
bool is_multiple_of(double value, double unit);

/**
 * A position's rhythmic level (`rhythmLevel`): 2-5 on a main pulse (`metricWeight` plus 2), 1 on
 * the pulse's first subdivision, 0 elsewhere.
 */
int rhythm_level(double beat_in_quarters, const MeterArg& meters);

/** Bin an inter-onset interval to RHYTHM_IOI_BINS, clamped to its ends (`ioiBinIndex`). */
int ioi_bin_index(double ioi);

/**
 * analyze_rhythm() over a window that opens at `window_start` rather than at the bar grid of the
 * first onset; nullopt opens it there (`rhythmOver`).
 */
RhythmAnalysis rhythm_over(const std::vector<NoteEvent>& notes, const RhythmAnalysisOptions& opts,
                           std::optional<double> window_start);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_RHYTHM_INTERNAL_H_
