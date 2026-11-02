// Op adapters of analyze/form, analyze/rhythm.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_a3.h), in the TS order and with the TS names, then calls the typed
// function. Values a result carries over from its input (a cadence's chords, the fields of a
// phrase) are the input's own wire values.

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "analyze/detect/profiles.h"
#include "analyze/form/hypermeter.h"
#include "analyze/form/phrase.h"
#include "analyze/grid.h"
#include "analyze/keys/keys.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1b.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/codec_a3.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `Number.MIN_VALUE`. */

/** `Cannot read properties of null (reading 'x')` for a value that has no properties. */
[[noreturn]] void no_properties(const json::Value& value, std::string_view property) {
  throw js::TypeError(std::string("Cannot read properties of ") +
                      (value.is_null() ? "null" : "undefined") + " (reading '" +
                      std::string(property) + "')");
}

//--------------------------------------------------------------------------------------------
// analyze/rhythm

void register_rhythm() {
  def("$const:RHYTHM_IOI_BINS", [](Args&) -> json::Value { return to_json(rhythm_ioi_bins()); });
  def("analyzeRhythm", [](Args& a) -> json::Value {
    json::Value bag = default_options(a, 1);
    const json::Value& opts = bag;
    MeterMap meters = resolve_wire_meters(opts, "rhythm meters");
    std::vector<NoteEvent> notes =
        assert_note_events(a[0], "rhythm notes", line_options(get(opts, "budget")));
    RhythmAnalysisOptions typed;
    typed.meters = MeterArg(meters);
    typed.budget = budget_of(opts);
    // The span's end is checked whether or not anything sounds.
    if (const json::Value* total = opt_null_default(opts, "totalBeats")) {
      typed.totalBeats = assert_finite_number(*total, "rhythm totalBeats");
    }
    return to_json(analyze_rhythm(notes, typed));
  });
}

//--------------------------------------------------------------------------------------------
// analyze/form

/** The meters `resolveMeters({ meters: meter }, 'meter')` settles on. */
MeterMap meter_argument(const Args& a, std::size_t i) {
  json::Object bag;
  if (!a.undefined(i)) {
    bag.set("meters", a[i]);
  }
  return resolve_wire_meters(json::Value(std::move(bag)), "meter");
}

void register_hypermeter() {
  def("hypermeter", [](Args& a) -> json::Value {
    json::Value bag = arg_or(a, 2, json::Object());
    const json::Value& asked = assert_options(bag, "opts");
    MeterMap meters = meter_argument(a, 1);
    std::vector<NoteEvent> notes =
        assert_note_events(a[0], "hypermeter notes", line_options(get(asked, "budget")));
    std::vector<NoteEvent> sounding = sounding_notes_only(notes);
    HypermeterOptions typed;
    typed.totalBeats = assert_range_option(asked, "totalBeats", latest_sounding_end(sounding),
                                           js::min(0, first_sounding_beat(sounding)),
                                           kMaxSafeInteger, "hypermeter totalBeats");
    typed.budget = budget_of(asked);
    // The cadence beats are read once the span is long enough to hold a grouping.
    CadenceBars cadence_bars = [&asked](const MeterArg& resolved) {
      std::vector<double> bars;
      const json::Value* beats = opt_null_default(asked, "cadenceBeats");
      if (beats == nullptr) {
        return bars;
      }
      if (!beats->is_array()) {
        throw js::TypeError("(asked.cadenceBeats ?? []).map is not a function");
      }
      for (const json::Value& beat : beats->as_array()) {
        bars.push_back(bar_index_at(assert_finite_number(beat, "beat"), resolved));
      }
      return bars;
    };
    return to_json(hypermeter_with(notes, MeterArg(meters), typed, cadence_bars));
  });
}

