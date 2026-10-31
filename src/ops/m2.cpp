// Op adapters of model/{key, chord, progression, timeline, score}.
//
// A model class crosses as a `$class` value (ops/codec_m2.h). Each adapter replays the TS
// method's own prologue over the wire arguments, in the TS order, and reaches the function the
// method forwards to through that function's op, so the function's prologue runs exactly as it
// does when the function is called directly. Structural steps (transposing, re-keying, copying)
// run on the typed classes.

#include <cmath>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "analyze/keys/keys.h"
#include "analyze/reference/profile.h"
#include "cantus/analyze/arrange.h"
#include "cantus/core/errors.h"
#include "cantus/model/chord.h"
#include "cantus/model/key.h"
#include "cantus/model/progression.h"
#include "cantus/model/score.h"
#include "cantus/model/timeline.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "model/limits.gen.h"
#include "ops/accessors.h"
#include "ops/codec_a1a.h"
#include "ops/codec_a1b.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/codec_a3.h"
#include "ops/codec_a4.h"
#include "ops/codec_a5.h"
#include "ops/codec_c1.h"
#include "ops/codec_c2.h"
#include "ops/codec_m1.h"
#include "ops/codec_m2.h"
#include "ops/codec_t1.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `Number.MIN_VALUE`. */
constexpr double kMinValue = std::numeric_limits<double>::denorm_min();

/** The op a method forwards to, called with wire arguments. */
json::Value forward(const Args& a, std::string_view op, json::Array args) {
  Args delegated(args, a.context());
  return find_op(op)->fn(delegated);
}

/** The wire arguments from index `from` on, as an array. */
json::Array rest_of(const Args& a, std::size_t from) {
  json::Array out;
  for (std::size_t index = from; index < a.size(); ++index) {
    out.push_back(a[index]);
  }
  return out;
}

/** `value?.key`, read through the value's public surface. */
json::Value optional_property(const json::Value& value, std::string_view key) {
  return is_null_or_undefined(value) ? undefined_value() : member_of(value, key);
}

/** `value.key`: the TypeError JS raises for null or undefined, else the member. */
json::Value member_or_throw(const json::Value& value, std::string_view key) {
  property_of(value, key);
  return member_of(value, key);
}

/** `{...first, ...second}` over wire values. */
json::Value merged(std::initializer_list<const json::Value*> parts) {
  json::Object out;
  for (const json::Value* part : parts) {
    spread_into(out, *part);
  }
  return json::Value(std::move(out));
}

/** A one-field record, for the context a method lays under the caller's options. */
json::Value field_record(const char* name, json::Value value) {
  json::Object o;
  if (!is_undefined(value)) {
    o.set(name, std::move(value));
  }
  return json::Value(std::move(o));
}

/** A chord the theory layer returned, wrapped with a key context. */
json::Value wrapped_chord(const json::Value& data, const std::optional<Key>& key) {
  Chord chord = read_chord_data(data);
  return to_json(key ? ChordValue(chord, KeyArg(*key)) : ChordValue(chord));
}

/** A record with one field replaced in place. */
json::Value with_field(const json::Value& record, std::string_view name, const json::Value& value) {
  json::Object out;
  for (const json::Member& m : record.as_object()) {
    out.set(m.key, m.key == name ? value : m.value);
  }
  return json::Value(std::move(out));
}

/**
 * A degree chord without the spelling its builder attached: the chord carries the key, which
 * spells its root on read.
 */
json::Value without_spelling(const json::Value& chord) {
  json::Object out;
  for (const json::Member& m : chord.as_object()) {
    if (m.key != "rootSpelling" && m.key != "bassSpelling" && m.key != "toneSpellings") {
      out.set(m.key, m.value);
    }
  }
  return json::Value(std::move(out));
}

/** A typed value with the signs of the zeros its source wrote at the same place. */
json::Value with_signed_zeros(json::Value value, const json::Value& source) {
  restore_signed_zero(value, source);
  return value;
}

//--------------------------------------------------------------------------------------------
// model/key

/** A key as a constructor or a function argument takes it: the instance itself. */
json::Value key_wire(const Key& key) { return to_json(key); }

/** A key's plain data with the zeros its instance argument wrote in the tonic. */
json::Value key_data_echo(const Key& key, const json::Value& source) {
  json::Value out = key_data_json(key.data());
  if (is_js_object(source)) {
    restore_signed_zero(*out.as_object().find("tonic"), get(source, "tonic"));
  }
  return out;
}

/** A key instance with the zeros its source wrote in the tonic. */
json::Value key_echo(const Key& key, const json::Value& source) {
  json::Value out = key_wire(key);
  if (is_js_object(source)) {
    restore_signed_zero(*out.as_object().find("tonic"), get(source, "tonic"));
  }
  return out;
}

/** `describeTonic`: how a value that is not the class API's Note is named. */
std::string describe_tonic(const json::Value& value) {
  if (!is_js_object(value)) {
    return js::string_of(value);
  }
  bool numbers = js::type_of(member_of(value, "letter")) == "number" &&
                 js::type_of(member_of(value, "alter")) == "number";
  return numbers ? "plain note data" : "an object that is not a note";
}

/** `isNoteInstance`, read structurally: a numeric `pitchClass` beside an object `data`. */
bool is_note_like(const json::Value& value) {
  if (!is_js_object(value)) {
    return false;
  }
  json::Value data = member_of(value, "data");
  return js::type_of(member_of(value, "pitchClass")) == "number" &&
         (data.is_null() || js::type_of(data) == "object");
}

/** `new Key(scale, tonic, variant)` over wire values. */
Key construct_key(const json::Value& scale, const json::Value& tonic, const json::Value& variant) {
  assert_data_object(scale, "scale");
  double root = assert_integer(member_of(scale, "rootPc"), "scale.rootPc");
  double mask =
      assert_integer(member_of(scale, "modeMask12"), "scale.modeMask12", 1, CHROMATIC_MASK);
  if ((static_cast<int>(mask) & 1) == 0) {
    // The typed constructor refuses a mask without its tonic before it reads the tonic.
    Key(KeyScale{pitch_class_of(root), static_cast<int>(mask)}, Note(NoteData{}));
  }
  if (!is_note_like(tonic)) {
    throw InvalidInputError("tonic must be the class API's Note; received " +
                            describe_tonic(tonic) +
                            "; wrap plain note data with Note.fromData, or omit the tonic to have "
                            "one chosen");
  }
  // A note read structurally is held to the checks of the note it stands for.
  Note note = is_class_value(tonic, "Note") ? read_note_data(tonic)
                                            : read_note_data(member_of(tonic, "data"));
  return read_key_parts(scale, note, variant);
}

/** The spelled key/scale a key factory op returned, as the key on its spelled tonic. */
Key key_on_spelled_scale(const json::Value& spelled) {
  KeyScale scale{static_cast<int>(*number_of(get(spelled, "rootPc"))),
                 static_cast<int>(*number_of(get(spelled, "modeMask12")))};
  return Key(scale, read_note_data(get(spelled, "tonic")));
}

/** `Key.tryParse(text, opts)`. */
ParseResult<Key> try_parse_key(const Args& a, const json::Value& text, const json::Value& options) {
  json::Value view = options_view(options);
  const json::Value& asked = assert_options(view, "opts");
  if (!text.is_string()) {
    // The name reader's refusal of a value that is not text.
    try {
      forward(a, "parseKeyName", json::Array{text, asked});
    } catch (const InvalidInputError& e) {
      return ParseResult<Key>::failure(e);
    }
    throw std::logic_error("parseKeyName read a key name that is not text");
  }
  NoteNameOptions opts;
  try {
    opts.system = read_note_name_system(asked);
  } catch (const InvalidInputError& e) {
    return ParseResult<Key>::failure(e);
  }
  return Key::try_parse(text.as_string(), opts);
}

/** `detectedKeyMatch` over a match a detection op returned. */
json::Value detected_key_match_wire(const json::Value& match) {
  ResolvedKey resolved = resolve_key(read_key_like(get(match, "key")));
  resolved.variant = *parse_key_variant(get(match, "variant").as_string());
  return with_field(match, "key", key_wire(Key::from_json(resolved)));
}

/** The instrument argument of a transposition: a name, or an interval. */
IntervalArg read_transposing_instrument(const json::Value& instrument) {
  if (instrument.is_string()) {
    return IntervalArg(instrument.as_string());
  }
  return IntervalArg(read_interval_like(instrument));
}

/** `mode === 'minor'`: anything else reads as major. */
KeyMode mode_named(const json::Value& mode) {
  return mode.is_string() && mode.as_string() == "minor" ? KeyMode::kMinor : KeyMode::kMajor;
}

/** A tonic as bare note data, as `{ letter, alter }` writes it. */
json::Value bare_tonic(const Note& tonic) {
  json::Object o;
  o.set("letter", to_json(tonic.letter()));
  o.set("alter", to_json(tonic.alter()));
  return json::Value(std::move(o));
}

