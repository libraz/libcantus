#include "ops/codec_a1a.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "js/format.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** Whether an option is the boolean `true` (`asked.x === true`). */
bool is_true(const json::Value& asked, std::string_view key) {
  const json::Value* value = field(asked, key);
  return value != nullptr && value->is_bool() && value->as_bool();
}

/** What V8 says of a value the destructuring of an array pattern cannot iterate. */
std::string not_iterable_message(const json::Value& value) {
  std::string type = js::type_of(value);
  std::string subject = type;
  if (type == "number" || type == "boolean") {
    subject = type + " " + js::template_string(value);
  }
  return subject + " is not iterable (cannot read property Symbol(Symbol.iterator))";
}

/** One voicing of the destructured pair: its numbers, anything else naming no pitch. */
std::vector<double> read_voicing_part(const json::Value& part) {
  std::vector<double> out;
  if (is_undefined(part) || part.is_null() || part.is_string()) {
    // `?? []`; a string iterates its characters, none of which is a finite number.
    return out;
  }
  if (!part.is_array()) {
    throw js::TypeError("voicing is not iterable");
  }
  for (const json::Value& pitch : part.as_array()) {
    std::optional<double> number = number_of(pitch);
    out.push_back(number ? *number : std::numeric_limits<double>::quiet_NaN());
  }
  return out;
}

}  // namespace

ChordToRomanOptions read_chord_to_roman_options(const json::Value& asked) {
  ChordToRomanOptions opts;
  opts.applied = is_true(asked, "applied");
  opts.neapolitan = is_true(asked, "neapolitan");
  return opts;
}

std::optional<std::array<std::vector<double>, 2>> read_cadence_voicing(const json::Value& asked) {
  const json::Value* voicing = opt_null_default(asked, "voicing");
  if (voicing == nullptr) {
    return std::nullopt;
  }
  std::array<std::vector<double>, 2> pair;
  if (voicing->is_string()) {
    // Destructured by characters: neither holds a pitch.
    return pair;
  }
  if (!voicing->is_array()) {
    throw js::TypeError(not_iterable_message(*voicing));
  }
  const json::Array& parts = voicing->as_array();
  for (std::size_t i = 0; i < 2; ++i) {
    pair[i] = read_voicing_part(i < parts.size() ? parts[i] : undefined_value());
  }
  return pair;
}

std::optional<ChordQuality> table_quality(const json::Value& quality) {
  if (quality.is_string()) {
    return parse_chord_quality(quality.as_string());
  }
  if (js::type_of(quality) == "symbol") {
    return std::nullopt;
  }
  // `Object.hasOwn(QUALITY_INTERVALS, quality)` takes the key a value has as text.
  return parse_chord_quality(js::template_string(quality));
}

ChordQuality assert_chord_quality(const json::Value& chord) {
  const json::Value& quality = get(chord, "quality");
  std::optional<ChordQuality> known = table_quality(quality);
  if (!known) {
    throw InvalidInputError("Unknown chord quality: " + js::template_string(quality));
  }
  return *known;
}

void settle_chord_quality(ChordData& data) { data.chord.quality = assert_chord_quality(data.wire); }

bool inherits_object_member(std::string_view name) {
  static constexpr std::string_view kNames[] = {
      "__defineGetter__", "__defineSetter__", "__lookupGetter__",
      "__lookupSetter__", "__proto__",        "constructor",
      "hasOwnProperty",   "isPrototypeOf",    "propertyIsEnumerable",
      "toLocaleString",   "toString",         "valueOf"};
  return std::find(std::begin(kNames), std::end(kNames), name) != std::end(kNames);
}

}  // namespace cantus::ops
