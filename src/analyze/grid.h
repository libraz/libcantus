/**
 * @file grid.h
 * @brief Internal helpers of ts/src/analyze/grid.ts: where a slot grid starts, the beat the music
 *        itself begins on. first_sounding_beat() lives here too: the form and reference analyses
 *        that TS reads it from in analyze/form/internal.ts share it from this header.
 */
#ifndef CANTUS_SRC_ANALYZE_GRID_H_
#define CANTUS_SRC_ANALYZE_GRID_H_

#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"

namespace cantus {

/** The grid a span is analyzed in (`GridOrigin`). */
struct GridOrigin {
  /** First beat of slot 0, a whole number of slots from beat 0. */
  double origin = 0;
  /** First beat that sounds. */
  double startBeat = 0;
};

/**
 * The earliest onset of a set of notes, or `fallback` for an empty span
 * (`firstSoundingBeat`, analyze/form/internal.ts).
 */
double first_sounding_beat(const std::vector<NoteEvent>& notes, double fallback = 0);

/**
 * The beat the latest-ending note stops sounding on, or `fallback` for an empty span
 * (`latestSoundingEnd`).
 */
double latest_sounding_end(const std::vector<NoteEvent>& notes, double fallback = 0);

/** Place the slot grid for a span whose earliest onset is `first_onset` (`gridOriginOf`). */
GridOrigin grid_origin_of(double first_onset, double slot_beats);

/** Place the slot grid for the notes themselves (`gridForNotes`). */
GridOrigin grid_for_notes(const std::vector<NoteEvent>& notes, double slot_beats);

/** First beat of a span read in bars, with the pickup rule applied (`barGridStart`). */
double bar_grid_start(double first_onset, const MeterArg& meter);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_GRID_H_
