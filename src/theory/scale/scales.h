/**
 * @file scales.h
 * @brief The unspelled scale builders of ts/src/theory/scale/scales.ts.
 */
#ifndef CANTUS_SRC_THEORY_SCALE_SCALES_H_
#define CANTUS_SRC_THEORY_SCALE_SCALES_H_

#include <string_view>

#include "cantus/core/types.h"

namespace cantus {

/** The major scale on a root pitch class (`majorScale`). */
KeyScale major_scale(double root_pc);

/** The natural-minor scale on a root pitch class (`minorScale`). */
KeyScale minor_scale(double root_pc);

/** A named scale on a root pitch class (`namedScale`); the root is read before the name. */
KeyScale named_scale(std::string_view name, double root_pc);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SCALE_SCALES_H_
