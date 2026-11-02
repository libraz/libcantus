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

#include <cstddef>
#include <cstdint>
#include <exception>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "json/json.h"
#include "ops/args.h"
#include "ops/codec.h"

namespace cantus::ops {

/** Whether a wire value is an object to JS (`typeof v === 'object' && v !== null`). */
bool is_js_object(const json::Value& v);

/** Property `key` of a wire value (`v.key`): the field, or the undefined tag. */
const json::Value& get(const json::Value& v, std::string_view key);

/** `assertFiniteNumber`. */
double assert_finite_number(const json::Value& value, std::string_view name);

/** `assertInteger` with bounds the library supplies. */
double assert_integer(const json::Value& value, std::string_view name,
                      double min = -kMaxSafeInteger, double max = kMaxSafeInteger);

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

/**
 * `assertOptions`: an empty object for undefined, else the record. A model-class instance is
 * handed back as the record of its members read through its getters (options_view()), since TS
 * reads an options bag field by field; that record lives until the current OptionViews ends.
 */
const json::Value& assert_options(const json::Value& value, std::string_view name = "options");

/**
 * A model-class instance or a `toJSON` carrier as the plain record of every member a reader can
 * see; anything else as it is. Defined with the class codecs (ops/codec_m2.cpp).
 */
json::Value options_view(const json::Value& value);

/**
 * An options bag TS defaults with `opts = {}` and reads without assertOptions: an empty bag for
 * undefined, a class instance as options_view() reads it, anything else as given.
 */
json::Value default_options(const Args& a, std::size_t i);

/** The records assert_options() builds for the ops run while it is alive (one per dispatch). */
class OptionViews {
 public:
  OptionViews();
  ~OptionViews();
  OptionViews(const OptionViews&) = delete;
  OptionViews& operator=(const OptionViews&) = delete;

  /** Keep `view` until this scope ends. */
  const json::Value& keep(json::Value view);

 private:
  std::vector<std::unique_ptr<json::Value>> views_;
  OptionViews* outer_;
};

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

/** `assertRange(opts.key ?? fallback, min, max, name)`: an option read with `??`, then checked. */
double assert_range_option(const json::Value& opts, std::string_view key, double fallback,
                           double min, double max, std::string_view name);

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

/** `v == null`: the null or the undefined wire value. */
inline bool is_null_or_undefined(const json::Value& v) noexcept {
  return v.is_null() || is_undefined(v);
}

/**
 * `v.key` where `v` may be null or undefined: the TypeError JS raises reading a property off
 * either, else get().
 * @throws js::TypeError for a null or undefined `v`.
 */
const json::Value& property_of(const json::Value& v, std::string_view key);

/** Reads property `key` of a value the way the caller's value model does. */
using MemberReader = json::Value (*)(const json::Value& value, std::string_view key);

/** `value.length`: the size of an array or a string (UTF-16), else the property of that name. */
json::Value length_of(const json::Value& value);

/** length_of() reading a property that is no array or string size through `member`. */
json::Value length_of(const json::Value& value, MemberReader member);

/**
 * What V8 says of a value spread or iterated that has no iterator: its type, and its text for a
 * number or a boolean ("number 5 is not iterable (cannot read property Symbol(Symbol.iterator))").
 */
std::string not_iterable_message(const json::Value& value);

/** `list[index]` of an array, a string or a record; the TypeError JS raises for null/undefined. */
json::Value element_of(const json::Value& list, std::size_t index);

/** element_of() reading a record's property through `member`. */
json::Value element_of(const json::Value& list, std::size_t index, MemberReader member);

/** `${name}` of argument `i`, where TS declares no default. */
inline std::string name_arg(const Args& a, std::size_t i) { return js::template_string(a[i]); }

/** `${name}` of argument `i`, or the TS default when it is undefined. */
inline std::string name_arg(const Args& a, std::size_t i, std::string_view fallback) {
  return a.undefined(i) ? std::string(fallback) : js::template_string(a[i]);
}

/** The stand-in with_name_arg() checks under, to tell whether a failure wrote the name. */
inline constexpr std::string_view kPendingName = "\x01name\x01";

/**
 * `check(name)` with the name of argument `i` (name_arg()), for a TS check that writes the name
 * only into a failure's message: a name that cannot be written, such as a Symbol, fails only when
 * a failure's message holds it.
 */
template <class Check>
decltype(auto) with_name_arg(const Args& a, std::size_t i, std::string_view fallback,
                             Check&& check) {
  std::optional<std::string> name;
  try {
    name = name_arg(a, i, fallback);
  } catch (const std::exception&) {
    try {
      return check(std::string(kPendingName));
    } catch (const Error& failure) {
      if (std::string_view(failure.message()).find(kPendingName) != std::string_view::npos) {
        name_arg(a, i, fallback);
      }
      throw;
    }
  }
  return check(*name);
}

/** with_name_arg() for a name TS declares no default for: `${undefined}` when it is absent. */
template <class Check>
decltype(auto) with_name_arg(const Args& a, std::size_t i, Check&& check) {
  return with_name_arg(a, i, "undefined", std::forward<Check>(check));
}

/** Argument `i`, or the TS default when it is undefined. */
inline json::Value arg_or(const Args& a, std::size_t i, const json::Value& fallback) {
  return a.undefined(i) ? fallback : a[i];
}

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_VALIDATE_H_
