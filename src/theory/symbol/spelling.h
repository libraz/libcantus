/**
 * @file spelling.h
 * @brief Internal helpers of ts/src/theory/symbol/spelling.ts: how a chord symbol writes a pitch,
 *        and which spellings a chart takes.
 *
 * A spelling hint of a chord is validated where it is first read, as noteToPitchClass does, and
 * from then on is a NoteData with no octave.
 */
#ifndef CANTUS_SRC_THEORY_SYMBOL_SPELLING_H_
#define CANTUS_SRC_THEORY_SYMBOL_SPELLING_H_

#include <functional>
#include <optional>
#include <string>

#include "cantus/core/pitch.h"
#include "cantus/theory/chord.h"

namespace cantus {

/** A hint as a validated note: `assertNote(hint, 'note')`. */
NoteData spelling_note(const PitchSpelling& spelling);

/** Drop the octave from a note, leaving the spelling alone (`bareSpelling`). */
PitchSpelling bare_spelling(const NoteData& note);

/** A pitch class named from the table, on the side asked for (`plainSpelling`). */
NoteData plain_spelling(int pc, bool as_flat);

/** A root or bass written the way a chord symbol writes it (`symbolName`). */
std::string symbol_name(const NoteData& note, NoteNameSystem system);

/** Whether a spelling is one a chart writes for a root or a slash bass (`isWrittenSpelling`). */
bool is_written_spelling(const NoteData& spelling);

/** Name a pitch class, preferring a hint that still names it (`pitchClassName`). */
std::string pitch_class_name(int pc, const std::optional<NoteData>& hint, NoteNameSystem system,
                             std::optional<bool> flats = std::nullopt,
                             std::optional<bool> inherit_flats = std::nullopt);

/** Whether a spelling sits on the side of the staff the caller asked for (`onAccidentalSide`). */
bool on_accidental_side(const NoteData& spelling, std::optional<bool> flats);

/** Move a spelling by the step that carries `from` to `to` (`bySameStep`). */
NoteData by_same_step(const NoteData& spelling, const NoteData& from, const NoteData& to);

/** The spelling `letters` letters above `root` that sounds `pc` (`spellingAbove`). */
NoteData spelling_above(const NoteData& root, double letters, int pc);

/** A slash bass carried by the root's own step, kept to what a chart writes (`carriedBass`). */
NoteData carried_bass(const NoteData& spelling, const NoteData& from, const NoteData& to,
                      bool as_flat, const std::function<bool(const NoteData&)>& is_own_spelling);

/** A spelling hint, or nullopt when it no longer names `pc` (`hintFor`). */
std::optional<NoteData> hint_for(const std::optional<PitchSpelling>& hint, int pc);

/** The spelling a symbol writes its root in (`rootSpellingFor`). */
NoteData root_spelling_for(int pc, const std::optional<NoteData>& hint, std::optional<bool> flats);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SYMBOL_SPELLING_H_