void register_key() {
  def_class_method("Key.constructor", [](Args& a) -> json::Value {
    // The tonic is kept as the instance holds it, so a `-0` alteration survives.
    json::Value source = wire_record({{"tonic", &a[1]}});
    return key_echo(construct_key(a[0], a[1], a[2]), source);
  });
  def_class_method("Key.major", [](Args& a) -> json::Value {
    if (a[0].is_string()) {
      return key_wire(Key::major(a[0].as_string()));
    }
    return key_wire(key_on_spelled_scale(forward(a, "majorKey", json::Array{a[0]})));
  });
  def_class_method("Key.minor", [](Args& a) -> json::Value {
    if (a[0].is_string()) {
      return key_wire(Key::minor(a[0].as_string()));
    }
    return key_wire(key_on_spelled_scale(forward(a, "minorKey", json::Array{a[0]})));
  });
  def_class_method("Key.named", [](Args& a) -> json::Value {
    if (a[1].is_string()) {
      Note tonic = Note::parse(a[1].as_string());
      json::Value scale = forward(a, "scaleByName", json::Array{a[0], tonic.pitch_class()});
      KeyScale key{static_cast<int>(*number_of(get(scale, "rootPc"))),
                   static_cast<int>(*number_of(get(scale, "modeMask12")))};
      return key_wire(Key(key, tonic));
    }
    double root = pitch_class_of(assert_finite_number(a[1], "pitch"));
    return key_wire(key_on_spelled_scale(forward(a, "scaleByName", json::Array{a[0], root})));
  });
  def_class_method("Key.parse", [](Args& a) -> json::Value {
    return key_wire(try_parse_key(a, a[0], a[1]).unwrap());
  });
  def_class_method("Key.tryParse",
                   [](Args& a) -> json::Value { return to_json(try_parse_key(a, a[0], a[1])); });
  def_class_method("Key.fromFifths", [](Args& a) -> json::Value {
    return key_wire(read_key_data(forward(a, "keyFromFifths", json::Array{a[0], a[1]})));
  });
  def_class_method("Key.of", [](Args& a) -> json::Value {
    json::Value resolved = forward(a, "resolveKey", json::Array{a[0]});
    json::Value tonic =
        is_null_or_undefined(a[1]) ? to_json(read_note_data(get(resolved, "tonic"))) : a[1];
    return key_wire(construct_key(get(resolved, "scale"), tonic, get(resolved, "variant")));
  });
  auto from_data = [](Args& a) -> json::Value { return key_echo(read_key_data(a[0]), a[0]); };
  def_class_method("Key.fromData", from_data);
  def_class_method("Key.fromJSON", from_data);
  def_class_method("Key.detect", [](Args& a) -> json::Value {
    json::Array out;
    json::Value match_list = forward(a, "detectKey", json::Array{a[0], options_view(a[1])});
    for (const json::Value& match : match_list.as_array()) {
      out.push_back(get(detected_key_match_wire(match), "key"));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Key.detectMatches", [](Args& a) -> json::Value {
    json::Array out;
    json::Value match_list = forward(a, "detectKey", json::Array{a[0], options_view(a[1])});
    for (const json::Value& match : match_list.as_array()) {
      out.push_back(detected_key_match_wire(match));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Key.detectBest", [](Args& a) -> json::Value {
    json::Value best = forward(a, "detectKeyBest", json::Array{a[0], options_view(a[1])});
    return best.is_null() ? best : get(detected_key_match_wire(best), "key");
  });

  def_class_method("Key#scale",
                   [](Args& a) -> json::Value { return to_json(read_key_instance(a, 0).scale()); });
  def_class_method("Key#tonic", [](Args& a) -> json::Value {
    return with_signed_zeros(to_json(read_key_instance(a, 0).tonic()), get(a[0], "tonic"));
  });
  def_class_method("Key#rootPc",
                   [](Args& a) -> json::Value { return read_key_instance(a, 0).root_pc(); });
  def_class_method("Key#isMinor",
                   [](Args& a) -> json::Value { return read_key_instance(a, 0).is_minor(); });
  def_class_method("Key#fifths",
                   [](Args& a) -> json::Value { return read_key_instance(a, 0).fifths(); });
  def_class_method("Key#scaleName", [](Args& a) -> json::Value {
    std::optional<std::string_view> name = read_key_instance(a, 0).scale_name();
    return name ? json::Value(std::string(*name)) : undefined_value();
  });
  auto data = [](Args& a) -> json::Value { return key_data_echo(read_key_instance(a, 0), a[0]); };
  def_class_method("Key#data", data);
  def_class_method("Key#toJSON", data);
  def_class_method("Key#variant", [](Args& a) -> json::Value {
    return to_json(read_key_instance(a, 0).variant());
  });
  def_class_method("Key#pitchClasses", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    const json::Value& order = optional_property(a[1], "order");
    PitchClassOrder read = PitchClassOrder::kDegree;
    if (!is_undefined(order)) {
      read = *parse_pitch_class_order(
          assert_one_of(order,
                        std::vector<std::string_view>{to_string(PitchClassOrder::kDegree),
                                                      to_string(PitchClassOrder::kAscending)},
                        "pitch-class order"));
    }
    return to_json(self.pitch_classes(read));
  });
  def_class_method("Key#system", [](Args& a) -> json::Value {
    return to_json(read_key_instance(a, 0).system());
  });
  def_class_method("Key#supportsFunctionalHarmony", [](Args& a) -> json::Value {
    return read_key_instance(a, 0).supports_functional_harmony();
  });
  def_class_method("Key#relative", [](Args& a) -> json::Value {
    return key_wire(read_key_instance(a, 0).relative());
  });
  def_class_method("Key#parallel", [](Args& a) -> json::Value {
    return key_wire(read_key_instance(a, 0).parallel());
  });
  def_class_method("Key#dominantKey", [](Args& a) -> json::Value {
    return key_wire(read_key_instance(a, 0).dominant_key());
  });
  def_class_method("Key#subdominantKey", [](Args& a) -> json::Value {
    return key_wire(read_key_instance(a, 0).subdominant_key());
  });
  def_class_method("Key#enharmonic", [](Args& a) -> json::Value {
    Nullable<Key> other = read_key_instance(a, 0).enharmonic();
    return other ? key_wire(*other) : json::Value(nullptr);
  });
  def_class_method("Key#relatedKeys", [](Args& a) -> json::Value {
    json::Array out;
    for (const RelatedKeyEntry& related : read_key_instance(a, 0).related_keys()) {
      json::Object o;
      o.set("relation", to_json(related.relation));
      o.set("key", key_wire(related.key));
      out.push_back(json::Value(std::move(o)));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Key#relationTo", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    // Both keys are read through their own `toJSON`.
    if (tag_of(a[1]) != Tag::kClass && tag_of(a[1]) != Tag::kToJson) {
      property_of(a[1], "toJSON");
      throw js::TypeError("other.toJSON is not a function");
    }
    return forward(a, "keyRelationBetween",
                   json::Array{key_data_json(self.data()), class_to_json(a[1])});
  });
  def_class_method("Key#pivotsTo", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    assert_key_argument(a[1], "key");
    json::Array out;
    json::Value pivot_list =
        forward(a, "pivotChords", json::Array{key_data_json(self.data()), a[1]});
    for (const json::Value& pivot : pivot_list.as_array()) {
      out.push_back(with_field(pivot, "chord", wrapped_chord(get(pivot, "chord"), self)));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Key#degree", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    auto count = static_cast<double>(self.notes().size());
    return to_json(self.degree(assert_integer(a[1], "degree", 1, count)));
  });
  def_class_method("Key#keyOnDegree", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    auto count = static_cast<double>(self.notes().size());
    double n = assert_integer(a[1], "degree", 1, count);
    std::optional<KeyMode> mode;
    if (!is_null_or_undefined(a[2])) {
      mode = mode_named(a[2]);
    }
    return key_wire(self.key_on_degree(n, mode));
  });
  def_class_method("Key#keyHavingTonicAsDegree", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    std::optional<KeyMode> mode;
    if (!is_null_or_undefined(a[2])) {
      mode = mode_named(a[2]);
    }
    // The degree is counted on the major or minor scale the result is built on.
    double n = assert_integer(a[1], "degree", 1, KEY_HEPTATONIC_DEGREES);
    return key_wire(self.key_having_tonic_as_degree(n, mode));
  });
  def_class_method("Key#transposeBy", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    return key_wire(self.transpose_by(IntervalArg(read_interval_like(a[1]))));
  });
  def_class_method("Key#intervalTo", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    if (is_class_value(a[1], "Key")) {
      return to_json(self.interval_to(read_key_instance(a, 1)));
    }
    // The other key is read through its `tonic`, octave left behind.
    json::Value tonic = member_or_throw(a[1], "tonic");
    json::Value letter = member_or_throw(tonic, "letter");
    json::Value alter = member_of(tonic, "alter");
    json::Value to = wire_record({{"letter", &letter}, {"alter", &alter}});
    json::Value interval = forward(a, "spelledInterval", json::Array{bare_tonic(self.tonic()), to});
    return to_json(read_interval_data(interval));
  });
  def_class_method("Key#transpose", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    return key_wire(self.transpose(assert_finite_number(a[1], "semitones")));
  });
  def_class_method("Key#forInstrument", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    return key_wire(self.for_instrument(read_transposing_instrument(a[1])));
  });
  auto notes = [](Args& a) -> json::Value { return to_json(read_key_instance(a, 0).notes()); };
  def_class_method("Key#notes", notes);
  def_class_method("Key#spell", notes);
  def_class_method("Key#noteNames", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    NoteNameOptions opts;
    json::Value view = options_view(a[1]);
    opts.system = read_note_name_system(assert_options(view, "opts"));
    return to_json(self.note_names(opts));
  });
  def_class_method("Key#spellPitchClasses", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    json::Value anchor =
        is_undefined(a[2]) ? to_json(self.tonic().data()) : to_json(read_note_like(a[2]));
    json::Value pcs(spread_iterable(a[1], "pcs"));
    json::Value spelled =
        forward(a, "spellPitchClasses", json::Array{pcs, anchor, to_json(self.scale())});
    json::Array out;
    for (const json::Value& note : spelled.as_array()) {
      out.push_back(to_json(read_note_data(note)));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Key#chord", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    json::Value key = key_data_json(self.data());
    json::Value data = is_undefined(a[2])
                           ? forward(a, "diatonicTriad", json::Array{a[1], key})
                           : forward(a, "chordFromDegree", json::Array{a[1], a[2], key});
    return wrapped_chord(without_spelling(data), self);
  });
  def_class_method("Key#diatonicTriad", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    return wrapped_chord(without_spelling(forward(a, "diatonicTriad",
                                                  json::Array{a[1], key_data_json(self.data())})),
                         self);
  });
  def_class_method("Key#diatonicSeventh", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    return wrapped_chord(without_spelling(forward(a, "diatonicSeventh",
                                                  json::Array{a[1], key_data_json(self.data())})),
                         self);
  });
  def_class_method("Key#roman", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    return wrapped_chord(forward(a, "romanToChord", json::Array{a[1], key_wire(self)}), self);
  });
  def_class_method("Key#augmentedSixth", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    return wrapped_chord(
        forward(a, "augmentedSixthChord", json::Array{a[1], key_data_json(key_identity(self))}),
        self);
  });
  def_class_method("Key#progression", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    json::Array chords;
    for (const json::Value& text : rest_of(a, 1)) {
      chords.push_back(
          wrapped_chord(forward(a, "romanToChord", json::Array{text, key_wire(self)}), self));
    }
    return to_json(read_progression_value(json::Value(std::move(chords)), key_wire(self)));
  });
  def_class_method("Key#contains", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    json::Value pitch = js::type_of(a[1]) == "number" ? a[1] : member_or_throw(a[1], "pitchClass");
    return forward(a, "isScaleTone", json::Array{pitch, to_json(self.scale())});
  });
  def_class_method("Key#nearestTone", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    return forward(a, "nearestScaleTone", json::Array{a[1], to_json(self.scale())});
  });
  def_class_method("Key#degreeOf", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    json::Value degree = forward(a, "pitchToScaleDegree", json::Array{a[1], to_json(self.scale())});
    return js::strict_equals(degree, json::Value(-1.0)) ? json::Value(nullptr) : degree;
  });
  def_class_method("Key#toString", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    const json::Value& system = optional_property(a[1], "system");
    if (!is_undefined(system) && !(system.is_string() && system.as_string() == "english")) {
      json::Object named;
      named.set("tonic", to_json(self.tonic().data()));
      named.set("mode", self.is_minor() ? "minor" : "major");
      return forward(a, "formatKeyName",
                     json::Array{json::Value(std::move(named)), options_view(a[1])});
    }
    return self.to_string();
  });
  def_class_method("Key#equals", [](Args& a) -> json::Value {
    Key self = read_key_instance(a, 0);
    if (is_class_value(a[1], "Key")) {
      return self.equals(read_key_instance(a, 1));
    }
    // The other key is read through its public `scale`.
    json::Value scale = member_or_throw(a[1], "scale");
    return js::strict_equals(json::Value(self.root_pc()), member_or_throw(scale, "rootPc")) &&
           js::strict_equals(json::Value(self.scale().modeMask12), member_of(scale, "modeMask12"));
  });
}

