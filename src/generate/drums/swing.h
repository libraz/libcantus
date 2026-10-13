/**
 * @file swing.h
 * @brief Internal pieces of ts/src/generate/drums/swing.ts: the swing warp of a bar's grid.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_SWING_H_
#define CANTUS_SRC_GENERATE_DRUMS_SWING_H_

#include <cstdint>

#include "cantus/generate/drums.h"

namespace cantus {

/** Grid resolution for swing quantization (`SwingResolution`). */
enum class SwingResolution : std::uint8_t { kEighth, kSixteenth };

/** Effective swing after applying the groove feel to a base amount (`effectiveSwing`). */
double effective_swing(GrooveFeel feel, double swing_amount);

/** Push an off-beat position toward its triplet placement (`quantizeSwing`). */
double quantize_swing(double start_beat, double swing, SwingResolution resolution);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_SWING_H_
