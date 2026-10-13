// Typed guards of ts/src/core/validation/index.ts.

#include "core/validation/validation.h"

#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>

#include "core/meter/internal.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "json/json.h"

namespace cantus {

namespace {

std::string num(double x) { return js::to_string(x); }

/** `describeRejected` of a number: always its `typeof`. */
std::string describe_number(double x) { return describe_rejected(json::Value(x)); }

std::size_t table_length(double rows, double columns, std::string_view name,
                         std::optional<double> budget) {
  assert_finite_number(rows, join_name(name, " rows"));
  assert_finite_number(columns, join_name(name, " columns"));
  double length = assert_generation_budget(rows * columns, name, budget);
  if (std::trunc(length) != length) {
    // `new Float64Array(2.5)`.
    throw std::range_error("Invalid typed array length: " + num(length));
  }
  return static_cast<std::size_t>(length);
}

}  // namespace

bool is_safe_integer(double value) noexcept {
  return std::isfinite(value) && std::trunc(value) == value && std::fabs(value) <= kMaxSafeInteger;
}

std::string index_text(std::size_t index) { return num(static_cast<double>(index)); }

double assert_finite_number(double value, std::string_view name) {
  if (!std::isfinite(value)) {
    throw InvalidInputError(std::string(name) + " must be finite; received " + num(value));
  }
  return value;
}

void assert_bounds(double min, double max, std::string_view name) {
  if (!std::isfinite(min) || !std::isfinite(max)) {
    throw InvalidInputError(std::string(name) + " must be bounded by finite numbers; received [" +
                            describe_number(min) + ", " + describe_number(max) + "]");
  }
}

double assert_integer(double value, std::string_view name, double min, double max) {
  assert_finite_number(value, name);
  assert_bounds(min, max, name);
  if (!is_safe_integer(value) || value < min || value > max) {
    throw InvalidInputError(std::string(name) + " must be an integer in [" + num(min) + ", " +
                            num(max) + "]; received " + num(value));
  }
  return value;
}

double assert_midi_pitch(double value, std::string_view name) {
  return assert_integer(value, name, 0, 127);
}

double assert_pitch_class(double value, std::string_view name) {
  return assert_integer(value, name, 0, 11);
}

double clamp_to_midi(double value, std::string_view name) {
  assert_integer(value, name);
  return js::min(127, js::max(0, value));
}

double assert_degree(double value, std::string_view name) {
  return assert_integer(value, name, 1, 1000);
}

double assert_finite_semitones(double value, std::string_view name) {
  return assert_finite_number(value, name);
}

std::vector<NoteEvent> drop_silent_notes(const std::vector<NoteEvent>& events) {
  std::vector<NoteEvent> out;
  for (const NoteEvent& event : events) {
    if (event.durationBeat > 0) {
      out.push_back(event);
    }
  }
  return out;
}

std::vector<NoteEvent> sounding_notes_only(const std::vector<NoteEvent>& events) {
  return drop_silent_notes(events);
}

std::string_view assert_one_of(std::string_view value, const std::vector<std::string_view>& allowed,
                               std::string_view name) {
  for (std::string_view candidate : allowed) {
    if (candidate == value) {
      return value;
    }
  }
  std::string names;
  for (std::size_t i = 0; i < allowed.size(); ++i) {
    if (i > 0) {
      names += ", ";
    }
    names += allowed[i];
  }
  throw InvalidInputError(std::string(name) + " must be one of " + names + "; received " +
                          describe_rejected(json::Value(value)));
}

double assert_positive_int(double value, std::string_view name, double max) {
  return assert_integer(value, name, 1, max);
}

double assert_range(double value, double min, double max, std::string_view name) {
  assert_finite_number(value, name);
  assert_bounds(min, max, name);
  if (value < min || value > max) {
    throw InvalidInputError(std::string(name) + " must be in [" + num(min) + ", " + num(max) +
                            "]; received " + num(value));
  }
  return value;
}

double assert_generation_budget(double estimated, std::string_view name,
                                std::optional<double> limit) {
  double cap = limit ? *limit : static_cast<double>(DEFAULT_GENERATION_BUDGET);
  assert_finite_number(estimated, name);
  assert_positive_int(cap, join_name(name, " limit"), kMaxSafeInteger);
  if (estimated < 0) {
    throw InvalidInputError(std::string(name) + " must not be negative; received " +
                            num(estimated));
  }
  if (estimated > cap) {
    throw BudgetExceededError(std::string(name) + " exceeds the generation budget " + num(cap) +
                              "; received " + num(estimated));
  }
  return estimated;
}

std::vector<double> allocate_candidate_table(double rows, double columns, std::string_view name,
                                             std::optional<double> budget) {
  return std::vector<double>(table_length(rows, columns, name, budget), 0.0);
}

std::vector<std::int32_t> allocate_choice_table(double rows, double columns, std::string_view name,
                                                std::optional<double> budget) {
  return std::vector<std::int32_t>(table_length(rows, columns, name, budget), 0);
}

void assert_grouping_sum(double numerator, double sum, std::string_view name) {
  // A compound numerator accepts its dotted pulses (9/8 as [1, 1, 1]) or its units (9/8 as
  // [2, 2, 2, 3]).
  double pulses = is_compound_numerator(numerator) ? numerator / 3 : numerator;
  if (sum != pulses && sum != numerator) {
    std::string accepted = pulses == numerator
                               ? num(pulses)
                               : num(pulses) + " (pulses) or " + num(numerator) + " (units)";
    throw InvalidInputError(std::string(name) + ".grouping must sum to " + accepted +
                            "; received " + num(sum));
  }
}

const TimeSignature& assert_time_signature(const TimeSignature& ts, std::string_view name) {
  assert_positive_int(ts.numerator, join_name(name, ".numerator"));
  assert_positive_int(ts.denominator, join_name(name, ".denominator"));
  if (ts.grouping) {
    if (ts.grouping->empty()) {
      throw InvalidInputError(std::string(name) + ".grouping must not be empty");
    }
    double sum = 0;
    for (std::size_t i = 0; i < ts.grouping->size(); ++i) {
      sum += assert_positive_int((*ts.grouping)[i],
                                 std::string(name) + ".grouping[" + index_text(i) + "]");
    }
    assert_grouping_sum(ts.numerator, sum, name);
  }
  return ts;
}

const MeterMap& assert_meter_map(const MeterMap& meters, std::string_view name) {
  if (meters.empty()) {
    throw InvalidInputError(std::string(name) + " must not be empty");
  }
  assert_generation_budget(static_cast<double>(meters.size()), join_name(name, " count"),
                           MAX_METER_CHANGES);
  double previous = -std::numeric_limits<double>::infinity();
  for (std::size_t i = 0; i < meters.size(); ++i) {
    std::string at = std::string(name) + "[" + index_text(i) + "]";
    const MeterChange& entry = meters[i];
    assert_finite_number(entry.startBeat, at + ".startBeat");
    if (i > 0 && entry.startBeat <= previous) {
      throw InvalidInputError(at + ".startBeat must be greater than " + num(previous) +
                              "; received " + num(entry.startBeat));
    }
    previous = entry.startBeat;
    assert_time_signature(entry.ts, at + ".ts");
  }
  return meters;
}

const NoteEvent& assert_note_event(const NoteEvent& event, std::string_view name,
                                   const NoteEventAssertOptions& options) {
  assert_midi_pitch(event.pitch, join_name(name, ".pitch"));
  double min_start_beat = options.minStartBeat.value_or(-kMaxSafeInteger);
  assert_finite_number(min_start_beat, "minStartBeat");
  assert_range(event.startBeat, min_start_beat, kMaxSafeInteger, join_name(name, ".startBeat"));
  // Positivity first, so a zero-length note reads as such rather than as a range.
  std::string duration_name = join_name(name, ".durationBeat");
  assert_finite_number(event.durationBeat, duration_name);
  if (!options.allowNonPositiveDuration.value_or(false) && event.durationBeat <= 0) {
    throw InvalidInputError(duration_name + " must be positive; received " +
                            num(event.durationBeat));
  }
  assert_range(event.durationBeat, -kMaxSafeInteger, kMaxSafeInteger, duration_name);
  if (event.velocity) {
    assert_integer(*event.velocity, join_name(name, ".velocity"), 0, 127);
  }
  return event;
}

const std::vector<NoteEvent>& assert_note_events(const std::vector<NoteEvent>& events,
                                                 std::string_view name,
                                                 const NoteEventAssertOptions& options) {
  assert_generation_budget(static_cast<double>(events.size()), join_name(name, " count"),
                           options.budget);
  for (std::size_t i = 0; i < events.size(); ++i) {
    assert_note_event(events[i], std::string(name) + "[" + index_text(i) + "]", options);
  }
  return events;
}

std::string describe_rejected(const json::Value& v) {
  if (v.is_null()) {
    return "null";
  }
  if (!v.is_string()) {
    return js::type_of(v);
  }
  const std::string& s = v.as_string();
  std::size_t length = js::utf16_length(s);
  if (length <= MAX_ECHOED_LENGTH) {
    return js::quote(s);
  }
  return js::quote(js::utf16_slice(s, 0, static_cast<double>(MAX_ECHOED_LENGTH))) +
         " (truncated from " + js::to_string(static_cast<double>(length)) + " characters)";
}

}  // namespace cantus