//--------------------------------------------------------------------------------------------
// model/chord

/** A chord's `data` view, which the functions it forwards to are handed. */
json::Value view_of(const ChordValue& chord) { return chord_view_json(chord); }

/** `#dataWithKey(key)`: the caller's own spellings, the rest derived from `key`. */
json::Value view_in(const ChordValue& chord, const Key& key) {
  return view_of(chord.with_key(KeyArg(key)));
}

/** `#resolveKey(key)`: the explicit key, else the carried one. */
Key chord_analysis_key(const ChordValue& chord, const json::Value& key) {
  std::optional<Key> given = read_key_argument(key, "chord key");
  if (given) {
    return *given;
  }
  if (!chord.key()) {
    throw InvalidInputError("chord has no key context; pass a Key or attach one with withKey()");
  }
  return *chord.key();
}

/** A chord method that reads `fn(this.#data, key, ...rest)` through the function's op. */
OpFn chord_analysis(const char* op, std::size_t extra) {
  return [op, extra](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    Key key = chord_analysis_key(self, a[1]);
    json::Array args{view_in(self, key), key_wire(key)};
    for (std::size_t index = 0; index < extra; ++index) {
      args.push_back(options_view(a[2 + index]));
    }
    return forward(a, op, std::move(args));
  };
}

/** `chord.equals(other)` against any value, read through its public `data`. */
bool chord_equals_wire(const ChordValue& chord, const json::Value& other) {
  if (is_class_value(other, "Chord")) {
    return chord.equals(read_chord_class(other));
  }
  Chord mine = chord.data();
  json::Value theirs = member_or_throw(other, "data");
  if (!js::strict_equals(json::Value(mine.rootPc), member_or_throw(theirs, "rootPc")) ||
      !js::strict_equals(to_json(mine.quality), member_of(theirs, "quality")) ||
      !js::strict_equals(mine.bassPc ? json::Value(*mine.bassPc) : undefined_value(),
                         member_of(theirs, "bassPc"))) {
    return false;
  }
  json::Value intervals = member_of(theirs, "intervals");
  if (!js::strict_equals(json::Value(static_cast<double>(mine.intervals.size())),
                         length_of(intervals))) {
    return false;
  }
  for (std::size_t index = 0; index < mine.intervals.size(); ++index) {
    if (!js::strict_equals(json::Value(mine.intervals[index]), element_of(intervals, index))) {
      return false;
    }
  }
  return true;
}

/** `Chord.tryParse(symbol, opts)` over the parser's op. */
json::Value try_parse_chord(const Args& a) {
  json::Value parsed = forward(a, "tryParseChordSymbol", json::Array{a[0], options_view(a[1])});
  const json::Value& ok = get(parsed, "ok");
  if (!(ok.is_bool() && ok.as_bool())) {
    return parsed;
  }
  return with_field(parsed, "value", wrapped_chord(get(parsed, "value"), std::nullopt));
}

/** `new Chord(makeChord(match.rootPc, match.quality, match.bassPc))` of a detection match. */
json::Value chord_of_match(const Args& a, const json::Value& match) {
  return wrapped_chord(
      forward(a, "makeChord",
              json::Array{get(match, "rootPc"), get(match, "quality"), get(match, "bassPc")}),
      std::nullopt);
}

void register_chord() {
  def_class_method("Chord.constructor",
                   [](Args& a) -> json::Value { return to_json(read_chord_value(a[0], a[1])); });
  auto from_data = [](Args& a) -> json::Value {
    return to_json(read_chord_value(a[0], undefined_value()));
  };
  def_class_method("Chord.fromData", from_data);
  def_class_method("Chord.fromJSON", from_data);
  def_class_method("Chord.of", [](Args& a) -> json::Value {
    // The bass is read first, then the root; a named one keeps its spelling.
    std::optional<Note> bass_note;
    if (a[2].is_string()) {
      bass_note = Note::parse(a[2].as_string());
    }
    std::optional<Note> root_note;
    if (a[0].is_string()) {
      root_note = Note::parse(a[0].as_string());
    }
    json::Value root = root_note ? json::Value(root_note->pitch_class()) : a[0];
    json::Value bass = bass_note ? json::Value(bass_note->pitch_class()) : a[2];
    json::Value data = forward(a, "makeChord", json::Array{root, a[1], bass});
    json::Object& fields = data.as_object();
    if (root_note) {
      fields.set("rootSpelling", bare_tonic(*root_note));
    }
    if (bass_note) {
      fields.set("bassSpelling", bare_tonic(*bass_note));
    }
    return wrapped_chord(data, std::nullopt);
  });
  def_class_method("Chord.fromFiguredBass", [](Args& a) -> json::Value {
    json::Value bass = to_json(read_note_like(a[0]));
    return wrapped_chord(forward(a, "realizeFiguredBass", json::Array{bass, a[1], a[2]}),
                         std::nullopt);
  });
  def_class_method("Chord.parse", [](Args& a) -> json::Value {
    return wrapped_chord(forward(a, "parseChordSymbol", json::Array{a[0], options_view(a[1])}),
                         std::nullopt);
  });
  def_class_method("Chord.tryParse", [](Args& a) -> json::Value { return try_parse_chord(a); });
  def_class_method("Chord.detect", [](Args& a) -> json::Value {
    json::Array out;
    json::Value match_list = forward(a, "detectChord", json::Array{a[0], options_view(a[1])});
    for (const json::Value& match : match_list.as_array()) {
      out.push_back(chord_of_match(a, match));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Chord.detectMatches", [](Args& a) -> json::Value {
    json::Array out;
    json::Value match_list = forward(a, "detectChord", json::Array{a[0], options_view(a[1])});
    for (const json::Value& match : match_list.as_array()) {
      json::Object entry;
      entry.set("chord", chord_of_match(a, match));
      entry.set("match", match);
      out.push_back(json::Value(std::move(entry)));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Chord.detectBest", [](Args& a) -> json::Value {
    json::Value best = forward(a, "detectChordBest", json::Array{a[0], options_view(a[1])});
    return best.is_null() ? best : wrapped_chord(best, std::nullopt);
  });

  def_class_method("Chord#rootPc",
                   [](Args& a) -> json::Value { return read_chord_instance(a, 0).root_pc(); });
  def_class_method("Chord#quality", [](Args& a) -> json::Value {
    return to_json(read_chord_instance(a, 0).quality());
  });
  def_class_method("Chord#intervals", [](Args& a) -> json::Value {
    return to_json(read_chord_instance(a, 0).intervals());
  });
  def_class_method("Chord#bassPc", [](Args& a) -> json::Value {
    return to_json(read_chord_instance(a, 0).bass_pc());
  });
  def_class_method("Chord#data",
                   [](Args& a) -> json::Value { return view_of(read_chord_instance(a, 0)); });
  def_class_method("Chord#spec", [](Args& a) -> json::Value {
    return forward(a, "chordSpecOf", json::Array{view_of(read_chord_instance(a, 0))});
  });
  def_class_method("Chord#key", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    return self.key() ? key_wire(*self.key()) : undefined_value();
  });
  def_class_method("Chord#withKey", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    return to_json(read_chord_value(copied_chord_json(self.to_json()), a[1]));
  });
  def_class_method("Chord#pitchClasses", [](Args& a) -> json::Value {
    return forward(a, "chordPitchClasses",
                   json::Array{view_of(read_chord_instance(a, 0)), options_view(a[1])});
  });
  def_class_method("Chord#contains", [](Args& a) -> json::Value {
    return forward(a, "isChordMember", json::Array{a[1], view_of(read_chord_instance(a, 0))});
  });
  def_class_method("Chord#roleOf", [](Args& a) -> json::Value {
    return forward(a, "chordToneRole", json::Array{a[1], view_of(read_chord_instance(a, 0))});
  });
  def_class_method("Chord#roman", chord_analysis("chordToRoman", 1));
  def_class_method("Chord#explain", chord_analysis("explainRoman", 1));
  def_class_method("Chord#function", chord_analysis("functionOf", 0));
  def_class_method("Chord#analyze", chord_analysis("analyzeChord", 1));
  def_class_method("Chord#isBorrowed", chord_analysis("isBorrowedChord", 0));
  def_class_method("Chord#borrowedSource", chord_analysis("borrowedSource", 0));
  def_class_method("Chord#figuredBass", chord_analysis("figuredBassOf", 0));
  def_class_method("Chord#substitutions", chord_analysis("substituteChord", 1));
  def_class_method("Chord#modalInterchange", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    Key key = chord_analysis_key(self, a[1]);
    return forward(a, "modalInterchangePalette", json::Array{key_wire(key)});
  });
  auto symbol = [](Args& a) -> json::Value {
    return forward(a, "formatChordSymbol",
                   json::Array{view_of(read_chord_instance(a, 0)), options_view(a[1])});
  };
  def_class_method("Chord#symbol", symbol);
  def_class_method("Chord#toString", [](Args& a) -> json::Value {
    return forward(a, "formatChordSymbol", json::Array{view_of(read_chord_instance(a, 0))});
  });
  def_class_method("Chord#voice", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    // `opts?.key ?? this.#key`: the carried key travels whole when the options name none.
    json::Value key = optional_property(a[1], "key");
    if (is_null_or_undefined(key)) {
      key = self.key() ? key_wire(*self.key()) : undefined_value();
    }
    // An explicit key selects the spelling view before the voicer reads it.
    const json::Value& asked_key = optional_property(a[1], "key");
    json::Value view =
        is_undefined(asked_key) ? view_of(self) : view_in(self, read_key_value(asked_key));
    if (is_undefined(key)) {
      return forward(a, "voiceChord", json::Array{std::move(view), options_view(a[1])});
    }
    json::Value keyed = field_record("key", key);
    return forward(a, "voiceChord", json::Array{std::move(view), merged({&a[1], &keyed})});
  });
  def_class_method("Chord#styledVoicing", [](Args& a) -> json::Value {
    return forward(a, "voiceChordStyled",
                   json::Array{view_of(read_chord_instance(a, 0)), options_view(a[1])});
  });
  def_class_method("Chord#negativeHarmony", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    Key key = chord_analysis_key(self, a[1]);
    return wrapped_chord(
        forward(a, "negativeHarmonyMirror", json::Array{view_in(self, key), key_wire(key)}), key);
  });
  def_class_method("Chord#secondaryDominant", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    return wrapped_chord(
        forward(a, "secondaryDominantOf", json::Array{copied_chord_json(self.to_json())}),
        self.key());
  });
  def_class_method("Chord#invert", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    // A chord with no template is refused before the inversion number is read.
    if (self.intervals().empty()) {
      return to_json(self.invert(0));
    }
    // `n % length`: a bigint does not mix with the template's length.
    if (js::type_of(a[1]) == "bigint") {
      throw js::TypeError("Cannot mix BigInt and other types, use explicit conversions");
    }
    return to_json(self.invert(js::to_number(a[1])));
  });
  def_class_method("Chord#transpose", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    return to_json(self.transpose(assert_finite_number(a[1], "semitones")));
  });
  def_class_method("Chord#transposeBy", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    return to_json(self.transpose_by(IntervalArg(read_interval_like(a[1]))));
  });
  def_class_method("Chord#scales", [](Args& a) -> json::Value {
    return forward(a, "chordScales", json::Array{view_of(read_chord_instance(a, 0))});
  });
  def_class_method("Chord#scaleReport", [](Args& a) -> json::Value {
    return forward(a, "chordScaleReport", json::Array{view_of(read_chord_instance(a, 0)), a[1]});
  });
  def_class_method("Chord#tensions", [](Args& a) -> json::Value {
    return forward(a, "availableTensions",
                   json::Array{view_of(read_chord_instance(a, 0)), a[1], options_view(a[2])});
  });
  def_class_method("Chord#avoidNotes", [](Args& a) -> json::Value {
    return forward(a, "avoidNotes",
                   json::Array{view_of(read_chord_instance(a, 0)), a[1], options_view(a[2])});
  });
  def_class_method("Chord#spell", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    std::optional<Key> key = read_key_argument(a[1], "chord key");
    std::optional<KeyArg> given;
    if (key) {
      given = KeyArg(*key);
    }
    return to_json(self.spell(given));
  });
  def_class_method("Chord#progressionTo", [](Args& a) -> json::Value {
    ChordValue self = read_chord_instance(a, 0);
    json::Array chords{a[0]};
    for (json::Value& other : rest_of(a, 1)) {
      chords.push_back(std::move(other));
    }
    json::Value key = self.key() ? key_wire(*self.key()) : undefined_value();
    return to_json(read_progression_value(json::Value(std::move(chords)), key));
  });
  def_class_method("Chord#span", [](Args& a) -> json::Value {
    return forward(a, "spanFromChord", json::Array{view_of(read_chord_instance(a, 0)), a[1]});
  });
  def_class_method("Chord#equals", [](Args& a) -> json::Value {
    return chord_equals_wire(read_chord_instance(a, 0), a[1]);
  });
  def_class_method("Chord#toJSON", [](Args& a) -> json::Value {
    return copied_chord_json(read_chord_instance(a, 0).to_json());
  });
}

