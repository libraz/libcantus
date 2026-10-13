#include "ops/codec_c1.h"

#include <cmath>
#include <optional>
#include <utility>
#include <vector>

#include "core/instrument/articulation.h"
#include "core/instrument/profile.h"
#include "core/meter/meter.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/validate.h"

namespace cantus {

json::Value error_to_json(const Error& error) {
  json::Object o;
  // Every ErrorCode value is in the table.
  o.set("$class", ops::error_info(error.code())->name);
  o.set("message", error.what());
  if (const auto* no_solution = dynamic_cast<const NoSolutionError*>(&error)) {
    if (no_solution->at()) {
      o.set("at", static_cast<double>(*no_solution->at()));
    }
  }
  return json::Value(std::move(o));
}

}  // namespace cantus

namespace cantus::ops {

namespace {

std::string str(std::string_view s) { return std::string(s); }

/** The user keys of an object, unescaped, in property order; an array's are its indices. */
std::vector<std::pair<std::string, const json::Value*>> own_entries(const json::Value& v) {
  std::vector<std::pair<std::string, const json::Value*>> out;
  if (v.is_array()) {
    const json::Array& a = v.as_array();
    for (std::size_t i = 0; i < a.size(); ++i) {
      out.emplace_back(index_text(i), &a[i]);
    }
  } else if (v.is_object() && (tag_of(v) == Tag::kNone || tag_of(v) == Tag::kClass)) {
    for (const json::Member& m : v.as_object()) {
      if (m.key.size() >= 2 && m.key[0] == '$' && m.key[1] != '$') {
        continue;
      }
      if (m.key.size() == 1 && m.key[0] == '$') {
        continue;
      }
      out.emplace_back(unescape_key(m.key), &m.value);
    }
  }
  return out;
}

std::vector<Articulation> read_articulations(const json::Value& data, const std::string& name) {
  const json::Value& list = get(data, "articulations");
  if (!list.is_array()) {
    throw InvalidInputError(name + " articulations must be an array; received " +
                            describe_rejected(list));
  }
  std::vector<Articulation> out;
  const json::Array& entries = list.as_array();
  for (std::size_t i = 0; i < entries.size(); ++i) {
    out.push_back(*parse_articulation(assert_one_of(
        entries[i], articulation_names(), name + " articulations[" + index_text(i) + "]")));
  }
  return out;
}

StringedProfile read_stringed(const json::Value& data, std::string name,
                              std::vector<Articulation> articulations, int polyphony) {
  StringedProfile out;
  const json::Value& tuning = get(data, "tuning");
  if (!tuning.is_array() || tuning.as_array().empty()) {
    throw InvalidInputError(name + " must have at least one string");
  }
  const json::Array& strings = tuning.as_array();
  for (std::size_t i = 0; i < strings.size(); ++i) {
    out.tuning.push_back(
        static_cast<int>(assert_midi_pitch(strings[i], name + " tuning[" + index_text(i) + "]")));
  }
  out.frets = static_cast<int>(assert_integer(get(data, "frets"), name + " frets", 0, MAX_FRETS));
  out.maxStretch =
      static_cast<int>(assert_integer(get(data, "maxStretch"), name + " maxStretch", 0, MAX_FRETS));
  const json::Value& fretless = get(data, "fretless");
  if (fretless.is_bool()) {
    out.fretless = fretless.as_bool();
  }
  out.name = std::move(name);
  out.articulations = std::move(articulations);
  out.polyphony = polyphony;
  return out;
}

/** The limbs of a reach entry the library knows; `reach[p] ?? []`, then read as an array. */
std::vector<Limb> read_reach_entry(const json::Value& entry) {
  std::vector<Limb> out;
  if (entry.is_null() || is_undefined(entry)) {
    return out;
  }
  if (!entry.is_array()) {
    throw js::TypeError("(profile.reach[pitch] ?? []).filter is not a function");
  }
  for (const json::Value& limb : entry.as_array()) {
    if (limb.is_string()) {
      if (std::optional<Limb> l = parse_limb(limb.as_string())) {
        out.push_back(*l);
      }
    }
  }
  return out;
}

PercussionProfile read_percussion(const json::Value& data, std::string name,
                                  std::vector<Articulation> articulations, int polyphony) {
  PercussionProfile out;
  const json::Value& limbs = get(data, "limbs");
  if (!limbs.is_array() || limbs.as_array().empty()) {
    throw InvalidInputError(name + " must have at least one limb");
  }
  const json::Array& limb_list = limbs.as_array();
  for (std::size_t i = 0; i < limb_list.size(); ++i) {
    out.limbs.push_back(*parse_limb(
        assert_one_of(limb_list[i], limb_names(), name + " limbs[" + index_text(i) + "]")));
  }
  const json::Value& reach = get(data, "reach");
  if (!is_js_object(reach)) {
    throw InvalidInputError(name + " reach must be a table of limbs by voice; received " +
                            describe_rejected(reach));
  }
  std::vector<std::pair<std::string, const json::Value*>> voices = own_entries(reach);
  for (const auto& [key, entry] : voices) {
    cantus::assert_midi_pitch(js::number(key), name + " reach pitch");
  }
  // `reach[Number(key)]` reads the canonical key, so a key such as "060" adds no voice of its own.
  for (const auto& [key, entry] : voices) {
    double pitch = js::number(key);
    if (js::to_string(pitch) == key) {
      out.reach[static_cast<int>(pitch)] = read_reach_entry(*entry);
    }
  }
  bool reachable = false;
  for (const auto& [key, entry] : voices) {
    if (!reach_of(out, static_cast<int>(js::number(key))).empty()) {
      reachable = true;
      break;
    }
  }
  if (!reachable) {
    throw InvalidInputError(name + " must have at least one voice within reach");
  }
  // `profile.overdub ?? []`, iterated: a string iterates its characters.
  const json::Value& overdub = get(data, "overdub");
  if (!overdub.is_null() && !is_undefined(overdub)) {
    std::vector<int> pitches;
    if (overdub.is_array()) {
      for (const json::Value& pitch : overdub.as_array()) {
        pitches.push_back(static_cast<int>(assert_midi_pitch(pitch, name + " overdub pitch")));
      }
    } else if (overdub.is_string()) {
      if (!overdub.as_string().empty()) {
        std::u16string units = js::to_utf16(overdub.as_string());
        std::size_t length = units.size() > 1 && units[0] >= 0xD800 && units[0] <= 0xDBFF &&
                                     units[1] >= 0xDC00 && units[1] <= 0xDFFF
                                 ? 2
                                 : 1;
        assert_midi_pitch(
            json::Value(js::utf16_slice(overdub.as_string(), 0, static_cast<double>(length))),
            name + " overdub pitch");
      }
    } else {
      throw js::TypeError("profile.overdub ?? [] is not iterable");
    }
    out.overdub = std::move(pitches);
  }
  out.name = std::move(name);
  out.articulations = std::move(articulations);
  out.polyphony = polyphony;
  return out;
}

}  // namespace

void write_fields(const PercussionProfile& v, FieldWriter& w) {
  w.field("kind", v.kind);
  w.field("name", v.name);
  w.field("limbs", v.limbs);
  json::Object reach;
  for (const auto& [pitch, limbs] : v.reach) {
    reach.set(js::to_string(pitch), to_json(limbs));
  }
  w.field("reach", json::Value(std::move(reach)));
  w.field("overdub", v.overdub);
  w.field("articulations", v.articulations);
  w.field("polyphony", v.polyphony);
}

const json::Value& like_target(const json::Value& value) {
  if (tag_of(value) == Tag::kToJson) {
    return *value.as_object().find("$tojson");
  }
  return value;
}

json::Value like_data(json::Value value) {
  switch (tag_of(value)) {
    case Tag::kToJson:
      return std::move(*value.as_object().find("$tojson"));
    case Tag::kClass: {
      json::Object data;
      for (const json::Member& m : value.as_object()) {
        if (m.key != "$class") {
          data.set(m.key, m.value);
        }
      }
      return json::Value(std::move(data));
    }
    default:
      return value;
  }
}

MeterData read_meter_like(const json::Value& value, std::string_view name) {
  if (value.is_string()) {
    return read_meter_data(MeterArg(value.as_string()), name);
  }
  if (is_js_object(value)) {
    const json::Value& data = like_target(value);
    if (data.is_array()) {
      return assert_meter_map(data, name);
    }
    // A value with no numerator names no meter at all, rather than a signature missing a field.
    if (is_js_object(data) && data.as_object().contains("numerator")) {
      return assert_time_signature(data, name);
    }
  }
  throw InvalidInputError(str(name) +
                          " must be a time signature, a meter map, or a signature name; received " +
                          describe_rejected(value));
}

InstrumentProfile read_instrument_profile(const json::Value& value, std::string_view name) {
  if (!is_js_object(value)) {
    throw InvalidInputError(str(name) + " must be an instrument profile; received " +
                            js::type_of(value));
  }
  const json::Value& data = like_target(value);
  const json::Value& kind = get(data, "kind");
  bool stringed = kind.is_string() && kind.as_string() == "stringed";
  if (!stringed && !(kind.is_string() && kind.as_string() == "percussion")) {
    throw InvalidInputError(str(name) +
                            " must be a stringed or percussion profile; received kind " +
                            js::template_string(kind));
  }
  // assertProfile: every field the library goes on to read, in the TS order.
  const json::Value& profile_name = get(data, "name");
  if (!profile_name.is_string() || profile_name.as_string().empty()) {
    throw InvalidInputError("instrument name must be a non-empty string; received " +
                            describe_rejected(profile_name));
  }
  std::string pname = profile_name.as_string();
  std::vector<Articulation> articulations = read_articulations(data, pname);
  auto polyphony = static_cast<int>(
      assert_positive_int(get(data, "polyphony"), pname + " polyphony", MAX_POLYPHONY));
  if (stringed) {
    return read_stringed(data, std::move(pname), std::move(articulations), polyphony);
  }
  return read_percussion(data, std::move(pname), std::move(articulations), polyphony);
}

MeterMap resolve_wire_meters(const json::Value& opts, std::string_view name) {
  std::string label(name);
  const json::Value& bag = assert_record(opts, label + " options");
  const json::Value* ts = opt_strict(bag, "ts");
  const json::Value* meters = opt_strict(bag, "meters");
  if (ts != nullptr && meters != nullptr) {
    throw InvalidInputError(label + " and ts name the same thing; give one or the other, not both");
  }
  // A null is refused rather than defaulted, meters first.
  if (meters != nullptr && meters->is_null()) {
    throw InvalidInputError(label + " must name a meter, not null");
  }
  if (ts != nullptr && ts->is_null()) {
    throw InvalidInputError("ts must name a meter, not null");
  }
  ResolveMetersOptions resolved;
  if (meters != nullptr) {
    resolved.meters = MeterArg(read_meter_like(*meters, label));
  } else if (ts != nullptr) {
    resolved.ts = MeterArg(read_meter_like(*ts, "ts"));
  }
  return resolve_meters(resolved, label);
}

}  // namespace cantus::ops
