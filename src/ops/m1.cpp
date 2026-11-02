// Op adapters of model/{shared, note, interval, duration, meter, tempo, tuning, instrument,
// voicing}.
//
// A model class crosses as a `$class` value; its methods and getters are ops `Type#member` whose
// first argument is the instance, and its factories are ops `Type.member`. An instance is decoded
// as the TS backend decodes it (ops/codec_m1.h). Each adapter then replays the TS prologue over
// the remaining wire arguments with the loose twins, in the TS order, and calls the typed class.

#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/model/duration.h"
#include "cantus/model/instrument.h"
#include "cantus/model/interval.h"
#include "cantus/model/meter.h"
#include "cantus/model/note.h"
#include "cantus/model/tempo.h"
#include "cantus/model/tuning.h"
#include "cantus/model/voicing.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "model/limits.gen.h"
#include "ops/accessors.h"
#include "ops/codec_m1.h"
#include "ops/codec_t1.h"
#include "ops/codec_t2.h"
#include "ops/codec_t3.h"
#include "ops/codec_t4.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"
#include "theory/partwriting/internal.h"
#include "theory/voicing/satb.h"

namespace cantus::ops {

namespace {

/** `Number.MIN_VALUE` and `Number.MAX_VALUE`. */
constexpr double kMaxValue = std::numeric_limits<double>::max();

/** A class value with the signs of the zeros its input wrote. */
template <class T>
json::Value echoed(const T& value, const json::Value& source) {
  json::Value out = to_json(value);
  restore_signed_zero(out, source);
  return out;
}

/** The wire object `{...fields}` of the named values; an undefined one is left out. */
json::Value record(std::initializer_list<std::pair<const char*, const json::Value*>> fields) {
  json::Object o;
  for (const auto& [name, value] : fields) {
    if (!is_undefined(*value)) {
      o.set(name, *value);
    }
  }
  return json::Value(std::move(o));
}

/** Whether argument `i` is a `$class` instance named `name`. */
bool is_instance(const Args& a, std::size_t i, std::string_view name) {
  const json::Value& v = a[i];
  const json::Value* tag = tag_of(v) == Tag::kClass ? v.as_object().find("$class") : nullptr;
  return tag != nullptr && tag->is_string() && tag->as_string() == name;
}

/**
 * `value.key` for an argument read through its public surface: on a class instance `data` is its
 * plain data and `isDescending` the flag the wire calls `descending`; every other getter has the
 * field of its name.
 */
json::Value surface_property(const json::Value& value, std::string_view key) {
  if (tag_of(value) != Tag::kClass) {
    return property_of(value, key);
  }
  if (key == "data") {
    const json::Value* name = value.as_object().find("$class");
    return name->is_string() && name->as_string() == "Voicing" ? get(value, "pitches")
                                                               : like_data(value);
  }
  return get(value, key == "isDescending" ? "descending" : key);
}

/** `held === read`, for a number the class holds. */
bool same_number(double held, const json::Value& read) {
  return js::strict_equals(json::Value(held), read);
}

/** `held === read`, for a text the class holds. */
bool same_text(std::string_view held, const json::Value& read) {
  return js::strict_equals(json::Value(std::string(held)), read);
}

/** `value?.key`. */
const json::Value& optional_property(const json::Value& value, std::string_view key) {
  return is_null_or_undefined(value) ? undefined_value() : get(value, key);
}

//--------------------------------------------------------------------------------------------
// model/note

/** `NATURAL_LETTER.test(letter)`, which reads `String(letter)`. */
bool is_natural_letter(const json::Value& letter) {
  std::string text = letter.is_string() ? letter.as_string() : js::template_string(letter);
  return text.size() == 1 && text[0] >= 'A' && text[0] <= 'G';
}

/** `letterNumberOf`: a number is the letter as written; a bare letter name is read by the parser.
 */
json::Value letter_number_of(const json::Value& letter) {
  if (js::type_of(letter) == "number") {
    return letter;
  }
  if (!is_natural_letter(letter)) {
    std::string shown = describe_rejected(letter);
    throw InvalidInputError(
        "Note.of takes a letter number 0..6 or a bare letter name 'C'..'B'; received " + shown +
        ". Use Note.parse(" + shown + ") to read a note name with an accidental or an octave.");
  }
  if (!letter.is_string()) {
    throw InvalidInputError("note must be a string; received " + js::type_of(letter));
  }
  return json::Value(static_cast<double>(try_parse_note(letter.as_string()).unwrap().letter));
}

/** The reading `tryParseNote` gives a text and its options, as a Note. */
ParseResult<Note> try_parse_note_text(const json::Value& text, const json::Value& options) {
  const json::Value& asked = assert_options(options, "opts");
  NoteNameOptions opts;
  try {
    if (!text.is_string()) {
      throw InvalidInputError("note must be a string; received " + js::type_of(text));
    }
    opts.system = read_note_name_system(asked);
  } catch (const InvalidInputError& e) {
    return ParseResult<Note>::failure(e);
  }
  return Note::try_parse(text.as_string(), opts);
}

/** `opts.system` of a note-name options bag. */
NoteNameOptions note_name_options(const json::Value& options) {
  NoteNameOptions opts;
  opts.system = read_note_name_system(assert_options(options, "opts"));
  return opts;
}

/** The instrument argument of a transposition: a name, or an interval read like
 * `toSpelledInterval`. */
IntervalArg read_instrument(const json::Value& instrument) {
  if (instrument.is_string()) {
    return IntervalArg(instrument.as_string());
  }
  return IntervalArg(read_interval_like(instrument));
}

/**
 * The note an argument stands for where TS reads `other.data`: an instance, or anything whose
 * `data` is note data (`assertNote`, under `name`).
 */
Note read_note_peer(const Args& a, std::size_t i, std::string_view name) {
  if (is_instance(a, i, "Note")) {
    return read_note_instance(a, i);
  }
  return Note(read_note(surface_property(a[i], "data"), name));
}

void register_note() {
  auto from_data = [](Args& a) -> json::Value { return echoed(read_note_data(a[0]), a[0]); };
  def_class_method("Note.constructor", from_data);
  def_class_method("Note.fromData", from_data);
  def_class_method("Note.fromJSON", from_data);
  def_class_method("Note.of", [](Args& a) -> json::Value {
    json::Value letter = letter_number_of(a[0]);
    json::Value alter = arg_or(a, 1, 0);
    json::Value data = record({{"letter", &letter}, {"alter", &alter}, {"octave", &a[2]}});
    return echoed(read_note_data(data), data);
  });
  def_class_method("Note.parse", [](Args& a) -> json::Value {
    return to_json(try_parse_note_text(a[0], a[1]).unwrap());
  });
  def_class_method("Note.tryParse",
                   [](Args& a) -> json::Value { return to_json(try_parse_note_text(a[0], a[1])); });
  def_class_method("Note.fromMidi", [](Args& a) -> json::Value {
    double midi = assert_finite_number(a[0], "midi");
    std::string spelling =
        assert_one_of(arg_or(a, 1, "sharp"),
                      std::vector<std::string_view>{to_string(MidiSpelling::kSharp),
                                                    to_string(MidiSpelling::kFlat)},
                      "midi spelling");
    return to_json(Note::from_midi(midi, *parse_midi_spelling(spelling)));
  });

  def_class_method("Note#name",
                   [](Args& a) -> json::Value { return read_note_instance(a, 0).name(); });
  def_class_method("Note#format", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    return self.format(note_name_options(a[1]));
  });
  def_class_method("Note#toString", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    return self.to_string(note_name_options(a[1]));
  });
  def_class_method("Note#pitchClass",
                   [](Args& a) -> json::Value { return read_note_instance(a, 0).pitch_class(); });
  def_class_method("Note#midi",
                   [](Args& a) -> json::Value { return read_note_instance(a, 0).midi(); });
  def_class_method("Note#letter", [](Args& a) -> json::Value {
    return echoed(read_note_instance(a, 0).letter(), get(a[0], "letter"));
  });
  def_class_method("Note#alter", [](Args& a) -> json::Value {
    return echoed(read_note_instance(a, 0).alter(), get(a[0], "alter"));
  });
  def_class_method("Note#octave", [](Args& a) -> json::Value {
    return to_json(read_note_instance(a, 0).octave());
  });
  auto data_method = [](Args& a) -> json::Value {
    return echoed(read_note_instance(a, 0).data(), a[0]);
  };
  def_class_method("Note#data", data_method);
  def_class_method("Note#toJSON", data_method);
  def_class_method("Note#frequency", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    // The MIDI number is read first, so a note with no octave is refused before the tuning is.
    self.midi();
    return a.undefined(1) ? self.frequency() : self.frequency(read_tuning(a[1]));
  });
  def_class_method("Note#transpose", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    std::optional<double> given = number_of(a[1]);
    if (given && *given == 0 && is_undefined(get(a[2], "spelling"))) {
      return echoed(self, a[0]);
    }
    const json::Value& asked = assert_options(a[2], "opts");
    if (!given || !std::isfinite(*given)) {
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
    return to_json(self.transpose(*given, opts));
  });
  def_class_method("Note#intervalTo", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    return to_json(self.interval_to(read_note_peer(a, 1, "b")));
  });
  def_class_method("Note#transposeBy", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    return to_json(self.transpose_by(IntervalArg(read_interval_like(a[1]))));
  });
  def_class_method("Note#withOctave", [](Args& a) -> json::Value {
    read_note_instance(a, 0);
    json::Value data = record(
        {{"letter", &get(a[0], "letter")}, {"alter", &get(a[0], "alter")}, {"octave", &a[1]}});
    return echoed(read_note_data(data), data);
  });
  def_class_method("Note#forInstrument", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    return to_json(self.for_instrument(read_instrument(a[1])));
  });
  def_class_method("Note#enharmonic", [](Args& a) -> json::Value {
    return to_json(read_note_instance(a, 0).enharmonic());
  });
  def_class_method("Note#degreeIn", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    return to_json(self.degree_in(KeyArg(read_key_like(a[1]))));
  });
  def_class_method("Note#compareTo", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    // `soundingOrder` asks for the octave before it reads the note any further.
    if (!is_instance(a, 1, "Note")) {
      property_of(surface_property(a[1], "data"), "octave");
    }
    return self.compare_to(read_note_peer(a, 1, "note"));
  });
  def_class_method("Note#equals", [](Args& a) -> json::Value {
    Note self = read_note_instance(a, 0);
    if (is_instance(a, 1, "Note")) {
      return self.equals(read_note_instance(a, 1));
    }
    // The other note is read through its public `data`, so anything carrying one compares.
    const json::Value& b = surface_property(a[1], "data");
    return same_number(self.letter(), property_of(b, "letter")) &&
           same_number(self.alter(), property_of(b, "alter")) &&
           js::strict_equals(self.octave() ? json::Value(*self.octave()) : undefined_value(),
                             property_of(b, "octave"));
  });
}

