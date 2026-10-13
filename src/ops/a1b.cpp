// Op adapters of analyze/detect, analyze/keys.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_a1b.h), in the TS order and with the TS names, then calls the typed
// function.

#include <algorithm>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "analyze/detect/detect.h"
#include "analyze/keys/keys.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/chord.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1b.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `Number.MIN_VALUE`. */
constexpr double kMinValue = std::numeric_limits<double>::denorm_min();

/** The options bag a detector is called with: `opts = {}` applies only to undefined. */
json::Value options_or_empty(const Args& a, std::size_t i) { return arg_or(a, i, json::Object()); }

/** The `input` option: only `auto` and `midi` are told apart from an unordered set. */
ChordInputKind read_input_kind(const json::Value& asked) {
  const json::Value* input = field(asked, "input");
  if (input == nullptr || (input->is_string() && input->as_string() == "auto")) {
    return ChordInputKind::kAuto;
  }
  // Anything but 'midi' reads as an unordered pitch-class set.
  return input->is_string() && input->as_string() == "midi" ? ChordInputKind::kMidi
                                                            : ChordInputKind::kPitchClass;
}

DetectChordOptions read_chord_options(const json::Value& asked) {
  DetectChordOptions opts;
  opts.input = read_input_kind(asked);
  if (const json::Value* bass = field(asked, "bassPc")) {
    opts.bassPc = assert_finite_number(*bass, "bassPc");
  }
  return opts;
}

/** The `weights` of a wire key-detection call, checked entry by entry as TS does. */
std::vector<double> read_weights(const json::Value& weights, std::size_t count) {
  std::vector<double> out;
  for (std::size_t index = 0; index < count; ++index) {
    json::Value entry = undefined_value();
    if (weights.is_array()) {
      entry = weights.as_array()[index];
    } else if (weights.is_string()) {
      entry = json::Value(js::utf16_slice(weights.as_string(), static_cast<double>(index),
                                          static_cast<double>(index) + 1));
    } else {
      entry = get(weights, js::to_string(static_cast<double>(index)));
    }
    // `weights[index] ?? 0`.
    if (entry.is_null() || is_undefined(entry)) {
      entry = json::Value(0.0);
    }
    out.push_back(
        assert_finite_number(entry, "weights[" + js::to_string(static_cast<double>(index)) + "]"));
  }
  return out;
}

/** `weights.length` of a wire value, or nullopt where TS reads undefined. */
std::optional<double> weights_length(const json::Value& weights) {
  if (weights.is_null()) {
    throw js::TypeError("Cannot read properties of null (reading 'length')");
  }
  if (weights.is_array()) {
    return static_cast<double>(weights.as_array().size());
  }
  if (weights.is_string()) {
    return static_cast<double>(js::utf16_length(weights.as_string()));
  }
  const json::Value& length = get(weights, "length");
  if (js::type_of(length) == "number") {
    return number_of(length);
  }
  return std::nullopt;
}

/** The options of `detectKey` on a wire bag: everything but the profile source. */
struct KeyCall {
  std::vector<int> pitches;
  DetectKeyOptions options;
  ProfileSource profile;
};

/** `detectKey`'s prologue over wire arguments, in the TS order. */
KeyCall read_key_call(const json::Value& pitches, const json::Value& opts) {
  const json::Value& asked = assert_record(opts, "opts");
  KeyCall call;
  call.pitches = read_pitches(pitches, "key detection pitches", get(asked, "budget"));
  const json::Value* weights = field(asked, "weights");
  if (weights != nullptr) {
    std::optional<double> length = weights_length(*weights);
    if (!length || *length != static_cast<double>(call.pitches.size())) {
      throw InvalidInputError("weights must have one entry per pitch");
    }
  }
  // The profile and the modes are resolved before the weights are read entry by entry.
  ResolvedProfile resolved = wire_profile_source(field(asked, "profile"))();
  call.profile = [resolved] { return resolved; };
  call.options.modes = read_modal_modes(field(asked, "modes"));
  if (weights != nullptr) {
    call.options.weights = read_weights(*weights, call.pitches.size());
  }
  call.options.explain = is_true_option(asked, "explain");
  if (const json::Value* budget = field(asked, "budget")) {
    call.options.budget = number_of(*budget);
  }
  return call;
}

