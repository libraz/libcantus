#include "ops/codec_a1c.h"

#include <limits>

#include "js/value.h"
#include "ops/accessors.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `note?.key ?? 0` read as a number. */
double field_or_zero(const json::Value& note, std::string_view key) {
  const json::Value& value = get(note, key);
  if (value.is_null() || is_undefined(value)) {
    return 0;
  }
  return js::to_number(value);
}

/** `note.key` read as a number: a field the note lacks is NaN. */
double field_raw(const json::Value& note, std::string_view key) {
  const json::Value& value = get(note, key);
  return is_undefined(value) ? std::numeric_limits<double>::quiet_NaN() : js::to_number(value);
}

}  // namespace

void write_fields(const MotifRelation& v, FieldWriter& w) {
  w.field("sequence", v.sequence);
  w.field("semitones", v.semitones);
  w.field("interval", v.interval);
  w.field("timeRatio", v.timeRatio);
  w.field("kind", v.kind);
  w.field("degrees", v.degrees);
  w.field("rationale", v.rationale);
}

const json::Value& read_phrase_notes(const json::Value& phrase) {
  if (phrase.is_array()) {
    return phrase;
  }
  return get(assert_record(phrase, "melodic phrase"), "notes");
}

std::vector<LineNote> read_line(const json::Array& notes) {
  std::vector<LineNote> out;
  for (const json::Value& note : notes) {
    out.push_back(LineNote{field_or_zero(note, "pitch"), field_or_zero(note, "startBeat"),
                           field_or_zero(note, "durationBeat"), field_raw(note, "pitch"),
                           field_raw(note, "startBeat"), field_raw(note, "durationBeat"),
                           note.is_null() ? "null" : (is_undefined(note) ? "undefined" : nullptr)});
  }
  return out;
}

}  // namespace cantus::ops