//--------------------------------------------------------------------------------------------
// model/interval

/** `parseInterval`'s refusal of a name that is not text. */
InvalidInputError interval_name_rejected(const json::Value& name) {
  return InvalidInputError(
      "interval must be a quality followed by a number, such as 'P5'; received " +
      describe_rejected(name));
}

ParseResult<Interval> try_parse_interval_text(const json::Value& name) {
  if (!name.is_string()) {
    return ParseResult<Interval>::failure(interval_name_rejected(name));
  }
  return Interval::try_parse(name.as_string());
}

void register_interval_class() {
  def_class_method("Interval.between", [](Args& a) -> json::Value {
    // `a.intervalTo(b)`: the first note measures, so only a Note can; the second is read for its
    // data alone.
    if (!is_instance(a, 0, "Note")) {
      throw InvalidInputError("interval a must be a Note; received " + describe_rejected(a[0]));
    }
    if (!is_instance(a, 1, "Note") &&
        (!is_js_object(a[1]) || !is_js_object(surface_property(a[1], "data")))) {
      throw InvalidInputError("interval b must be a Note; received " + describe_rejected(a[1]));
    }
    return to_json(Interval::between(read_note_instance(a, 0), read_note_peer(a, 1, "b")));
  });
  def_class_method("Interval.of", [](Args& a) -> json::Value {
    json::Value data = record({{"number", &a[0]}, {"quality", &a[1]}, {"semitones", &a[2]}});
    return echoed(read_interval_data(data), data);
  });
  auto from_data = [](Args& a) -> json::Value {
    return echoed(read_interval_data(a[0]), like_target(a[0]));
  };
  def_class_method("Interval.fromData", from_data);
  def_class_method("Interval.fromJSON", from_data);
  def_class_method("Interval.parse", [](Args& a) -> json::Value {
    return to_json(try_parse_interval_text(a[0]).unwrap());
  });
  def_class_method("Interval.tryParse",
                   [](Args& a) -> json::Value { return to_json(try_parse_interval_text(a[0])); });

  def_class_method("Interval#number",
                   [](Args& a) -> json::Value { return read_interval_instance(a, 0).number(); });
  def_class_method("Interval#quality",
                   [](Args& a) -> json::Value { return read_interval_instance(a, 0).quality(); });
  def_class_method("Interval#semitones", [](Args& a) -> json::Value {
    return echoed(read_interval_instance(a, 0).semitones(), get(a[0], "semitones"));
  });
  def_class_method("Interval#isDescending", [](Args& a) -> json::Value {
    return read_interval_instance(a, 0).is_descending();
  });
  def_class_method("Interval#name",
                   [](Args& a) -> json::Value { return read_interval_instance(a, 0).name(); });
  def_class_method("Interval#toString",
                   [](Args& a) -> json::Value { return read_interval_instance(a, 0).to_string(); });
  auto data_method = [](Args& a) -> json::Value {
    return echoed(read_interval_instance(a, 0).data(), a[0]);
  };
  def_class_method("Interval#data", data_method);
  def_class_method("Interval#toJSON", data_method);
  def_class_method("Interval#invert", [](Args& a) -> json::Value {
    return to_json(read_interval_instance(a, 0).invert());
  });
  def_class_method("Interval#negate", [](Args& a) -> json::Value {
    return to_json(read_interval_instance(a, 0).negate());
  });
  def_class_method("Interval#isConsonant", [](Args& a) -> json::Value {
    Interval self = read_interval_instance(a, 0);
    return self.is_consonant(assert_flag(arg_or(a, 1, true), "twoVoice"));
  });
  def_class_method("Interval#equals", [](Args& a) -> json::Value {
    Interval self = read_interval_instance(a, 0);
    if (is_instance(a, 1, "Interval")) {
      return self.equals(read_interval_instance(a, 1));
    }
    // The other interval is read through its public accessors.
    return same_number(self.number(), surface_property(a[1], "number")) &&
           same_text(self.quality(), surface_property(a[1], "quality")) &&
           same_number(self.semitones(), surface_property(a[1], "semitones")) &&
           js::strict_equals(json::Value(self.is_descending()),
                             surface_property(a[1], "isDescending"));
  });
}

