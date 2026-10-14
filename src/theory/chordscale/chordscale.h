/**
 * @file chordscale.h
 * @brief Internal helpers of ts/src/theory/chordscale/index.ts beside the public API.
 */
#ifndef CANTUS_SRC_THEORY_CHORDSCALE_CHORDSCALE_H_
#define CANTUS_SRC_THEORY_CHORDSCALE_CHORDSCALE_H_

#include <string_view>

#include "cantus/theory/chord.h"

namespace cantus {

/**
 * The mask of a scale a chord-scale question may be asked about (`requireChordScaleMask`).
 * @throws InvalidInputError if the name is not a built-in scale, or names a world scale.
 */
int require_chord_scale_mask(std::string_view name);

/**
 * Whether available_tensions() weighs a scale's tones over a chord at all: the scale fits the
 * chord, or reads it as an altered dominant. Where it does not, no option is read.
 */
bool weighs_tensions(const Chord& chord, std::string_view scale_name);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_CHORDSCALE_CHORDSCALE_H_
