#include "ops/codec_a2.h"

#include <cmath>
#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_t1.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `firstAfter`: the index of the first segment beginning after `beat`, by binary search. */
std::size_t first_after(const json::Array& segments, double beat) {
  std::size_t low = 0;
  std::size_t high = segments.size();
  while (low < high) {
    std::size_t middle = (low + high) / 2;
    const json::Value& start = get(segments[middle], "startBeat");
    double at =
        is_undefined(start) ? std::numeric_limits<double>::infinity() : js::to_number(start);
    if (at <= beat) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

}  // namespace

void write_fields(const ChordTimeline& v, FieldWriter& w) {
  w.field("$hy", std::string_view("ChordTimeline"));
  w.field("segments", v.segments);
}

void write_fields(const ChordTimelineResult& v, FieldWriter& w) {
  w.field("timeline", v.timeline);
  w.field("keys", v.keys);
  w.field("prevailingKey", scale_first(v.prevailingKey));
  w.field("segmentConfidence", v.segmentConfidence);
}

bool is_timeline_hybrid(const json::Value& value) {
  const json::Value* type = value.is_object() ? value.as_object().find("$hy") : nullptr;
  return type != nullptr && type->is_string() && type->as_string() == "ChordTimeline";
}

bool is_chord_function(const json::Value& value) {
  return js::type_of(value) == "function" || is_timeline_hybrid(value);
}

const json::Array& assert_wire_timeline(const json::Value& timeline, std::string_view name) {
  const json::Value& read = assert_record(timeline, name);
  // A hybrid carries `at` as a method, not as a field; the method of another timeline is a
  // function too.
  if (!is_timeline_hybrid(read) && !is_chord_function(get(read, "at"))) {
    assert_function(get(read, "at"), join_name(name, ".at"));
  }
  const json::Array& segments = assert_array(get(read, "segments"), join_name(name, ".segments"));
  for (std::size_t index = 0; index < segments.size(); ++index) {
    std::string label = join_name(name, ".segments[") + index_text(index) + "]";
    const json::Value& segment = assert_record(segments[index], label);
    assert_finite_number(get(segment, "startBeat"), label + ".startBeat");
    assert_finite_number(get(segment, "endBeat"), label + ".endBeat");
  }
  return segments;
}

json::Value timeline_chord_at(const json::Array& segments, double beat) {
  assert_finite_number(json::Value(beat), "timeline query beat");
  std::size_t after = first_after(segments, beat);
  if (after == 0) {
    return json::Value(nullptr);
  }
  const json::Value& candidate = segments[after - 1];
  if (beat >= js::to_number(get(candidate, "startBeat")) &&
      beat < js::to_number(get(candidate, "endBeat"))) {
    return get(candidate, "chord");
  }
  return json::Value(nullptr);
}

WireSegments::WireSegments(const json::Array& segments)
    : segments_(&segments), raw_(segments.size()), checked_(segments.size()) {}

std::vector<SegmentSpan> WireSegments::spans() const {
  std::vector<SegmentSpan> out;
  for (const json::Value& segment : *segments_) {
    out.push_back(SegmentSpan{js::to_number(get(segment, "startBeat")),
                              js::to_number(get(segment, "endBeat"))});
  }
  return out;
}

const json::Value& WireSegments::chord_value(std::size_t i) const {
  return get((*segments_)[i], "chord");
}

const Chord& WireSegments::raw(std::size_t i) {
  if (!raw_[i]) {
    const json::Value& value = chord_value(i);
    if (value.is_null() || is_undefined(value)) {
      throw js::TypeError(std::string("Cannot read properties of ") +
                          (value.is_null() ? "null" : "undefined") + " (reading 'rootPc')");
    }
    raw_[i] = read_chord_fields(value);
  }
  return *raw_[i];
}

const Chord& WireSegments::checked(std::size_t i) {
  if (!checked_[i]) {
    checked_[i] = read_chord_like(chord_value(i));
  }
  return checked_[i]->chord;
}

ChordReads WireSegments::reads() {
  return ChordReads{[this](std::size_t i) -> const Chord& { return raw(i); },
                    [this](std::size_t i) -> const Chord& { return checked(i); },
                    [this](std::size_t i) { return root_pc(i); },
                    [this](std::size_t i) { scan_dominant(i); },
                    [this](std::size_t i) { check_pitch_classes(i); },
                    [this](std::size_t i) { scan_six_four(i); }};
}

namespace {

/** `chord.<name>` of a chord value, which fails for a missing chord. */
const json::Value& chord_member(const json::Value& chord, std::string_view name) {
  if (chord.is_null() || is_undefined(chord)) {
    throw js::TypeError(std::string("Cannot read properties of ") +
                        (chord.is_null() ? "null" : "undefined") + " (reading '" +
                        std::string(name) + "')");
  }
  return get(chord, name);
}

}  // namespace

int WireSegments::root_pc(std::size_t i) const {
  return pitch_class_of(assert_finite_number(chord_member(chord_value(i), "rootPc"), "pitch"));
}

void WireSegments::scan_dominant(std::size_t i) const {
  const json::Value& intervals = chord_member(chord_value(i), "intervals");
  if (!intervals.is_array()) {
    if (intervals.is_null() || is_undefined(intervals)) {
      throw js::TypeError(std::string("Cannot read properties of ") +
                          (intervals.is_null() ? "null" : "undefined") + " (reading 'some')");
    }
    throw js::TypeError("chord.intervals.some is not a function");
  }
  // `hasInterval(chord, semitones)`: `some` stops at the first interval that matches.
  auto has_interval = [&](int semitones) {
    for (const json::Value& interval : intervals.as_array()) {
      if (pitch_class_of(assert_finite_number(interval, "pitch")) == semitones) {
        return true;
      }
    }
    return false;
  };
  if (has_interval(4)) {
    return;
  }
  if (!has_interval(3) && (has_interval(5) || has_interval(2))) {
    has_interval(10);
  }
}

void WireSegments::check_pitch_classes(std::size_t i) const {
  const json::Value& chord = assert_chord(chord_value(i));
  assert_mask_inputs(chord);
  // `pitchClass(chord.rootPc + interval)`: the sum is JS addition, so a string interval joins the
  // root as text.
  double root = js::to_number(get(chord, "rootPc"));
  for (const json::Value& interval : get(chord, "intervals").as_array()) {
    assert_finite_number(js::add_number(root, interval), "pitch");
  }
  const json::Value& bass = get(chord, "bassPc");
  if (!is_undefined(bass)) {
    assert_finite_number(bass, "pitch");
  }
}

void WireSegments::scan_six_four(std::size_t i) const {
  const json::Value& intervals = chord_member(chord_value(i), "intervals");
  if (intervals.is_null() || is_undefined(intervals)) {
    throw js::TypeError(std::string("Cannot read properties of ") +
                        (intervals.is_null() ? "null" : "undefined") + " (reading 'length')");
  }
  if (!intervals.is_array() || intervals.as_array().size() != 3) {
    return;
  }
  // `some` stops at the first interval that is a fifth.
  for (const json::Value& interval : intervals.as_array()) {
    if (pitch_class_of(assert_finite_number(interval, "pitch")) == 7) {
      return;
    }
  }
}

json::Value indexed_at(const json::Value& held, double index) {
  double position = std::isnan(index) ? 0 : std::trunc(index);
  double length = held.is_string() ? static_cast<double>(js::utf16_length(held.as_string()))
                                   : static_cast<double>(held.as_array().size());
  double at = position >= 0 ? position : length + position;
  if (at < 0 || at >= length) {
    return undefined_value();
  }
  if (held.is_string()) {
    return json::Value(js::utf16_slice(held.as_string(), at, at + 1));
  }
  return held.as_array()[static_cast<std::size_t>(at)];
}

}  // namespace cantus::ops