//--------------------------------------------------------------------------------------------
// model/duration

/** `beatsToDuration`'s and `beatsToTiedDurations`'s reading of the length. */
double read_positive_beats(const json::Value& beats) {
  double value = assert_finite_number(beats, "beats");
  if (value <= 0) {
    throw InvalidInputError("beats must be positive; received " + js::to_string(value));
  }
  return value;
}

void register_duration_class() {
  def_class_method("Duration.of", [](Args& a) -> json::Value {
    json::Value dots = arg_or(a, 1, 0);
    json::Value data = record({{"base", &a[0]}, {"dots", &dots}, {"tuplet", &a[2]}});
    return echoed(read_duration_data(data), data);
  });
  def_class_method("Duration.ofBeats", [](Args& a) -> json::Value {
    double beats = read_positive_beats(a[0]);
    return to_json(Duration::of_beats(beats, read_duration_options(a[1])));
  });
  def_class_method("Duration.tieChain", [](Args& a) -> json::Value {
    double beats = read_positive_beats(a[0]);
    return to_json(Duration::tie_chain(beats, read_duration_options(a[1])));
  });
  auto from_data = [](Args& a) -> json::Value {
    return echoed(read_duration_data(a[0]), like_target(a[0]));
  };
  def_class_method("Duration.fromData", from_data);
  def_class_method("Duration.fromJSON", from_data);

  def_class_method("Duration#base", [](Args& a) -> json::Value {
    return to_json(read_duration_instance(a, 0).base());
  });
  def_class_method("Duration#dots", [](Args& a) -> json::Value {
    return echoed(read_duration_instance(a, 0).dots(), get(a[0], "dots"));
  });
  def_class_method("Duration#tuplet", [](Args& a) -> json::Value {
    return to_json(read_duration_instance(a, 0).tuplet());
  });
  auto data_method = [](Args& a) -> json::Value {
    return echoed(read_duration_instance(a, 0).data(), a[0]);
  };
  def_class_method("Duration#spelled", data_method);
  def_class_method("Duration#data", data_method);
  def_class_method("Duration#toJSON", data_method);
  def_class_method("Duration#beats", [](Args& a) -> json::Value {
    Duration self = read_duration_instance(a, 0);
    return self.beats(read_duration_options(a[1]));
  });
  def_class_method("Duration#equals", [](Args& a) -> json::Value {
    Duration self = read_duration_instance(a, 0);
    if (is_instance(a, 1, "Duration")) {
      return self.equals(read_duration_instance(a, 1));
    }
    // The other duration is read through its public `data`.
    const json::Value& b = surface_property(a[1], "data");
    std::optional<Tuplet> tuplet = self.tuplet();
    return same_text(to_string(self.base()), property_of(b, "base")) &&
           same_number(self.dots(), property_of(b, "dots")) &&
           js::strict_equals(tuplet ? json::Value(tuplet->actual) : undefined_value(),
                             optional_property(property_of(b, "tuplet"), "actual")) &&
           js::strict_equals(tuplet ? json::Value(tuplet->normal) : undefined_value(),
                             optional_property(property_of(b, "tuplet"), "normal"));
  });
  def_class_method("Duration#toString",
                   [](Args& a) -> json::Value { return read_duration_instance(a, 0).to_string(); });
}

//--------------------------------------------------------------------------------------------
// model/meter

std::string time_signature_rejected(const json::Value& text) {
  return "time signature must be a string; received " + js::type_of(text);
}

void register_meter_class() {
  def_class_method("Meter.of", [](Args& a) -> json::Value {
    json::Value data = record({{"numerator", &a[0]}, {"denominator", &a[1]}, {"grouping", &a[2]}});
    return to_json(read_meter_data(data));
  });
  def_class_method("Meter.parse", [](Args& a) -> json::Value {
    if (!a[0].is_string()) {
      throw InvalidInputError(time_signature_rejected(a[0]));
    }
    return to_json(Meter::parse(a[0].as_string()));
  });
  def_class_method("Meter.tryParse", [](Args& a) -> json::Value {
    if (!a[0].is_string()) {
      return to_json(ParseResult<Meter>::failure(InvalidInputError(time_signature_rejected(a[0]))));
    }
    return to_json(Meter::try_parse(a[0].as_string()));
  });
  auto from_data = [](Args& a) -> json::Value { return to_json(read_meter_data(a[0])); };
  def_class_method("Meter.fromData", from_data);
  def_class_method("Meter.fromJSON", from_data);

  def_class_method("Meter#numerator",
                   [](Args& a) -> json::Value { return read_meter_instance(a, 0).numerator(); });
  def_class_method("Meter#denominator",
                   [](Args& a) -> json::Value { return read_meter_instance(a, 0).denominator(); });
  def_class_method("Meter#grouping", [](Args& a) -> json::Value {
    return to_json(read_meter_instance(a, 0).grouping());
  });
  auto data_method = [](Args& a) -> json::Value {
    return to_json(read_meter_instance(a, 0).data());
  };
  def_class_method("Meter#data", data_method);
  def_class_method("Meter#toJSON", data_method);
  def_class_method("Meter#isCompound",
                   [](Args& a) -> json::Value { return read_meter_instance(a, 0).is_compound(); });
  def_class_method("Meter#beatsPerBar", [](Args& a) -> json::Value {
    return read_meter_instance(a, 0).beats_per_bar();
  });
  def_class_method("Meter#pulsesPerBar", [](Args& a) -> json::Value {
    return read_meter_instance(a, 0).pulses_per_bar();
  });
  def_class_method("Meter#pulseBeats",
                   [](Args& a) -> json::Value { return read_meter_instance(a, 0).pulse_beats(); });
  def_class_method("Meter#format", [](Args& a) -> json::Value {
    Meter self = read_meter_instance(a, 0);
    const json::Value& asked = assert_options(a[1], "opts");
    FormatTimeSignatureOptions opts;
    const json::Value& grouping = get(asked, "grouping");
    if (grouping.is_bool() && grouping.as_bool()) {
      opts.grouping = true;
    }
    return self.format(opts);
  });
  def_class_method("Meter#toString",
                   [](Args& a) -> json::Value { return read_meter_instance(a, 0).to_string(); });
  def_class_method("Meter#weightAt", [](Args& a) -> json::Value {
    Meter self = read_meter_instance(a, 0);
    return self.weight_at(assert_finite_number(a[1], "beat"));
  });
  def_class_method("Meter#isStrongBeat", [](Args& a) -> json::Value {
    Meter self = read_meter_instance(a, 0);
    return self.is_strong_beat(assert_finite_number(a[1], "beat"));
  });
  def_class_method("Meter#barPositionAt", [](Args& a) -> json::Value {
    Meter self = read_meter_instance(a, 0);
    return to_json(self.bar_position_at(assert_finite_number(a[1], "beat")));
  });
  def_class_method("Meter#formatPosition", [](Args& a) -> json::Value {
    Meter self = read_meter_instance(a, 0);
    auto decimals = static_cast<int>(assert_integer(arg_or(a, 2, 2), "decimals", 0, 100));
    return self.format_position(assert_finite_number(a[1], "beat"), decimals);
  });
  def_class_method("Meter#tuplet", [](Args& a) -> json::Value {
    Meter self = read_meter_instance(a, 0);
    double total = assert_range(a[1], 0, kMaxSafeInteger, "tuplet total beats");
    auto count = static_cast<int>(assert_positive_int(a[2], "tuplet count"));
    return to_json(self.tuplet(total, count));
  });
  def_class_method("Meter#equals", [](Args& a) -> json::Value {
    Meter self = read_meter_instance(a, 0);
    if (is_instance(a, 1, "Meter")) {
      return self.equals(read_meter_instance(a, 1));
    }
    // The other meter is read through its public `data`. An ungrouped meter compares the
    // signature first; a grouped one asks for the other's grouping before anything else.
    const json::Value& b = surface_property(a[1], "data");
    const std::optional<std::vector<int>>& grouping = self.grouping();
    if (!grouping) {
      return same_number(self.numerator(), property_of(b, "numerator")) &&
             same_number(self.denominator(), property_of(b, "denominator")) &&
             is_undefined(property_of(b, "grouping"));
    }
    const json::Value& theirs = property_of(b, "grouping");
    if (!same_number(self.numerator(), property_of(b, "numerator")) ||
        !same_number(self.denominator(), property_of(b, "denominator")) || is_undefined(theirs) ||
        !js::strict_equals(json::Value(static_cast<double>(grouping->size())), length_of(theirs))) {
      return false;
    }
    for (std::size_t index = 0; index < grouping->size(); ++index) {
      if (!theirs.is_array() || !same_number((*grouping)[index], theirs.as_array()[index])) {
        return false;
      }
    }
    return true;
  });
}

