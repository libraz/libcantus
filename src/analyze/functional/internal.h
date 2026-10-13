/**
 * @file internal.h
 * @brief Internal helpers of ts/src/analyze/functional/internal.ts shared by the
 *        functional-harmony modules. Roots are pitch classes measured against the key tonic.
 */
#ifndef CANTUS_SRC_ANALYZE_FUNCTIONAL_INTERNAL_H_
#define CANTUS_SRC_ANALYZE_FUNCTIONAL_INTERNAL_H_

#include <vector>

#include "cantus/core/types.h"

namespace cantus {

/** Whether a scale has a minor third and no major third (`isMinorScale`). */
bool is_minor_scale(const KeyScale& key);

/** The parallel key of a scale: same tonic, opposite mode (`parallelScale`). */
KeyScale parallel_scale(const KeyScale& key);

/** Diatonic pitch class of a 1-based scale degree in a key (`degreeRootPc`). */
int degree_root_pc(double degree_number, const KeyScale& key);

/**
 * The 1-based scale degrees that already sit a semitone below their parallel major counterpart
 * (`loweredDegrees`), ascending.
 */
std::vector<int> lowered_degrees(const KeyScale& key);

/** The heptatonic frame a Roman numeral is measured against for a key (`romanReference`). */
KeyScale roman_reference(const KeyScale& key);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FUNCTIONAL_INTERNAL_H_