//--------------------------------------------------------------------------------------------
// model/progression

/** The chords of a progression as instances, each carrying the progression key. */
json::Value chords_json(const Progression& progression) {
  json::Array out;
  for (const ChordValue& chord : progression.chords()) {
    out.push_back(to_json(chord));
  }
  return json::Value(std::move(out));
}

/** The chords' `data` views, which the functions a progression forwards to are handed. */
json::Value views_of(const Progression& progression) {
  json::Array out;
  for (const ChordValue& chord : progression.chords()) {
    out.push_back(view_of(chord));
  }
  return json::Value(std::move(out));
}

/** The carried key as an argument: the instance, or undefined. */
json::Value carried_key(const std::optional<Key>& key) {
  return key ? key_wire(*key) : undefined_value();
}

/** `#resolveKey(key)` of a progression: the explicit key, else the carried one. */
Key progression_analysis_key(const Progression& progression, const json::Value& key) {
  std::optional<Key> given = read_key_argument(key, "progression key");
  if (given) {
    return *given;
  }
  if (!progression.key()) {
    throw InvalidInputError(
        "progression has no key context; pass a Key or attach one with withKey()");
  }
  return *progression.key();
}

/** `voicing[index] ?? []` of a voicing list read off a wire value. */
json::Value voicing_at(const json::Value& voicing, std::size_t index) {
  json::Value entry = element_of(voicing, index);
  return is_null_or_undefined(entry) ? json::Value(json::Array{}) : entry;
}

/** `#closingVoicing(voicing)`: the closing pair cut from one voicing per chord. */
json::Value closing_voicing(const json::Value& voicing, std::size_t chords) {
  json::Value length = length_of(voicing);
  if (!js::strict_equals(length, json::Value(static_cast<double>(chords))) &&
      !js::strict_equals(length, json::Value(2.0))) {
    throw InvalidInputError("voicing must hold one voicing per chord (" +
                            js::to_string(static_cast<double>(chords)) +
                            ") or the closing pair; received " + js::template_string(length));
  }
  // The length is the chord count or 2, both at least 2 here.
  auto count = static_cast<std::size_t>(*number_of(length));
  return json::Value(json::Array{voicing_at(voicing, count - 2), voicing_at(voicing, count - 1)});
}

/** The host function argument a progression or a score calls back. */
void require_function(const json::Value& fn, const char* name) {
  if (js::type_of(fn) != "function") {
    throw js::TypeError(std::string(name) + " is not a function");
  }
}

/** `Timeline.fromChords(spans, totalBeats, key)`. */
json::Value timeline_from_chords(const Args& a, const json::Value& spans, const json::Value& total,
                                 const json::Value& key) {
  json::Value timeline = forward(a, "chordTimelineFromChords", json::Array{spans, total});
  const json::Value& segments = get(timeline, "segments");
  json::Object data;
  data.set("segments", segments);
  data.set("totalBeats", total);
  if (!is_undefined(key)) {
    ResolvedKey stated = key_identity(read_key_value(key));
    // The region starts where the music does, so a chord in a pickup is covered by its key.
    json::Array keys;
    if (!segments.as_array().empty()) {
      double start = *number_of(get(segments.as_array().front(), "startBeat"));
      for (const KeyRegion& region : stated_key_regions(stated, start, *number_of(total))) {
        keys.push_back(key_region_json(region));
      }
    }
    data.set("keys", json::Value(std::move(keys)));
  }
  return to_json(read_timeline_data(json::Value(std::move(data))));
}

/** `Timeline.fromProgression(progression, beatsEach)`. */
json::Value timeline_from_progression(const Args& a, const json::Value& progression,
                                      const json::Value& beats) {
  bool is_class = is_class_value(progression, "Progression");
  // Anything with a `chords` list is read as a progression.
  json::Value chords =
      is_class || !is_js_object(progression) ? json::Value() : member_of(progression, "chords");
  if (!is_class && !chords.is_array()) {
    throw InvalidInputError("timeline progression must be a Progression; received " +
                            describe_rejected(progression));
  }
  double each = assert_range(beats, kMinValue, kMaxSafeInteger, "timeline beatsEach");
  json::Array views;
  json::Value key;
  if (is_class) {
    Progression read = read_progression_class(progression);
    views = views_of(read).as_array();
    key = carried_key(read.key());
  } else {
    const json::Array& members = chords.as_array();
    for (std::size_t i = 0; i < members.size(); ++i) {
      json::Value data = member_of(members[i], "data");
      if (!is_js_object(data)) {
        throw InvalidInputError("timeline progression chords[" + index_text(i) +
                                "] must be a Chord; received " + describe_rejected(members[i]));
      }
      views.push_back(std::move(data));
    }
    key = member_of(progression, "key");
  }
  json::Array spans;
  for (std::size_t index = 0; index < views.size(); ++index) {
    spans.push_back(
        forward(a, "spanFromChord", json::Array{views[index], static_cast<double>(index) * each}));
  }
  json::Value total(static_cast<double>(views.size()) * each);
  return timeline_from_chords(a, json::Value(std::move(spans)), total, key);
}

