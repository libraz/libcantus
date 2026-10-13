/**
 * @file symbol.h
 * @brief Internal helpers of ts/src/theory/symbol/index.ts beside the public API.
 */
#ifndef CANTUS_SRC_THEORY_SYMBOL_SYMBOL_H_
#define CANTUS_SRC_THEORY_SYMBOL_SYMBOL_H_

#include <optional>
#include <vector>

#include "cantus/theory/chord.h"

namespace cantus {

/** The spellings a caller attaches to a chord, which transposition carries with it. */
struct ChordSpellings {
  std::optional<PitchSpelling> rootSpelling;
  std::optional<PitchSpelling> bassSpelling;
  std::optional<std::vector<PitchSpelling>> toneSpellings;
};

/**
 * Move a chord's spellings by a semitone count, keeping them writable
 * (`transposeChordSpellings`).
 * @throws InvalidInputError if a spelling is not a note or `semitones` is not finite.
 */
ChordSpellings transpose_chord_spellings(const ChordSpellings& spellings, double semitones,
                                         std::optional<bool> flats = std::nullopt);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SYMBOL_SYMBOL_H_