void register_detect() {
  def("$const:MODAL_SCALE_NAMES",
      [](Args&) -> json::Value { return to_json(modal_scale_names()); });
  def("detectChord", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    std::vector<int> pitches = read_pitches(a[0], "chord detection pitches", undefined_value());
    return to_json(detect_chord(pitches, read_chord_options(asked)));
  });
  def("detectChordBest", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    std::vector<int> pitches = read_pitches(a[0], "chord detection pitches", undefined_value());
    return to_json(detect_chord_best(pitches, read_chord_options(asked)));
  });
  def("detectKey", [](Args& a) -> json::Value {
    json::Value opts = options_or_empty(a, 1);
    KeyCall call = read_key_call(a[0], opts);
    return to_json(detect_key_over(call.pitches, call.options, call.profile));
  });
  def("detectKeyBest", [](Args& a) -> json::Value {
    json::Value opts = options_or_empty(a, 1);
    KeyCall call = read_key_call(a[0], opts);
    std::vector<KeyMatch> matches = detect_key_over(call.pitches, call.options, call.profile);
    if (matches.empty()) {
      return json::Value(nullptr);
    }
    return to_json(matches.front());
  });
  def("detectKeyFromNotes", [](Args& a) -> json::Value {
    json::Value opts = options_or_empty(a, 1);
    const json::Value& asked = assert_options(opts, "opts");
    json::Object note_bag;
    note_bag.set("allowNonPositiveDuration", true);
    note_bag.set("budget", get(asked, "budget"));
    std::vector<NoteEvent> notes =
        assert_note_events(a[0], "key detection notes", json::Value(std::move(note_bag)));
    DetectKeyFromNotesOptions typed;
    // detectKey resolves the profile, then the modes, from the options it is handed.
    ResolvedProfile resolved = wire_profile_source(field(asked, "profile"))();
    typed.modes = read_modal_modes(field(asked, "modes"));
    typed.explain = is_true_option(asked, "explain");
    if (const json::Value* budget = field(asked, "budget")) {
      typed.budget = number_of(*budget);
    }
    return to_json(detect_key_from_notes_over(notes, typed, [resolved] { return resolved; }));
  });
}

//--------------------------------------------------------------------------------------------
// analyze/keys

/** `opts.x ?? fallback` run through `assertRange`; the value is the number checked. */
double read_range(const json::Value& opts, std::string_view key, double fallback, double min,
                  double max, std::string_view name) {
  const json::Value* given = opt_null_default(opts, key);
  return assert_range(given != nullptr ? *given : json::Value(fallback), min, max, name);
}

KeyTimelineOptions read_timeline_options(const json::Value& opts, const MeterMap& meters,
                                         double expected, double minimum) {
  KeyTimelineOptions typed;
  typed.meters = MeterArg(meters);
  typed.expectedKeyBeats = expected;
  typed.minKeyBeats = minimum;
  if (const json::Value* budget = field(opts, "budget")) {
    typed.budget = number_of(*budget);
  }
  return typed;
}

