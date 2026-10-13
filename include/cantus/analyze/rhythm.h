/**
 * @file rhythm.h
 * @brief Public C++ API of ts/src/analyze/rhythm: where a line places its onsets against the
 *        meter, how dense they are, which metric positions they favour, and how far they push
 *        against the beat.
 */
#ifndef CANTUS_ANALYZE_RHYTHM_H_
#define CANTUS_ANALYZE_RHYTHM_H_

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"

namespace cantus {

/** Options of analyze_rhythm() (`RhythmAnalysisOptions`). */
struct RhythmAnalysisOptions {
  /** A single time signature held across the whole span; defaults to 4/4. */
  std::optional<MeterArg> ts;
  /** The meter as it changes over the span; defaults to 4/4 throughout. */
  std::optional<MeterArg> meters;
  /** End of the analysed span in beats; defaults to the end of the last note. */
  std::optional<double> totalBeats;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/** How a line's onsets sit against one time signature (`BarPositionProfile`). */
struct BarPositionProfile {
  /** The time signature this profile's bar is read in. */
  TimeSignature ts;
  /** Slots in one bar of `ts`, at one twelfth of a quarter-note beat each. */
  int slotsPerBar = 0;
  /** Onset mass per slot, in bar order starting at the downbeat; sums to 1. */
  std::vector<double> shares;
  /** Onsets read under this signature. */
  std::size_t onsets = 0;
};

/** How a line places its onsets against the meter (`RhythmAnalysis`). */
struct RhythmAnalysis {
  /** First beat of the analysed span. */
  double startBeat = 0;
  /** End of the analysed span, exclusive. */
  double endBeat = 0;
  /** The span's length in bars, counted across any meter changes it crosses. */
  double bars = 0;
  /** Onsets read, folding onsets within 0.05 beat of one another into one. */
  std::size_t onsets = 0;
  /** Onsets per bar; 0 for a span with no bars. */
  double onsetDensity = 0;
  /** Onsets per bar of the span, one entry per bar including a part bar at either end. */
  std::vector<std::size_t> barOnsets;
  /** Onset mass by rhythmic level, indexed 0-5; sums to 1. */
  std::vector<double> onsetLevels;
  /** Onset placement within the bar, one profile per time signature the span reads under. */
  std::vector<BarPositionProfile> barPositions;
  /** Inter-onset-interval mass, binned to RHYTHM_IOI_BINS; sums to 1. */
  std::vector<double> interOnsetShares;
  /** Share of the span during which nothing sounds. */
  double restRatio = 0;
  /** Longuet-Higgins and Lee syncopation, in [0, 1]. */
  double syncopation = 0;
  /** Share of onsets further than 1/32 beat from the nearest grid slot. */
  double offGridRatio = 0;
  /** Why the line reads as it does. */
  std::string rationale;
};

/** Inter-onset intervals in quarter-note beats, at half-octave steps (`RHYTHM_IOI_BINS`). */
const std::vector<double>& rhythm_ioi_bins();

/**
 * How a line places its onsets against the meter (`analyzeRhythm`): density, metric placement,
 * interval spacing, rest, and syncopation. Notes that never sound are dropped.
 * @throws InvalidInputError if a note or an option is invalid.
 * @throws BudgetExceededError if the work exceeds the budget.
 */
RhythmAnalysis analyze_rhythm(const std::vector<NoteEvent>& notes,
                              const RhythmAnalysisOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_ANALYZE_RHYTHM_H_
