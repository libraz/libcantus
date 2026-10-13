/**
 * @file suffix.h
 * @brief Internal helpers of ts/src/theory/symbol/suffix.ts: the suffix a chord symbol writes
 *        after its root.
 */
#ifndef CANTUS_SRC_THEORY_SYMBOL_SUFFIX_H_
#define CANTUS_SRC_THEORY_SYMBOL_SUFFIX_H_

#include <string>
#include <string_view>

#include "cantus/theory/chord.h"

namespace cantus {

/** The canonical lead-sheet suffix of a quality (`CANONICAL_SUFFIX`). */
std::string_view canonical_suffix(ChordQuality quality);

/** The suffix a chord's structure is written as (`specSuffix`). */
std::string spec_suffix(const ChordSpec& spec);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SYMBOL_SUFFIX_H_