//--------------------------------------------------------------------------------------------
// model/tempo

void register_tempo_class() {
  def_class_method("Tempo.of",
                   [](Args& a) -> json::Value { return to_json(read_tempo_bpm(a[0])); });
  auto from_data = [](Args& a) -> json::Value { return to_json(read_tempo_data(a[0])); };
  def_class_method("Tempo.fromData", from_data);
  def_class_method("Tempo.fromJSON", from_data);

  def_class_method("Tempo#bpm",
                   [](Args& a) -> json::Value { return read_tempo_instance(a, 0).bpm(); });
  auto data_method = [](Args& a) -> json::Value {
    return to_json(read_tempo_instance(a, 0).data());
  };
  def_class_method("Tempo#data", data_method);
  def_class_method("Tempo#toJSON", data_method);
  def_class_method("Tempo#secondsAt", [](Args& a) -> json::Value {
    Tempo self = read_tempo_instance(a, 0);
    return self.seconds_at(assert_finite_number(a[1], "beat"));
  });
  def_class_method("Tempo#beatAtSeconds", [](Args& a) -> json::Value {
    Tempo self = read_tempo_instance(a, 0);
    return self.beat_at_seconds(assert_finite_number(a[1], "seconds"));
  });
  def_class_method("Tempo#secondsOf", [](Args& a) -> json::Value {
    Tempo self = read_tempo_instance(a, 0);
    return self.seconds_of(assert_range(a[1], 0, kMaxSafeInteger, "lengthBeats"));
  });
  def_class_method("Tempo#ticksAt", [](Args& a) -> json::Value {
    Tempo self = read_tempo_instance(a, 0);
    double beat = assert_finite_number(a[1], "beat");
    return self.ticks_at(beat, static_cast<int>(assert_positive_int(a[2], "ppq")));
  });
  def_class_method("Tempo#beatAtTicks", [](Args& a) -> json::Value {
    Tempo self = read_tempo_instance(a, 0);
    double ticks = assert_integer(a[1], "ticks");
    return self.beat_at_ticks(ticks, static_cast<int>(assert_positive_int(a[2], "ppq")));
  });
  def_class_method("Tempo#equals", [](Args& a) -> json::Value {
    Tempo self = read_tempo_instance(a, 0);
    if (is_instance(a, 1, "Tempo")) {
      return self.equals(read_tempo_instance(a, 1));
    }
    return same_number(self.bpm(), surface_property(a[1], "bpm"));
  });
  def_class_method("Tempo#toString",
                   [](Args& a) -> json::Value { return read_tempo_instance(a, 0).to_string(); });
}

//--------------------------------------------------------------------------------------------
// model/tuning

/** The tuning argument `i`, or nothing when it is undefined (the instance's own table). */
std::optional<TuningTable> tuning_override(const Args& a, std::size_t i) {
  if (a.undefined(i)) {
    return std::nullopt;
  }
  return read_tuning(a[i]);
}

