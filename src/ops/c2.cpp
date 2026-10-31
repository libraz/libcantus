// Op adapters of core/pitch, core/interval, core/random, core/duration, core/tempo, core/tuning,
// core/event-index.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_c2.h), in the TS order and with the TS names, then calls the typed
// function. A guard that returns its argument returns the wire value it was given.

#include <cmath>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/duration.h"
#include "cantus/core/event_index.h"
#include "cantus/core/interval.h"
#include "cantus/core/pitch.h"
#include "cantus/core/random.h"
#include "cantus/core/tempo.h"
#include "cantus/core/tuning.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_c2.h"
#include "ops/codec_g1.h"
#include "ops/handles.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `Number.MIN_VALUE` and `Number.MAX_VALUE`. */
constexpr double kMinValue = std::numeric_limits<double>::denorm_min();
constexpr double kMaxValue = std::numeric_limits<double>::max();

//--------------------------------------------------------------------------------------------
// core/random

/** The source behind a `PositionalRng` hybrid argument. */
PositionalRng positional_rng_of(const Args& a, std::size_t i) {
  a.hybrid(i, "PositionalRng");
  return read_positional_rng(a[i]);
}

/** The generator behind an `Rng` handle. */
class RngHandle : public Handle {
 public:
  static constexpr const char* kTypeName = "Rng";

  explicit RngHandle(std::uint32_t seed) : rng(seed) {}

  Rng rng;
};

void register_random() {
  def("$const:ALGORITHM_VERSION", [](Args&) -> json::Value { return to_json(ALGORITHM_VERSION); });
  def("$const:MIN_ALGORITHM_VERSION",
      [](Args&) -> json::Value { return to_json(MIN_ALGORITHM_VERSION); });
  def("resolveAlgorithmVersion", [](Args& a) -> json::Value {
    if (a.undefined(0)) {
      return to_json(resolve_algorithm_version());
    }
    double version = assert_integer(a[0], "algorithm version");
    return to_json(resolve_algorithm_version(static_cast<std::int64_t>(version)));
  });
  def(
      "createRng",
      [](Args& a) -> json::Value {
        return new_handle(std::make_shared<RngHandle>(read_seed(a[0], "seed")));
      },
      kHandles);
  def_method<RngHandle>("Rng#next",
                        [](RngHandle& self, Args&) -> json::Value { return self.rng.next(); });
  def_method<RngHandle>("Rng#prob", [](RngHandle& self, Args& a) -> json::Value {
    double p = assert_range(a[1], 0, 1, "probability");
    return to_json(self.rng.prob(p));
  });
  def_method<RngHandle>("Rng#range", [](RngHandle& self, Args& a) -> json::Value {
    double lo = assert_integer(a[1], "range lower bound");
    double hi = assert_integer(a[2], "range upper bound");
    return to_json(self.rng.range(static_cast<std::int64_t>(lo), static_cast<std::int64_t>(hi)));
  });
  def_method<RngHandle>("Rng#float", [](RngHandle& self, Args& a) -> json::Value {
    double lo = assert_finite_number(a[1], "float lower bound");
    double hi = assert_finite_number(a[2], "float upper bound");
    return self.rng.float_(lo, hi);
  });
  def("deriveSeed", [](Args& a) -> json::Value {
    std::uint32_t root = read_seed(a[0], "root seed");
    return to_json(derive_seed(root, read_seed_path(a, 1)));
  });
  def("createPositionalRng",
      [](Args& a) -> json::Value { return positional_rng_hybrid(read_seed(a[0], "seed")); });
  def("PositionalRng#at",
      [](Args& a) -> json::Value { return positional_rng_of(a, 0).at(read_seed_path(a, 1)); });
  // The callback form is optional (a PositionalRng hybrid is the usual source), so the op carries
  // no kCallbacks flag; dispatch still refuses a `$cb` argument when the caller has no host.
  def("includeAt", [](Args& a) -> json::Value {
    double complexity = assert_range(a[1], 0, 1, "complexity");
    json::Array path;
    for (std::size_t i = 2; i < a.size(); ++i) {
      path.push_back(a[i]);
    }
    // `rng.at(...path)` for whatever source the caller passed, held to [0, 1).
    json::Value draw = draw_from(WireRng(a, a[0]), path);
    return json::Value(js::less_than(draw, json::Value(complexity)));
  });
}

