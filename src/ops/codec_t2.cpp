#include "ops/codec_t2.h"

#include <string>
#include <utility>

#include "cantus/core/errors.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/value.h"
#include "ops/accessors.h"
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
  if (is_js_object(value)) {
    return normalized_chord(like_target(value));
  }
  throw InvalidInputError("chord must be a chord symbol or chord data; received " +
                          js::type_of(value));
}

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
  const json::Value* flats = opt_null_default(asked, "flats");
  if (flats == nullptr || !flats->is_bool()) {
    return std::nullopt;
  }
  return flats->as_bool();
}

bool is_wire_number(const json::Value& value) { return js::type_of(value) == "number"; }

double read_pitch(const json::Value& value) {
  if (is_wire_number(value)) {
    return *number_of(value);
  }
  return note_to_midi(read_note(value, "note"));
}

}  // namespace cantus::ops