void register_sections() {
  def("sectionsFromNotes", [](Args& a) -> json::Value {
    json::Value bag = default_options(a, 1);
    const json::Value& opts = bag;
    MeterMap meters = resolve_wire_meters(opts, "section meters");
    std::vector<NoteEvent> notes =
        assert_note_events(a[0], "section notes", line_options(get(opts, "budget")));
    FormSectionOptions typed;
    typed.meters = MeterArg(meters);
    typed.budget = budget_of(opts);
    std::vector<NoteEvent> sounding = sounding_notes_only(notes);
    if (const json::Value* total = opt_null_default(opts, "totalBeats")) {
      // `resolveSpanEnd`'s range check, ahead of every other option as TS makes it.
      double first_onset = bar_grid_start(first_sounding_beat(sounding), MeterArg(meters));
      typed.totalBeats =
          assert_range(*total, js::min(0, first_onset), kMaxSafeInteger, "section totalBeats");
    }
    if (sounding.empty()) {
      // The analysis checks the span's end, then finds nothing to hear a form in.
      return to_json(sections_from_notes(notes, typed));
    }
    typed.threshold = assert_range_option(opts, "threshold", SECTION_DEFAULT_THRESHOLD, 0, 1,
                                          "section threshold");
    // Without `unitBars` the grouping is inferred first, and the typed analysis checks the result.
    if (const json::Value* unit_bars = opt_null_default(opts, "unitBars")) {
      typed.unitBars = assert_positive_int(*unit_bars, "section unitBars");
    }
    return to_json(sections_from_notes(notes, typed));
  });
}