//--------------------------------------------------------------------------------------------
// core/interval

void register_interval() {
  def("$const:ConsonanceClass", [](Args&) -> json::Value {
    json::Object o;
    const char* names[] = {"PerfectConsonance", "ImperfectConsonance", "Dissonance"};
    for (int value = 0; value < 3; ++value) {
      o.set(js::to_string(value), names[value]);
    }
    for (int value = 0; value < 3; ++value) {
      o.set(names[value], static_cast<double>(value));
    }
    return json::Value(std::move(o));
  });
  def("classifyInterval", [](Args& a) -> json::Value {
    bool two_voice = assert_flag(arg_or(a, 1, true), "twoVoice");
    double semitones = assert_finite_semitones(a[0]);
    return to_json(classify_interval(semitones, two_voice));
  });
  def("isPerfectInterval", [](Args& a) -> json::Value {
    return to_json(is_perfect_interval(assert_finite_semitones(a[0])));
  });
  def("isConsonantInterval", [](Args& a) -> json::Value {
    bool two_voice = assert_flag(arg_or(a, 1, true), "twoVoice");
    double semitones = assert_finite_semitones(a[0]);
    return to_json(is_consonant_interval(semitones, two_voice));
  });
}

//--------------------------------------------------------------------------------------------
// core/pitch

/** `toSpelledInterval`'s result; a `descending` the caller wrote that is not a boolean stays as is.
 */
json::Value interval_result(const json::Value& given, const SpelledInterval& interval) {
  json::Value out = to_json(interval);
  if (is_js_object(given)) {
    const json::Value& descending = get(like_target(given), "descending");
    if (!is_undefined(descending) && !descending.is_bool()) {
      out.as_object().set("descending", descending);
    }
  }
  return out;
}

/** `toNoteData`'s result for note data: a fresh object holding the fields the caller wrote. */
json::Value note_data_result(const json::Value& given) {
  const json::Value& data = like_target(given);
  json::Object out;
  out.set("letter", get(data, "letter"));
  out.set("alter", get(data, "alter"));
  const json::Value& octave = get(data, "octave");
  if (!is_undefined(octave)) {
    out.set("octave", octave);
  }
  return json::Value(std::move(out));
}

/** A text argument that TS checks with `typeof text !== 'string'`. */
void require_text(const json::Value& text, const std::string& what) {
  if (!text.is_string()) {
    throw InvalidInputError(what + " must be a string; received " + js::type_of(text));
  }
}

