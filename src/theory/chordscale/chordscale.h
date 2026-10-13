/**
 * @file chordscale.h
 * @brief Internal helpers of ts/src/theory/chordscale/index.ts beside the public API.
 */
#ifndef CANTUS_SRC_THEORY_CHORDSCALE_CHORDSCALE_H_
#define CANTUS_SRC_THEORY_CHORDSCALE_CHORDSCALE_H_

#include <string_view>

namespace cantus {

/**
 * The mask of a scale a chord-scale question may be asked about (`requireChordScaleMask`).
 * @throws InvalidInputError if the name is not a built-in scale, or names a world scale.
 */
int require_chord_scale_mask(std::string_view name);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_CHORDSCALE_CHORDSCALE_H_
