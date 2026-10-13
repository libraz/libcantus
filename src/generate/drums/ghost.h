/**
 * @file ghost.h
 * @brief Internal pieces of ts/src/generate/drums/ghost.ts: how much, where and how softly a
 *        groove ghosts its snare.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_GHOST_H_
#define CANTUS_SRC_GENERATE_DRUMS_GHOST_H_

#include <cstdint>
#include <vector>

#include "generate/drums/internal.h"

namespace cantus {

/** Ghost-note position within a beat: the "e" or the "a" (`GhostPosition`). */
enum class GhostPosition : std::uint8_t { kE, kA };

/** The draw-path name of a ghost position ("e", "a"). */
std::string_view to_string(GhostPosition position);

/** Ghost-note trigger probability for a section, mood and tempo (`getGhostDensity`). */
double get_ghost_density(MoodCategory mood, SectionType section, double bpm);

/** Ghost-note velocity multiplier for a section and metric position (`getGhostVelocity`). */
double get_ghost_velocity(SectionType section, double beat_position);

/**
 * Probability of a ghost at a sixteenth, higher where it leads into a backbeat
 * (`getGhostProbabilityAtPosition`).
 */
double get_ghost_probability_at_position(double beat, int sixteenth_in_beat,
                                         const std::vector<double>& lead_ins);

/** The ghost positions a groove favours (`selectGhostPositions`). */
std::vector<GhostPosition> select_ghost_positions(MoodCategory mood);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_GHOST_H_