void register_pitch() {
  def("pitchClassOf",
      [](Args& a) -> json::Value { return pitch_class_of(assert_finite_number(a[0], "pitch")); });
  def("diatonicLetterOf", [](Args& a) -> json::Value {
    return diatonic_letter_of(assert_finite_number(a[0], "diatonic letter"));
  });
  def("naturalPitchClassOf", [](Args& a) -> json::Value {
    return natural_pitch_class_of(assert_finite_number(a[0], "diatonic letter"));
  });
  def("detectNoteNameSystem", [](Args& a) -> json::Value {
    require_text(a[0], "name");
    return to_json(detect_note_name_system(a[0].as_string()));
  });
  def("parseNote", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    require_text(a[0], "note");
    NoteNameOptions opts;
    opts.system = read_note_name_system(asked);
    return to_json(parse_note(a[0].as_string(), opts));
  });
  def("tryParseNote", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    NoteNameOptions opts;
    try {
      require_text(a[0], "note");
      opts.system = read_note_name_system(asked);
    } catch (const InvalidInputError& e) {
      return to_json(ParseResult<NoteData>::failure(e));
    }
    return to_json(try_parse_note(a[0].as_string(), opts));
  });
  def("formatNote", [](Args& a) -> json::Value {
    NoteData note = read_note(a[0], "note");
    NoteNameOptions opts;
    opts.system = read_note_name_system(assert_options(a[1], "opts"));
    return format_note(note, opts);
  });
  def("parseKeyName", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    require_text(a[0], "key name");
    NoteNameOptions opts;
    opts.system = read_note_name_system(asked);
    return to_json(parse_key_name(a[0].as_string(), opts));
  });
  def("tryParseKeyName", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    NoteNameOptions opts;
    try {
      require_text(a[0], "key name");
      opts.system = read_note_name_system(asked);
    } catch (const InvalidInputError& e) {
      return to_json(ParseResult<KeyName>::failure(e));
    }
    return to_json(try_parse_key_name(a[0].as_string(), opts));
  });
  def("formatKeyName", [](Args& a) -> json::Value {
    const json::Value& named = assert_record(a[0], "key");
    KeyName key;
    key.tonic = read_note(get(named, "tonic"), "key.tonic");
    key.mode = *parse_key_name_mode(assert_one_of(
        get(named, "mode"), std::vector<std::string_view>{"major", "minor"}, "key.mode"));
    NoteNameOptions opts;
    opts.system = read_note_name_system(assert_options(a[1], "opts"));
    return format_key_name(key, opts);
  });
  def("noteToPitchClass",
      [](Args& a) -> json::Value { return note_to_pitch_class(read_note(a[0], "note")); });
  def("noteToMidi", [](Args& a) -> json::Value { return note_to_midi(read_note(a[0], "note")); });
  def("midiToNote", [](Args& a) -> json::Value {
    double midi = assert_finite_number(a[0], "midi");
    std::string spelling =
        assert_one_of(arg_or(a, 1, "sharp"),
                      std::vector<std::string_view>{to_string(MidiSpelling::kSharp),
                                                    to_string(MidiSpelling::kFlat)},
                      "midi spelling");
    return to_json(midi_to_note(midi, *parse_midi_spelling(spelling)));
  });
  def("transposeNote", [](Args& a) -> json::Value {
    NoteData note = read_note(a[0], "note");
    const json::Value& asked = assert_options(a[2], "opts");
    std::optional<double> semitones = number_of(a[1]);
    if (!semitones || !std::isfinite(*semitones)) {
      throw InvalidInputError("semitones must be a finite number; received " +
                              js::template_string(a[1]));
    }
    TransposeNoteOptions opts;
    if (const json::Value* spelling = opt_strict(asked, "spelling")) {
      opts.spelling = parse_midi_spelling(
          assert_one_of(*spelling,
                        std::vector<std::string_view>{to_string(MidiSpelling::kSharp),
                                                      to_string(MidiSpelling::kFlat)},
                        "midi spelling"));
    }
    return to_json(transpose_note(note, *semitones, opts));
  });
  def("intervalSemitones", [](Args& a) -> json::Value {
    double number = assert_integer(a[0], "interval number", 1, MAX_INTERVAL_NUMBER);
    if (a[1].is_string()) {
      return interval_semitones(static_cast<int>(number), a[1].as_string());
    }
    // A quality that is no string can only match the repeated-letter patterns, which read it as
    // text; the count is its `length` (an array's size), not the length of that text.
    std::string text = js::template_string(a[1]);
    bool repeated = !text.empty() && (text.find_first_not_of('A') == std::string::npos ||
                                      text.find_first_not_of('d') == std::string::npos);
    if (!repeated || !a[1].is_array()) {
      throw InvalidInputError("unknown interval quality " + describe_rejected(a[1]));
    }
    std::string quality(a[1].as_array().size(), text[0]);
    return interval_semitones(static_cast<int>(number), quality);
  });
  def("parseInterval", [](Args& a) -> json::Value {
    if (!a[0].is_string()) {
      throw InvalidInputError(
          "interval must be a quality followed by a number, such as 'P5'; received " +
          describe_rejected(a[0]));
    }
    return to_json(parse_interval(a[0].as_string()));
  });
  def("tryParseInterval", [](Args& a) -> json::Value {
    if (!a[0].is_string()) {
      return to_json(ParseResult<SpelledInterval>::failure(InvalidInputError(
          "interval must be a quality followed by a number, such as 'P5'; received " +
          describe_rejected(a[0]))));
    }
    return to_json(try_parse_interval(a[0].as_string()));
  });
  def("toSpelledInterval",
      [](Args& a) -> json::Value { return interval_result(a[0], read_interval_like(a[0])); });
  def("toNoteData", [](Args& a) -> json::Value {
    NoteData note = read_note_like(a[0]);
    if (is_js_object(a[0])) {
      return note_data_result(a[0]);
    }
    return to_json(note);
  });
  def("transposeByInterval", [](Args& a) -> json::Value {
    NoteData note = read_note_like(a[0]);
    SpelledInterval interval = read_interval_like(a[1]);
    return to_json(transpose_by_interval(note, interval));
  });
  def("spelledInterval", [](Args& a) -> json::Value {
    NoteData from = read_note(a[0], "a");
    NoteData to = read_note(a[1], "b");
    return to_json(spelled_interval(from, to));
  });
}

