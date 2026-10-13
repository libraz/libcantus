/**
 * @file spelling.h
 * @brief Internal entry point of ts/src/analyze/spelling/index.ts beside the public API in
 *        cantus/analyze/spelling.h: the line spelling over a host that supplies the chords.
 */
#ifndef CANTUS_SRC_ANALYZE_SPELLING_SPELLING_H_
#define CANTUS_SRC_ANALYZE_SPELLING_SPELLING_H_

#include <functional>
#include <optional>
#include <vector>

#include "cantus/analyze/spelling.h"

namespace cantus {

/** The chord sounding at a beat; empty for none. It is asked once per note, in line order. */
using ChordLookup = std::function<std::optional<Chord>(double)>;

/** spell_line() with the chord under each note supplied by a lookup; empty for no timeline. */
std::vector<NoteData> spell_line_over(const std::vector<NoteEvent>& notes,
                                      const ChordLookup& chord_at, const KeyArg& key,
                                      const SpellLineOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_SPELLING_SPELLING_H_