void register_progression() {
  auto construct = [](Args& a) -> json::Value {
    return to_json(read_progression_value(a[0], a[1]));
  };
  def_class_method("Progression.constructor", construct);
  def_class_method("Progression.of", construct);
  def_class_method("Progression.fromSpans", [](Args& a) -> json::Value {
    const json::Array& spans = assert_data_objects(a[0], "progression spans");
    json::Array chords;
    for (const json::Value& span : spans) {
      chords.push_back(wrapped_chord(forward(a, "chordFromSpan", json::Array{span}), std::nullopt));
    }
    return to_json(read_progression_value(json::Value(std::move(chords)), a[1]));
  });
  auto from_data = [](Args& a) -> json::Value { return to_json(read_progression_data(a[0])); };
  def_class_method("Progression.fromData", from_data);
  def_class_method("Progression.fromJSON", from_data);

  def_class_method("Progression#chords", [](Args& a) -> json::Value {
    return chords_json(read_progression_instance(a, 0));
  });
  def_class_method("Progression#key", [](Args& a) -> json::Value {
    return carried_key(read_progression_instance(a, 0).key());
  });
  auto data = [](Args& a) -> json::Value {
    ProgressionData plain = read_progression_instance(a, 0).to_json();
    json::Array chords;
    for (const Chord& chord : plain.chords) {
      chords.push_back(copied_chord_json(chord));
    }
    json::Object o;
    o.set("chords", json::Value(std::move(chords)));
    if (plain.key) {
      o.set("key", key_data_json(*plain.key));
    }
    if (plain.chordKeys) {
      json::Array keys;
      for (const Nullable<ResolvedKey>& entry : *plain.chordKeys) {
        keys.push_back(entry ? key_data_json(*entry) : json::Value(nullptr));
      }
      o.set("chordKeys", json::Value(std::move(keys)));
    }
    return json::Value(std::move(o));
  };
  def_class_method("Progression#data", data);
  def_class_method("Progression#toJSON", data);
  def_class_method("Progression#length", [](Args& a) -> json::Value {
    return static_cast<double>(read_progression_instance(a, 0).length());
  });
  def_class_method("Progression#at", [](Args& a) -> json::Value {
    std::optional<ChordValue> chord = read_progression_instance(a, 0).at(js::to_math_number(a[1]));
    return chord ? to_json(*chord) : undefined_value();
  });
  def_class_method("Progression#equals", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    if (is_class_value(a[1], "Progression")) {
      return self.equals(read_progression_instance(a, 1));
    }
    // The other progression is read through its public `length` and `at`.
    if (!js::strict_equals(json::Value(static_cast<double>(self.length())),
                           member_or_throw(a[1], "length"))) {
      return false;
    }
    for (std::size_t index = 0; index < self.length(); ++index) {
      // `other.at(index)`, then `theirs !== undefined && chord.equals(theirs)`.
      if (js::type_of(member_of(a[1], "at")) != "function") {
        throw js::TypeError("other.at is not a function");
      }
      json::Value theirs =
          call_member(a[1], "at", json::Array{static_cast<double>(index)}, a.context());
      if (is_undefined(theirs) || !chord_equals_wire(self.chords()[index], theirs)) {
        return false;
      }
    }
    return true;
  });
  def_class_method("Progression#add", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    json::Array chords = chords_json(self).as_array();
    chords.push_back(a[1]);
    return to_json(read_progression_value(json::Value(std::move(chords)), carried_key(self.key())));
  });
  def_class_method(
      "Progression#map",
      [](Args& a) -> json::Value {
        Progression self = read_progression_instance(a, 0);
        json::Array mapped;
        if (self.length() > 0) {
          require_function(a[1], "fn");
          Callback fn = a.callback(1);
          json::Array chords = chords_json(self).as_array();
          for (std::size_t index = 0; index < chords.size(); ++index) {
            mapped.push_back(fn(json::Array{chords[index], static_cast<double>(index)}));
          }
        }
        return to_json(
            read_progression_value(json::Value(std::move(mapped)), carried_key(self.key())));
      },
      kCallbacks);
  def_class_method(
      "Progression#filter",
      [](Args& a) -> json::Value {
        Progression self = read_progression_instance(a, 0);
        json::Array kept;
        if (self.length() > 0) {
          require_function(a[1], "pred");
          Callback pred = a.callback(1);
          json::Array chords = chords_json(self).as_array();
          for (std::size_t index = 0; index < chords.size(); ++index) {
            if (js::truthy(pred(json::Array{chords[index], static_cast<double>(index)}))) {
              kept.push_back(chords[index]);
            }
          }
        }
        return to_json(
            read_progression_value(json::Value(std::move(kept)), carried_key(self.key())));
      },
      kCallbacks);
  def_class_method("Progression#slice", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    std::optional<double> start;
    std::optional<double> end;
    if (!a.undefined(1)) {
      start = js::to_math_number(a[1]);
    }
    if (!a.undefined(2)) {
      end = js::to_math_number(a[2]);
    }
    return to_json(self.slice(start, end));
  });
  def_class_method("Progression#concat", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    const json::Value& other = a[1];
    if (!is_js_object(other)) {
      throw js::TypeError("Cannot use 'in' operator to search for 'chords' in " +
                          js::string_of(other));
    }
    // Read structurally: anything with a `chords` member supplies those chords.
    json::Value chords = has_member(other, "chords") ? member_of(other, "chords") : other;
    json::Array joined = chords_json(self).as_array();
    for (json::Value& chord : spread_iterable(chords, "chords")) {
      joined.push_back(std::move(chord));
    }
    return to_json(read_progression_value(json::Value(std::move(joined)), carried_key(self.key())));
  });
  def_class_method("Progression#indexOf", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    for (std::size_t index = 0; index < self.length(); ++index) {
      if (chord_equals_wire(self.chords()[index], a[1])) {
        return static_cast<double>(index);
      }
    }
    return -1.0;
  });
  def_class_method("Progression#withKey", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    return to_json(read_progression_value(chords_json(self), a[1]));
  });
  def_class_method("Progression#voice", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    json::Value key = optional_property(a[1], "key");
    // An explicit key spells the members before the voicer reads them.
    json::Value views;
    if (is_undefined(key)) {
      views = views_of(self);
    } else {
      Key asked = read_key_value(key);
      json::Array keyed_views;
      for (const ChordValue& chord : self.chords()) {
        keyed_views.push_back(view_in(chord, asked));
      }
      views = json::Value(std::move(keyed_views));
    }
    if (is_null_or_undefined(key)) {
      key = carried_key(self.key());
    }
    if (is_undefined(key)) {
      return forward(a, "voiceProgression", json::Array{std::move(views), options_view(a[1])});
    }
    json::Value keyed = field_record("key", key);
    return forward(a, "voiceProgression", json::Array{std::move(views), merged({&a[1], &keyed})});
  });
  def_class_method("Progression#roman", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    Key key = progression_analysis_key(self, a[1]);
    json::Array out;
    for (const ChordValue& chord : self.chords()) {
      out.push_back(forward(a, "chordToRoman",
                            json::Array{view_in(chord, key), key_wire(key), options_view(a[2])}));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Progression#functions", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    Key key = progression_analysis_key(self, a[1]);
    json::Array out;
    for (const ChordValue& chord : self.chords()) {
      out.push_back(forward(a, "functionOf", json::Array{view_in(chord, key), key_wire(key)}));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Progression#analyze", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    Key key = progression_analysis_key(self, a[1]);
    json::Array chords;
    for (const ChordValue& chord : self.chords()) {
      chords.push_back(forward(
          a, "analyzeChord", json::Array{view_in(chord, key), key_wire(key), options_view(a[2])}));
    }
    json::Value cadence(nullptr);
    std::size_t count = self.length();
    if (count >= 2) {
      // `{ voicing, ...cadenceOpts } = opts ?? {}`, then the progression's own approach.
      json::Object asked;
      spread_into(asked, a[2]);
      json::Value voicing = optional_property(a[2], "voicing");
      json::Object options;
      for (const json::Member& m : asked) {
        if (m.key != "voicing") {
          options.set(m.key, m.value);
        }
      }
      if (count >= 3) {
        options.set("approach", view_in(self.chords()[count - 3], key));
      }
      if (!is_undefined(voicing)) {
        options.set("voicing", closing_voicing(voicing, count));
      }
      cadence = forward(a, "detectCadence",
                        json::Array{view_in(self.chords()[count - 2], key),
                                    view_in(self.chords()[count - 1], key), key_wire(key),
                                    json::Value(std::move(options))});
    }
    json::Object out;
    out.set("chords", json::Value(std::move(chords)));
    out.set("cadence", std::move(cadence));
    return json::Value(std::move(out));
  });
  def_class_method("Progression#scales", [](Args& a) -> json::Value {
    return forward(a, "scalesForChanges", json::Array{views_of(read_progression_instance(a, 0))});
  });
  def_class_method("Progression#cadences", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    Key key = progression_analysis_key(self, a[1]);
    const json::Value& alternatives = optional_property(a[2], "alternatives");
    const json::Value& approach = optional_property(a[2], "approach");
    const json::Value& pair = optional_property(a[2], "voicing");
    json::Array found;
    for (std::size_t index = 1; index < self.length(); ++index) {
      json::Object options;
      if (!is_undefined(alternatives)) {
        options.set("alternatives", alternatives);
      }
      // The progression supplies its own predecessor wherever it has one.
      json::Value before = index >= 2 ? view_in(self.chords()[index - 2], key) : approach;
      if (!is_undefined(before)) {
        options.set("approach", before);
      }
      if (!is_undefined(pair)) {
        options.set("voicing",
                    json::Value(json::Array{voicing_at(pair, index - 1), voicing_at(pair, index)}));
      }
      found.push_back(forward(
          a, "detectCadence",
          json::Array{view_in(self.chords()[index - 1], key), view_in(self.chords()[index], key),
                      key_wire(key), json::Value(std::move(options))}));
    }
    return json::Value(std::move(found));
  });
  def_class_method("Progression#substitute", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    auto count = static_cast<double>(self.length());
    // `index < 0 ? length + index : index`, then `chords[position]`.
    json::Value position =
        js::less_than(a[1], json::Value(0.0)) ? js::add_number(count, a[1]) : a[1];
    std::optional<double> at = number_of(position);
    if (position.is_string()) {
      at = js::number(position.as_string());
      if (at && js::to_string(*at) != position.as_string()) {
        at.reset();
      }
    }
    if (!at || !(*at >= 0 && *at < count && std::trunc(*at) == *at)) {
      throw InvalidInputError("progression has no chord at index " + js::template_string(a[1]) +
                              "; it holds " + js::to_string(count));
    }
    auto target = static_cast<std::size_t>(*at);
    Key key = progression_analysis_key(self, undefined_value());
    json::Value candidates =
        forward(a, "substituteChord",
                json::Array{view_of(self.chords()[target]), key_wire(key), options_view(a[3])});
    for (const json::Value& candidate : candidates.as_array()) {
      if (js::strict_equals(get(candidate, "type"), a[2])) {
        json::Array chords = chords_json(self).as_array();
        chords[target] = wrapped_chord(get(candidate, "chord"), std::nullopt);
        return to_json(read_progression_value(json::Value(std::move(chords)), key_wire(key)));
      }
    }
    json::Value symbol =
        forward(a, "formatChordSymbol", json::Array{view_of(self.chords()[target])});
    throw InvalidInputError("no " + js::template_string(a[2]) + " substitution for " +
                            symbol.as_string() + " in " + key.to_string());
  });
  def_class_method("Progression#timeline", [](Args& a) -> json::Value {
    read_progression_instance(a, 0);
    return timeline_from_progression(a, a[0], a[1]);
  });
  def_class_method("Progression#transpose", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    // The key moves first, then each chord; with neither there is nothing to read the offset for.
    if (!self.key() && self.length() == 0) {
      return to_json(self);
    }
    return to_json(self.transpose(assert_finite_number(a[1], "semitones")));
  });
  def_class_method("Progression#transposeBy", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    if (!self.key() && self.length() == 0) {
      return to_json(self);
    }
    return to_json(self.transpose_by(IntervalArg(read_interval_like(a[1]))));
  });
  def_class_method("Progression#transposeTo", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    if (!self.key()) {
      // The typed method refuses a progression with no key before it reads the target.
      return to_json(self.transpose_to(KeyArg(KeyScale{})));
    }
    assert_key_argument(a[1], "progression key");
    return to_json(self.transpose_to(KeyArg(read_key_value(a[1]))));
  });
  def_class_method("Progression#toString", [](Args& a) -> json::Value {
    Progression self = read_progression_instance(a, 0);
    std::string out;
    for (std::size_t index = 0; index < self.length(); ++index) {
      if (index > 0) {
        out += ' ';
      }
      out +=
          forward(a, "formatChordSymbol", json::Array{view_of(self.chords()[index])}).as_string();
    }
    return out;
  });
}

//--------------------------------------------------------------------------------------------
// model/timeline

/** A timeline's segments as copies, which every reader is handed. */
json::Value segments_json(const Timeline& timeline) {
  TimelineData data;
  data.segments = timeline.segments();
  return get(timeline_data_json(data), "segments");
}

/** A segment chord's `toJSON` view, as the analyses that read a segment take it. */
json::Value segment_chord(const ChordSegment& segment) { return copied_chord_json(segment.chord); }

/** The `{ at, segments }` hybrid of a list of segments. */
json::Value timeline_hybrid(const json::Value& segments) {
  json::Object o;
  o.set("$hy", "ChordTimeline");
  o.set("segments", segments);
  return json::Value(std::move(o));
}

/** Where the last of the segments and the regions ends, never before beat 0 (`spanEnd`). */
double wire_span_end(const json::Value& segments, const json::Value& keys) {
  double end = 0;
  for (const json::Value* run : {&segments, &keys}) {
    if (run->is_array()) {
      for (const json::Value& span : run->as_array()) {
        end = js::max(end, *number_of(get(span, "endBeat")));
      }
    }
  }
  return end;
}

/** Whether a timeline carries nothing a move would read its step for. */
bool nothing_to_move(const Timeline& timeline) {
  return timeline.length() == 0 && timeline.keys().empty();
}