void register_phrases() {
  def("phrasesFromTimeline", [](Args& a) -> json::Value {
    const json::Array& segments = assert_wire_timeline(a[0]);
    json::Value bag = default_options(a, 2);
    const json::Value& opts = bag;
    MeterMap meters = resolve_wire_meters(opts, "phrase meters");
    std::vector<NoteEvent> notes =
        assert_note_events(a[1], "phrase notes", line_options(get(opts, "budget")));
    PhraseOptions typed;
    typed.meters = MeterArg(meters);
    typed.budget = budget_of(opts);
    const json::Value* given = field(opts, "hypermeter");
    if (given != nullptr) {
      // The one structured option, held to the contract its own type states.
      if (given->is_null()) {
        no_properties(*given, "confidence");
      }
      Hypermeter grouping;
      grouping.confidence =
          assert_range(get(*given, "confidence"), 0, 1, "phrase hypermeter confidence");
      grouping.groupBars = static_cast<int>(
          assert_positive_int(get(*given, "groupBars"), "phrase hypermeter groupBars"));
      typed.hypermeter = std::move(grouping);
    }
    WireSegments wire(segments);
    PhraseSource source;
    source.segments = wire.spans();
    source.chords = wire.reads();
    source.total_beats = [&opts]() -> std::optional<double> {
      const json::Value* total = opt_null_default(opts, "totalBeats");
      if (total == nullptr) {
        return std::nullopt;
      }
      return assert_finite_number(*total, "phrase totalBeats");
    };
    auto beats_option = [&opts](std::string_view key, std::string_view name) -> BeatsOption {
      return [&opts, key, name](double fallback) {
        return assert_range_option(opts, key, fallback, kMinValue, kMaxSafeInteger, name);
      };
    };
    source.rest_beats = beats_option("restBeats", "phrase restBeats");
    source.long_note_beats = beats_option("longNoteBeats", "phrase longNoteBeats");
    source.min_phrase_beats = beats_option("minPhraseBeats", "phrase minPhraseBeats");
    source.expected_phrase_beats =
        beats_option("expectedPhraseBeats", "phrase expectedPhraseBeats");
    if (const json::Value* key = field(opts, "key")) {
      source.key = [&a, key] { return read_key_context(a, *key); };
    }
    // `detectModulations(timeline.segments, ...)` over the chords the timeline check already read.
    std::vector<std::unique_ptr<Chord>> modulation_chords;
    source.modulations = [&wire, &segments,
                          &modulation_chords](const KeyTimelineOptions& key_options) {
      std::vector<SegmentBeats> beats;
      for (const SegmentSpan& span : wire.spans()) {
        beats.push_back(
            SegmentBeats{span.startBeat, span.endBeat, span.endBeat > span.startBeat, {}});
      }
      return detect_modulations_over(beats, modulation_chord_source(segments, modulation_chords),
                                     key_options, typed_profile_source(std::nullopt));
    };
    if (given != nullptr) {
      source.given_downbeats = [given] {
        const json::Value& downbeats = get(*given, "downbeats");
        if (!downbeats.is_array()) {
          throw js::TypeError("grouping.downbeats is not iterable");
        }
        std::vector<double> out;
        for (const json::Value& downbeat : downbeats.as_array()) {
          out.push_back(js::to_number(downbeat));
        }
        return out;
      };
    }
    PhraseReading reading = phrases_over(source, notes, typed);
    json::Value out = to_json(reading.phrases);
    // A closing cadence names the chords of the segments it was found between as they were
    // written.
    for (std::size_t i = 0; i < reading.phrases.size(); ++i) {
      if (reading.phrases[i].cadence && reading.arrivals[i]) {
        json::Value* hit = out.as_array()[i].as_object().find("cadence");
        hit->as_object().set("from", wire.chord_value(*reading.arrivals[i] - 1));
        hit->as_object().set("to", wire.chord_value(*reading.arrivals[i]));
      }
    }
    return out;
  });
  def("structuralCadences", [](Args& a) -> json::Value {
    const json::Array& phrases = assert_array(a[0], "phrases");
    struct Ranked {
      std::size_t index;
      const json::Value* phrase;
      const json::Value* hit;
      double weight;
      double at_beat;
      std::string rationale;
    };
    std::vector<Ranked> ranked;
    for (std::size_t index = 0; index < phrases.size(); ++index) {
      const json::Value& phrase =
          assert_record(phrases[index], "phrases[" + index_text(index) + "]");
      const json::Value& hit = get(phrase, "cadence");
      if (hit.is_null() || is_undefined(hit)) {
        continue;
      }
      const json::Value& result = get(hit, "cadence");
      if (result.is_null() || is_undefined(result)) {
        no_properties(result, "type");
      }
      const json::Value& type = get(result, "type");
      if (type.is_null()) {
        continue;
      }
      // `describeCadence(hit)`, then the phrase's confidence to two places.
      const json::Value& strength = get(result, "strength");
      std::optional<std::string> graded_strength;
      if (!strength.is_null()) {
        graded_strength = js::template_string(strength);
      }
      std::string described = describe_cadence_text(js::template_string(type), graded_strength,
                                                    js::template_string(get(hit, "atBeat")));
      double confidence = js::to_number(get(phrase, "confidence"));
      ranked.push_back(Ranked{index, &phrase, &hit, js::to_number(get(phrase, "structuralWeight")),
                              js::to_number(get(hit, "atBeat")),
                              "Closes " + described + " on a phrase of confidence " +
                                  js::to_string(js::round(confidence * 100) / 100)});
    }
    std::stable_sort(ranked.begin(), ranked.end(), [](const Ranked& x, const Ranked& y) {
      double by_weight = y.weight - x.weight;
      return (by_weight != 0 && !std::isnan(by_weight) ? by_weight : x.at_beat - y.at_beat) < 0;
    });
    json::Array out;
    for (const Ranked& entry : ranked) {
      json::Object cadence;
      cadence.set("phraseIndex", static_cast<double>(entry.index));
      auto carry = [&cadence](const char* name, const json::Value& value) {
        if (!is_undefined(value)) {
          cadence.set(name, value);
        }
      };
      carry("atBeat", get(*entry.hit, "atBeat"));
      carry("endBeat", get(*entry.phrase, "endBeat"));
      carry("cadence", get(*entry.hit, "cadence"));
      carry("weight", get(*entry.phrase, "structuralWeight"));
      cadence.set("rationale", entry.rationale);
      out.push_back(json::Value(std::move(cadence)));
    }
    return json::Value(std::move(out));
  });
}

}  // namespace

void register_a3() {
  register_rhythm();
  register_hypermeter();
  register_sections();
  register_phrases();
}

}  // namespace cantus::ops
