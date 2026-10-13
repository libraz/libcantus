/**
 * @file chord.h
 * @brief Internal helpers of ts/src/theory/chord/index.ts that the layers above share.
 */
#ifndef CANTUS_SRC_THEORY_CHORD_CHORD_H_
#define CANTUS_SRC_THEORY_CHORD_CHORD_H_

#include <optional>
#include <vector>

#include "cantus/theory/chord.h"

namespace cantus {

/** A chord's pitch classes as a twelve-bit mask (`chordPcMask`). */
int chord_pc_mask(const Chord& chord, const ChordPitchClassOptions& opts = {});

/** A chord's per-tone spelling hints, when they still describe its tones (`chordToneSpellings`). */
std::optional<std::vector<PitchSpelling>> chord_tone_spellings(const Chord& chord);

/** The letter distance above the root each tone spelling implies (`chordToneLetterOffsets`). */
std::optional<std::vector<int>> chord_tone_letter_offsets(const Chord& chord);

/** Which chord degree one of a chord's intervals spells (`degreeOfInterval`). */
std::optional<int> degree_of_interval(double interval, const Chord& chord);

/** What occupies a chord's third slot (`ThirdSlot`). */
struct ThirdSlot {
  enum class Kind { kThird, kSuspension, kNone };
  Kind kind = Kind::kNone;
  /** 3 or 4 for a third, 2 or 5 for a suspension; 0 for none. */
  int interval = 0;
};

/** Read what stands in a chord's third slot (`thirdSlotOf`). */
ThirdSlot third_slot_of(const Chord& chord);

/** The thirds a suspension stands in for, as pitch classes (`displacedThirds`). */
std::vector<int> displaced_thirds(const Chord& chord);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_CHORD_CHORD_H_