//--------------------------------------------------------------------------------------------
// core/duration

/** `assertPositiveBeats`: a finite, positive beat count. */
double read_positive_beats(const json::Value& beats) {
  double value = assert_finite_number(beats, "beats");
  if (value <= 0) {
    throw InvalidInputError("beats must be positive; received " + js::to_string(value));
  }
  return value;
}

void register_duration() {
  def("$const:NOTE_VALUES", [](Args&) -> json::Value {
    json::Array names;
    for (NoteValue value : NOTE_VALUES) {
      names.push_back(to_json(value));
    }
    return json::Value(std::move(names));
  });
  def("durationToBeats", [](Args& a) -> json::Value {
    DurationArg duration = read_duration(a[0], "duration");
    // The duration is read before the options bag, as TS evaluates its operands.
    DurationOptions options = read_duration_options(a[1]);
    return duration_to_beats(duration, options);
  });
  def("beatsToDuration", [](Args& a) -> json::Value {
    double beats = read_positive_beats(a[0]);
    return to_json(beats_to_duration(beats, read_duration_options(a[1])));
  });
  def("beatsToTiedDurations", [](Args& a) -> json::Value {
    double beats = read_positive_beats(a[0]);
    return to_json(beats_to_tied_durations(beats, read_duration_options(a[1])));
  });
}

//--------------------------------------------------------------------------------------------
// core/tempo

void register_tempo() {
  def("beatsToSeconds", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    return beats_to_seconds(beat, read_tempo_map(a[1]));
  });
  def("secondsToBeats", [](Args& a) -> json::Value {
    double seconds = assert_finite_number(a[0], "seconds");
    return seconds_to_beats(seconds, read_tempo_map(a[1]));
  });
  def("durationToSeconds", [](Args& a) -> json::Value {
    double start_beat = assert_finite_number(a[0], "startBeat");
    double length = assert_range(a[1], 0, kMaxSafeInteger, "lengthBeats");
    return duration_to_seconds(start_beat, length, read_tempo_map(a[2]));
  });
  def("tempoAt", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    return tempo_at(beat, read_tempo_map(a[1]));
  });
  def("beatsToTicks", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    auto ppq = static_cast<int>(assert_positive_int(a[1], "ppq"));
    return beats_to_ticks(beat, ppq);
  });
  def("ticksToBeats", [](Args& a) -> json::Value {
    double ticks = assert_integer(a[0], "ticks");
    auto ppq = static_cast<int>(assert_positive_int(a[1], "ppq"));
    return ticks_to_beats(ticks, ppq);
  });
}

