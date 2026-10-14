#include "ops/codec_m1.h"

#include <cmath>
#include <limits>
#include <string>
#include <utility>
#include <variant>

#include "cantus/core/errors.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/value.h"
#include "model/limits.gen.h"
#include "ops/codec_m2.h"
#include "ops/error_map.h"
#include "ops/validate.h"

namespace cantus {

namespace {

/** `{"$class": name, ...fields}`: the tag goes first, as the TS backend writes it. */
json::Value with_class(std::string_view name, const json::Value& fields) {
  json::Object o;
  o.set("$class", std::string(name));
  for (const json::Member& m : fields.as_object()) {
    o.set(m.key, m.value);
  }
  return json::Value(std::move(o));
}

}  // namespace

json::Value to_json(const Note& note) { return with_class("Note", ops::to_json(note.data())); }

json::Value to_json(const Interval& interval) {
  return with_class("Interval", ops::to_json(interval.data()));
}

json::Value to_json(const Duration& duration) {
  return with_class("Duration", ops::to_json(duration.data()));
}

json::Value to_json(const Meter& meter) { return with_class("Meter", ops::to_json(meter.data())); }

json::Value to_json(const Tempo& tempo) { return with_class("Tempo", ops::to_json(tempo.data())); }

json::Value to_json(const Tuning& tuning) {
  return with_class("Tuning", ops::to_json(tuning.data()));
}

json::Value to_json(const Instrument& instrument) {
  return with_class("Instrument", ops::instrument_data_json(instrument.data()));
}

json::Value to_json(const Voicing& voicing) {
  json::Object o;
  o.set("pitches", ops::to_json(voicing.pitches()));
  return with_class("Voicing", json::Value(std::move(o)));
}

}  // namespace cantus

