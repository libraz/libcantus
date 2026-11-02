/**
 * @file adjacency.h
 * @brief Internal helpers of ts/src/analyze/adjacency.ts: whether two beats are the same instant,
 *        and whether one note follows another. BEAT_EPS and HUMANIZE_ADJACENCY are in
 *        cantus/core/limits.h.
 */
#ifndef CANTUS_SRC_ANALYZE_ADJACENCY_H_
#define CANTUS_SRC_ANALYZE_ADJACENCY_H_

#include "cantus/core/limits.h"

namespace cantus {

/** Whether two beats name the same instant (`sameInstant`). */
bool same_instant(double beat, double other);

/** Whether a note ending at `prev_end` is heard as the one before `next_start` (`adjacent`). */
bool adjacent(double prev_end, double next_start);

/** Whether a note ending at `prev_end` has finished by `beat` (`hasEnded`). */
bool has_ended(double prev_end, double beat);

/** Whether a beat falls in the half-open span `[from, to)`, edges pulled in by BEAT_EPS
 * (`withinBeats`). */
bool within_beats(double beat, double from, double to);

/** A key under which beats within BEAT_EPS of one another collide (`beatKey`). */
double beat_key(double beat);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_ADJACENCY_H_
