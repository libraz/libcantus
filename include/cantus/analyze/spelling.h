/**
 * @file spelling.h
 * @brief Public C++ API of ts/src/analyze/spelling: name every note of a melodic line in one pass,
 *        so the spellings agree with each other.
 */
#ifndef CANTUS_ANALYZE_SPELLING_H_
#define CANTUS_ANALYZE_SPELLING_H_

#include <optional>
#include <vector>

#include "cantus/analyze/timeline.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Options of spell_line() (`SpellLineOptions`). */
struct SpellLineOptions {
  /** Tonic spelling to anchor the key; it must sound the key's own root pitch class. */
  std::optional<NoteArg> tonic;
  /** Upper bound on the work the line may cost; defaults to the generation budget. */
  std::optional<double> budget;
};

/**
 * Spell a whole melodic line at once (`spellLine`): the sounding chord, the key's scale, the shape
 * of the line and the key's chromatic convention decide, in that order. Ties fall to the spelling
 * spell_pitch_class() would have chosen alone.
 * @param notes The line, monophonic and in time order.
 * @param timeline The chords sounding under the line, or null when only the key is known.
 * @param key The key the line is written in.
 * @param opts Optional tonic spelling and work budget.
 * @returns One spelled note per input note, each carrying the octave that reproduces its pitch.
 * @throws InvalidInputError if `opts.tonic` does not sound the key's root pitch class, or a note
 *   event is malformed.
 * @throws BudgetExceededError if the line is longer than the budget allows.
 */
std::vector<NoteData> spell_line(const std::vector<NoteEvent>& notes,
                                 const Nullable<ChordTimeline>& timeline, const KeyArg& key,
                                 const SpellLineOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_ANALYZE_SPELLING_H_