//--------------------------------------------------------------------------------------------
// core/tuning

/** The tuning argument `i`, or twelve-tone equal temperament when it is undefined. */
TuningTable tuning_arg(const Args& a, std::size_t i) {
  return a.undefined(i) ? TWELVE_TET : read_tuning(a[i]);
}

void register_tuning() {
  def("$const:TWELVE_TET", [](Args&) -> json::Value { return to_json(TWELVE_TET); });
  def("$const:JUST_RATIOS", [](Args&) -> json::Value {
    json::Object o;
    for (int semitone_class = 0; semitone_class <= 12; ++semitone_class) {
      JustRatio ratio = just_ratio(semitone_class);
      o.set(js::to_string(semitone_class),
            json::Value(json::Array{json::Value(ratio.numerator), json::Value(ratio.denominator)}));
    }
    return json::Value(std::move(o));
  });
  def("edo", [](Args& a) -> json::Value {
    auto n = static_cast<int>(assert_positive_int(a[0], "EDO divisions"));
    double ref_freq = assert_range(arg_or(a, 1, 440), kMinValue, kMaxValue, "reference frequency");
    double ref_step = assert_finite_number(arg_or(a, 2, 69), "reference step");
    return to_json(edo(n, ref_freq, ref_step));
  });
  def("frequencyOf", [](Args& a) -> json::Value {
    double step = assert_finite_number(a[0], "step");
    return frequency_of(step, tuning_arg(a, 1));
  });
  def("nearestStep", [](Args& a) -> json::Value {
    double freq = assert_range(a[0], kMinValue, kMaxValue, "frequency");
    return nearest_step(freq, tuning_arg(a, 1));
  });
  def("stepOf", [](Args& a) -> json::Value {
    double freq = assert_range(a[0], kMinValue, kMaxValue, "frequency");
    return step_of(freq, tuning_arg(a, 1));
  });
  def("centsFromNearestStep", [](Args& a) -> json::Value {
    double freq = assert_range(a[0], kMinValue, kMaxValue, "frequency");
    return cents_from_nearest_step(freq, tuning_arg(a, 1));
  });
  def("stepsOfCents", [](Args& a) -> json::Value {
    double cents = assert_finite_number(a[0], "cents");
    return steps_of_cents(cents, tuning_arg(a, 1));
  });
  def("centsToRatio",
      [](Args& a) -> json::Value { return cents_to_ratio(assert_finite_number(a[0], "cents")); });
  def("centsBetweenFreq", [](Args& a) -> json::Value {
    double first = assert_range(a[0], kMinValue, kMaxValue, "first frequency");
    double second = assert_range(a[1], kMinValue, kMaxValue, "second frequency");
    return cents_between_freq(first, second);
  });
  def("centsOfSteps", [](Args& a) -> json::Value {
    double steps = assert_finite_number(a[0], "steps");
    return cents_of_steps(steps, tuning_arg(a, 1));
  });
  def("ratioToCents", [](Args& a) -> json::Value {
    double numerator = assert_range(a[0], kMinValue, kMaxValue, "ratio numerator");
    double denominator = assert_range(a[1], kMinValue, kMaxValue, "ratio denominator");
    return ratio_to_cents(numerator, denominator);
  });
  def("justDeviationCents", [](Args& a) -> json::Value {
    auto semitone_class = static_cast<int>(assert_integer(a[0], "semitone class", 0, 12));
    return just_deviation_cents(semitone_class);
  });
}

//--------------------------------------------------------------------------------------------
// core/event-index

/** The index behind a `NoteEventIndex` handle, with the notes as the caller wrote them. */
class NoteEventIndexHandle : public Handle {
 public:
  static constexpr const char* kTypeName = "NoteEventIndex";

  NoteEventIndexHandle(NoteEventIndex index, json::Array raw_notes)
      : index_(std::move(index)),
        raw_notes_(std::move(raw_notes)),
        wrapper_ids_(raw_notes_.size()),
        note_ids_(raw_notes_.size()) {}