void register_tuning_class() {
  def_class_method("Tuning.of",
                   [](Args& a) -> json::Value { return to_json(read_tuning_data(a[0])); });
  def_class_method("Tuning.edo", [](Args& a) -> json::Value {
    auto divisions = static_cast<int>(assert_positive_int(a[0], "EDO divisions"));
    double ref_freq = assert_range(arg_or(a, 1, 440), kMinValue, kMaxValue, "reference frequency");
    double ref_step = assert_finite_number(arg_or(a, 2, 69), "reference step");
    return to_json(Tuning::edo(divisions, ref_freq, ref_step));
  });
  def_class_method("Tuning.twelveTet",
                   [](Args&) -> json::Value { return to_json(Tuning::twelve_tet()); });
  auto from_data = [](Args& a) -> json::Value { return to_json(read_tuning_data(a[0])); };
  def_class_method("Tuning.fromData", from_data);
  def_class_method("Tuning.fromJSON", from_data);
  def_class_method("Tuning.ratioToCents", [](Args& a) -> json::Value {
    double numerator = assert_range(a[0], kMinValue, kMaxValue, "ratio numerator");
    double denominator = assert_range(a[1], kMinValue, kMaxValue, "ratio denominator");
    return Tuning::ratio_to_cents(numerator, denominator);
  });
  def_class_method("Tuning.centsToRatio", [](Args& a) -> json::Value {
    return Tuning::cents_to_ratio(assert_finite_number(a[0], "cents"));
  });
  def_class_method("Tuning.centsBetweenFreq", [](Args& a) -> json::Value {
    double first = assert_range(a[0], kMinValue, kMaxValue, "first frequency");
    double second = assert_range(a[1], kMinValue, kMaxValue, "second frequency");
    return Tuning::cents_between_freq(first, second);
  });
  def_class_method("Tuning.justDeviationCents", [](Args& a) -> json::Value {
    return Tuning::just_deviation_cents(
        static_cast<int>(assert_integer(a[0], "semitone class", 0, 12)));
  });

  def_class_method("Tuning#refStep",
                   [](Args& a) -> json::Value { return read_tuning_instance(a, 0).ref_step(); });
  def_class_method("Tuning#refFreq",
                   [](Args& a) -> json::Value { return read_tuning_instance(a, 0).ref_freq(); });
  def_class_method("Tuning#divisions",
                   [](Args& a) -> json::Value { return read_tuning_instance(a, 0).divisions(); });
  auto data_method = [](Args& a) -> json::Value {
    return to_json(read_tuning_instance(a, 0).data());
  };
  def_class_method("Tuning#data", data_method);
  def_class_method("Tuning#toJSON", data_method);
  def_class_method("Tuning#frequencyOf", [](Args& a) -> json::Value {
    Tuning self = read_tuning_instance(a, 0);
    NoteData note = read_note_like(a[1]);
    note_to_midi(note);
    return self.frequency_of(note, tuning_override(a, 2));
  });
  def_class_method("Tuning#frequencyOfStep", [](Args& a) -> json::Value {
    Tuning self = read_tuning_instance(a, 0);
    double step = assert_finite_number(a[1], "step");
    return self.frequency_of_step(step, tuning_override(a, 2));
  });
  def_class_method("Tuning#nearestStep", [](Args& a) -> json::Value {
    Tuning self = read_tuning_instance(a, 0);
    double freq = assert_range(a[1], kMinValue, kMaxValue, "frequency");
    return self.nearest_step(freq, tuning_override(a, 2));
  });
  def_class_method("Tuning#stepOf", [](Args& a) -> json::Value {
    Tuning self = read_tuning_instance(a, 0);
    double freq = assert_range(a[1], kMinValue, kMaxValue, "frequency");
    return self.step_of(freq, tuning_override(a, 2));
  });
  def_class_method("Tuning#centsFromNearestStep", [](Args& a) -> json::Value {
    Tuning self = read_tuning_instance(a, 0);
    double freq = assert_range(a[1], kMinValue, kMaxValue, "frequency");
    return self.cents_from_nearest_step(freq, tuning_override(a, 2));
  });
  def_class_method("Tuning#centsOfSteps", [](Args& a) -> json::Value {
    Tuning self = read_tuning_instance(a, 0);
    double steps = assert_finite_number(a[1], "steps");
    return self.cents_of_steps(steps, tuning_override(a, 2));
  });
  def_class_method("Tuning#stepsOfCents", [](Args& a) -> json::Value {
    Tuning self = read_tuning_instance(a, 0);
    double cents = assert_finite_number(a[1], "cents");
    return self.steps_of_cents(cents, tuning_override(a, 2));
  });
  def_class_method("Tuning#equals", [](Args& a) -> json::Value {
    Tuning self = read_tuning_instance(a, 0);
    if (is_instance(a, 1, "Tuning")) {
      return self.equals(read_tuning_instance(a, 1));
    }
    return same_number(self.ref_step(), surface_property(a[1], "refStep")) &&
           same_number(self.ref_freq(), surface_property(a[1], "refFreq")) &&
           same_number(self.divisions(), surface_property(a[1], "divisions"));
  });
  def_class_method("Tuning#toString",
                   [](Args& a) -> json::Value { return read_tuning_instance(a, 0).to_string(); });
}

//--------------------------------------------------------------------------------------------
// model/instrument

/**
 * The range `Math.min` and `Math.max` give over a tuning that wrote `-0`: the lowest pitch is
 * `-0` when any open string at 0 is, the highest only when every one is and the neck has no frets
 * to lift it.
 */
void restore_range_zeros(json::Value& range, const json::Value& instrument) {
  const json::Value& tuning = get(instrument, "tuning");
  if (!tuning.is_array()) {
    return;
  }
  bool any_negative = false;
  bool all_negative = true;
  for (const json::Value& open : tuning.as_array()) {
    std::optional<double> pitch = number_of(open);
    if (pitch && *pitch == 0) {
      bool negative = std::signbit(*pitch);
      any_negative = any_negative || negative;
      all_negative = all_negative && negative;
    }
  }
  json::Object& o = range.as_object();
  if (any_negative && o.find("low")->as_number() == 0) {
    *o.find("low") = json::Value(-0.0);
  }
  std::optional<double> frets = number_of(get(instrument, "frets"));
  if (any_negative && all_negative && frets && *frets == 0 && std::signbit(*frets) &&
      o.find("high")->as_number() == 0) {
    *o.find("high") = json::Value(-0.0);
  }
}

/** `sameList(held, read)`: the same length and the same value at every index. */
bool same_list(const std::vector<json::Value>& held, const json::Value& read) {
  if (!js::strict_equals(json::Value(static_cast<double>(held.size())), length_of(read))) {
    return false;
  }
  for (std::size_t index = 0; index < held.size(); ++index) {
    if (!js::strict_equals(held[index], element_of(read, index))) {
      return false;
    }
  }
  return true;
}

template <class T, class F>
std::vector<json::Value> wire_list(const std::vector<T>& values, F&& wire) {
  std::vector<json::Value> out;
  for (const T& value : values) {
    out.push_back(wire(value));
  }
  return out;
}

/** `Object.keys(value).length`; the TypeError JS raises for null and undefined. */
std::size_t key_count(const json::Value& value) {
  if (is_null_or_undefined(value)) {
    throw js::TypeError("Cannot convert undefined or null to object");
  }
  if (value.is_array()) {
    return value.as_array().size();
  }
  if (value.is_string()) {
    return js::utf16_length(value.as_string());
  }
  return value.is_object() && tag_of(value) == Tag::kNone ? value.as_object().size() : 0;
}

/** `a ?? []` for the list a reach table or an overdub holds, read off a wire value. */
json::Value list_or_empty(const json::Value& value) {
  return is_null_or_undefined(value) ? json::Value(json::Array{}) : value;
}

/** `Instrument#equals` against a profile read off another object, as TS compares them. */
bool instrument_equals_peer(const Instrument& self, const json::Value& b) {
  InstrumentProfile profile = self.data();
  auto name = [](const auto& p) { return json::Value(p.name); };
  auto polyphony = [](const auto& p) { return json::Value(p.polyphony); };
  if (!js::strict_equals(std::visit(name, profile), property_of(b, "name")) ||
      !js::strict_equals(json::Value(std::string(to_string(self.kind()))),
                         property_of(b, "kind")) ||
      !js::strict_equals(std::visit(polyphony, profile), property_of(b, "polyphony"))) {
    return false;
  }
  std::vector<json::Value> articulations = wire_list(
      self.articulations(), [](Articulation a) { return json::Value(std::string(to_string(a))); });
  if (!same_list(articulations, property_of(b, "articulations"))) {
    return false;
  }
  auto text = [](const auto& value) { return json::Value(std::string(to_string(value))); };
  if (const auto* stringed = std::get_if<StringedProfile>(&profile)) {
    const json::Value& fretless = property_of(b, "fretless");
    return js::strict_equals(json::Value("stringed"), property_of(b, "kind")) &&
           same_number(stringed->frets, property_of(b, "frets")) &&
           same_number(stringed->maxStretch, property_of(b, "maxStretch")) &&
           js::strict_equals(json::Value(stringed->fretless.value_or(false)),
                             is_null_or_undefined(fretless) ? json::Value(false) : fretless) &&
           same_list(wire_list(stringed->tuning, [](int p) { return json::Value(p); }),
                     property_of(b, "tuning"));
  }
  const auto& kit = std::get<PercussionProfile>(profile);
  if (!js::strict_equals(json::Value("percussion"), property_of(b, "kind")) ||
      !same_list(wire_list(kit.limbs, text), property_of(b, "limbs"))) {
    return false;
  }
  // sameReach: the same number of voices, and each voice's limbs where the other keeps them
  const json::Value& reach = property_of(b, "reach");
  if (kit.reach.size() != key_count(reach)) {
    return false;
  }
  for (const auto& [pitch, limbs] : kit.reach) {
    if (!same_list(wire_list(limbs, text), list_or_empty(element_of(reach, pitch)))) {
      return false;
    }
  }
  return same_list(
      wire_list(kit.overdub.value_or(std::vector<int>{}), [](int p) { return json::Value(p); }),
      list_or_empty(property_of(b, "overdub")));
}

