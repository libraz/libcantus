#include "ops/codec_c2.h"

#include <cmath>
#include <limits>
#include <string>
#include <utility>

#include "cantus/core/errors.h"
#include "core/pitch/limits.gen.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

std::string str(std::string_view s) { return std::string(s); }

/** `Number.MIN_VALUE` and `Number.MAX_VALUE`. */
constexpr double kMaxValue = std::numeric_limits<double>::max();

/** The names of the note-name systems, in the order TS lists them. */
std::vector<std::string_view> note_name_system_names() {
  std::vector<std::string_view> names;
  for (NoteNameSystem system :
       {NoteNameSystem::kEnglish, NoteNameSystem::kGerman, NoteNameSystem::kJapanese,
        NoteNameSystem::kItalian, NoteNameSystem::kFixedDo}) {
    names.push_back(to_string(system));
  }
  return names;
}

std::vector<std::string_view> note_value_names() {
  std::vector<std::string_view> names;
  for (NoteValue value : NOTE_VALUES) {
    names.push_back(to_string(value));
  }
  return names;
}

}  // namespace

NoteData read_note(const json::Value& value, std::string_view name) {
  const json::Value& note = assert_record(value, name);
  double letter = assert_integer(get(note, "letter"), join_name(name, ".letter"), 0, 6);
  double alter = assert_integer(get(note, "alter"), join_name(name, ".alter"), -MAX_NOTE_ALTER,
                                MAX_NOTE_ALTER);
  std::optional<double> octave;
  const json::Value& wire_octave = get(note, "octave");
  if (!is_undefined(wire_octave)) {
    octave = assert_integer(wire_octave, join_name(name, ".octave"), -MAX_OCTAVE, MAX_OCTAVE);
  }
  return NoteData{letter, alter, octave};
}

NoteData read_note_like(const json::Value& value) {
  std::string type = js::type_of(value);
  if (value.is_string()) {
    return parse_note(value.as_string());
  }
  if (type == "number") {
    // A MIDI note number, and only that.
    return midi_to_note(assert_midi_pitch(value, "note"));
  }
  if (is_js_object(value)) {
    return read_note(like_target(value), "note");
  }
  throw InvalidInputError("note must be a name, a MIDI number, or spelled note data; received " +
                          type);
}

SpelledInterval read_interval_like(const json::Value& value) {
  if (value.is_string()) {
    return parse_interval(value.as_string());
  }
  if (!is_js_object(value)) {
    throw InvalidInputError("interval must be a name or spelled interval data; received " +
                            js::type_of(value));
  }
  const json::Value& data = like_target(value);
  double number = assert_integer(get(data, "number"), "interval.number", 1);
  double semitones = assert_finite_number(get(data, "semitones"), "interval.semitones");
  // The bound intervalSemitones holds the number to, before it reads the quality.
  cantus::assert_integer(number, "interval number", 1, MAX_INTERVAL_NUMBER);
  const json::Value& quality = get(data, "quality");
  if (!quality.is_string()) {
    throw InvalidInputError("unknown interval quality " + describe_rejected(quality));
  }
  IntervalData interval{static_cast<int>(number), quality.as_string(), semitones, std::nullopt};
  const json::Value& descending = get(data, "descending");
  if (!is_undefined(descending)) {
    interval.descending = js::truthy(descending);
  }
  return to_spelled_interval(IntervalArg(std::move(interval)));
}

std::optional<NoteNameSystem> read_note_name_system(const json::Value& opts) {
  const json::Value* system = opt_strict(opts, "system");
  if (system == nullptr) {
    return std::nullopt;
  }
  return parse_note_name_system(assert_one_of(*system, note_name_system_names(), "system"));
}

MidiSpelling read_midi_spelling(const json::Value& value) {
  return *parse_midi_spelling(
      assert_one_of(value,
                    std::vector<std::string_view>{to_string(MidiSpelling::kSharp),
                                                  to_string(MidiSpelling::kFlat)},
                    "midi spelling"));
}

double read_transpose_semitones(const json::Value& value) {
  std::optional<double> semitones = number_of(value);
  if (!semitones || !std::isfinite(*semitones)) {
    throw InvalidInputError("semitones must be a finite number; received " +
                            js::template_string(value));
  }
  return *semitones;
}

TransposeNoteOptions read_transpose_note_options(const json::Value& asked) {
  TransposeNoteOptions opts;
  if (const json::Value* spelling = opt_strict(asked, "spelling")) {
    opts.spelling = read_midi_spelling(*spelling);
  }
  return opts;
}

