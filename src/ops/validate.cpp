#include "ops/validate.h"

#include <cmath>
#include <limits>
#include <string>
#include <utility>

#include "core/instrument/articulation.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec.h"

namespace cantus::ops {

namespace {

std::string str(std::string_view s) { return std::string(s); }

/** A wire number, or a non-number rejected the way `Number.isFinite` rejects it. */
double number_or_reject(const json::Value& value, std::string_view name) {
  std::optional<double> n = number_of(value);
  if (!n) {
    throw InvalidInputError(str(name) + " must be finite; received " + js::template_string(value));
  }
  return *n;
}

bool is_finite_number(const json::Value& v) {
  std::optional<double> n = number_of(v);
  return n && std::isfinite(*n);
}

/** `assertBounds` over wire bounds; on success both are finite numbers. */
void assert_bounds(const json::Value& min, const json::Value& max, std::string_view name) {
  if (!is_finite_number(min) || !is_finite_number(max)) {
    throw InvalidInputError(str(name) + " must be bounded by finite numbers; received [" +
                            describe_rejected(min) + ", " + describe_rejected(max) + "]");
  }
}

json::Value to_wire(const NoteEventAssertOptions& options) {
  json::Object o;
  if (options.allowNonPositiveDuration) {
    o.set("allowNonPositiveDuration", *options.allowNonPositiveDuration);
  }
  if (options.budget) {
    o.set("budget", *options.budget);
  }
  if (options.minStartBeat) {
    o.set("minStartBeat", *options.minStartBeat);
  }
  return json::Value(std::move(o));
}

/** `names.join(', ')`: null and undefined elements are empty. */
std::string join_names(const json::Array& names) {
  std::string out;
  for (std::size_t i = 0; i < names.size(); ++i) {
    if (i > 0) {
      out += ", ";
    }
    if (!names[i].is_null() && !is_undefined(names[i])) {
      out += js::template_string(names[i]);
    }
  }
  return out;
}

}  // namespace

bool is_js_object(const json::Value& v) { return !v.is_null() && js::type_of(v) == "object"; }

const json::Value& get(const json::Value& v, std::string_view key) {
  const json::Value* f = field(v, key);
  return f == nullptr ? undefined_value() : *f;
}

double assert_finite_number(const json::Value& value, std::string_view name) {
  return cantus::assert_finite_number(number_or_reject(value, name), name);
}

double assert_integer(const json::Value& value, std::string_view name, double min, double max) {
  return cantus::assert_integer(assert_finite_number(value, name), name, min, max);
}

double assert_integer(const json::Value& value, std::string_view name, const json::Value& min,
                      const json::Value& max) {
  double v = assert_finite_number(value, name);
  assert_bounds(min, max, name);
  return cantus::assert_integer(v, name, *number_of(min), *number_of(max));
}

double assert_midi_pitch(const json::Value& value, std::string_view name) {
  return assert_integer(value, name, 0, 127);
}

double assert_pitch_class(const json::Value& value, std::string_view name) {
  return assert_integer(value, name, 0, 11);
}

double clamp_to_midi(const json::Value& value, std::string_view name) {
  return cantus::clamp_to_midi(assert_integer(value, name), name);
}

double assert_degree(const json::Value& value, std::string_view name) {
  return assert_integer(value, name, 1, 1000);
}

double assert_finite_semitones(const json::Value& value, std::string_view name) {
  return assert_finite_number(value, name);
}

json::Value drop_silent_notes(json::Value events) {
  assert_array(events, "events");
  json::Array kept;
  for (json::Value& event : events.as_array()) {
    // `event.durationBeat > 0`: a primitive has no such property, and the comparison coerces.
    const json::Value* duration = field(event, "durationBeat");
    if (duration != nullptr && js::to_number(*duration) > 0) {
      kept.push_back(std::move(event));
    }
  }
  return json::Value(std::move(kept));
}

const json::Array& assert_array(const json::Value& value, std::string_view name) {
  if (!value.is_array()) {
    throw InvalidInputError(str(name) + " must be an array; received " + describe_rejected(value));
  }
  return value.as_array();
}

const json::Value& assert_record(const json::Value& value, std::string_view name) {
  if (!is_js_object(value) || value.is_array()) {
    throw InvalidInputError(str(name) + " must be an object; received " + describe_rejected(value));
  }
  return value;
}

const json::Value& assert_options(const json::Value& value, std::string_view name) {
  static const json::Value kEmpty{json::Object()};
  return is_undefined(value) ? kEmpty : assert_record(value, name);
}

bool assert_flag(const json::Value& value, std::string_view name) {
  if (!value.is_bool()) {
    throw InvalidInputError(str(name) + " must be a boolean; received " + describe_rejected(value));
  }
  return value.as_bool();
}

const json::Value& assert_function(const json::Value& value, std::string_view name) {
  if (js::type_of(value) != "function") {
    throw InvalidInputError(str(name) + " must be a function; received " +
                            describe_rejected(value));
  }
  return value;
}

std::string assert_one_of(const json::Value& value, const json::Value& allowed,
                          std::string_view name) {
  // The allowed set is checked as a list before the membership test and the message walk it.
  const json::Array& names = assert_array(allowed, str(name) + " allowed values");
  if (value.is_string()) {
    for (const json::Value& candidate : names) {
      if (candidate.is_string() && candidate.as_string() == value.as_string()) {
        return value.as_string();
      }
    }
  }
  throw InvalidInputError(str(name) + " must be one of " + join_names(names) + "; received " +
                          describe_rejected(value));
}

std::string assert_one_of(const json::Value& value, const std::vector<std::string_view>& allowed,
                          std::string_view name) {
  if (!value.is_string()) {
    json::Array names;
    for (std::string_view n : allowed) {
      names.emplace_back(n);
    }
    throw InvalidInputError(str(name) + " must be one of " + join_names(names) + "; received " +
                            describe_rejected(value));
  }
  return std::string(cantus::assert_one_of(value.as_string(), allowed, name));
}

double assert_positive_int(const json::Value& value, std::string_view name, double max) {
  return assert_integer(value, name, 1, max);
}

double assert_positive_int(const json::Value& value, std::string_view name,
                           const json::Value& max) {
  return assert_integer(value, name, json::Value(1), max);
}

double assert_range(const json::Value& value, double min, double max, std::string_view name) {
  return cantus::assert_range(assert_finite_number(value, name), min, max, name);
}

double assert_range_option(const json::Value& opts, std::string_view key, double fallback,
                           double min, double max, std::string_view name) {
  const json::Value* given = opt_null_default(opts, key);
  return assert_range(given != nullptr ? *given : json::Value(fallback), min, max, name);
}

double assert_range(const json::Value& value, const json::Value& min, const json::Value& max,
                    std::string_view name) {
  double v = assert_finite_number(value, name);
  assert_bounds(min, max, name);
  return cantus::assert_range(v, *number_of(min), *number_of(max), name);
}

double assert_generation_budget(const json::Value& estimated, std::string_view name,
                                const json::Value& limit) {
  // Only an omitted limit means the default one; a null is checked, and refused.
  double e = assert_finite_number(estimated, name);
  std::optional<double> cap;
  if (!is_undefined(limit)) {
    cap = assert_positive_int(limit, join_name(name, " limit"), kMaxSafeInteger);
  }
  return cantus::assert_generation_budget(e, name, cap);
}

namespace {

/** `assertTableSize`: the length of a `rows × columns` table charged against `budget`. */
std::optional<double> checked_table_budget(const json::Value& rows, const json::Value& columns,
                                           std::string_view name, const json::Value& budget,
                                           double& r, double& c) {
  r = assert_finite_number(rows, join_name(name, " rows"));
  c = assert_finite_number(columns, join_name(name, " columns"));
  cantus::assert_finite_number(r * c, name);
  if (is_undefined(budget)) {
    return std::nullopt;
  }
  return assert_positive_int(budget, join_name(name, " limit"), kMaxSafeInteger);
}

}  // namespace

std::vector<double> allocate_candidate_table(const json::Value& rows, const json::Value& columns,
                                             std::string_view name, const json::Value& budget) {
  double r = 0;
  double c = 0;
  std::optional<double> cap = checked_table_budget(rows, columns, name, budget, r, c);
  return cantus::allocate_candidate_table(r, c, name, cap);
}

std::vector<std::int32_t> allocate_choice_table(const json::Value& rows, const json::Value& columns,
                                                std::string_view name, const json::Value& budget) {
  double r = 0;
  double c = 0;
  std::optional<double> cap = checked_table_budget(rows, columns, name, budget, r, c);
  return cantus::allocate_choice_table(r, c, name, cap);
}

TimeSignature assert_time_signature(const json::Value& ts, std::string_view name) {
  // The shape is checked before any field is read.
  if (!is_js_object(ts)) {
    throw InvalidInputError(str(name) + " must be a time signature; received " +
                            describe_rejected(ts));
  }
  double numerator = assert_positive_int(get(ts, "numerator"), join_name(name, ".numerator"));
  double denominator = assert_positive_int(get(ts, "denominator"), join_name(name, ".denominator"));
  TimeSignature out{static_cast<int>(numerator), static_cast<int>(denominator), std::nullopt};
  const json::Value& grouping = get(ts, "grouping");
  if (!is_undefined(grouping)) {
    if (!grouping.is_array()) {
      throw InvalidInputError(str(name) + ".grouping must be an array of group lengths; received " +
                              describe_rejected(grouping));
    }
    const json::Array& groups = grouping.as_array();
    if (groups.empty()) {
      throw InvalidInputError(str(name) + ".grouping must not be empty");
    }
    double sum = 0;
    std::vector<int> lengths;
    for (std::size_t i = 0; i < groups.size(); ++i) {
      // `ts.grouping[index] ?? Number.NaN`
      const json::Value& g =
          groups[i].is_null() || is_undefined(groups[i]) ? json::Value(std::nan("")) : groups[i];
      double length = assert_positive_int(g, str(name) + ".grouping[" + index_text(i) + "]");
      sum += length;
      lengths.push_back(static_cast<int>(length));
    }
    assert_grouping_sum(numerator, sum, name);
    out.grouping = std::move(lengths);
  }
  return out;
}

MeterMap assert_meter_map(const json::Value& meters, std::string_view name) {
  if (!meters.is_array()) {
    throw InvalidInputError(str(name) + " must be an array; received " + js::type_of(meters));
  }
  const json::Array& entries = meters.as_array();
  if (entries.empty()) {
    throw InvalidInputError(str(name) + " must not be empty");
  }
  cantus::assert_generation_budget(static_cast<double>(entries.size()), join_name(name, " count"),
                                   MAX_METER_CHANGES);
  MeterMap out;
  out.reserve(entries.size());
  double previous = -std::numeric_limits<double>::infinity();
  for (std::size_t i = 0; i < entries.size(); ++i) {
    std::string at = str(name) + "[" + index_text(i) + "]";
    const json::Value& entry = entries[i];
    // A hole, a null and a number are refused here rather than at the first field read.
    if (!is_js_object(entry)) {
      throw InvalidInputError(at + " must be a meter change; received " + describe_rejected(entry));
    }
    double start_beat = assert_finite_number(get(entry, "startBeat"), at + ".startBeat");
    if (i > 0 && start_beat <= previous) {
      throw InvalidInputError(at + ".startBeat must be greater than " + js::to_string(previous) +
                              "; received " + js::to_string(start_beat));
    }
    previous = start_beat;
    out.push_back(MeterChange{start_beat, assert_time_signature(get(entry, "ts"), at + ".ts")});
  }
  return out;
}

NoteEvent assert_note_event(const json::Value& event, std::string_view name,
                            const json::Value& options) {
  const json::Value& asked = assert_options(options, join_name(name, " options"));
  if (!is_js_object(event)) {
    throw InvalidInputError(str(name) + " must be a note event; received " +
                            describe_rejected(event));
  }
  NoteEvent out;
  out.pitch = static_cast<int>(assert_midi_pitch(get(event, "pitch"), join_name(name, ".pitch")));
  // Onsets are unbounded below (a pickup sounds before beat 0), but the bound is finite.
  const json::Value* asked_min = opt_null_default(asked, "minStartBeat");
  double min_start_beat =
      asked_min == nullptr ? -kMaxSafeInteger : assert_finite_number(*asked_min, "minStartBeat");
  out.startBeat = assert_range(get(event, "startBeat"), min_start_beat, kMaxSafeInteger,
                               join_name(name, ".startBeat"));
  std::string duration_name = join_name(name, ".durationBeat");
  out.durationBeat = assert_finite_number(get(event, "durationBeat"), duration_name);
  if (!js::truthy(get(asked, "allowNonPositiveDuration")) && out.durationBeat <= 0) {
    throw InvalidInputError(duration_name + " must be positive; received " +
                            js::to_string(out.durationBeat));
  }
  cantus::assert_range(out.durationBeat, -kMaxSafeInteger, kMaxSafeInteger, duration_name);
  if (const json::Value* velocity = field(event, "velocity")) {
    out.velocity =
        static_cast<int>(assert_integer(*velocity, join_name(name, ".velocity"), 0, 127));
  }
  if (const json::Value* articulation = field(event, "articulation")) {
    out.articulation = parse_articulation(
        assert_one_of(*articulation, articulation_names(), join_name(name, ".articulation")));
  }
  return out;
}

NoteEvent assert_note_event(const json::Value& event, std::string_view name,
                            const NoteEventAssertOptions& options) {
  return assert_note_event(event, name, to_wire(options));
}

std::vector<NoteEvent> assert_note_events(const json::Value& events, std::string_view name,
                                          const json::Value& options) {
  const json::Value& asked = assert_options(options, join_name(name, " options"));
  if (!events.is_array()) {
    throw InvalidInputError(str(name) + " must be an array; received " + js::type_of(events));
  }
  const json::Array& entries = events.as_array();
  assert_generation_budget(json::Value(static_cast<double>(entries.size())),
                           join_name(name, " count"), get(asked, "budget"));
  std::vector<NoteEvent> out;
  out.reserve(entries.size());
  for (std::size_t i = 0; i < entries.size(); ++i) {
    std::string at = str(name) + "[" + index_text(i) + "]";
    // A hole, an explicit undefined and a null are all refused here.
    if (!is_js_object(entries[i])) {
      throw InvalidInputError(at + " must be a note event; received " +
                              describe_rejected(entries[i]));
    }
    out.push_back(assert_note_event(entries[i], at, asked));
  }
  return out;
}

std::vector<NoteEvent> assert_note_events(const json::Value& events, std::string_view name,
                                          const NoteEventAssertOptions& options) {
  return assert_note_events(events, name, to_wire(options));
}

}  // namespace cantus::ops
