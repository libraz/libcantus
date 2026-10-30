#include "ops/codec_t2.h"

#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_m2.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `normalizedChord` over wire chord data: the data object and the reading of it. */
ChordData normalized_chord(const json::Value& data) {
  const json::Value& intervals = get(data, "intervals");
  if (!intervals.is_array()) {
    throw InvalidInputError("chord.intervals must be an array of semitone offsets");
  }
  json::Object out;
  out.set("rootPc", pitch_class_of(assert_finite_number(get(data, "rootPc"), "chord.rootPc")));
  const json::Value& quality = get(data, "quality");
  if (!is_undefined(quality)) {
    out.set("quality", quality);
  }
  // Each offset is checked rather than copied blind.
  json::Array offsets;
  for (std::size_t index = 0; index < intervals.as_array().size(); ++index) {
    offsets.emplace_back(assert_finite_number(intervals.as_array()[index],
                                              "chord.intervals[" + index_text(index) + "]"));
  }
  out.set("intervals", json::Value(std::move(offsets)));
  const json::Value& bass = get(data, "bassPc");
  if (!is_undefined(bass)) {
    out.set("bassPc", pitch_class_of(assert_finite_number(bass, "chord.bassPc")));
  }
  // Spelling hints are carried through untouched.
  for (const char* key : {"rootSpelling", "bassSpelling", "toneSpellings"}) {
    const json::Value& hint = get(data, key);
    if (!is_undefined(hint)) {
      out.set(key, hint);
    }
  }
  json::Value wire(std::move(out));
  Chord chord = read_chord_fields(wire);
  return ChordData{std::move(chord), std::move(wire)};
}

}  // namespace

ChordData read_chord_like(const json::Value& value) {
  if (value.is_string()) {
    Chord chord = parse_chord_symbol(value.as_string());
    json::Value wire = to_json(chord);
    return ChordData{std::move(chord), std::move(wire)};
  }
  if (is_class_value(value, "Chord")) {
    // A model chord is read through its `data` view, spelled by the key it carries.
    return normalized_chord(to_json(read_chord_class(value).data()));
  }
  if (is_js_object(value)) {
    return normalized_chord(like_target(value));
  }
  throw InvalidInputError("chord must be a chord symbol or chord data; received " +
                          js::type_of(value));
}

void settle_chord_quality(ChordData& data) { data.chord.quality = assert_chord_quality(data.wire); }

std::optional<NoteNameSystem> read_symbol_system(const json::Value& asked) {
  const json::Value* system = opt_null_default(asked, "system");
  if (system == nullptr) {
    return std::nullopt;
  }
  json::Object bag;
  bag.set("system", *system);
  return read_note_name_system(json::Value(std::move(bag)));
}

std::optional<bool> read_symbol_flats(const json::Value& asked) {
  const json::Value* flats = opt_strict(asked, "flats");
  if (flats == nullptr) {
    return std::nullopt;
  }
  return assert_flag(*flats, "flats");
}

void read_attack_arrays(const json::Value& asked, std::size_t slots,
                        VoiceIndependenceOptions& opts) {
  const std::pair<const char*, std::optional<std::vector<bool>>*> attack_arrays[] = {
      {"leadAttacks", &opts.leadAttacks}, {"counterAttacks", &opts.counterAttacks}};
  for (const auto& [name, target] : attack_arrays) {
    const json::Value& flags = get(asked, name);
    if (is_undefined(flags)) {
      continue;
    }
    // `flags.length !== lines.length`: an array, a string or any record with a length.
    json::Value length = length_of(flags);
    if (!js::strict_equals(length, json::Value(static_cast<double>(slots)))) {
      throw InvalidInputError(std::string("voiceIndependence needs ") + name +
                              " aligned slot for slot with the lines; received " +
                              js::template_string(length) + " and " + js::to_string(slots));
    }
    std::vector<bool> read;
    for (std::size_t index = 0; index < slots; ++index) {
      const json::Value flag = element_of(flags, index);
      read.push_back(flag.is_bool() && flag.as_bool());
    }
    *target = std::move(read);
  }
  if (const json::Value* fourths = opt_null_default(asked, "countFourths")) {
    opts.countFourths = js::truthy(*fourths);
  }
}

bool is_wire_number(const json::Value& value) { return js::type_of(value) == "number"; }

double read_pitch(const json::Value& value) {
  if (is_wire_number(value)) {
    return *number_of(value);
  }
  return note_to_midi(read_note(value, "note"));
}

}  // namespace cantus::ops