DurationArg read_duration(const json::Value& value, std::string_view name) {
  if (value.is_string()) {
    return DurationArg(*parse_note_value(assert_one_of(value, note_value_names(), name)));
  }
  if (!is_js_object(value)) {
    throw InvalidInputError(str(name) + " must be a note value or a duration; received " +
                            describe_rejected(value));
  }
  DurationData out;
  out.base = *parse_note_value(
      assert_one_of(get(value, "base"), note_value_names(), join_name(name, ".base")));
  const json::Value& dots = get(value, "dots");
  if (!is_undefined(dots)) {
    out.dots = static_cast<int>(assert_integer(dots, join_name(name, ".dots"), 0, MAX_DOTS));
  }
  const json::Value& tuplet = get(value, "tuplet");
  if (is_undefined(tuplet)) {
    return DurationArg(std::move(out));
  }
  // A duration restored from a file can carry a null where the tuplet is.
  if (!is_js_object(tuplet)) {
    throw InvalidInputError(str(name) + ".tuplet must be a tuplet; received " +
                            describe_rejected(tuplet));
  }
  Tuplet ratio;
  ratio.actual = static_cast<int>(
      assert_positive_int(get(tuplet, "actual"), join_name(name, ".tuplet.actual"), MAX_TUPLET));
  ratio.normal = static_cast<int>(
      assert_positive_int(get(tuplet, "normal"), join_name(name, ".tuplet.normal"), MAX_TUPLET));
  out.tuplet = ratio;
  return DurationArg(std::move(out));
}

DurationOptions read_duration_options(const json::Value& options) {
  const json::Value& asked = assert_options(options, "options");
  DurationOptions out;
  if (const json::Value* unit = opt_strict(asked, "beatUnit")) {
    out.beatUnit = read_duration(*unit, "beatUnit");
  }
  return out;
}

TempoMap read_tempo_map(const json::Value& value, std::string_view name) {
  if (!value.is_array() || value.as_array().empty()) {
    throw InvalidInputError(str(name) + " must hold at least one tempo event");
  }
  const json::Array& entries = value.as_array();
  cantus::assert_generation_budget(static_cast<double>(entries.size()), join_name(name, " count"),
                                   MAX_TEMPO_CHANGES);
  TempoMap out;
  out.reserve(entries.size());
  for (std::size_t index = 0; index < entries.size(); ++index) {
    const json::Value& event = entries[index];
    std::string at = str(name) + "[" + index_text(index) + "]";
    // A hole, a null and a number are refused here rather than at the first field read.
    if (!is_js_object(event)) {
      throw InvalidInputError(at + " must be a tempo event; received " + describe_rejected(event));
    }
    double start_beat = assert_finite_number(get(event, "startBeat"), at + ".startBeat");
    double bpm = assert_range(get(event, "bpm"), MIN_TEMPO_BPM, MAX_TEMPO_BPM, at + ".bpm");
    if (index > 0 && start_beat <= out[index - 1].startBeat) {
      throw InvalidInputError(str(name) + " must be sorted by startBeat with no repeats; [" +
                              index_text(index) + "].startBeat " + js::to_string(start_beat) +
                              " does not follow " + js::to_string(out[index - 1].startBeat));
    }
    out.push_back(TempoEvent{start_beat, bpm});
  }
  return out;
}

TuningTable read_tuning(const json::Value& value) {
  // The shape is checked before any field is read.
  if (!is_js_object(value)) {
    throw InvalidInputError("tuning must be a tuning table; received " + describe_rejected(value));
  }
  TuningTable out;
  out.refStep = assert_finite_number(get(value, "refStep"), "tuning.refStep");
  out.refFreq = assert_range(get(value, "refFreq"), kMinValue, kMaxValue, "tuning.refFreq");
  out.divisions =
      static_cast<int>(assert_positive_int(get(value, "divisions"), "tuning.divisions"));
  return out;
}

SeedPath read_seed_path(const Args& args, std::size_t from) {
  SeedPath path;
  for (std::size_t i = from; i < args.size(); ++i) {
    const json::Value& segment = args[i];
    std::size_t index = i - from;
    if (segment.is_string()) {
      path.emplace_back(segment.as_string());
    } else if (js::type_of(segment) == "number") {
      path.emplace_back(assert_finite_number(segment, "seed path segment " + index_text(index)));
    } else {
      throw InvalidInputError("seed path segment " + index_text(index) +
                              " must be a string or a number; received " + js::type_of(segment));
    }
  }
  return path;
}

std::uint32_t read_seed(const json::Value& value, std::string_view name) {
  return static_cast<std::uint32_t>(assert_integer(value, name, 0, 4294967295.0));
}

json::Value positional_rng_hybrid(std::uint32_t seed) {
  json::Object o;
  o.set("$hy", "PositionalRng");
  o.set("seed", static_cast<double>(seed));
  return json::Value(std::move(o));
}

bool is_positional_rng_hybrid(const json::Value& value) {
  const json::Value* type = value.is_object() ? value.as_object().find("$hy") : nullptr;
  return type != nullptr && type->is_string() && type->as_string() == "PositionalRng";
}

PositionalRng read_positional_rng(const json::Value& hybrid) {
  const json::Value* given = hybrid.is_object() ? hybrid.as_object().find("seed") : nullptr;
  std::optional<double> seed = given == nullptr ? std::nullopt : number_of(*given);
  if (!seed) {
    throw RequestError("a PositionalRng hybrid needs a numeric seed");
  }
  return PositionalRng(read_seed(*given, "seed"));
}

}  // namespace cantus::ops
