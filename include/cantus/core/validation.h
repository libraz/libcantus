/**
 * @file validation.h
 * @brief Public C++ API of ts/src/core/validation: the input guards every entry point shares.
 *
 * Each guard returns its argument unchanged when it is acceptable and throws InvalidInputError
 * (BudgetExceededError for a budget) with the TS message otherwise. Numeric guards take and
 * return `double`, so the value is checked before any narrowing to an integer type.
 */
#ifndef CANTUS_CORE_VALIDATION_H_
#define CANTUS_CORE_VALIDATION_H_

#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/meter.h"
#include "cantus/core/types.h"

namespace cantus {

/** Require a finite number (`assertFiniteNumber`). */
double assert_finite_number(double value, std::string_view name);

/** Require a safe integer in `[min, max]` (`assertInteger`). */
double assert_integer(double value, std::string_view name, double min = -9007199254740991.0,
                      double max = 9007199254740991.0);

/** Require an integer MIDI pitch in 0..127 (`assertMidiPitch`). */
double assert_midi_pitch(double value, std::string_view name = "MIDI pitch");

/** Clamp an integer MIDI pitch to 0..127 (`clampToMidi`). */
double clamp_to_midi(double value, std::string_view name = "MIDI pitch");

/** Require a degree in 1..1000 (`assertDegree`). */
double assert_degree(double value, std::string_view name = "degree");

/** Require a finite semitone offset (`assertFiniteSemitones`). */
double assert_finite_semitones(double value, std::string_view name = "semitones");

/** The notes with a positive duration (`dropSilentNotes`). */
std::vector<NoteEvent> drop_silent_notes(const std::vector<NoteEvent>& events);

/** drop_silent_notes() under the name the entry points use (`soundingNotesOnly`). */
std::vector<NoteEvent> sounding_notes_only(const std::vector<NoteEvent>& events);

/** Require one of a fixed set of names (`assertOneOf`). */
std::string_view assert_one_of(std::string_view value, const std::vector<std::string_view>& allowed,
                               std::string_view name);

/** Require a positive safe integer no greater than `max` (`assertPositiveInt`). */
double assert_positive_int(double value, std::string_view name,
                           double max = DEFAULT_GENERATION_BUDGET);

/** Require a finite number in `[min, max]` (`assertRange`). */
double assert_range(double value, double min, double max, std::string_view name);

/**
 * Reject a work estimate above the budget (`assertGenerationBudget`); an absent limit is
 * DEFAULT_GENERATION_BUDGET.
 * @throws BudgetExceededError when `estimated` exceeds the limit.
 */
double assert_generation_budget(double estimated, std::string_view name,
                                std::optional<double> limit = std::nullopt);

/** Validate a time signature, grouping included (`assertTimeSignature`). */
const TimeSignature& assert_time_signature(const TimeSignature& ts,
                                           std::string_view name = "time signature");

/** Validate a non-empty meter map in strictly increasing beat order (`assertMeterMap`). */
const MeterMap& assert_meter_map(const MeterMap& meters, std::string_view name = "meters");

/** How strictly assert_note_event() and assert_note_events() read events. */
struct NoteEventAssertOptions {
  /** Accept notes that never sound. */
  std::optional<bool> allowNonPositiveDuration;
  /** Upper bound on the event count; DEFAULT_GENERATION_BUDGET when absent. */
  std::optional<double> budget;
  /** Earliest accepted onset; -9007199254740991 when absent. */
  std::optional<double> minStartBeat;
};

/** Validate one note event (`assertNoteEvent`). */
const NoteEvent& assert_note_event(const NoteEvent& event, std::string_view name = "note event",
                                   const NoteEventAssertOptions& options = {});

/** Validate an event array and its budget (`assertNoteEvents`). */
const std::vector<NoteEvent>& assert_note_events(const std::vector<NoteEvent>& events,
                                                 std::string_view name = "note events",
                                                 const NoteEventAssertOptions& options = {});

}  // namespace cantus

#endif  // CANTUS_CORE_VALIDATION_H_
