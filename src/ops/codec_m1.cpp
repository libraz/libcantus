#include "ops/codec_m1.h"

#include <cmath>
#include <limits>
#include <memory>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "cantus/core/errors.h"
#include "core/tempo/limits.gen.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/value.h"
#include "model/limits.gen.h"
#include "ops/codec_m2.h"
#include "ops/codec_m3.h"
#include "ops/counters.h"
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

namespace {

/** The member a hybrid's copy meets first that is a function, in the TS object's key order. */
std::string first_method_of(const json::Value& hybrid) {
  const json::Value* type = hybrid.as_object().find("$hy");
  return type != nullptr && type->is_string() && type->as_string() == "ResolvedContext"
             ? "instrument"
             : "at";
}

json::Value copy_plain_at(const json::Value& value, const std::string& name, int depth) {
  std::string kind = js::type_of(value);
  if (kind == "number") {
    assert_finite_number(value, name);
    return value;
  }
  if (kind == "function" || kind == "symbol" || kind == "bigint") {
    throw InvalidInputError(name + " must be plain data; received " + kind);
  }
  if (kind != "object" || value.is_null()) {
    return value;
  }
  if (depth >= MAX_PLAIN_DEPTH) {
    throw InvalidInputError(name + " must be plain data; received a value nested more than " +
                            js::to_string(static_cast<double>(MAX_PLAIN_DEPTH)) + " levels deep");
  }
  if (value.is_array()) {
    json::Array out;
    const json::Array& items = value.as_array();
    for (std::size_t index = 0; index < items.size(); ++index) {
      out.push_back(copy_plain_at(items[index], name + "[" + index_text(index) + "]", depth + 1));
    }
    return json::Value(std::move(out));
  }
  Tag tag = tag_of(value);
  if (tag == Tag::kHybrid) {
    throw InvalidInputError(name + "." + first_method_of(value) +
                            " must be plain data; received function");
  }
  if (tag == Tag::kToJson) {
    throw InvalidInputError(name + ".toJSON must be plain data; received function");
  }
  json::Object out;
  // A class instance and a handle keep their state out of reach of Object.entries.
  if (tag == Tag::kNone) {
    for (const json::Member& m : value.as_object()) {
      if (!is_undefined(m.value)) {
        out.set(m.key, copy_plain_at(m.value, name + "." + m.key, depth + 1));
      }
    }
  }
  return json::Value(std::move(out));
}

/** `Object.entries(value)` of an object as a reader sees it: a plain record's own fields. */
const json::Object* own_entries(const json::Value& value) {
  static const json::Object kNone;
  return value.is_object() && tag_of(value) == Tag::kNone ? &value.as_object() : &kNone;
}

}  // namespace

json::Value copy_plain(const json::Value& value, std::string_view name) {
  return copy_plain_at(value, std::string(name), 0);
}

bool same_plain(const json::Value& value, const json::Value& other) {
  if (value.is_array() || other.is_array()) {
    if (!value.is_array() || !other.is_array() ||
        value.as_array().size() != other.as_array().size()) {
      return false;
    }
    for (std::size_t index = 0; index < value.as_array().size(); ++index) {
      if (!same_plain(value.as_array()[index], other.as_array()[index])) {
        return false;
      }
    }
    return true;
  }
  if (js::type_of(value) == "object" && !value.is_null() && js::type_of(other) == "object" &&
      !other.is_null()) {
    const json::Object& mine = *own_entries(value);
    const json::Object& theirs = *own_entries(other);
    if (mine.size() != theirs.size()) {
      return false;
    }
    for (const json::Member& m : mine) {
      const json::Value* item = theirs.find(m.key);
      if (item == nullptr || !same_plain(m.value, *item)) {
        return false;
      }
    }
    return true;
  }
  return js::strict_equals(value, other);
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
  return Tempo::of(assert_range(bpm, MIN_TEMPO_BPM, MAX_TEMPO_BPM, "bpm"));
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

/** Error classes cross as `$class` values too; they are not model classes and decode to nothing. */
bool is_error_class(const std::string& name) {
  return name == "InvalidInputError" || name == "NoSolutionError" || name == "BudgetExceededError";
}

/** A Voicing instance carries its pitch array under `pitches`. */
Voicing read_voicing_pitches(const json::Value& v) { return read_voicing_data(get(v, "pitches")); }

/**
 * `Class.fromData` over one `$class` value whose nested values are decoded already; its decode,
 * or null for an error class.
 */
std::shared_ptr<const Decoded> decode_class_instance(const json::Value& v) {
  const std::string& name = v.as_object().find("$class")->as_string();
  if (is_error_class(name)) {
    return nullptr;
  }
  counters::bump(counters::class_decodes);
  std::shared_ptr<const Decoded> kept;
  if (name == "Note") {
    kept = decoded_value(read_note_data(v));
  } else if (name == "Interval") {
    kept = decoded_value(read_interval_data(v));
  } else if (name == "Duration") {
    kept = decoded_value(read_duration_data(v));
  } else if (name == "Meter") {
    kept = decoded_value(read_meter_data(v));
  } else if (name == "Tempo") {
    kept = decoded_value(read_tempo_data(v));
  } else if (name == "Tuning") {
    kept = decoded_value(read_tuning_data(v));
  } else if (name == "Instrument") {
    kept = decoded_value(read_instrument_data(v));
  } else if (name == "Voicing") {
    kept = decoded_value(read_voicing_pitches(v));
  } else if (!decode_m2_class(v, name, kept) && !decode_m3_class(v, name, kept)) {
    throw RequestError("unknown class " + js::quote(name));
  }
  return kept;
}

}  // namespace

