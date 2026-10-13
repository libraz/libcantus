/**
 * @file internal.h
 * @brief Internal helpers of ts/src/analyze/melody/internal.ts: what every reading of a melody
 *        has to agree on first. Which notes sound, in what order, and what the gaps between their
 *        onsets are.
 *
 * Analyses past the ordering read a line as LineNote values, whose fields are plain numbers, so a
 * motif handed in by a caller can be read the way TS reads it, field by field.
 */
#ifndef CANTUS_SRC_ANALYZE_MELODY_INTERNAL_H_
#define CANTUS_SRC_ANALYZE_MELODY_INTERNAL_H_

#include <cstddef>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/types.h"

namespace cantus {

/**
 * The three numbers an analysis of a line reads of a note. The fields are what `note?.field ?? 0`
 * reads; the raw ones are what `note.field` reads, which differs only for a field the note lacks
 * (`NaN` in arithmetic).
 */
struct LineNote {
  double pitch = 0;
  double startBeat = 0;
  double durationBeat = 0;
  double rawPitch = 0;
  double rawStartBeat = 0;
  double rawDurationBeat = 0;
  /** "null" or "undefined" for a note that is not there, which `note.field` cannot read. */
  const char* absent = nullptr;
};

/** The notes of a line as LineNote values. */
std::vector<LineNote> line_of(const std::vector<NoteEvent>& notes);

/**
 * The indices of the sounding notes of a melody in time order, one per onset (`orderedNotes`,
 * without its validation): notes that never sound are dropped, and of notes struck together the
 * highest stands for the event.
 */
std::vector<std::size_t> ordered_indices(const std::vector<NoteEvent>& notes);

/**
 * The sounding notes of a melody in time order, one note per onset (`orderedNotes`).
 * @throws InvalidInputError if the notes are not valid note events.
 * @throws BudgetExceededError if there are more than the budget.
 */
std::vector<NoteEvent> ordered_notes(const std::vector<NoteEvent>& notes, std::string_view name,
                                     std::optional<double> budget = std::nullopt);

/** Semitones between consecutive notes (`intervalsOf`). */
std::vector<double> intervals_of(const std::vector<LineNote>& notes);

/** Onset-to-onset gaps between consecutive notes (`onsetGaps`). */
std::vector<double> onset_gaps(const std::vector<LineNote>& notes);

/** The onset gaps a line read back to front would have (`retrogradeGaps`). */
std::vector<double> retrograde_gaps(const std::vector<LineNote>& notes);

/**
 * Onset gaps as multiples of the first gap, rounded onto the comparison grid
 * (`rhythmProfile`); nullopt for a cell whose first gap is not positive.
 */
std::optional<std::vector<double>> rhythm_profile(const std::vector<double>& gaps);

/** Compare two numeric sequences elementwise (`sameNumbers`). */
bool same_numbers(const std::vector<double>& a, const std::vector<double>& b);

/** Round for display, so a rationale never carries floating-point noise (`roundTo`). */
double round_to(double value, int digits);

/**
 * Beat of the last note's end (`endBeatOf`).
 * @throws js::TypeError for a note that is absent, which TS cannot read the beats of.
 */
double end_beat_of(const std::vector<LineNote>& notes);

/** Distance from the first onset to the last (`onsetSpan`). */
double onset_span(const std::vector<LineNote>& notes);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_MELODY_INTERNAL_H_
