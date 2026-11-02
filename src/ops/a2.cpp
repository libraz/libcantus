// Op adapters of analyze/timeline, analyze/spelling, analyze/reduction.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_a2.h), in the TS order and with the TS names, then calls the typed
// function. Values a result carries over from its input (a segment's chord, its beats) are the
// input's own wire values.

#include <algorithm>
#include <limits>
#include <numeric>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "analyze/grid.h"
#include "analyze/reduction/reduction.h"
#include "analyze/spelling/spelling.h"
#include "analyze/timeline/timeline.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/meter/meter.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"
#include "theory/spelling/spelling.h"

namespace cantus::ops {

namespace {

/** `Number.MIN_VALUE`. */

//--------------------------------------------------------------------------------------------
// analyze/timeline

/** `chords[index]?.startBeat ?? NaN`. */
json::Value span_start(const json::Value& chord) {
  if (!(chord.is_null() || is_undefined(chord))) {
    const json::Value& start = get(chord, "startBeat");
    if (!(start.is_null() || is_undefined(start))) {
      return start;
    }
  }
  return json::Value(std::numeric_limits<double>::quiet_NaN());
}

/** `assertOneOf(opts.segmentation ?? 'dynamic', CHORD_SEGMENTATIONS, ...)`. */
ChordSegmentation read_segmentation(const json::Value& opts) {
  return *parse_chord_segmentation(
      assert_one_of(opt_or(opts, "segmentation", to_string(ChordSegmentation::kDynamic)),
                    std::vector<std::string_view>{to_string(ChordSegmentation::kDynamic),
                                                  to_string(ChordSegmentation::kGrid)},
                    "timeline segmentation"));
}

void register_timeline() {
  def("ChordTimeline#at", [](Args& a) -> json::Value {
    const json::Object& self = a.hybrid(0, "ChordTimeline");
    const json::Value* held = self.find("segments");
    const json::Value& listed = held != nullptr ? *held : undefined_value();
    double beat = assert_finite_number(a[1], "timeline query beat");
    if (!listed.is_array()) {
      throw InvalidInputError("timeline.segments must be an array; received " +
                              describe_rejected(listed));
    }
    return timeline_chord_at(listed.as_array(), beat);
  });
  def("assertChordTimeline", [](Args& a) -> json::Value {
    std::string name;
    try {
      name = name_arg(a, 1, "timeline");
    } catch (const std::invalid_argument&) {
      // A function's text is its source, which only a failure's message would hold.
      try {
        assert_wire_timeline(a[0]);
      } catch (const InvalidInputError&) {
        name_arg(a, 1, "timeline");
        throw;
      }
      return a[0];
    }
    assert_wire_timeline(a[0], name);
    return a[0];
  });
  def("chordTimelineFromChords", [](Args& a) -> json::Value {
    double total_beats = assert_range(a[1], 0, kMaxSafeInteger, "timeline totalBeats");
    const json::Array& chords = assert_array(a[0], "chords");
    assert_generation_budget(json::Value(static_cast<double>(chords.size())), "timeline chords",
                             undefined_value());
    std::vector<double> starts;
    for (std::size_t index = 0; index < chords.size(); ++index) {
      // Unbounded below, like a note onset: a chord may sound in the pickup.
      starts.push_back(assert_range(span_start(chords[index]), -kMaxSafeInteger, kMaxSafeInteger,
                                    "chords[" + index_text(index) + "].startBeat"));
    }
    std::vector<std::size_t> order;
    for (std::size_t index = 0; index < chords.size(); ++index) {
      if (starts[index] < total_beats) {
        order.push_back(index);
      }
    }
    std::stable_sort(order.begin(), order.end(),
                     [&](std::size_t x, std::size_t y) { return starts[x] - starts[y] < 0; });
    // Each chord is checked in the order the segments are built.
    std::vector<ChordSpan> spans;
    for (std::size_t index : order) {
      ChordSpan span = read_chord_span(chords[index]);
      span.startBeat = starts[index];
      spans.push_back(std::move(span));
    }
    return to_json(chord_timeline_from_chords(spans, total_beats));
  });
  def("chordTimelineFromNotes", [](Args& a) -> json::Value {
    json::Value bag = default_options(a, 1);
    const json::Value& opts = bag;
    MeterMap meters = resolve_wire_meters(opts, "timeline meters");
    ChordTimelineOptions typed;
    typed.meters = MeterArg(meters);
    typed.harmonicRhythm =
        assert_range_option(opts, "harmonicRhythm", beats_per_bar_at(0, MeterArg(meters)),
                            kMinValue, kMaxSafeInteger, "harmonic rhythm");
    typed.segmentation = read_segmentation(opts);
    double grid_unit = metric_grid_unit(MeterArg(meters));
    typed.minChordBeats = assert_range_option(opts, "minChordBeats", grid_unit, kMinValue,
                                              kMaxSafeInteger, "minChordBeats");
    const json::Value& budget = get(opts, "budget");
    json::Value note_bag = line_options(budget);
    if (const json::Value* pickup = opt_strict(opts, "pickupBeats")) {
      typed.pickupBeats = assert_range(*pickup, 0, kMaxSafeInteger, "timeline pickupBeats");
      note_bag.as_object().set("minStartBeat", -*typed.pickupBeats);
    }
    std::vector<NoteEvent> notes = assert_note_events(a[0], "timeline notes", note_bag);
    std::vector<NoteEvent> sounding;
    for (const NoteEvent& note : notes) {
      if (note.durationBeat > 0) {
        sounding.push_back(note);
      }
    }
    typed.totalBeats = assert_range_option(opts, "totalBeats", latest_sounding_end(sounding),
                                           js::min(0, first_sounding_beat(sounding)),
                                           kMaxSafeInteger, "timeline totalBeats");
    typed.budget = budget_of(opts);
    if (const json::Value* key = field(opts, "key")) {
      typed.key = read_key_arg(*key);
    }
    return to_json(analyze_timeline(notes, typed).result);
  });
  def("detectCadences", [](Args& a) -> json::Value {
    const json::Array& segments = assert_wire_timeline(a[0]);
    KeyAtBeat key_at = read_key_context(a, 1);
    WireSegments wire(segments);
    std::vector<std::size_t> arrivals;
    std::vector<CadenceHit> hits =
        detect_cadences_over(wire.spans(), wire.reads(), key_at, &arrivals);
    json::Value out = to_json(hits);
    // A hit names the chords as the timeline wrote them.
    for (std::size_t i = 0; i < hits.size(); ++i) {
      json::Object& hit = out.as_array()[i].as_object();
      hit.set("from", wire.chord_value(arrivals[i] - 1));
      hit.set("to", wire.chord_value(arrivals[i]));
    }
    return out;
  });
}

//--------------------------------------------------------------------------------------------
// analyze/spelling

void register_spelling() {
  def("spellLine", [](Args& a) -> json::Value {
    json::Value bag = arg_or(a, 3, json::Object());
    const json::Value& opts = assert_options(bag, "opts");
    // Read whole rather than reduced: a line in Ab minor is written on flats.
    KeyArg key = read_key_arg(a[2]);
    ResolvedKey resolved = resolve_key(key);
    SpellLineOptions typed;
    std::optional<NoteData> given;
    if (const json::Value* tonic = field(opts, "tonic")) {
      given = read_note_like(*tonic);
      typed.tonic = NoteArg(*given);
    }
    const json::Value& budget = get(opts, "budget");
    std::vector<NoteEvent> notes = assert_note_events(a[0], "line notes", line_options(budget));
    assert_generation_budget(
        json::Value(static_cast<double>(notes.size()) * SPELLINGS_PER_PITCH * SPELLINGS_PER_PITCH),
        "line spelling states", budget);
    if (given) {
      assert_tonic_of(*given, resolved.scale, "spellLine");
    }
    typed.budget = budget_of(opts);
    // `timeline?.at(note.startBeat) ?? null`, asked once per note.
    ChordLookup lookup;
    const json::Value& timeline = a[1];
    if (!(timeline.is_null() || is_undefined(timeline))) {
      std::optional<Callback> at;
      const json::Array* segments = nullptr;
      // A timeline answers from its segments; so does the method of another timeline standing
      // in for `at`. A text or a list has an `at` of its own, which indexes it.
      const json::Value* source = nullptr;
      bool indexed = false;
      if (is_timeline_hybrid(timeline)) {
        source = &timeline;
      } else if (timeline.is_string() || timeline.is_array()) {
        indexed = true;
      } else {
        const json::Value& method = get(timeline, "at");
        if (is_timeline_hybrid(method)) {
          source = &method;
        } else if (js::type_of(method) == "function") {
          at = a.callback(method);
        } else {
          throw js::TypeError("timeline?.at is not a function");
        }
      }
      if (source != nullptr) {
        const json::Value& listed = get(*source, "segments");
        if (!listed.is_array()) {
          throw InvalidInputError("timeline.segments must be an array; received " +
                                  describe_rejected(listed));
        }
        segments = &listed.as_array();
      }
      lookup = [segments, at, indexed, &timeline](double beat) -> std::optional<Chord> {
        json::Value chord = indexed               ? indexed_at(timeline, beat)
                            : segments != nullptr ? timeline_chord_at(*segments, beat)
                                                  : (*at)(json::Array{json::Value(beat)});
        if (chord.is_null() || is_undefined(chord)) {
          return std::nullopt;
        }
        // `spellChord` checks the chord it is handed, then reads its spelling hints.
        const json::Value& value = assert_chord(chord);
        read_spelled_hints(value);
        return read_chord_fields(value);
      };
    }
    return to_json(spell_line_over(notes, lookup, key, typed));
  });
}

//--------------------------------------------------------------------------------------------
// analyze/reduction

void register_reduction() {
  def("$const:REDUCTION_LEVELS", [](Args&) -> json::Value {
    std::vector<std::string_view> names;
    for (ReductionLevel level : reduction_levels()) {
      names.push_back(to_string(level));
    }
    return to_json(names);
  });
  def("reduceProgression", [](Args& a) -> json::Value {
    const json::Array& segments = assert_wire_timeline(a[0]);
    const json::Value& asked = assert_options(a[2], "opts");
    KeyAtBeat key_at = read_key_context(a, 1);
    std::string name =
        assert_one_of(opt_or(asked, "basis", json::Value("function")),
                      std::vector<std::string_view>{to_string(ReductionBasis::kFunction),
                                                    to_string(ReductionBasis::kDuration)},
                      "reduction basis");
    WireSegments wire(segments);
    std::vector<ReductionVerdict> verdicts =
        reduce_progression_over(wire.spans(), wire.reads(), key_at, *parse_reduction_basis(name));
    json::Array out;
    for (std::size_t i = 0; i < verdicts.size(); ++i) {
      json::Object entry;
      entry.set("chord", wire.chord_value(i));
      entry.set("startBeat", get(segments[i], "startBeat"));
      entry.set("endBeat", get(segments[i], "endBeat"));
      entry.set("level", to_json(verdicts[i].level));
      entry.set("rationale", verdicts[i].rationale);
      out.push_back(json::Value(std::move(entry)));
    }
    return json::Value(std::move(out));
  });
}

}  // namespace

void register_a2() {
  register_timeline();
  register_spelling();
  register_reduction();
}

}  // namespace cantus::ops