std::shared_ptr<const Decoded> decode_class_value(const json::Value& v) {
  struct Pending {
    const json::Value* value;
    bool children_done;
  };
  std::shared_ptr<const Decoded> outermost;
  std::vector<Pending> pending{Pending{&v, false}};
  while (!pending.empty()) {
    Pending next = pending.back();
    pending.pop_back();
    if (next.children_done) {
      std::shared_ptr<const Decoded> kept = decode_class_instance(*next.value);
      if (next.value == &v) {
        outermost = std::move(kept);
      }
      continue;
    }
    // A nested snapshot decoded without error when it was retained.
    if (next.value != &v && next.value->is_shared()) {
      continue;
    }
    if (next.value->is_array()) {
      const json::Array& items = next.value->as_array();
      for (auto it = items.rbegin(); it != items.rend(); ++it) {
        pending.push_back(Pending{&*it, false});
      }
      continue;
    }
    if (!next.value->is_object()) {
      continue;
    }
    // validate() has made every `$class` tag a string.
    if (tag_of(*next.value) == Tag::kClass) {
      pending.push_back(Pending{next.value, true});
    }
    const json::Object& members = next.value->as_object();
    for (const json::Member* m = members.end(); m != members.begin();) {
      --m;
      pending.push_back(Pending{&m->value, false});
    }
  }
  return outermost;
}

void decode_class_arguments(Args& a) {
  for (std::size_t i = 0; i < a.size(); ++i) {
    if (a.retained(i) != nullptr) {
      continue;
    }
    if (std::shared_ptr<const Decoded> kept = decode_class_value(a[i])) {
      a.keep(i, std::move(kept));
    }
  }
}

Note read_note_instance(const Args& a, std::size_t i) {
  return kept_value<Note>(a, i, "Note", read_note_data);
}

Interval read_interval_instance(const Args& a, std::size_t i) {
  return kept_value<Interval>(a, i, "Interval", read_interval_data);
}

Duration read_duration_instance(const Args& a, std::size_t i) {
  return kept_value<Duration>(a, i, "Duration", read_duration_data);
}

Meter read_meter_instance(const Args& a, std::size_t i) {
  return kept_value<Meter>(a, i, "Meter", read_meter_data);
}

Tempo read_tempo_instance(const Args& a, std::size_t i) {
  return kept_value<Tempo>(a, i, "Tempo", read_tempo_data);
}

Tuning read_tuning_instance(const Args& a, std::size_t i) {
  return kept_value<Tuning>(a, i, "Tuning", read_tuning_data);
}

Instrument read_instrument_instance(const Args& a, std::size_t i) {
  return kept_value<Instrument>(a, i, "Instrument", read_instrument_data);
}

Voicing read_voicing_instance(const Args& a, std::size_t i) {
  return kept_value<Voicing>(a, i, "Voicing", read_voicing_pitches);
}

}  // namespace cantus::ops