void register_timeline() {
  auto from_data = [](Args& a) -> json::Value { return to_json(read_timeline_data(a[0])); };
  def_class_method("Timeline.constructor", from_data);
  def_class_method("Timeline.fromData", from_data);
  def_class_method("Timeline.fromJSON", from_data);
  def_class_method("Timeline.fromChords", [](Args& a) -> json::Value {
    return timeline_from_chords(a, a[0], a[1], a[2]);
  });
  def_class_method("Timeline.fromNotes", [](Args& a) -> json::Value {
    json::Value result =
        forward(a, "chordTimelineFromNotes", json::Array{a[0], options_view(a[1])});
    const json::Value& segments = get(get(result, "timeline"), "segments");
    const json::Value& keys = get(result, "keys");
    // The analysis reports where the chords and the keys end, so the span is read back off them.
    json::Value total = optional_property(a[1], "totalBeats");
    if (is_null_or_undefined(total)) {
      total = json::Value(wire_span_end(segments, keys));
    }
    json::Object data;
    data.set("segments", segments);
    data.set("totalBeats", total);
    data.set("keys", keys);
    data.set("segmentConfidence", get(result, "segmentConfidence"));
    return to_json(read_timeline_data(json::Value(std::move(data))));
  });
  def_class_method("Timeline.fromProgression",
                   [](Args& a) -> json::Value { return timeline_from_progression(a, a[0], a[1]); });

  def_class_method("Timeline#at", [](Args& a) -> json::Value {
    const Timeline& self = timeline_instance(a, 0);
    Nullable<ChordValue> chord = self.at(assert_finite_number(a[1], "timeline query beat"));
    return chord ? to_json(*chord) : json::Value(nullptr);
  });
  def_class_method("Timeline#segments",
                   [](Args& a) -> json::Value { return segments_json(timeline_instance(a, 0)); });
  def_class_method("Timeline#totalBeats",
                   [](Args& a) -> json::Value { return timeline_instance(a, 0).total_beats(); });
  def_class_method("Timeline#key", [](Args& a) -> json::Value {
    return carried_key(timeline_instance(a, 0).key());
  });
  def_class_method("Timeline#keys", [](Args& a) -> json::Value {
    const Timeline& self = timeline_instance(a, 0);
    json::Array out;
    for (const KeyRegion& region : self.keys()) {
      out.push_back(key_region_json(region));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Timeline#segmentConfidence", [](Args& a) -> json::Value {
    return to_json(timeline_instance(a, 0).segment_confidence());
  });
  def_class_method("Timeline#length", [](Args& a) -> json::Value {
    return static_cast<double>(timeline_instance(a, 0).length());
  });
  def_class_method("Timeline#progression", [](Args& a) -> json::Value {
    return to_json(timeline_instance(a, 0).progression());
  });
  def_class_method("Timeline#reduce", [](Args& a) -> json::Value {
    const Timeline& self = timeline_instance(a, 0);
    // The key context is read before the reduction reads its options.
    if (!prevailing_key_of(self.keys())) {
      self.reduce();
    }
    json::Value view = options_view(a[1]);
    const json::Value& asked = assert_options(view, "opts");
    ReduceProgressionOptions opts;
    if (const json::Value* basis = opt_null_default(asked, "basis")) {
      opts.basis = parse_reduction_basis(
          assert_one_of(*basis,
                        std::vector<std::string_view>{to_string(ReductionBasis::kFunction),
                                                      to_string(ReductionBasis::kDuration)},
                        "reduction basis"));
    }
    json::Array out;
    for (const ReducedChord& reduced : self.reduce(opts)) {
      json::Object entry;
      entry.set("chord", copied_chord_json(reduced.chord));
      entry.set("startBeat", to_json(reduced.startBeat));
      entry.set("endBeat", to_json(reduced.endBeat));
      entry.set("level", to_json(reduced.level));
      entry.set("rationale", reduced.rationale);
      out.push_back(json::Value(std::move(entry)));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Timeline#cadences", [](Args& a) -> json::Value {
    json::Array out;
    for (const CadenceHit& hit : timeline_instance(a, 0).cadences()) {
      json::Object entry;
      entry.set("atBeat", to_json(hit.atBeat));
      entry.set("cadence", to_json(hit.cadence));
      entry.set("from", copied_chord_json(hit.from));
      entry.set("to", copied_chord_json(hit.to));
      out.push_back(json::Value(std::move(entry)));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Timeline#modulations", [](Args& a) -> json::Value {
    const Timeline& self = timeline_instance(a, 0);
    json::Value total = field_record("totalBeats", json::Value(self.total_beats()));
    json::Value regions =
        forward(a, "detectModulations", json::Array{segments_json(self), merged({&total, &a[1]})});
    json::Array out;
    for (const json::Value& region : regions.as_array()) {
      out.push_back(key_region_json(read_key_region(region)));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Timeline#roman", [](Args& a) -> json::Value {
    const Timeline& self = timeline_instance(a, 0);
    assert_key_argument(a[1], "timeline key");
    // The key a caller names travels whole; otherwise each segment reads the key in force.
    std::optional<ResolvedKey> given;
    if (!is_undefined(a[1])) {
      given = read_key_data(forward(a, "resolveKey", json::Array{a[1]})).data();
    }
    Nullable<ResolvedKey> prevailing = prevailing_key_of(self.keys());
    if (!given && !prevailing) {
      self.roman();
    }
    json::Array out;
    for (const ChordSegment& segment : self.segments()) {
      ResolvedKey key = given ? *given : KeyLookup(self.keys(), *prevailing)(segment.startBeat);
      json::Value roman =
          forward(a, "chordToRoman",
                  json::Array{segment_chord(segment), key_data_json(key), options_view(a[2])});
      json::Object entry;
      entry.set("startBeat", to_json(segment.startBeat));
      entry.set("endBeat", to_json(segment.endBeat));
      entry.set("roman", std::move(roman));
      out.push_back(json::Value(std::move(entry)));
    }
    return json::Value(std::move(out));
  });
  def_class_method("Timeline#slice", [](Args& a) -> json::Value {
    const Timeline& self = timeline_instance(a, 0);
    double from = assert_finite_number(a[1], "timeline slice fromBeat");
    double to = assert_finite_number(a[2], "timeline slice toBeat");
    return to_json(self.slice(from, to));
  });
  def_class_method("Timeline#transpose", [](Args& a) -> json::Value {
    const Timeline& self = timeline_instance(a, 0);
    if (nothing_to_move(self)) {
      return to_json(self);
    }
    return to_json(self.transpose(assert_finite_number(a[1], "semitones")));
  });
  def_class_method("Timeline#transposeBy", [](Args& a) -> json::Value {
    const Timeline& self = timeline_instance(a, 0);
    if (nothing_to_move(self)) {
      return to_json(self);
    }
    return to_json(self.transpose_by(IntervalArg(read_interval_like(a[1]))));
  });
  def_class_method("Timeline#equals", [](Args& a) -> json::Value {
    const Timeline& self = timeline_instance(a, 0);
    if (is_class_value(a[1], "Timeline")) {
      return self.equals(timeline_instance(a, 1));
    }
    // The other timeline is read through its public `data`.
    json::Value theirs = member_or_throw(a[1], "data");
    if (!js::strict_equals(member_or_throw(theirs, "totalBeats"),
                           json::Value(self.total_beats())) ||
        !js::strict_equals(length_of(member_of(theirs, "segments")),
                           json::Value(static_cast<double>(self.length())))) {
      return false;
    }
    json::Value segments = member_of(theirs, "segments");
    for (std::size_t index = 0; index < self.length(); ++index) {
      const ChordSegment& mine = self.segments()[index];
      json::Value yours = element_of(segments, index);
      if (is_undefined(yours) ||
          !js::strict_equals(json::Value(mine.startBeat), member_or_throw(yours, "startBeat")) ||
          !js::strict_equals(json::Value(mine.endBeat), member_of(yours, "endBeat")) ||
          !ChordValue(mine.chord)
               .equals(read_chord_value(member_of(yours, "chord"), undefined_value()))) {
        return false;
      }
    }
    return true;
  });
  auto data = [](Args& a) -> json::Value {
    return timeline_data_json(timeline_instance(a, 0).data());
  };
  def_class_method("Timeline#data", data);
  def_class_method("Timeline#toJSON", data);
  def_class_method("Timeline#chordTimeline", [](Args& a) -> json::Value {
    return timeline_hybrid(segments_json(timeline_instance(a, 0)));
  });
}

//--------------------------------------------------------------------------------------------
// model/score

/** The score's notes, in its own time order. */
json::Value notes_of(const Score& score) { return to_json(score.notes()); }

/** The score's own context as options: its meters, and its key when it carries one. */
json::Value analysis_context(const Score& score) {
  json::Object o;
  o.set("meters", to_json(score.meters()));
  if (score.data().key) {
    o.set("key", key_data_json(*score.data().key));
  }
  return json::Value(std::move(o));
}

/** `{ meters: this.#data.meters }`. */
json::Value meters_context(const Score& score) {
  return field_record("meters", to_json(score.meters()));
}

/** The score with one field of its data replaced: `new Score({ ...this.#data, field })`. */
json::Value score_with(const Score& score, const char* name, json::Value value) {
  json::Value data = score_data_json(score.data());
  data.as_object().set(name, std::move(value));
  return to_json(read_score_data(data));
}

/** `tempoFrom(tempo)`: a bare bpm as a one-entry map, the default when absent. */
json::Value tempo_from(const json::Value& tempo) {
  if (is_undefined(tempo)) {
    return to_json(TempoMap{TempoEvent{0, SCORE_DEFAULT_BPM}});
  }
  if (js::type_of(tempo) == "number") {
    json::Object event;
    event.set("startBeat", 0.0);
    event.set("bpm", tempo);
    return json::Value(json::Array{json::Value(std::move(event))});
  }
  return tempo;
}

/** The meter map a score reads `meters` as (`resolveMeters({ meters }, 'score meters')`). */
json::Value score_meters(const json::Value& meters) {
  return to_json(resolve_wire_meters(field_record("meters", meters), "score meters"));
}

/** `new Score(scoreData(notes, opts))`. */
json::Value score_of(const json::Value& notes, const json::Value& opts) {
  json::Object data;
  data.set("notes", json::Value(assert_data_array(notes, "score notes")));
  data.set("meters", score_meters(optional_property(opts, "meters")));
  data.set("tempo", tempo_from(optional_property(opts, "tempo")));
  const json::Value& key = optional_property(opts, "key");
  if (!is_undefined(key)) {
    // Read through the resolver that keeps a spelled tonic and a scale form.
    data.set("key", key_data_json(read_key_value(key).data()));
  }
  return to_json(read_score_data(json::Value(std::move(data))));
}

/** The score's own chord reading, as the chord-timeline op reports it. */
json::Value score_chord_analysis(const Args& a, const Score& score) {
  return forward(a, "chordTimelineFromNotes",
                 json::Array{notes_of(score), analysis_context(score)});
}

/** The key regions under the score: the stated key across it, or those read from the notes. */
json::Value score_key_regions(const Args& a, const Score& score) {
  if (score.data().key) {
    json::Array out;
    for (const KeyRegion& region : score.keys(KeyTimelineOptions{})) {
      out.push_back(key_region_json(region));
    }
    return json::Value(std::move(out));
  }
  return forward(a, "keyTimelineFromNotes", json::Array{notes_of(score), meters_context(score)});
}

/** The key regions of a wire list, typed. */
std::vector<KeyRegion> typed_regions(const json::Value& regions) {
  std::vector<KeyRegion> out;
  for (const json::Value& region : regions.as_array()) {
    out.push_back(read_key_region(region));
  }
  return out;
}

/** The segments of a wire list, typed. */
std::vector<ChordSegment> typed_segments(const json::Value& segments) {
  std::vector<ChordSegment> out;
  for (const json::Value& segment : segments.as_array()) {
    out.push_back(ChordSegment{*number_of(get(segment, "startBeat")),
                               *number_of(get(segment, "endBeat")),
                               read_chord_data(get(segment, "chord"))});
  }
  return out;
}

/**
 * `#keyContext(key)`: the argument, then the carried key, as one key; otherwise the key in force
 * at each beat, read as its scale, falling back to C major where nothing sounds.
 */
std::variant<json::Value, KeyAtBeat> score_key_context(const Args& a, const Score& score,
                                                       const json::Value& key) {
  assert_key_argument(key, "score key");
  if (!is_undefined(key)) {
    return key_data_json(key_identity(read_key_value(key)));
  }
  if (score.data().key) {
    return key_data_json(*score.data().key);
  }
  std::vector<KeyRegion> regions = typed_regions(score_key_regions(a, score));
  Nullable<ResolvedKey> found = prevailing_key_of(regions);
  ResolvedKey prevailing = found ? *found : key_identity(Key::major("C"));
  return KeyAtBeat([regions, prevailing](double beat) {
    return scale_of(KeyLookup(regions, prevailing)(beat));
  });
}

/** The options referenceFromReadings reads, from the bag a score hands it, in its order. */
ReferenceProfileOptions reference_options(const json::Value& bag, const json::Value& notes) {
  const json::Value& asked = assert_options(bag, "reference options");
  ReferenceProfileOptions typed;
  typed.meters = MeterArg(resolve_wire_meters(asked, "reference meters"));
  const json::Value& budget = get(asked, "budget");
  if (std::optional<double> read = number_of(budget)) {
    typed.budget = read;
  }
  assert_note_events(notes, "reference notes", line_options(budget));
  const json::Value& total = get(asked, "totalBeats");
  if (!is_undefined(total)) {
    typed.totalBeats = assert_range(total, 0, kMaxSafeInteger, "reference totalBeats");
  }
  if (const json::Value* melody = opt_null_default(asked, "melody")) {
    typed.melody = assert_note_events(*melody, "reference melody", line_options(budget));
  }
  if (const json::Value* key = field(asked, "key")) {
    typed.key = read_key_arg(*key);
  }
  return typed;
}

/** `{ ...note, field: convert(note.field) }` for each note, through a tick conversion op. */
json::Value converted_times(const Args& a, const json::Array& notes, const char* op,
                            const json::Value& ppq) {
  json::Array out;
  for (const json::Value& note : notes) {
    json::Object copy;
    spread_into(copy, note);
    copy.set("startBeat", forward(a, op, json::Array{get(note, "startBeat"), ppq}));
    copy.set("durationBeat", forward(a, op, json::Array{get(note, "durationBeat"), ppq}));
    out.push_back(json::Value(std::move(copy)));
  }
  return json::Value(std::move(out));
}

/** `sameNote(note, other)` against a note read off another score's public data. */
bool same_note_wire(const NoteEvent& note, const json::Value& other) {
  if (is_undefined(other)) {
    return false;
  }
  json::Value velocity = note.velocity ? json::Value(*note.velocity) : undefined_value();
  json::Value articulation = note.articulation
                                 ? json::Value(std::string(to_string(*note.articulation)))
                                 : undefined_value();
  return js::strict_equals(json::Value(note.pitch), property_of(other, "pitch")) &&
         js::strict_equals(json::Value(note.startBeat), get(other, "startBeat")) &&
         js::strict_equals(json::Value(note.durationBeat), get(other, "durationBeat")) &&
         js::strict_equals(velocity, get(other, "velocity")) &&
         js::strict_equals(articulation, get(other, "articulation"));
}

/** `sameMeter(change, other)` against a change read off another score's public data. */
bool same_meter_wire(const MeterChange& change, const json::Value& other) {
  if (is_undefined(other) ||
      !js::strict_equals(json::Value(change.startBeat), property_of(other, "startBeat"))) {
    return false;
  }
  const json::Value& ts = property_of(other, "ts");
  json::Value theirs = property_of(ts, "grouping");
  if (is_null_or_undefined(theirs)) {
    theirs = json::Value(json::Array{});
  }
  std::vector<int> grouping = change.ts.grouping.value_or(std::vector<int>{});
  if (!js::strict_equals(json::Value(change.ts.numerator), get(ts, "numerator")) ||
      !js::strict_equals(json::Value(change.ts.denominator), get(ts, "denominator")) ||
      !js::strict_equals(json::Value(static_cast<double>(grouping.size())), length_of(theirs))) {
    return false;
  }
  for (std::size_t index = 0; index < grouping.size(); ++index) {
    if (!js::strict_equals(json::Value(grouping[index]), element_of(theirs, index))) {
      return false;
    }
  }
  return true;
}

/** `Score#equals` against a score read through its public `data`. */
bool score_equals_wire(const Score& score, const json::Value& other) {
  json::Value theirs = member_or_throw(other, "data");
  const ScoreData mine = score.data();
  json::Value notes = member_or_throw(theirs, "notes");
  if (!js::strict_equals(json::Value(static_cast<double>(mine.notes.size())), length_of(notes))) {
    return false;
  }
  for (std::size_t index = 0; index < mine.notes.size(); ++index) {
    if (!same_note_wire(mine.notes[index], element_of(notes, index))) {
      return false;
    }
  }
  json::Value meters = member_of(theirs, "meters");
  if (!js::strict_equals(json::Value(static_cast<double>(mine.meters.size())), length_of(meters))) {
    return false;
  }
  for (std::size_t index = 0; index < mine.meters.size(); ++index) {
    if (!same_meter_wire(mine.meters[index], element_of(meters, index))) {
      return false;
    }
  }
  json::Value tempo = member_of(theirs, "tempo");
  if (!js::strict_equals(json::Value(static_cast<double>(mine.tempo.size())), length_of(tempo))) {
    return false;
  }
  for (std::size_t index = 0; index < mine.tempo.size(); ++index) {
    json::Value event = element_of(tempo, index);
    if (is_undefined(event) ||
        !js::strict_equals(json::Value(mine.tempo[index].startBeat),
                           property_of(event, "startBeat")) ||
        !js::strict_equals(json::Value(mine.tempo[index].bpm), get(event, "bpm"))) {
      return false;
    }
  }
  // `sameKey`: both absent, or the same key once each is read back.
  json::Value key = member_of(theirs, "key");
  if (!mine.key || is_undefined(key)) {
    return !mine.key && is_undefined(key);
  }
  return Key::from_json(*mine.key).equals(read_key_data(key));
}

void register_score() {
  def_class_method("Score.of", [](Args& a) -> json::Value { return score_of(a[0], a[1]); });
  def_class_method("Score.empty", [](Args& a) -> json::Value {
    return score_of(json::Value(json::Array{}), a[0]);
  });
  def_class_method("Score.fromTicks", [](Args& a) -> json::Value {
    const json::Array& events = assert_data_objects(a[0], "score notes");
    return score_of(converted_times(a, events, "ticksToBeats", a[1]), a[2]);
  });
  auto from_data = [](Args& a) -> json::Value { return to_json(read_score_data(a[0])); };
  def_class_method("Score.constructor", from_data);
  def_class_method("Score.fromData", from_data);
  def_class_method("Score.fromJSON", from_data);

  def_class_method("Score#notes",
                   [](Args& a) -> json::Value { return notes_of(score_instance(a, 0)); });
  def_class_method("Score#totalBeats",
                   [](Args& a) -> json::Value { return score_instance(a, 0).total_beats(); });
  def_class_method("Score#meters",
                   [](Args& a) -> json::Value { return to_json(score_instance(a, 0).meters()); });
  def_class_method("Score#tempo",
                   [](Args& a) -> json::Value { return to_json(score_instance(a, 0).tempo()); });
  def_class_method("Score#slice", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    double from = assert_finite_number(a[1], "slice fromBeat");
    double to = assert_finite_number(a[2], "slice toBeat");
    return to_json(self.slice(from, to));
  });
  def_class_method(
      "Score#filter",
      [](Args& a) -> json::Value {
        const Score& self = score_instance(a, 0);
        json::Array kept;
        if (!self.notes().empty()) {
          require_function(a[1], "predicate");
          Callback predicate = a.callback(1);
          json::Array notes = notes_of(self).as_array();
          for (std::size_t index = 0; index < notes.size(); ++index) {
            if (js::truthy(predicate(json::Array{notes[index], static_cast<double>(index)}))) {
              kept.push_back(notes[index]);
            }
          }
        }
        return score_with(self, "notes", json::Value(std::move(kept)));
      },
      kCallbacks);
  def_class_method(
      "Score#map",
      [](Args& a) -> json::Value {
        const Score& self = score_instance(a, 0);
        json::Array mapped;
        if (!self.notes().empty()) {
          require_function(a[1], "fn");
          Callback fn = a.callback(1);
          json::Array notes = notes_of(self).as_array();
          for (std::size_t index = 0; index < notes.size(); ++index) {
            mapped.push_back(fn(json::Array{notes[index], static_cast<double>(index)}));
          }
        }
        return score_with(self, "notes", json::Value(std::move(mapped)));
      },
      kCallbacks);
  def_class_method("Score#concat", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    // Read through the public surface: an array is the notes, anything else supplies `notes`.
    json::Value added = a[1].is_array() ? a[1] : member_or_throw(a[1], "notes");
    json::Array joined = notes_of(self).as_array();
    for (json::Value& note : spread_iterable(added, "added")) {
      joined.push_back(std::move(note));
    }
    return score_with(self, "notes", json::Value(std::move(joined)));
  });
  def_class_method("Score#shift", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    return to_json(self.shift(assert_finite_number(a[1], "shift beats")));
  });
  def_class_method("Score#transpose", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    return to_json(self.transpose(assert_finite_number(a[1], "transpose semitones")));
  });
  def_class_method("Score#transposeBy", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    return to_json(self.transpose_by(IntervalArg(read_interval_like(a[1]))));
  });
  def_class_method("Score#withMeters", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    return score_with(self, "meters", score_meters(a[1]));
  });
  def_class_method("Score#withTempo", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    return score_with(self, "tempo", tempo_from(a[1]));
  });
  def_class_method("Score#withKey", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    return score_with(self, "key", key_data_json(read_key_value(a[1]).data()));
  });
  def_class_method("Score#quantize", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    return to_json(self.quantize(assert_range(a[1], kMinValue, kMaxSafeInteger, "quantize grid")));
  });
  // The whole meter map, as the score holds it.
  auto meter_map = [](const Score& score) { return to_json(score.meters()); };
  def_class_method("Score#humanize", [meter_map](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Value ts = field_record("ts", meter_map(self));
    json::Value notes = forward(a, "humanize", json::Array{notes_of(self), merged({&ts, &a[1]})});
    return score_with(self, "notes", std::move(notes));
  });
  def_class_method("Score#ornament", [meter_map](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Value ts = field_record("ts", meter_map(self));
    json::Value notes = forward(a, "ornament", json::Array{notes_of(self), merged({&ts, &a[1]})});
    return score_with(self, "notes", std::move(notes));
  });
  def_class_method("Score#groove", [meter_map](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Value notes =
        forward(a, "applyGrooveTemplate", json::Array{notes_of(self), a[1], meter_map(self)});
    return score_with(self, "notes", std::move(notes));
  });
  def_class_method("Score#grooveTemplate", [meter_map](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    return forward(a, "extractGrooveTemplate", json::Array{notes_of(self), meter_map(self), a[1]});
  });
  def_class_method("Score#timeline", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Value context = analysis_context(self);
    json::Value bag = a.undefined(1) ? context : merged({&context, &a[1]});
    json::Value result = forward(a, "chordTimelineFromNotes", json::Array{notes_of(self), bag});
    json::Value total = optional_property(a[1], "totalBeats");
    if (is_null_or_undefined(total)) {
      total = json::Value(self.total_beats());
    }
    json::Object data;
    data.set("segments", get(get(result, "timeline"), "segments"));
    data.set("totalBeats", total);
    data.set("keys", get(result, "keys"));
    data.set("segmentConfidence", get(result, "segmentConfidence"));
    return to_json(read_timeline_data(json::Value(std::move(data))));
  });
  def_class_method("Score#key", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    if (self.data().key) {
      return key_wire(Key::from_json(*self.data().key));
    }
    json::Value prevailing = forward(a, "prevailingKeyOf", json::Array{score_key_regions(a, self)});
    return prevailing.is_null() ? undefined_value() : key_wire(read_key_value(prevailing));
  });
  def_class_method("Score#keys", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    if (a.undefined(1)) {
      json::Array out;
      json::Value region_list = score_key_regions(a, self);
      for (const json::Value& region : region_list.as_array()) {
        out.push_back(key_region_json(read_key_region(region)));
      }
      return json::Value(std::move(out));
    }
    if (self.data().key) {
      // A score told its key answers with that key across the whole of it.
      json::Value given = member_or_throw(a[1], "totalBeats");
      KeyTimelineOptions opts;
      if (!is_null_or_undefined(given)) {
        opts.totalBeats = assert_range(given, 0, kMaxSafeInteger, "key timeline totalBeats");
      }
      json::Array out;
      for (const KeyRegion& region : self.keys(opts)) {
        out.push_back(key_region_json(region));
      }
      return json::Value(std::move(out));
    }
    json::Value context = meters_context(self);
    return forward(a, "keyTimelineFromNotes",
                   json::Array{notes_of(self), merged({&context, &a[1]})});
  });
  def_class_method("Score#detectKeys", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Array out;
    json::Value match_list =
        forward(a, "detectKeyFromNotes", json::Array{notes_of(self), options_view(a[1])});
    for (const json::Value& match : match_list.as_array()) {
      out.push_back(detected_key_match_wire(match));
    }
    return json::Value(std::move(out));
  });
  auto phrases = [](Args& a, const Score& self) -> json::Value {
    json::Value timeline = get(score_chord_analysis(a, self), "timeline");
    json::Value context = analysis_context(self);
    return forward(a, "phrasesFromTimeline",
                   json::Array{timeline, notes_of(self), merged({&context, &a[1]})});
  };
  def_class_method("Score#phrases",
                   [phrases](Args& a) -> json::Value { return phrases(a, score_instance(a, 0)); });
  def_class_method("Score#structuralCadences", [phrases](Args& a) -> json::Value {
    return forward(a, "structuralCadences", json::Array{phrases(a, score_instance(a, 0))});
  });
  def_class_method("Score#sections", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Value context = meters_context(self);
    return forward(a, "sectionsFromNotes", json::Array{notes_of(self), merged({&context, &a[1]})});
  });
  def_class_method("Score#hypermeter", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Value asked = merged({&a[1]});
    // Beats the caller gives are read as the plain function reads them.
    if (opt_null_default(asked, "cadenceBeats") != nullptr) {
      return forward(a, "hypermeter", json::Array{notes_of(self), to_json(self.meters()), asked});
    }
    // Otherwise the cadences come from the score's own harmony, read as spans in the key its
    // phrases are read in; the options are checked in the order hypermeterOver checks them.
    const json::Value& budget = get(asked, "budget");
    assert_note_events(notes_of(self), "hypermeter notes", line_options(budget));
    HypermeterOptions typed;
    if (const json::Value* total = opt_null_default(asked, "totalBeats")) {
      typed.totalBeats = assert_finite_number(*total, "hypermeter totalBeats");
    }
    typed.budget = number_of(budget);
    return to_json(self.hypermeter(typed));
  });
  def_class_method("Score#motifs", [](Args& a) -> json::Value {
    return forward(a, "extractMotifs",
                   json::Array{notes_of(score_instance(a, 0)), options_view(a[1])});
  });
  def_class_method("Score#contour", [](Args& a) -> json::Value {
    return forward(a, "melodicContour", json::Array{notes_of(score_instance(a, 0))});
  });
  def_class_method("Score#reference", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Object context;
    context.set("meters", to_json(self.meters()));
    context.set("totalBeats", self.total_beats());
    if (self.data().key) {
      context.set("key", key_data_json(*self.data().key));
    }
    json::Value base(std::move(context));
    json::Value asked = merged({&base, &a[1]});
    if (!is_undefined(optional_property(a[1], "timeline"))) {
      return forward(a, "analyzeReference", json::Array{notes_of(self), asked});
    }
    // The harmony is the score's own chord reading, made before the options are read.
    ChordTimelineOptions analysis;
    analysis.meters = MeterArg(self.meters());
    if (self.data().key) {
      analysis.key = KeyArg(*self.data().key);
    }
    ChordTimelineResult result = chord_timeline_from_notes(self.notes(), analysis);
    ReferenceReadings readings{result.timeline, result.keys, result.prevailingKey};
    ReferenceProfileOptions opts = reference_options(asked, notes_of(self));
    return to_json(reference_from_readings(self.notes(), readings, opts));
  });
  def_class_method("Score#rhythm", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Object context;
    context.set("meters", to_json(self.meters()));
    context.set("totalBeats", self.total_beats());
    json::Value base(std::move(context));
    return forward(a, "analyzeRhythm", json::Array{notes_of(self), merged({&base, &a[1]})});
  });
  def_class_method("Score#motifGraph", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Value motifs =
        forward(a, "extractMotifs", json::Array{notes_of(self), options_view(a[1])});
    json::Value key;
    if (self.data().key) {
      key = key_wire(Key::from_json(*self.data().key));
    } else {
      json::Value prevailing =
          forward(a, "prevailingKeyOf", json::Array{score_key_regions(a, self)});
      key = prevailing.is_null() ? undefined_value() : key_wire(read_key_value(prevailing));
    }
    json::Value keyed = field_record("key", key);
    return forward(a, "motifGraph", json::Array{notes_of(self), motifs, merged({&keyed, &a[1]})});
  });
  def_class_method("Score#evaluate", [](Args& a) -> json::Value {
    return forward(a, "evaluateComposition",
                   json::Array{notes_of(score_instance(a, 0)), a[1], options_view(a[2])});
  });
  def_class_method("Score#voices", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    json::Value timeline = get(score_chord_analysis(a, self), "timeline");
    std::variant<json::Value, KeyAtBeat> context = score_key_context(a, self, a[1]);
    if (const auto* key = std::get_if<json::Value>(&context)) {
      return forward(a, "analyzePolyphony", json::Array{notes_of(self), timeline, *key});
    }
    ChordTimeline typed{typed_segments(get(timeline, "segments"))};
    return to_json(analyze_polyphony(
        self.notes(), [&typed](double beat) { return typed.at(beat); },
        KeyContext(std::get<KeyAtBeat>(context))));
  });
  def_class_method("Score#voiceNotes", [](Args& a) -> json::Value {
    return forward(a, "toVoiceNotes", json::Array{notes_of(score_instance(a, 0))});
  });
  def_class_method("Score#playability", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    InstrumentProfile profile = read_instrument_profile(a[1], "instrument");
    return to_json(self.playability(InstrumentProfileArg(profile)));
  });
  def_class_method(
      "Score#index",
      [](Args& a) -> json::Value {
        const Score& self = score_instance(a, 0);
        json::Object context;
        context.set("allowNonPositiveDuration", true);
        context.set("name", "score notes");
        json::Value base(std::move(context));
        return forward(a, "createNoteEventIndex",
                       json::Array{notes_of(self), merged({&base, &a[1]})});
      },
      kHandles);
  def_class_method("Score#secondsAt", [](Args& a) -> json::Value {
    return forward(a, "beatsToSeconds", json::Array{a[1], to_json(score_instance(a, 0).tempo())});
  });
  def_class_method("Score#barAt", [](Args& a) -> json::Value {
    return forward(a, "beatToBarPosition",
                   json::Array{a[1], to_json(score_instance(a, 0).meters())});
  });
  def_class_method("Score#meterAt", [](Args& a) -> json::Value {
    return forward(a, "meterAt", json::Array{a[1], to_json(score_instance(a, 0).meters())});
  });
  def_class_method("Score#toTicks", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    return converted_times(a, notes_of(self).as_array(), "beatsToTicks", a[1]);
  });
  def_class_method("Score#equals", [](Args& a) -> json::Value {
    const Score& self = score_instance(a, 0);
    if (is_class_value(a[1], "Score")) {
      return self.equals(score_instance(a, 1));
    }
    return score_equals_wire(self, a[1]);
  });
  auto data = [](Args& a) -> json::Value { return score_data_json(score_instance(a, 0).data()); };
  def_class_method("Score#data", data);
  def_class_method("Score#toJSON", data);
}

}  // namespace

void register_m2() {
  // Messages write a class instance the way TS's template literals do, through its toString().
  js::set_class_text(&class_text);
  register_key();
  register_chord();
  register_progression();
  register_timeline();
  register_score();
}

}  // namespace cantus::ops
