/**
 * @file validate.h
 * @brief Loose twins of the ts/src/core/validation helpers, over wire values.
 *
 * Each twin reads a json::Value the way the TS helper reads the JS value it stands for: it checks
 * the kind, rejects a wrong one with the TS message (a non-number reaching a numeric guard is
 * "must be finite; received <String(value)>"), converts, and leaves the range, finiteness and
 * integrality checks to the typed twin in src/core/validation. A composite twin walks its fields
 * in the TS order, so the first failure is the one TS reports. Numeric twins return the converted
 * number; the composite ones return the typed value.
 *
 * Names are the already formatted `${name}` strings. A parameter TS defaults applies its default
 * only when the wire value is undefined (absent or `$u`), never for null; the adapters do that.
 */
#ifndef CANTUS_SRC_OPS_VALIDATE_H_
#define CANTUS_SRC_OPS_VALIDATE_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/core/validation.h"
#include "js/format.h"
#include "json/json.h"
#include "ops/args.h"

namespace cantus::ops {

/** Whether a wire value is an object to JS (`typeof v === 'object' && v !== null`). */
bool is_js_object(const json::Value& v);

/** Property `key` of a wire value (`v.key`): the field, or the undefined tag. */
const json::Value& get(const json::Value& v, std::string_view key);

/** `assertFiniteNumber`. */
double assert_finite_number(const json::Value& value, std::string_view name);

/** `assertInteger` with bounds the library supplies. */
double assert_integer(const json::Value& value, std::string_view name,
                      double min = -9007199254740991.0, double max = 9007199254740991.0);

/** `assertInteger` with bounds from the wire. */
double assert_integer(const json::Value& value, std::string_view name, const json::Value& min,
                      const json::Value& max);

/** `assertMidiPitch`. */
double assert_midi_pitch(const json::Value& value, std::string_view name = "MIDI pitch");

/** `assertPitchClass`. */
double assert_pitch_class(const json::Value& value, std::string_view name = "pitch class");

/** `clampToMidi`. */
double clamp_to_midi(const json::Value& value, std::string_view name = "MIDI pitch");

/** `assertDegree`. */
double assert_degree(const json::Value& value, std::string_view name = "degree");

/** `assertFiniteSemitones`. */
double assert_finite_semitones(const json::Value& value, std::string_view name = "semitones");

/** `dropSilentNotes`: the elements of `events` that are notes with a positive duration. */
json::Value drop_silent_notes(json::Value events);

/** `assertArray`. */
const json::Array& assert_array(const json::Value& value, std::string_view name);

/** `assertRecord`. */
const json::Value& assert_record(const json::Value& value, std::string_view name);

/** `assertOptions`: an empty object for undefined, else the record. */
const json::Value& assert_options(const json::Value& value, std::string_view name = "options");

/** `assertFlag`. */
bool assert_flag(const json::Value& value, std::string_view name);

/** `assertFunction`: the value must be a `$cb`. */
const json::Value& assert_function(const json::Value& value, std::string_view name);

/** `assertOneOf` with the allowed names from the wire. */
std::string assert_one_of(const json::Value& value, const json::Value& allowed,
                          std::string_view name);

/** `assertOneOf` with the allowed names the library supplies. */
std::string assert_one_of(const json::Value& value, const std::vector<std::string_view>& allowed,
                          std::string_view name);

/** `assertPositiveInt` with a cap the library supplies. */
double assert_positive_int(const json::Value& value, std::string_view name,
                           double max = DEFAULT_GENERATION_BUDGET);

/** `assertPositiveInt` with a cap from the wire. */
double assert_positive_int(const json::Value& value, std::string_view name, const json::Value& max);

/** `assertRange` with bounds the library supplies. */
double assert_range(const json::Value& value, double min, double max, std::string_view name);

/** `assertRange` with bounds from the wire. */
double assert_range(const json::Value& value, const json::Value& min, const json::Value& max,
                    std::string_view name);

/** `assertGenerationBudget`; an undefined `limit` is the default budget, a null one is refused. */
double assert_generation_budget(const json::Value& estimated, std::string_view name,
                                const json::Value& limit);

/** `allocateCandidateTable`; an undefined `budget` is the default one. */
std::vector<double> allocate_candidate_table(const json::Value& rows, const json::Value& columns,
                                             std::string_view name, const json::Value& budget);

/** `allocateChoiceTable`; an undefined `budget` is the default one. */
std::vector<std::int32_t> allocate_choice_table(const json::Value& rows, const json::Value& columns,
                                                std::string_view name, const json::Value& budget);

/** `assertTimeSignature`. */
TimeSignature assert_time_signature(const json::Value& ts,
                                    std::string_view name = "time signature");

/** `assertMeterMap`. */
MeterMap assert_meter_map(const json::Value& meters, std::string_view name = "meters");

/** `assertNoteEvent` with the options bag from the wire. */
NoteEvent assert_note_event(const json::Value& event, std::string_view name,
                            const json::Value& options);

/** `assertNoteEvent` with options the library supplies. */
NoteEvent assert_note_event(const json::Value& event, std::string_view name = "note event",
                            const NoteEventAssertOptions& options = {});

/** `assertNoteEvents` with the options bag from the wire. */
std::vector<NoteEvent> assert_note_events(const json::Value& events, std::string_view name,
                                          const json::Value& options);

/** `assertNoteEvents` with options the library supplies. */
std::vector<NoteEvent> assert_note_events(const json::Value& events,
                                          std::string_view name = "note events",
                                          const NoteEventAssertOptions& options = {});

/** `${name}` of argument `i`, where TS declares no default. */
inline std::string name_arg(const Args& a, std::size_t i) { return js::template_string(a[i]); }

/** `${name}` of argument `i`, or the TS default when it is undefined. */
inline std::string name_arg(const Args& a, std::size_t i, std::string_view fallback) {
  return a.undefined(i) ? std::string(fallback) : js::template_string(a[i]);
}

/** Argument `i`, or the TS default when it is undefined. */
inline json::Value arg_or(const Args& a, std::size_t i, json::Value fallback) {
  return a.undefined(i) ? std::move(fallback) : a[i];
}

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_VALIDATE_H_