void register_keys() {
  def("keyTimelineFromNotes", [](Args& a) -> json::Value {
    json::Value opts = options_or_empty(a, 1);
    MeterMap meters = resolve_wire_meters(opts, "key timeline meters");
    double bar = beats_per_bar_at(0, MeterArg(meters));
    double expected = read_range(opts, "expectedKeyBeats", bar * 4, kMinValue, kMaxSafeInteger,
                                 "expectedKeyBeats");
    double minimum =
        read_range(opts, "minKeyBeats", bar, kMinValue, kMaxSafeInteger, "minKeyBeats");
    json::Object note_bag;
    note_bag.set("allowNonPositiveDuration", true);
    note_bag.set("budget", get(opts, "budget"));
    std::vector<NoteEvent> notes =
        assert_note_events(a[0], "key timeline notes", json::Value(std::move(note_bag)));
    double last_end = 0;
    for (const NoteEvent& note : notes) {
      if (note.durationBeat > 0) {
        last_end = js::max(last_end, note.startBeat + note.durationBeat);
      }
    }
    double total =
        read_range(opts, "totalBeats", last_end, 0, kMaxSafeInteger, "key timeline totalBeats");
    KeyTimelineOptions typed = read_timeline_options(opts, meters, expected, minimum);
    typed.totalBeats = total;
    return to_json(key_timeline_over(notes, typed, wire_profile_source(field(opts, "profile"))));
  });
  def("detectModulations", [](Args& a) -> json::Value {
    json::Value opts = options_or_empty(a, 1);
    const json::Array& chords = assert_array(a[0], "modulation chord segments");
    for (std::size_t index = 0; index < chords.size(); ++index) {
      assert_record(chords[index], "modulation chord segments[" + index_text(index) + "]");
    }
    MeterMap meters = resolve_wire_meters(opts, "modulation meters");
    double bar = beats_per_bar_at(0, MeterArg(meters));
    double expected = read_range(opts, "expectedKeyBeats", bar * 4, kMinValue, kMaxSafeInteger,
                                 "expectedKeyBeats");
    double minimum =
        read_range(opts, "minKeyBeats", bar, kMinValue, kMaxSafeInteger, "minKeyBeats");
    assert_generation_budget(json::Value(static_cast<double>(chords.size() * 24)),
                             "modulation chord segments", get(opts, "budget"));
    KeyTimelineOptions typed = read_timeline_options(opts, meters, expected, minimum);
    // A total named by the caller is checked here, before any chord is read.
    if (const json::Value* total = opt_null_default(opts, "totalBeats")) {
      typed.totalBeats = assert_range(*total, 0, kMaxSafeInteger, "modulation totalBeats");
    }
    std::vector<SegmentBeats> beats;
    for (const json::Value& segment : chords) {
      const json::Value& start = get(segment, "startBeat");
      const json::Value& end = get(segment, "endBeat");
      SegmentBeats written{js::to_number(start), js::to_number(end), js::greater_than(end, start),
                           {}};
      if (start.kind() != json::Kind::kNumber) {
        // A start that is not a number is refused where the search measures its beat.
        written.assert_start = [&start] { assert_finite_number(start, "beat"); };
      }
      beats.push_back(std::move(written));
    }
    // Each chord is checked and read the first time the search needs it.
    std::vector<std::unique_ptr<Chord>> read(chords.size());
    ChordSource chord_at = [&](std::size_t index) -> const Chord& {
      if (!read[index]) {
        const json::Value& wire = get(chords[index], "chord");
        // `assertChord`, then the guards of the tones.
        assert_record(wire, "chord");
        assert_finite_number(get(wire, "rootPc"), "chord.rootPc");
        ChordQuality quality = assert_chord_quality(wire);
        assert_chord_mask_inputs(wire);
        read[index] = std::make_unique<Chord>(read_chord_fields(wire, quality));
      }
      return *read[index];
    };
    std::vector<std::size_t> starts;
    json::Value out = to_json(detect_modulations_over(
        beats, chord_at, typed, wire_profile_source(field(opts, "profile")), &starts));
    // A region starts at the beat of its first segment exactly as the segment wrote it.
    for (std::size_t i = 0; i < starts.size(); ++i) {
      const json::Value& written = get(chords[starts[i]], "startBeat");
      if (js::type_of(written) != "number") {
        out.as_array()[i].as_object().set("startBeat", written);
      }
    }
    return out;
  });
  def("prevailingKeyOf", [](Args& a) -> json::Value {
    const json::Array& regions = assert_array(a[0], "key regions");
    std::vector<std::pair<std::string, double>> entries;
    for (std::size_t index = 0; index < regions.size(); ++index) {
      std::string label = "key regions[" + index_text(index) + "]";
      const json::Value& region = assert_record(regions[index], label);
      const json::Value& key = assert_record(get(region, "key"), label + ".key");
      const json::Value& scale = get(key, "scale");
      if (scale.is_null() || is_undefined(scale)) {
        throw js::TypeError(std::string("Cannot read properties of ") +
                            (scale.is_null() ? "null" : "undefined") + " (reading 'rootPc')");
      }
      int root_pc = pitch_class_of(assert_finite_number(get(scale, "rootPc"), "pitch"));
      std::string id = js::to_string(static_cast<double>(root_pc)) + ":" +
                       js::template_string(get(scale, "modeMask12"));
      double length = js::max(
          0, js::to_number(get(region, "endBeat")) - js::to_number(get(region, "startBeat")));
      entries.emplace_back(std::move(id), length);
    }
    std::optional<std::size_t> best = prevailing_key_index(entries);
    if (!best) {
      return json::Value(nullptr);
    }
    return get(regions[*best], "key");
  });
}

}  // namespace

void register_a1b() {
  register_detect();
  register_keys();
}

}  // namespace cantus::ops