namespace cantus::ops {

namespace {

/** `Number.MIN_VALUE` and `Number.MAX_VALUE`. */
constexpr double kMinValue = std::numeric_limits<double>::denorm_min();
constexpr double kMaxValue = std::numeric_limits<double>::max();

/** How a value that failed a shape check is named in the error explaining it. */
std::string describe_shape(const json::Value& value) {
  if (value.is_null()) {
    return "null";
  }
  return value.is_array() ? "an array" : js::type_of(value);
}

/** Whether a value carries the fields any of the key forms is read through. */
bool is_key_shaped(const json::Value& value) {
  if (!is_js_object(value) || value.is_array()) {
    return false;
  }
  // A class instance and a `toJSON` carrier have a `toJSON`; a plain record is read by its fields.
  Tag tag = tag_of(value);
  if (tag == Tag::kClass || tag == Tag::kToJson) {
    return true;
  }
  if (!value.is_object() || tag != Tag::kNone) {
    return false;
  }
  const json::Object& o = value.as_object();
  return o.contains("scale") || o.contains("toJSON") ||
         (o.contains("rootPc") && o.contains("modeMask12"));
}

}  // namespace

json::Value instrument_data_json(const InstrumentProfile& profile) {
  json::Object o;
  auto common = [&o](const auto& p) {
    o.set("kind", std::string(p.kind));
    o.set("name", p.name);
    o.set("articulations", to_json(p.articulations));
    o.set("polyphony", to_json(p.polyphony));
  };
  if (const auto* stringed = std::get_if<StringedProfile>(&profile)) {
    common(*stringed);
    o.set("tuning", to_json(stringed->tuning));
    o.set("frets", to_json(stringed->frets));
    o.set("maxStretch", to_json(stringed->maxStretch));
    if (stringed->fretless) {
      o.set("fretless", to_json(*stringed->fretless));
    }
  } else {
    const auto& kit = std::get<PercussionProfile>(profile);
    common(kit);
    o.set("limbs", to_json(kit.limbs));
    json::Object reach;
    for (const auto& [pitch, limbs] : kit.reach) {
      reach.set(js::to_string(pitch), to_json(limbs));
    }
    o.set("reach", json::Value(std::move(reach)));
    if (kit.overdub) {
      o.set("overdub", to_json(*kit.overdub));
    }
  }
  return json::Value(std::move(o));
}

void restore_signed_zero(json::Value& result, const json::Value& source) {
  if (result.is_number()) {
    if (result.as_number() == 0 && !std::signbit(result.as_number())) {
      std::optional<double> written = number_of(source);
      if (written && *written == 0 && std::signbit(*written)) {
        result = json::Value(*written);
      }
    }
    return;
  }
  if (result.is_array() && source.is_array()) {
    json::Array& items = result.as_array();
    const json::Array& written = source.as_array();
    for (std::size_t i = 0; i < items.size() && i < written.size(); ++i) {
      restore_signed_zero(items[i], written[i]);
    }
    return;
  }
  if (result.is_object() && source.is_object()) {
    json::Object& members = result.as_object();
    std::vector<std::string> keys;
    for (const json::Member& m : members) {
      keys.push_back(m.key);
    }
    for (const std::string& key : keys) {
      if (const json::Value* written = source.as_object().find(key)) {
        restore_signed_zero(*members.find(key), *written);
      }
    }
  }
}

//--------------------------------------------------------------------------------------------
// shared.ts

const json::Value& assert_data_object(const json::Value& value, std::string_view name) {
  if (!is_js_object(value) || value.is_array()) {
    throw InvalidInputError(std::string(name) + " must be an object; received " +
                            describe_shape(value));
  }
  return value;
}

const json::Array& assert_data_array(const json::Value& value, std::string_view name) {
  if (!value.is_array()) {
    throw InvalidInputError(std::string(name) + " must be an array; received " +
                            describe_shape(value));
  }
  return value.as_array();
}

void assert_key_argument(const json::Value& value, std::string_view name) {
  if (is_undefined(value) || value.is_string() || is_key_shaped(value)) {
    return;
  }
  std::string received = value.is_null()                  ? "null"
                         : js::type_of(value) == "object" ? "an object"
                                                          : "a " + js::type_of(value);
  throw InvalidInputError(
      std::string(name) + " must be a Key; received " + received +
      ". A method that also takes options takes them after the key, not in its place");
}

const json::Array& assert_data_objects(const json::Value& value, std::string_view name) {
  const json::Array& items = assert_data_array(value, name);
  for (std::size_t index = 0; index < items.size(); ++index) {
    assert_data_object(items[index], std::string(name) + "[" + index_text(index) + "]");
  }
  return items;
}

std::vector<NoteEvent> assert_note_event_array(const json::Value& notes, std::string_view name,
                                               const NoteEventAssertOptions& options) {
  assert_data_array(notes, name);
  return assert_note_events(notes, name, options);
}

//--------------------------------------------------------------------------------------------
// Factory data

Note read_note_data(const json::Value& value) {
  const json::Value& data = assert_data_object(value, "note data");
  const json::Value& letter = get(data, "letter");
  std::optional<double> number = number_of(letter);
  if (!number || !std::isfinite(*number) || std::trunc(*number) != *number || *number < 0 ||
      *number > 6) {
    throw InvalidInputError("note letter must be an integer in [0, 6]; received " +
                            js::template_string(letter));
  }
  // The alteration and octave bounds are the core pitch functions' own.
  return Note(read_note(data, "note"));
}

Interval read_interval_data(const json::Value& data) {
  SpelledInterval checked = read_interval_like(data);
  // The direction is kept as written, so it is held to a boolean before the instance keeps it.
  if (is_js_object(data)) {
    const json::Value& descending = get(like_target(data), "descending");
    if (!is_undefined(descending) && !descending.is_bool()) {
      throw InvalidInputError("interval.descending must be a boolean; received " +
                              describe_rejected(descending));
    }
  }
  return Interval::from_data(checked);
}

Duration read_duration_data(const json::Value& data) {
  return Duration::from_data(read_duration(data, "duration"));
}

Meter read_meter_data(const json::Value& data) {
  assert_data_object(data, "time signature");
  return Meter::from_data(assert_time_signature(data, "time signature"));
}

Tempo read_tempo_bpm(const json::Value& bpm) {
  return Tempo::of(assert_range(bpm, MIN_MODEL_BPM, MAX_MODEL_BPM, "bpm"));
}

Tempo read_tempo_data(const json::Value& data) {
  return read_tempo_bpm(get(assert_data_object(data, "tempo data"), "bpm"));
}

Tuning read_tuning_data(const json::Value& table) {
  const json::Value& given = assert_data_object(table, "tuning table");
  // Every field is checked before edo() is handed it: a missing one must not take its default.
  assert_finite_number(get(given, "divisions"), "tuning table.divisions");
  assert_finite_number(get(given, "refFreq"), "tuning table.refFreq");
  assert_finite_number(get(given, "refStep"), "tuning table.refStep");
  auto divisions = static_cast<int>(assert_positive_int(get(given, "divisions"), "EDO divisions"));
  double ref_freq =
      assert_range(get(given, "refFreq"), kMinValue, kMaxValue, "reference frequency");
  double ref_step = assert_finite_number(get(given, "refStep"), "reference step");
  return Tuning::edo(divisions, ref_freq, ref_step);
}

Instrument read_instrument_data(const json::Value& profile) {
  return Instrument::of(read_instrument_profile(profile, "instrument"));
}

Voicing read_voicing_data(const json::Value& pitches) {
  const json::Array& given = assert_data_array(pitches, "voicing pitches");
  if (given.empty()) {
    throw InvalidInputError("a voicing must contain at least one pitch");
  }
  std::vector<double> checked;
  for (std::size_t index = 0; index < given.size(); ++index) {
    checked.push_back(assert_midi_pitch(given[index], "pitches[" + index_text(index) + "]"));
  }
  return Voicing::from_data(checked);
}

//--------------------------------------------------------------------------------------------
// Class instances

const json::Value& class_instance(const Args& a, std::size_t i, std::string_view name) {
  const json::Value& v = a[i];
  const json::Value* tag = tag_of(v) == Tag::kClass ? v.as_object().find("$class") : nullptr;
  if (tag == nullptr || !tag->is_string() || tag->as_string() != name) {
    throw RequestError("expected a " + js::quote(name) + " instance");
  }
  return v;
}

namespace {

void decode_class_value(const json::Value& v) {
  if (v.is_array()) {
    for (const json::Value& element : v.as_array()) {
      decode_class_value(element);
    }
    return;
  }
  if (!v.is_object()) {
    return;
  }
  for (const json::Member& member : v.as_object()) {
    decode_class_value(member.value);
  }
  if (tag_of(v) != Tag::kClass) {
    return;
  }
  const json::Value* tag = v.as_object().find("$class");
  if (!tag->is_string()) {
    return;
  }
  const std::string& name = tag->as_string();
  if (name == "Note") {
    read_note_data(v);
  } else if (name == "Interval") {
    read_interval_data(v);
  } else if (name == "Duration") {
    read_duration_data(v);
  } else if (name == "Meter") {
    read_meter_data(v);
  } else if (name == "Tempo") {
    read_tempo_data(v);
  } else if (name == "Tuning") {
    read_tuning_data(v);
  } else if (name == "Instrument") {
    read_instrument_data(v);
  } else if (name == "Voicing") {
    read_voicing_data(get(v, "pitches"));
  } else {
    decode_m2_class(v, name);
  }
}

}  // namespace

void decode_class_arguments(const json::Array& args) {
  for (const json::Value& arg : args) {
    decode_class_value(arg);
  }
}

Note read_note_instance(const Args& a, std::size_t i) {
  return read_note_data(class_instance(a, i, "Note"));
}

Interval read_interval_instance(const Args& a, std::size_t i) {
  return read_interval_data(class_instance(a, i, "Interval"));
}

Duration read_duration_instance(const Args& a, std::size_t i) {
  return read_duration_data(class_instance(a, i, "Duration"));
}

Meter read_meter_instance(const Args& a, std::size_t i) {
  return read_meter_data(class_instance(a, i, "Meter"));
}

Tempo read_tempo_instance(const Args& a, std::size_t i) {
  return read_tempo_data(class_instance(a, i, "Tempo"));
}

Tuning read_tuning_instance(const Args& a, std::size_t i) {
  return read_tuning_data(class_instance(a, i, "Tuning"));
}

Instrument read_instrument_instance(const Args& a, std::size_t i) {
  return read_instrument_data(class_instance(a, i, "Instrument"));
}

Voicing read_voicing_instance(const Args& a, std::size_t i) {
  return read_voicing_data(get(class_instance(a, i, "Voicing"), "pitches"));
}

}  // namespace cantus::ops