/**
 * `pitch - open` is `-0` for a written `-0` pitch on a string written as `+0`: the fret of a
 * position found with such a pitch.
 */
void restore_open_string_frets(json::Value& fingerings, double pitch, const json::Value& tuning) {
  if (pitch != 0 || !std::signbit(pitch) || !tuning.is_array()) {
    return;
  }
  for (json::Value& position : fingerings.as_array()) {
    json::Object& o = position.as_object();
    auto string = static_cast<std::size_t>(o.find("string")->as_number());
    std::optional<double> open =
        string < tuning.as_array().size() ? number_of(tuning.as_array()[string]) : std::nullopt;
    if (o.find("fret")->as_number() == 0 && open && !std::signbit(*open)) {
      *o.find("fret") = json::Value(-0.0);
    }
  }
}

void register_instrument_class() {
  def_class_method("Instrument.of", [](Args& a) -> json::Value {
    return echoed(read_instrument_data(a[0]), like_target(a[0]));
  });
  auto from_data = [](Args& a) -> json::Value {
    return echoed(read_instrument_data(a[0]), like_target(a[0]));
  };
  def_class_method("Instrument.fromData", from_data);
  def_class_method("Instrument.fromJSON", from_data);
  def_class_method("Instrument.guitar",
                   [](Args&) -> json::Value { return to_json(Instrument::guitar()); });
  def_class_method("Instrument.guitarDropD",
                   [](Args&) -> json::Value { return to_json(Instrument::guitar_drop_d()); });
  def_class_method("Instrument.bass4",
                   [](Args&) -> json::Value { return to_json(Instrument::bass4()); });
  def_class_method("Instrument.bass5",
                   [](Args&) -> json::Value { return to_json(Instrument::bass5()); });

  def_class_method("Instrument#name",
                   [](Args& a) -> json::Value { return read_instrument_instance(a, 0).name(); });
  def_class_method("Instrument#toString", [](Args& a) -> json::Value {
    return read_instrument_instance(a, 0).to_string();
  });
  def_class_method("Instrument#kind", [](Args& a) -> json::Value {
    return std::string(to_string(read_instrument_instance(a, 0).kind()));
  });
  def_class_method("Instrument#polyphony", [](Args& a) -> json::Value {
    return echoed(read_instrument_instance(a, 0).polyphony(), get(a[0], "polyphony"));
  });
  def_class_method("Instrument#articulations", [](Args& a) -> json::Value {
    return to_json(read_instrument_instance(a, 0).articulations());
  });
  auto data_method = [](Args& a) -> json::Value {
    json::Value out = instrument_data_json(read_instrument_instance(a, 0).data());
    restore_signed_zero(out, a[0]);
    return out;
  };
  def_class_method("Instrument#data", data_method);
  def_class_method("Instrument#toJSON", data_method);
  def_class_method("Instrument#range", [](Args& a) -> json::Value {
    json::Value out = to_json(read_instrument_instance(a, 0).range());
    restore_range_zeros(out, a[0]);
    return out;
  });
  def_class_method("Instrument#canSound", [](Args& a) -> json::Value {
    Instrument self = read_instrument_instance(a, 0);
    return self.can_sound(static_cast<int>(assert_midi_pitch(a[1], "pitch")));
  });
  def_class_method("Instrument#fingerings", [](Args& a) -> json::Value {
    Instrument self = read_instrument_instance(a, 0);
    if (self.kind() != InstrumentKind::kStringed) {
      throw InvalidInputError(self.name() + " has no strings to finger");
    }
    double pitch = assert_midi_pitch(a[1], "pitch");
    json::Value out = to_json(self.fingerings(static_cast<int>(pitch)));
    restore_open_string_frets(out, pitch, get(a[0], "tuning"));
    return out;
  });
  def_class_method("Instrument#foldIntoRange", [](Args& a) -> json::Value {
    Instrument self = read_instrument_instance(a, 0);
    int pitch = static_cast<int>(assert_midi_pitch(a[1], "pitch"));
    int folded = self.fold_into_range(pitch);
    // A pitch the instrument already sounds comes back as it was written, `-0` included.
    return folded == pitch ? echoed(folded, a[1]) : json::Value(folded);
  });
  def_class_method("Instrument#soundingPitch", [](Args& a) -> json::Value {
    Instrument self = read_instrument_instance(a, 0);
    NoteData note = read_note_like(a[1]);
    if (a.undefined(2)) {
      return to_json(self.sounding_pitch(note));
    }
    return to_json(self.sounding_pitch(note, read_instrument(a[2])));
  });
  def_class_method("Instrument#playability", [](Args& a) -> json::Value {
    Instrument self = read_instrument_instance(a, 0);
    NoteEventAssertOptions note_options;
    note_options.allowNonPositiveDuration = true;
    std::vector<NoteEvent> notes = assert_note_events(a[1], "playability notes", note_options);
    std::optional<double> bpm;
    if (!a.undefined(2)) {
      bpm = assert_range(a[2], kMinValue, 1000, "playability bpm");
    }
    return to_json(self.playability(notes, bpm));
  });
  def_class_method("Instrument#equals", [](Args& a) -> json::Value {
    Instrument self = read_instrument_instance(a, 0);
    if (is_instance(a, 1, "Instrument")) {
      return self.equals(read_instrument_instance(a, 1));
    }
    return instrument_equals_peer(self, surface_property(a[1], "data"));
  });
}

//--------------------------------------------------------------------------------------------
// model/voicing

/** `chord.key` where a `Chord` carries one: an object, else nothing (`carriedKeyOf`). */
const json::Value* carried_key_of(const json::Value& chord) {
  if (!is_js_object(chord)) {
    return nullptr;
  }
  const json::Value& key = get(chord, "key");
  return is_js_object(key) ? &key : nullptr;
}

/** `withCarriedKey`: the voicing options with the chord's own key filled in. */
json::Value with_carried_key(const json::Value& chord, const json::Value& opts) {
  if (!is_undefined(get(opts, "key"))) {
    return opts;
  }
  const json::Value* key = carried_key_of(chord);
  if (key == nullptr) {
    return opts;
  }
  json::Object merged;
  if (opts.is_object() && tag_of(opts) == Tag::kNone) {
    for (const json::Member& m : opts.as_object()) {
      merged.set(m.key, m.value);
    }
  }
  merged.set("key", *key);
  return json::Value(std::move(merged));
}

/** `list.map` is no function: the TypeError of a `pitches` that is not a list, as a line. */
[[noreturn]] void line_not_a_list(const json::Value& list, const char* message) {
  property_of(list, "map");
  throw js::TypeError(message);
}

