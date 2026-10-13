/**
 * @file tendency.h
 * @brief Internal helpers of ts/src/theory/voicing/tendency.ts: how a chord's tones are written,
 *        so the voicing search and the part-writing checker read the same letters.
 */
#ifndef CANTUS_SRC_THEORY_VOICING_TENDENCY_H_
#define CANTUS_SRC_THEORY_VOICING_TENDENCY_H_

#include <optional>
#include <vector>

#include "cantus/core/pitch.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** One spelling per pitch class, and the MIDI pitch each sounds at octave 0 (`SpellingTable`). */
struct SpellingTable {
  /** The octave-less spelling of each pitch class 0-11. */
  std::vector<NoteData> notes;
  /** The MIDI pitch each of those spellings sounds at octave 0. */
  std::vector<double> bases;
};

/** Name every pitch class the way spell_voicing() names it under one chord (`spellingTable`). */
SpellingTable spelling_table(const KeyArg& key, const std::optional<Chord>& chord = std::nullopt);

/** The spelled note a table gives a sounding pitch, carrying its octave (`spelledAt`). */
NoteData spelled_at(const SpellingTable& table, double pitch);

/** Whether a voice moving between two sounding pitches writes an augmented interval
 * (`movesByAugmentedInterval`). */
bool moves_by_augmented_interval(const SpellingTable& from, double from_pitch,
                                 const SpellingTable& to, double to_pitch);

/** Whether a voice moving between two sounding pitches falls by a diatonic step
 * (`movesByDescendingStep`). */
bool moves_by_descending_step(const SpellingTable& from, double from_pitch, const SpellingTable& to,
                              double to_pitch);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_VOICING_TENDENCY_H_