  const NoteEventIndex& index() const { return index_; }

  /** One indexed note as the wire holds it; the same objects keep the same identity tokens. */
  json::Value wrap(const IndexedNoteEvent& indexed) {
    std::size_t at = indexed.originalIndex;
    const json::Value& raw = raw_notes_[at];
    json::Object o;
    o.set("note", raw.is_object() && tag_of(raw) == Tag::kNone
                      ? with_identity(note_ids_[at], raw.as_object())
                      : raw);
    o.set("originalIndex", static_cast<double>(indexed.originalIndex));
    o.set("endBeat", indexed.endBeat);
    return with_identity(wrapper_ids_[at], o);
  }

 private:
  NoteEventIndex index_;
  json::Array raw_notes_;
  std::vector<Identity> wrapper_ids_;
  std::vector<Identity> note_ids_;
};

/** `opts.tieBreak ?? 'highest'`, refusing anything but the three tie-breaks. */
OnsetTieBreak read_tie_break(const json::Value& asked) {
  const json::Value* tie_break = opt_null_default(asked, "tieBreak");
  if (tie_break == nullptr) {
    return OnsetTieBreak::kHighest;
  }
  return *parse_onset_tie_break(
      assert_one_of(*tie_break, {"highest", "lowest", "last"}, "options.tieBreak"));
}

void register_event_index() {
  def(
      "createNoteEventIndex",
      [](Args& a) -> json::Value {
        const json::Value& asked = assert_options(a[1], "options");
        const json::Value* wire_name = opt_null_default(asked, "name");
        std::string name = wire_name == nullptr ? "note events" : js::template_string(*wire_name);
        json::Value events = a.take(0);
        std::vector<NoteEvent> notes = assert_note_events(events, name, asked);
        NoteEventIndexOptions options;
        options.name = name;
        options.allowNonPositiveDuration = js::truthy(get(asked, "allowNonPositiveDuration"));
        if (std::optional<double> budget = number_of(get(asked, "budget"))) {
          options.budget = budget;
        }
        options.tieBreak = read_tie_break(asked);
        return new_handle(std::make_shared<NoteEventIndexHandle>(NoteEventIndex(notes, options),
                                                                 std::move(events.as_array())));
      },
      kHandles);
  def_method<NoteEventIndexHandle>("NoteEventIndex#notes",
                                   [](NoteEventIndexHandle& self, Args&) -> json::Value {
                                     json::Array out;
                                     for (const IndexedNoteEvent& indexed : self.index().notes()) {
                                       out.push_back(self.wrap(indexed));
                                     }
                                     return json::Value(std::move(out));
                                   });
  def_method<NoteEventIndexHandle>("NoteEventIndex#at",
                                   [](NoteEventIndexHandle& self, Args& a) -> json::Value {
                                     double beat = assert_finite_number(a[1], "beat");
                                     std::optional<IndexedNoteEvent> found = self.index().at(beat);
                                     return found ? self.wrap(*found) : undefined_value();
                                   });
  def_method<NoteEventIndexHandle>("NoteEventIndex#attacksAt",
                                   [](NoteEventIndexHandle& self, Args& a) -> json::Value {
                                     double beat = assert_finite_number(a[1], "beat");
                                     return to_json(self.index().attacks_at(beat));
                                   });
  def_method<NoteEventIndexHandle>(
      "NoteEventIndex#onsetsBetween", [](NoteEventIndexHandle& self, Args& a) -> json::Value {
        double start_beat = assert_finite_number(a[1], "startBeat");
        double end_beat = assert_finite_number(a[2], "endBeat");
        return to_json(self.index().onsets_between(start_beat, end_beat));
      });
}

}  // namespace

void register_c2() {
  register_random();
  register_interval();
  register_pitch();
  register_duration();
  register_tempo();
  register_tuning();
  register_event_index();
}

}  // namespace cantus::ops