/** `spellLine` over a list of notes: a number is spelled by the key, anything else names itself. */
std::vector<NoteData> spell_wire_line(const json::Value& line, const ResolvedKey& key) {
  if (!line.is_array()) {
    property_of(line, "map");
    throw js::TypeError("line.map is not a function");
  }
  std::vector<NoteData> out;
  for (const json::Value& value : line.as_array()) {
    if (is_wire_number(value)) {
      double pitch = assert_finite_number(value, "pitch");
      out.push_back(spell_pitch(pitch, key.tonic, key));
    } else {
      out.push_back(read_note_like(value));
    }
  }
  return out;
}

/** The options bag of Voicing#independence without its `key`: `{key, ...rest} = opts ?? {}`. */
json::Value independence_rest(const json::Value& opts) {
  json::Object rest;
  if (opts.is_object() && tag_of(opts) == Tag::kNone) {
    for (const json::Member& m : opts.as_object()) {
      if (m.key != "key") {
        rest.set(m.key, m.value);
      }
    }
  }
  return json::Value(std::move(rest));
}

/**
 * The query `this.#context(query)` builds for a voicing, in the form the safety functions read:
 * the voices with the pitch each came from, the chord as chord data, and the key's scale.
 */
json::Value build_safety_query(const Voicing& self, const json::Value& query) {
  // `query.previous?.pitches`, then `previous?.[index]` for each voice
  const json::Value& given = property_of(query, "previous");
  json::Value previous =
      is_null_or_undefined(given) ? undefined_value() : surface_property(given, "pitches");
  const json::Value& chord = get(query, "chord");
  json::Value chord_data = chord.is_null() ? json::Value(nullptr) : read_chord_like(chord).wire;
  json::Value scale = to_json(resolve_key(read_key_arg(get(query, "key"))).scale);

  json::Array voices;
  for (std::size_t index = 0; index < self.pitches().size(); ++index) {
    json::Value before =
        is_null_or_undefined(previous) ? undefined_value() : element_of(previous, index);
    json::Value pitch(self.pitches()[index]);
    voices.push_back(record({{"pitch", &pitch}, {"prevPitch", &before}}));
  }
  json::Value other_voices(std::move(voices));
  return record({{"profile", &get(query, "profile")},
                 {"chord", &chord_data},
                 {"key", &scale},
                 {"otherVoices", &other_voices},
                 {"strongBeat", &get(query, "strongBeat")},
                 {"prevPitch", &get(query, "prevPitch")},
                 {"vocalLow", &get(query, "vocalLow")},
                 {"vocalHigh", &get(query, "vocalHigh")}});
}

