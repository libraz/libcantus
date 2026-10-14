/**
 * @file degrees.h
 * @brief Internal pieces of ts/src/generate/bass/degrees.ts: which pitch a chord degree asks for.
 */
#ifndef CANTUS_SRC_GENERATE_BASS_DEGREES_H_
#define CANTUS_SRC_GENERATE_BASS_DEGREES_H_

#include <optional>
#include <string>
#include <vector>

#include "cantus/core/types.h"
#include "cantus/theory/chord.h"

namespace cantus {

/**
 * The scale a chord's own quality implies, as semitones above its root, one per degree; absent
 * when the quality determines no seven-tone scale (`impliedScaleTones`). A chord whose quality the
 * caller wrote as `unknown_quality` is refused once it states a seventh, where TS reads its tones.
 * @throws InvalidInputError for an unknown quality.
 */
std::optional<std::vector<int>> implied_scale_tones(const Chord& chord,
                                                    const std::string* unknown_quality = nullptr);

/**
 * Semitones above the chord's root that a degree names, as a signed offset rather than a pitch
 * class (`degreeSemitone`).
 */
double degree_semitone(double degree, double alter, const Chord& chord, const KeyScale& key,
                       const std::optional<std::vector<int>>& implied);

/** The semitone a chord gives one of its own degrees, if it has that degree. */
std::optional<double> chord_degree_semitone(double degree, const Chord& chord);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_BASS_DEGREES_H_
