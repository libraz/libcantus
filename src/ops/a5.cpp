// Op adapters of analyze/reference.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_a5.h), in the TS order and with the TS names, then calls the typed
// function. A profile is read and checked in one pass by read_reference_profile().

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "analyze/grid.h"
#include "analyze/keys/keys.h"
#include "analyze/reduction/reduction.h"
#include "analyze/reference/profile.h"
#include "analyze/timeline/timeline.h"
#include "cantus/analyze/reference.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "ops/accessors.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/codec_a5.h"
#include "ops/codec_t1.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `.budget` of an options bag, as the typed options carry it. */
std::optional<double> budget_of(const json::Value& opts) {
  const json::Value* budget = field(opts, "budget");
  return budget != nullptr ? number_of(*budget) : std::nullopt;
}

/** The notes that sound. */
std::vector<NoteEvent> sounding_notes(const std::vector<NoteEvent>& notes) {
  std::vector<NoteEvent> out;
  for (const NoteEvent& note : notes) {
    if (note.durationBeat > 0) {
      out.push_back(note);
    }
  }
  return out;
}

/**
 * The segments of a wire timeline for the typed profile. TS refuses a chord only once the profile
 * reaches it (read_harmony(), read_numerals()), and every chord reaches `toChordData` there, so a
 * chord it would refuse stands empty here and never reaches the result.
 */
ChordTimeline read_timeline(const WireSegments& wire) {
  std::vector<SegmentSpan> spans = wire.spans();
  ChordTimeline out;
  for (std::size_t i = 0; i < wire.size(); ++i) {
    Chord chord;
    try {
      chord = read_chord_like(wire.chord_value(i)).chord;
    } catch (const Error&) {
    } catch (const js::TypeError&) {
    }
    out.segments.push_back(ChordSegment{spans[i].startBeat, spans[i].endBeat, std::move(chord)});
  }
  return out;
}

/** What `referenceFromReadings` reads of the timeline's chords for its cadences and reduction. */
void read_harmony(WireSegments& wire, const ReferenceReadings& readings) {
  KeyLookup key_at(readings.keys, readings.prevailingKey);
  KeyAtBeat scale_at = [&key_at](double beat) { return scale_of(key_at(beat)); };
  std::vector<SegmentSpan> spans = wire.spans();
  ChordReads reads = wire.reads();
  detect_cadences_over(spans, reads, scale_at);
  reduce_progression_over(spans, reads, scale_at, ReductionBasis::kFunction);
}

/**
 * `chordToRoman` then `functionOf` over each timeline chord as written, in the key region the
 * profile names it in: the ops themselves, so each chord is refused as the public functions refuse
 * it.
 */
void read_numerals(Args& a, const WireSegments& wire, const ReferenceHarmony& harmony) {
  for (std::size_t i = 0; i < harmony.chords.size(); ++i) {
    json::Value key = to_json(harmony.keys[harmony.chords[i].key].key);
    for (const char* op : {"chordToRoman", "functionOf"}) {
      json::Array arguments{wire.chord_value(i), key};
      Args delegated(arguments, a.context());
      find_op(op)->fn(delegated);
    }
  }
}

ReferenceProfile analyze_wire(Args& a) {
  json::Value bag = arg_or(a, 1, json::Object());
  const json::Value& asked = assert_options(bag, "reference options");
  MeterMap meters = resolve_wire_meters(asked, "reference meters");
  const json::Value& budget = get(asked, "budget");
  ReferenceProfileOptions typed;
  typed.meters = MeterArg(meters);
  typed.budget = budget_of(asked);
  const json::Value* key = field(asked, "key");
  const json::Value* total = opt_null_default(asked, "totalBeats");
  std::vector<NoteEvent> notes;
  std::optional<WireSegments> wire;
  if (is_undefined(get(asked, "timeline"))) {
    // chordTimelineFromNotes reads the notes, then the span's end, then the key.
    notes = assert_note_events(a[0], "timeline notes", line_options(budget));
    std::vector<NoteEvent> sounding = sounding_notes(notes);
    assert_range_option(asked, "totalBeats", latest_sounding_end(sounding),
                        js::min(0, first_sounding_beat(sounding)), kMaxSafeInteger,
                        "timeline totalBeats");
    if (key != nullptr) {
      typed.key = read_key_arg(*key);
    }
  } else {
    const json::Array& segments =
        assert_wire_timeline(get(asked, "timeline"), "reference timeline");
    notes = assert_note_events(a[0], key == nullptr ? "key timeline notes" : "reference notes",
                               line_options(budget));
    if (key == nullptr) {
      std::vector<NoteEvent> sounding = sounding_notes(notes);
      assert_range_option(asked, "totalBeats", latest_sounding_end(sounding),
                          js::min(0, first_sounding_beat(sounding)), kMaxSafeInteger,
                          "key timeline totalBeats");
    } else {
      typed.key = read_key_arg(*key);
    }
    wire.emplace(segments);
    typed.timeline = read_timeline(*wire);
  }
  if (total != nullptr) {
    typed.totalBeats = js::to_number(*total);
  }
  // The profile itself checks the span's end once the harmony is read.
  const json::Value& span_end = get(asked, "totalBeats");
  ReferenceReadings readings = readings_for(notes, typed);
  if (!is_undefined(span_end)) {
    assert_range(span_end, 0, kMaxSafeInteger, "reference totalBeats");
  }
  if (const json::Value* melody = opt_null_default(asked, "melody")) {
    typed.melody = assert_note_events(*melody, "reference melody", line_options(budget));
  }
  if (wire) {
    read_harmony(*wire, readings);
  }
  ReferenceProfile profile = reference_from_readings(notes, readings, typed);
  if (wire) {
    read_numerals(a, *wire, profile.harmony);
  }
  return profile;
}

}  // namespace

void register_a5() {
  def("$const:REFERENCE_PROFILE_VERSION",
      [](Args&) -> json::Value { return to_json(REFERENCE_PROFILE_VERSION); });
  def("analyzeReference", [](Args& a) -> json::Value { return to_json(analyze_wire(a)); });
  def("assertReferenceProfile", [](Args& a) -> json::Value {
    std::string name = name_arg(a, 1, "reference profile");
    read_reference_profile(a[0], name);
    return a[0];
  });
  def("compareReferences", [](Args& a) -> json::Value {
    ReferenceProfile first = read_reference_profile(a[0], "reference profile a");
    ReferenceProfile second = read_reference_profile(a[1], "reference profile b");
    json::Value bag = arg_or(a, 2, json::Object());
    const json::Value& asked = assert_options(bag, "compare options");
    // The progression alignment checks its cell count against the budget as the caller wrote it.
    auto structural_count = [](const ReferenceProfile& profile) {
      std::size_t count = 0;
      for (const ReferenceChord& chord : profile.harmony.chords) {
        count += chord.level == ReductionLevel::kStructural ? 1 : 0;
      }
      return static_cast<double>(count);
    };
    assert_generation_budget(json::Value(structural_count(first) * structural_count(second)),
                             "reference progression alignment", get(asked, "budget"));
    ReferenceComparisonOptions typed;
    typed.budget = budget_of(asked);
    return to_json(compare_references(first, second, typed));
  });
}

}  // namespace cantus::ops