void register_voicing_class() {
  auto from_pitches = [](Args& a) -> json::Value { return to_json(read_voicing_data(a[0])); };
  def_class_method("Voicing.constructor", from_pitches);
  def_class_method("Voicing.of", from_pitches);
  def_class_method("Voicing.fromData", from_pitches);
  def_class_method("Voicing.fromJSON", from_pitches);
  def_class_method("Voicing.satbRanges",
                   [](Args&) -> json::Value { return to_json(Voicing::satb_ranges()); });
  def_class_method("Voicing.forChord", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    ChordData data = read_chord_like(a[0]);
    StyledVoicingOptions opts;
    opts.style =
        parse_voicing_style(assert_one_of(opt_or(asked, "style", to_string(VoicingStyle::kClose)),
                                          voicing_style_names(), "styled voicing style"));
    if (const json::Value* octave = opt_null_default(asked, "octave")) {
      opts.octave = assert_integer(*octave, "styled voicing octave", -10, 10);
    }
    if (const json::Value* top = opt_strict(asked, "topNote")) {
      opts.topNote = assert_finite_number(*top, "styled voicing topNote");
    }
    const json::Value& rootless = get(asked, "rootless");
    opts.rootless = rootless.is_bool() && rootless.as_bool();
    return to_json(Voicing::for_chord(ChordArg(data.chord), opts));
  });
  def_class_method("Voicing.satb", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    json::Value given = with_carried_key(a[0], a[1]);
    const json::Value& asked = assert_options(given, "opts");
    VoicingOptions opts;
    read_ranges_option(asked, opts);
    read_max_spacing_option(asked, opts);
    read_max_candidates_option(asked, opts);
    read_voiced_chord(data, asked, opts);
    return to_json(Voicing::satb(ChordArg(data.chord), opts));
  });

  def_class_method("Voicing#pitches", [](Args& a) -> json::Value {
    return to_json(read_voicing_instance(a, 0).pitches());
  });
  def_class_method("Voicing#range", [](Args& a) -> json::Value {
    return to_json(read_voicing_instance(a, 0).range());
  });
  auto data_method = [](Args& a) -> json::Value {
    return to_json(read_voicing_instance(a, 0).data());
  };
  def_class_method("Voicing#data", data_method);
  def_class_method("Voicing#toJSON", data_method);
  def_class_method("Voicing#toString",
                   [](Args& a) -> json::Value { return read_voicing_instance(a, 0).to_string(); });
  def_class_method("Voicing#equals", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    if (is_instance(a, 1, "Voicing")) {
      return self.equals(read_voicing_instance(a, 1));
    }
    // The other voicing is read through its public `pitches`.
    const json::Value& theirs = surface_property(a[1], "pitches");
    const std::vector<double>& pitches = self.pitches();
    if (!js::strict_equals(json::Value(static_cast<double>(pitches.size())), length_of(theirs))) {
      return false;
    }
    for (std::size_t index = 0; index < pitches.size(); ++index) {
      if (!theirs.is_array() || !same_number(pitches[index], theirs.as_array()[index])) {
        return false;
      }
    }
    return true;
  });
  def_class_method("Voicing#costTo", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    if (is_instance(a, 1, "Voicing")) {
      return self.cost_to(read_voicing_instance(a, 1));
    }
    // The other voicing is read through its public `pitches`, held to the guard `voiceLeadingCost`
    // applies.
    return voice_leading_cost(self.pitches(),
                              read_voicing(surface_property(a[1], "pitches"), "to"));
  });
  def_class_method("Voicing#invert", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    auto n = static_cast<int>(assert_integer(a[1], "voicing inversion", -128, 128));
    return to_json(self.invert(n));
  });
  def_class_method("Voicing#spell", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    assert_key_argument(a[1], "voicing key");
    KeyArg key = read_key_arg(a[1]);
    ResolvedKey resolved = resolve_key(key);
    if (a.undefined(2)) {
      return to_json(self.spell(key));
    }
    // `spellVoicing` asserts the chord `toChordData` has read, then spells by it.
    ChordData data = read_chord_like(a[2]);
    settle_chord_quality(data);
    read_voicing_hints(self.pitches(), data.wire, resolved);
    return to_json(self.spell(key, ChordArg(data.chord)));
  });
  def_class_method("Voicing#next", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    ChordData data = read_chord_like(a[1]);
    json::Value given = with_carried_key(a[1], a[2]);
    const json::Value& asked = assert_options(given, "opts");
    VoicingOptions opts;
    // The ranges are read off the voicing unless the options name them.
    if (field(asked, "ranges") != nullptr || field(asked, "voices") != nullptr) {
      read_ranges_option(asked, opts);
    }
    read_max_spacing_option(asked, opts);
    read_max_candidates_option(asked, opts);
    read_next_voiced_chord(data, asked, opts);
    return to_json(self.next(ChordArg(data.chord), opts));
  });
  def_class_method("Voicing#checkTo", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    assert_key_argument(a[3], "voicing key");
    KeyArg key = read_key_arg(a[3]);
    ResolvedKey resolved = resolve_key(key);
    ChordData from = read_chord_like(element_of(a[2], 0));
    ChordData to = read_chord_like(element_of(a[2], 1));
    // Each `spellVoicing` reads its voicing, asserts its chord, then spells by it.
    settle_chord_quality(from);
    read_voicing_hints(self.pitches(), from.wire, resolved);
    bool instance = is_instance(a, 1, "Voicing");
    std::optional<Voicing> other;
    std::optional<SpelledVoicing> peer;
    if (instance) {
      other = read_voicing_instance(a, 1);
      settle_chord_quality(to);
      read_voicing_hints(other->pitches(), to.wire, resolved);
    } else {
      // Anything with a `pitches` list is read as a voicing.
      json::Value pitches = surface_property(a[1], "pitches");
      const json::Array& listed = assert_array(pitches, "voicing");
      settle_chord_quality(to);
      peer = spell_wire_voicing(listed, to.chord, to.wire, key);
    }
    const json::Value& asked = assert_options(a[4], "opts");
    PartWritingOptions opts;
    VoicingOptions limits;
    read_max_spacing_option(asked, limits);
    opts.maxSpacing = limits.maxSpacing;
    if (field(asked, "ranges") != nullptr) {
      read_ranges_option(asked, limits);
      opts.ranges = limits.ranges;
    }
    // The seventh of the chord left is found through the roles its spelling gives its tones.
    if (!from.chord.intervals.empty()) {
      reads_tone_letter_offsets(from.wire);
    }
    if (instance) {
      return to_json(self.check_to(*other, {ChordArg(from.chord), ChordArg(to.chord)}, key, opts));
    }
    std::vector<SpelledVoicing> voicings = {spell_voicing(self.pitches(), from.chord, resolved),
                                            *peer};
    return to_json(check_part_writing(voicings, {from.chord, to.chord}, resolved, opts));
  });
  def_class_method("Voicing#species", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    assert_key_argument(a[3], "voicing mode");
    KeyArg mode = read_key_arg(a[3]);
    ResolvedKey resolved = resolve_key(mode);
    // Both lines are spelled by the same reading, the cantus firmus first.
    std::vector<NoteData> given = spell_wire_line(a[1], resolved);
    const json::Value& asked = assert_options(a[4], "opts");
    std::optional<double> species = is_wire_number(a[2]) ? number_of(a[2]) : std::nullopt;
    if (!species || !is_species_number(*species)) {
      throw species_rejected(a[2]);
    }
    if (given.empty()) {
      throw InvalidInputError("checkSpecies needs both a cantus firmus and a counterpoint");
    }
    SpeciesOptions opts;
    if (const json::Value* durations = field(asked, "durations")) {
      std::vector<double> read;
      for (const json::Value& duration : assert_array(*durations, "durations")) {
        read.push_back(js::to_number(duration));
      }
      opts.durations = std::move(read);
    }
    if (const json::Value* above = opt_null_default(asked, "counterpointAbove")) {
      opts.counterpointAbove = js::truthy(*above);
    }
    std::vector<NoteArg> line(given.begin(), given.end());
    return to_json(self.species(line, static_cast<int>(*species), mode, opts));
  });
  def_class_method("Voicing#independence", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    VoicingIndependenceOptions opts;
    // `const { key, ...rest } = opts ?? {}`
    const json::Value& key = get(a[2], "key");
    if (!is_undefined(key)) {
      opts.key = read_key_arg(key);
      resolve_key(*opts.key);
    }
    json::Value rest = independence_rest(a[2]);
    if (is_instance(a, 1, "Voicing")) {
      Voicing other = read_voicing_instance(a, 1);
      if (self.pitches().size() != other.pitches().size()) {
        throw InvalidInputError(
            "voiceIndependence needs the two lines aligned slot for slot; received " +
            js::to_string(self.pitches().size()) + " and " + js::to_string(other.pitches().size()));
      }
      read_attack_arrays(rest, self.pitches().size(), opts);
      return to_json(self.independence(other, opts));
    }
    // Anything with a `pitches` list is read as a line: spelled by the key when there is one,
    // else as sharp-spelled MIDI notes.
    json::Value pitches = surface_property(a[1], "pitches");
    if (!pitches.is_array()) {
      line_not_a_list(pitches,
                      opts.key ? "line.map is not a function" : "pitches.map is not a function");
    }
    std::optional<ResolvedKey> resolved;
    if (opts.key) {
      resolved = resolve_key(*opts.key);
    }
    auto line_of = [&resolved](const json::Value& list) {
      std::vector<Nullable<NoteData>> out;
      if (resolved) {
        for (NoteData& note : spell_wire_line(list, *resolved)) {
          out.emplace_back(std::move(note));
        }
      } else {
        for (const json::Value& pitch : list.as_array()) {
          out.emplace_back(read_note_like(pitch));
        }
      }
      return out;
    };
    std::vector<Nullable<NoteData>> lead;
    for (double pitch : self.pitches()) {
      lead.emplace_back(resolved ? spell_pitch(pitch, resolved->tonic, *resolved)
                                 : to_note_data(NoteArg(pitch)));
    }
    std::vector<Nullable<NoteData>> counter = line_of(pitches);
    if (lead.size() != counter.size()) {
      throw InvalidInputError(
          "voiceIndependence needs the two lines aligned slot for slot; received " +
          js::to_string(lead.size()) + " and " + js::to_string(counter.size()));
    }
    read_attack_arrays(rest, lead.size(), opts);
    return to_json(voice_independence(lead, counter, opts));
  });
  def_class_method("Voicing#safetyOf", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    json::Value built = build_safety_query(self, a[2]);
    SafetyQuery query;
    static_cast<SafetyContext&>(query) = read_safety_context(built);
    query.candidatePitch = static_cast<int>(assert_midi_pitch(a[1], "candidatePitch"));
    const json::Value& asked = assert_options(a[3], "opts");
    EvaluateSafetyOptions opts;
    if (const json::Value* suggestions = opt_null_default(asked, "suggestions")) {
      opts.suggestions = js::truthy(*suggestions);
    }
    if (const json::Value* partners = opt_null_default(asked, "partners")) {
      opts.partners = js::truthy(*partners);
    }
    read_safety_harmony(built, query);
    return to_json(evaluate_safety(query, opts));
  });
  def_class_method("Voicing#safePitches", [](Args& a) -> json::Value {
    Voicing self = read_voicing_instance(a, 0);
    json::Value built = build_safety_query(self, a[1]);
    SafetyContext context = read_safety_context(built);
    double low = assert_midi_pitch(a[2], "pitchLow");
    double high = assert_midi_pitch(a[3], "pitchHigh");
    read_safety_harmony(built, context);
    return to_json(enumerate_safe_pitches(context, low, high));
  });
}

}  // namespace

void register_m1() {
  register_note();
  register_interval_class();
  register_duration_class();
  register_meter_class();
  register_tempo_class();
  register_tuning_class();
  register_instrument_class();
  register_voicing_class();
}

}  // namespace cantus::ops
