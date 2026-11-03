#include "ops/codec_m2.h"

#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/codec_a1a.h"
#include "ops/codec_c1.h"
#include "ops/codec_c2.h"
#include "ops/error_map.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus {

json::Value to_json(const Key& key) { return ops::with_class("Key", ops::scale_first(key.data())); }

json::Value to_json(const ChordValue& chord) {
  json::Value out = ops::with_class("Chord", ops::copied_chord_json(chord.to_json()));
  if (chord.key()) {
    out.as_object().set("key", to_json(*chord.key()));
  }
  return out;
}

json::Value to_json(const Progression& progression) {
  json::Object o;
  o.set("$class", "Progression");
  json::Array chords;
  for (const ChordValue& chord : progression.chords()) {
    chords.push_back(to_json(chord));
  }
  o.set("chords", json::Value(std::move(chords)));
  if (progression.key()) {
    o.set("key", to_json(*progression.key()));
  }
  return json::Value(std::move(o));
}

json::Value to_json(const Timeline& timeline) {
  return ops::with_class("Timeline", ops::timeline_data_json(timeline.data()));
}

json::Value to_json(const Score& score) {
  return ops::with_class("Score", ops::score_data_json(score.data()));
}

}  // namespace cantus

namespace cantus::ops {

namespace {

/** Whether a value answers `toJSON`: a class instance or a carrier of one. */
bool answers_to_json(const json::Value& value) {
  Tag tag = tag_of(value);
  return tag == Tag::kClass || tag == Tag::kToJson;
}

/** A spelling hint as written: the letter and the alteration the caller gave. */
PitchSpelling written_hint(const json::Value& hint) {
  return PitchSpelling{*number_of(get(hint, "letter")), *number_of(get(hint, "alter"))};
}

/** `hintMatches(hint, pc)`: the hint is read as a note before its pitch class is compared. */
bool wire_hint_matches(const json::Value& hint, std::optional<double> pc) {
  if (is_undefined(hint) || !pc) {
    return false;
  }
  return note_to_pitch_class(read_note(hint, "note")) == pitch_class_of(*pc);
}

/**
 * `chordToneSpellings`: one usable hint per interval, each read as a note, or none at all when
 * the list does not run one per interval or a hint names another tone.
 */
std::optional<std::vector<PitchSpelling>> wire_tone_spellings(
    const json::Value& hints, double root, const std::vector<double>& intervals) {
  if (is_undefined(hints)) {
    return std::nullopt;
  }
  if (!js::strict_equals(length_of(hints), json::Value(static_cast<double>(intervals.size())))) {
    return std::nullopt;
  }
  std::vector<PitchSpelling> usable;
  for (std::size_t index = 0; index < intervals.size(); ++index) {
    json::Value hint = element_of(hints, index);
    if (is_undefined(hint)) {
      return std::nullopt;
    }
    if (note_to_pitch_class(read_note(hint, "note")) != pitch_class_of(root + intervals[index])) {
      return std::nullopt;
    }
    usable.push_back(written_hint(hint));
  }
  return usable;
}

/** Every key relation, in the order `KEY_RELATIONS` lists them. */
constexpr KeyRelation kKeyRelations[] = {KeyRelation::kSame,
                                         KeyRelation::kEnharmonic,
                                         KeyRelation::kRelative,
                                         KeyRelation::kParallel,
                                         KeyRelation::kDominant,
                                         KeyRelation::kSubdominant,
                                         KeyRelation::kRelativeOfDominant,
                                         KeyRelation::kRelativeOfSubdominant};

/** The names `assertOneOf` lists for a key relation. */
std::vector<std::string_view> key_relation_names() {
  std::vector<std::string_view> names;
  for (KeyRelation relation : kKeyRelations) {
    names.push_back(to_string(relation));
  }
  return names;
}

/** The relation a checked name names. */
KeyRelation parse_key_relation(std::string_view name) {
  for (KeyRelation relation : kKeyRelations) {
    if (to_string(relation) == name) {
      return relation;
    }
  }
  return KeyRelation::kSame;
}

/** A pivot numeral, which must be text. */
std::string read_numeral(const json::Value& numeral, std::string_view name) {
  if (!numeral.is_string()) {
    throw InvalidInputError(std::string(name) + " must be a string; received " +
                            describe_rejected(numeral));
  }
  return numeral.as_string();
}

/** The fields of copyChord, in its key order, without the spelling hints. */
void write_chord_base(const Chord& chord, json::Object& o) {
  o.set("rootPc", to_json(chord.rootPc));
  o.set("quality", to_json(chord.quality));
  o.set("intervals", to_json(chord.intervals));
  if (chord.bassPc) {
    o.set("bassPc", to_json(*chord.bassPc));
  }
  if (chord.toneSpellings) {
    o.set("toneSpellings", to_json(*chord.toneSpellings));
  }
}

}  // namespace

//--------------------------------------------------------------------------------------------
// Plain data

json::Value copied_chord_json(const Chord& chord) {
  json::Object o;
  write_chord_base(chord, o);
  if (chord.rootSpelling) {
    o.set("rootSpelling", to_json(*chord.rootSpelling));
  }
  if (chord.bassSpelling) {
    o.set("bassSpelling", to_json(*chord.bassSpelling));
  }
  return json::Value(std::move(o));
}

json::Value chord_view_json(const ChordValue& chord) {
  const Chord& given = chord.to_json();
  Chord view = chord.data();
  json::Object o;
  write_chord_base(view, o);
  // The hints the caller supplied keep their places; the derived ones follow them.
  if (given.rootSpelling) {
    o.set("rootSpelling", to_json(*view.rootSpelling));
  }
  if (given.bassSpelling) {
    o.set("bassSpelling", to_json(*view.bassSpelling));
  }
  if (!given.rootSpelling && view.rootSpelling) {
    o.set("rootSpelling", to_json(*view.rootSpelling));
  }
  if (!given.bassSpelling && view.bassSpelling) {
    o.set("bassSpelling", to_json(*view.bassSpelling));
  }
  return json::Value(std::move(o));
}

json::Value key_region_json(const KeyRegion& region) {
  json::Object o;
  o.set("startBeat", to_json(region.startBeat));
  o.set("endBeat", to_json(region.endBeat));
  o.set("key", scale_first(region.key));
  o.set("confidence", to_json(region.confidence));
  if (region.modulation) {
    o.set("modulation", to_json(*region.modulation));
  }
  if (region.pivot) {
    json::Object pivot;
    pivot.set("chord", copied_chord_json(region.pivot->chord));
    pivot.set("romanFrom", region.pivot->romanFrom);
    pivot.set("romanTo", region.pivot->romanTo);
    o.set("pivot", json::Value(std::move(pivot)));
  }
  return json::Value(std::move(o));
}

json::Value timeline_data_json(const TimelineData& data) {
  json::Object o;
  json::Array segments;
  for (const ChordSegment& segment : data.segments) {
    json::Object entry;
    entry.set("startBeat", to_json(segment.startBeat));
    entry.set("endBeat", to_json(segment.endBeat));
    entry.set("chord", copied_chord_json(segment.chord));
    segments.push_back(json::Value(std::move(entry)));
  }
  o.set("segments", json::Value(std::move(segments)));
  o.set("totalBeats", to_json(data.totalBeats));
  if (data.keys) {
    json::Array keys;
    for (const KeyRegion& region : *data.keys) {
      keys.push_back(key_region_json(region));
    }
    o.set("keys", json::Value(std::move(keys)));
  }
  if (data.segmentConfidence) {
    o.set("segmentConfidence", to_json(*data.segmentConfidence));
  }
  return json::Value(std::move(o));
}

json::Value score_data_json(const ScoreData& data) {
  json::Object o;
  o.set("notes", to_json(data.notes));
  o.set("meters", to_json(data.meters));
  o.set("tempo", to_json(data.tempo));
  if (data.key) {
    o.set("key", scale_first(*data.key));
  }
  return json::Value(std::move(o));
}

json::Value wire_record(std::initializer_list<std::pair<const char*, const json::Value*>> fields) {
  json::Object o;
  for (const auto& [name, value] : fields) {
    if (!is_undefined(*value)) {
      o.set(name, *value);
    }
  }
  return json::Value(std::move(o));
}

double settled_span_end(std::initializer_list<const json::Value*> runs) {
  double end = 0;
  for (const json::Value* run : runs) {
    if (run->is_array()) {
      for (const json::Value& span : run->as_array()) {
        end = js::max(end, *number_of(get(span, "endBeat")));
      }
    }
  }
  return end;
}

json::Value without(const json::Value& record, std::initializer_list<std::string_view> names) {
  json::Object out;
  for (const json::Member& m : record.as_object()) {
    bool named = false;
    for (std::string_view name : names) {
      named = named || m.key == name;
    }
    if (!named) {
      out.set(m.key, m.value);
    }
  }
  return json::Value(std::move(out));
}

void spread_into(json::Object& out, const json::Value& value) {
  if (value.is_array()) {
    const json::Array& items = value.as_array();
    for (std::size_t index = 0; index < items.size(); ++index) {
      out.set(js::to_string(static_cast<double>(index)), items[index]);
    }
    return;
  }
  if (value.is_string()) {
    std::size_t length = js::utf16_length(value.as_string());
    for (std::size_t index = 0; index < length; ++index) {
      out.set(js::to_string(static_cast<double>(index)),
              js::utf16_slice(value.as_string(), static_cast<double>(index),
                              static_cast<double>(index + 1)));
    }
    return;
  }
  // A class instance keeps its state in private fields, so it spreads to nothing.
  if (value.is_object() && tag_of(value) == Tag::kNone) {
    for (const json::Member& m : value.as_object()) {
      if (!is_undefined(m.value)) {
        out.set(m.key, m.value);
      }
    }
  }
}

//--------------------------------------------------------------------------------------------
// Public surface

namespace {

/** The getters of a model class; its other members are methods. */
struct ClassGetters {
  std::string_view name;
  std::initializer_list<std::string_view> getters;
};

const ClassGetters kClassGetters[] = {
    {"Arrangement", {"tracks", "analysis", "conflicts", "data"}},
    {"Chord", {"rootPc", "quality", "intervals", "bassPc", "data", "spec", "key"}},
    {"Composer", {"context", "data"}},
    {"Duration", {"base", "dots", "tuplet", "spelled", "data"}},
    {"Instrument", {"name", "kind", "polyphony", "articulations", "data"}},
    {"Interval", {"number", "quality", "semitones", "isDescending", "name", "data"}},
    {"Key", {"scale", "tonic", "rootPc", "isMinor", "fifths", "scaleName", "data", "variant"}},
    {"Meter",
     {"numerator", "denominator", "grouping", "data", "isCompound", "beatsPerBar", "pulsesPerBar",
      "pulseBeats"}},
    {"Motif", {"notes", "totalBeats", "data"}},
    {"Note", {"name", "pitchClass", "midi", "letter", "alter", "octave", "data"}},
    {"Progression", {"chords", "key", "data", "length"}},
    {"Rhythm", {"events", "ts", "totalBeats", "data"}},
    {"Score", {"notes", "totalBeats", "meters", "tempo", "data"}},
    {"Tempo", {"bpm", "data"}},
    {"Timeline",
     {"segments", "totalBeats", "key", "keys", "segmentConfidence", "length", "data",
      "chordTimeline"}},
    {"Tuning", {"refStep", "refFreq", "divisions", "data"}},
    {"Voicing", {"pitches", "range", "data"}},
};

/** The host of a member read made inside an op: getters call no host functions. */
const CallContext kNoHost;

/** A function value, for a method read off an instance: typeof reports it as one. */
json::Value function_value() {
  json::Object o;
  o.set("$cb", static_cast<double>(UINT32_MAX));
  return json::Value(std::move(o));
}

/** The class name of a `$class` value, or empty. */
std::string class_name_of(const json::Value& value) {
  if (tag_of(value) != Tag::kClass) {
    return {};
  }
  const json::Value* tag = value.as_object().find("$class");
  return tag != nullptr && tag->is_string() ? tag->as_string() : std::string();
}

bool is_getter(std::string_view cls, std::string_view name) {
  for (const ClassGetters& entry : kClassGetters) {
    if (entry.name == cls) {
      for (std::string_view getter : entry.getters) {
        if (getter == name) {
          return true;
        }
      }
    }
  }
  return false;
}

/** The op of member `name` of class `cls`, or nullptr. */
const OpEntry* member_op(std::string_view cls, std::string_view name) {
  return find_op(std::string(cls) + "#" + std::string(name));
}

/** Run a member op over an instance and its arguments. */
json::Value run_member(const OpEntry& op, const json::Value& value, json::Array args) {
  json::Array values{value};
  for (json::Value& arg : args) {
    values.push_back(std::move(arg));
  }
  Args a(values, kNoHost);
  return op.fn(a);
}

/** The methods of Array.prototype and String.prototype a member read can meet. */
constexpr std::string_view kListMethods[] = {"at",   "concat",   "every",   "filter",
                                             "find", "includes", "indexOf", "join",
                                             "map",  "slice",    "some",    "toString"};

bool is_list_method(std::string_view name) {
  for (std::string_view method : kListMethods) {
    if (method == name) {
      return true;
    }
  }
  return false;
}

/**
 * A getter's value, or nothing when the getter refuses the instance: a reader meets that refusal
 * only by asking for the getter by name.
 */
std::optional<json::Value> read_getter(const OpEntry& op, const json::Value& value) {
  try {
    return run_member(op, value, {});
  } catch (const Error&) {
    return std::nullopt;
  }
}

}  // namespace

json::Value member_of(const json::Value& value, std::string_view name) {
  std::string cls = class_name_of(value);
  if (!cls.empty()) {
    const OpEntry* op = member_op(cls, name);
    if (op == nullptr) {
      return js::inherits_object_member(name) ? function_value() : undefined_value();
    }
    return is_getter(cls, name) ? run_member(*op, value, {}) : function_value();
  }
  if (tag_of(value) == Tag::kToJson) {
    return name == "toJSON" || name == "toString" || js::inherits_object_member(name)
               ? function_value()
               : undefined_value();
  }
  if (value.is_array() || value.is_string()) {
    if (name == "length") {
      return length_of(value);
    }
    if (is_list_method(name)) {
      return function_value();
    }
    return value.is_array() ? get(value, name) : undefined_value();
  }
  if (value.is_object() && tag_of(value) == Tag::kNone && !value.as_object().contains(name) &&
      js::inherits_object_member(name)) {
    return function_value();
  }
  return get(value, name);
}

bool has_member(const json::Value& value, std::string_view name) {
  std::string cls = class_name_of(value);
  if (!cls.empty()) {
    return member_op(cls, name) != nullptr;
  }
  if (tag_of(value) == Tag::kToJson) {
    return name == "toJSON" || name == "toString";
  }
  return value.is_object() && value.as_object().contains(name);
}

json::Value class_to_json(const json::Value& value) {
  std::string cls = class_name_of(value);
  if (!cls.empty()) {
    if (const OpEntry* op = member_op(cls, "toJSON")) {
      return run_member(*op, value, {});
    }
  }
  return like_data(value);
}

json::Value call_member(const json::Value& value, std::string_view name, json::Array args,
                        const CallContext& host) {
  if ((value.is_array() || value.is_string()) && name == "at") {
    // `Array.prototype.at` / `String.prototype.at`: a relative integer index.
    double length = *number_of(length_of(value));
    double index = args.empty() ? 0 : js::to_math_number(args[0]);
    index = std::isnan(index) ? 0 : std::trunc(index);
    double position = index < 0 ? index + length : index;
    if (position < 0 || position >= length) {
      return undefined_value();
    }
    return element_of(value, static_cast<std::size_t>(position));
  }
  std::string cls = class_name_of(value);
  if (cls.empty() && value.is_object() && tag_of(value) == Tag::kNone) {
    // A plain record's own function: the host callback it carries.
    const json::Value& fn = get(value, name);
    if (tag_of(fn) == Tag::kCallback) {
      return Callback(host, static_cast<std::uint32_t>(*number_of(get(fn, "$cb"))))(args);
    }
  }
  const OpEntry* op = member_op(cls, name);
  if (op == nullptr) {
    throw js::TypeError(std::string(name) + " is not a function");
  }
  return run_member(*op, value, std::move(args));
}

json::Value options_view(const json::Value& value) {
  std::string cls = class_name_of(value);
  if (cls.empty()) {
    if (tag_of(value) != Tag::kToJson) {
      return value;
    }
    json::Object o;
    o.set("toJSON", function_value());
    o.set("toString", function_value());
    return json::Value(std::move(o));
  }
  json::Object o;
  std::string prefix = cls + "#";
  for (const auto& [op_name, entry] : list_ops()) {
    if (op_name.compare(0, prefix.size(), prefix) != 0) {
      continue;
    }
    std::string member = op_name.substr(prefix.size());
    if (!is_getter(cls, member)) {
      o.set(member, function_value());
      continue;
    }
    if (std::optional<json::Value> read = read_getter(*entry, value)) {
      o.set(member, std::move(*read));
    }
  }
  return json::Value(std::move(o));
}

json::Array spread_iterable(const json::Value& value, std::string_view name) {
  if (value.is_array()) {
    return value.as_array();
  }
  if (value.is_string()) {
    json::Array out;
    std::size_t length = js::utf16_length(value.as_string());
    for (std::size_t index = 0; index < length; ++index) {
      out.push_back(element_of(value, index));
    }
    return out;
  }
  // A Progression yields its chords and a Timeline its segments.
  if (is_class_value(value, "Progression")) {
    return member_of(value, "chords").as_array();
  }
  if (is_class_value(value, "Timeline")) {
    return member_of(value, "segments").as_array();
  }
  throw js::TypeError(std::string(name) + " is not iterable");
}

std::string class_text(const json::Value& value) {
  std::string cls = class_name_of(value);
  if (member_op(cls, "toString") == nullptr) {
    return "[object Object]";
  }
  json::Value text = call_member(value, "toString", {});
  return text.is_string() ? text.as_string() : js::template_string(text);
}

json::Value surface_record(const json::Value& value,
                           std::initializer_list<std::string_view> names) {
  if (class_name_of(value).empty() && tag_of(value) != Tag::kToJson) {
    return value;
  }
  json::Object o;
  for (std::string_view name : names) {
    json::Value member = member_of(value, name);
    if (!is_undefined(member)) {
      o.set(std::string(name), std::move(member));
    }
  }
  return json::Value(std::move(o));
}

//--------------------------------------------------------------------------------------------
// Keys

Key read_key_parts(const json::Value& scale, const Note& tonic, const json::Value& variant) {
  assert_data_object(scale, "scale");
  json::Value given = surface_record(scale, {"rootPc", "modeMask12"});
  double root = assert_integer(get(given, "rootPc"), "scale.rootPc");
  double mask = assert_integer(get(given, "modeMask12"), "scale.modeMask12", 1, CHROMATIC_MASK);
  KeyScale key{pitch_class_of(root), static_cast<int>(mask)};
  // The constructor reads the variant last, after the tonic has been held to the root.
  Key built(key, tonic);
  if (is_undefined(variant)) {
    return built;
  }
  std::string name = assert_one_of(variant, key_variant_names(), "variant");
  return Key(key, tonic, parse_key_variant(name));
}

Key read_key_data(const json::Value& data) {
  assert_data_object(data, "key data");
  json::Value given = surface_record(data, {"scale", "tonic", "variant"});
  Note tonic = read_note_data(get(given, "tonic"));
  return read_key_parts(get(given, "scale"), tonic, get(given, "variant"));
}

Key read_key_value(const json::Value& value) {
  if (value.is_string()) {
    return Key::parse(value.as_string());
  }
  if (is_js_object(value)) {
    json::Value data = answers_to_json(value) ? class_to_json(value) : value;
    if (is_js_object(data)) {
      const json::Value& scale = get(data, "scale");
      const json::Value& tonic = get(data, "tonic");
      if (is_undefined(scale)) {
        // A flat key/scale may still carry the spelling and form it was named with.
        KeyScale flat = read_key_like(data);
        Note spelled = is_undefined(tonic) ? Note(resolve_key(flat).tonic) : read_note_data(tonic);
        json::Value scale_wire = to_json(flat);
        return read_key_parts(scale_wire, spelled, get(data, "variant"));
      }
      if (is_undefined(tonic)) {
        return Key::of(read_key_like(scale));
      }
      return read_key_data(data);
    }
  }
  throw InvalidInputError("key must be a key name or a key/scale; received " +
                          describe_rejected(value));
}

std::optional<Key> read_key_argument(const json::Value& value, std::string_view name) {
  assert_key_argument(value, name);
  if (is_undefined(value)) {
    return std::nullopt;
  }
  return read_key_value(value);
}

//--------------------------------------------------------------------------------------------
// Chords

Chord read_chord_data(const json::Value& value) {
  assert_data_object(value, "chord data");
  json::Value data = surface_record(value, {"quality", "rootPc", "intervals", "bassPc",
                                            "toneSpellings", "rootSpelling", "bassSpelling"});
  Chord chord;
  chord.quality = assert_chord_quality(data);
  chord.rootPc = assert_finite_number(get(data, "rootPc"), "pitch");
  const json::Array& intervals = assert_data_array(get(data, "intervals"), "chord intervals");
  for (std::size_t index = 0; index < intervals.size(); ++index) {
    chord.intervals.push_back(
        assert_finite_number(intervals[index], "chord intervals[" + index_text(index) + "]"));
  }
  const json::Value& bass = get(data, "bassPc");
  std::optional<double> kept_bass;
  if (!is_undefined(bass)) {
    chord.bassPc = assert_finite_number(bass, "pitch");
    if (pitch_class_of(*chord.bassPc) != pitch_class_of(chord.rootPc)) {
      kept_bass = pitch_class_of(*chord.bassPc);
    }
  }
  chord.toneSpellings =
      wire_tone_spellings(get(data, "toneSpellings"), chord.rootPc, chord.intervals);
  const json::Value& root_hint = get(data, "rootSpelling");
  if (wire_hint_matches(root_hint, chord.rootPc)) {
    chord.rootSpelling = written_hint(root_hint);
  }
  const json::Value& bass_hint = get(data, "bassSpelling");
  if (wire_hint_matches(bass_hint, kept_bass)) {
    chord.bassSpelling = written_hint(bass_hint);
  }
  return chord;
}

ChordValue read_chord_value(const json::Value& data, const json::Value& key) {
  Chord chord = read_chord_data(data);
  std::optional<Key> carried = read_key_argument(key, "chord key");
  if (!carried) {
    return ChordValue(chord);
  }
  return ChordValue(chord, KeyArg(*carried));
}

//--------------------------------------------------------------------------------------------
// Progressions

Progression read_progression_value(const json::Value& chords, const json::Value& key) {
  std::optional<Key> resolved = read_key_argument(key, "progression key");
  const json::Array& given = assert_data_objects(chords, "progression chords");
  // `new Chord(chord.toJSON(), key ?? chord.key)`: each member rebuilt from its own data.
  std::vector<ChordValue> members;
  for (std::size_t i = 0; i < given.size(); ++i) {
    const json::Value& chord = given[i];
    if (!answers_to_json(chord)) {
      property_of(chord, "toJSON");
      throw InvalidInputError("progression chords[" + index_text(i) +
                              "] must be a Chord; received " + describe_rejected(chord));
    }
    json::Value data = class_to_json(chord);
    if (resolved) {
      members.push_back(read_chord_value(data, to_json(*resolved)));
    } else {
      members.push_back(read_chord_value(data, member_of(chord, "key")));
    }
  }
  if (!resolved) {
    return Progression(members);
  }
  return Progression(members, KeyArg(*resolved));
}

Progression read_progression_data(const json::Value& data) {
  assert_data_object(data, "progression data");
  json::Value given = surface_record(data, {"key", "chords", "chordKeys"});
  std::optional<Key> key;
  if (!is_undefined(get(given, "key"))) {
    key = read_key_data(get(given, "key"));
  }
  const json::Array& listed = assert_data_array(get(given, "chords"), "progression chords");
  // Without a carried key, each chord may name its own.
  std::vector<std::optional<Key>> chord_keys(listed.size());
  const json::Value& own_keys = get(given, "chordKeys");
  if (!key && !is_undefined(own_keys)) {
    const json::Array& entries = assert_data_array(own_keys, "progression chord keys");
    if (entries.size() != listed.size()) {
      throw InvalidInputError("progression chord keys must hold one entry per chord (" +
                              index_text(listed.size()) + "); received " +
                              index_text(entries.size()));
    }
    for (std::size_t index = 0; index < entries.size(); ++index) {
      if (!entries[index].is_null()) {
        chord_keys[index] = read_key_data(entries[index]);
      }
    }
  }
  std::vector<ChordValue> chords;
  for (std::size_t index = 0; index < listed.size(); ++index) {
    ChordValue chord = ChordValue::from_json(read_chord_data(listed[index]));
    chords.push_back(chord_keys[index] ? chord.with_key(KeyArg(*chord_keys[index])) : chord);
  }
  if (!key) {
    return Progression(chords);
  }
  return Progression(chords, KeyArg(*key));
}

//--------------------------------------------------------------------------------------------
// Timelines

KeyRegion read_key_region(const json::Value& value) {
  assert_data_object(value, "key region");
  json::Value region =
      surface_record(value, {"startBeat", "endBeat", "key", "confidence", "modulation", "pivot"});
  KeyRegion copy;
  copy.startBeat = assert_finite_number(get(region, "startBeat"), "key region startBeat");
  copy.endBeat = assert_finite_number(get(region, "endBeat"), "key region endBeat");
  // Read through the key itself, so a tonic that does not spell the root is refused here.
  copy.key = key_identity(read_key_value(get(region, "key")));
  copy.confidence = assert_finite_number(get(region, "confidence"), "key region confidence");
  const json::Value& modulation = get(region, "modulation");
  if (!is_undefined(modulation)) {
    copy.modulation = parse_key_relation(
        assert_one_of(modulation, key_relation_names(), "key region modulation"));
  }
  const json::Value& given_pivot = get(region, "pivot");
  if (!is_undefined(given_pivot)) {
    assert_data_object(given_pivot, "key region pivot");
    json::Value pivot = surface_record(given_pivot, {"chord", "romanFrom", "romanTo"});
    PivotChord copied;
    copied.chord = ChordValue(read_chord_data(get(pivot, "chord"))).to_json();
    copied.romanFrom = read_numeral(get(pivot, "romanFrom"), "key region pivot romanFrom");
    copied.romanTo = read_numeral(get(pivot, "romanTo"), "key region pivot romanTo");
    copy.pivot = std::move(copied);
  }
  return copy;
}

Timeline read_timeline_data(const json::Value& data) {
  assert_data_object(data, "timeline data");
  json::Value given = surface_record(data, {"segments", "totalBeats", "keys", "segmentConfidence"});
  TimelineData copy;
  for (const json::Value& value : assert_data_array(get(given, "segments"), "timeline segments")) {
    assert_data_object(value, "timeline segment");
    json::Value segment = surface_record(value, {"startBeat", "endBeat", "chord"});
    ChordSegment read;
    read.startBeat = assert_finite_number(get(segment, "startBeat"), "timeline segment startBeat");
    read.endBeat = assert_finite_number(get(segment, "endBeat"), "timeline segment endBeat");
    read.chord = ChordValue(read_chord_data(get(segment, "chord"))).to_json();
    copy.segments.push_back(std::move(read));
  }
  copy.totalBeats =
      assert_range(get(given, "totalBeats"), 0, kMaxSafeInteger, "timeline totalBeats");
  const json::Value& keys = get(given, "keys");
  std::vector<KeyRegion> regions;
  if (!is_null_or_undefined(keys)) {
    for (const json::Value& region : assert_data_array(keys, "timeline keys")) {
      regions.push_back(read_key_region(region));
    }
  }
  copy.keys = std::move(regions);
  const json::Value& confidence = get(given, "segmentConfidence");
  if (!is_undefined(confidence)) {
    const json::Array& values = assert_data_array(confidence, "timeline segmentConfidence");
    if (values.size() != copy.segments.size()) {
      throw InvalidInputError(
          "timeline segmentConfidence must hold one value per segment; received " +
          js::to_string(static_cast<double>(values.size())) + " for " +
          js::to_string(static_cast<double>(copy.segments.size())));
    }
    std::vector<double> read;
    for (std::size_t index = 0; index < values.size(); ++index) {
      read.push_back(assert_range(values[index], 0, 1,
                                  "timeline segmentConfidence[" + index_text(index) + "]"));
    }
    copy.segmentConfidence = std::move(read);
  }
  return Timeline(copy);
}

//--------------------------------------------------------------------------------------------
// Scores

Score read_score_data(const json::Value& data) {
  assert_data_object(data, "score data");
  json::Value given = surface_record(data, {"notes", "meters", "tempo", "key"});
  ScoreData copy;
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  copy.notes = assert_note_event_array(get(given, "notes"), "score notes", note_options);
  json::Object bag;
  if (!is_undefined(get(given, "meters"))) {
    bag.set("meters", get(given, "meters"));
  }
  copy.meters = resolve_wire_meters(json::Value(std::move(bag)), "score meters");
  const json::Value& tempo = get(given, "tempo");
  assert_data_objects(tempo, "score tempo");
  copy.tempo = read_tempo_map(tempo);
  if (!is_undefined(get(given, "key"))) {
    copy.key = read_key_data(get(given, "key")).to_json();
  }
  return Score(copy);
}

//--------------------------------------------------------------------------------------------
// Class instances

bool is_class_value(const json::Value& value, std::string_view name) {
  const json::Value* tag =
      tag_of(value) == Tag::kClass ? value.as_object().find("$class") : nullptr;
  return tag != nullptr && tag->is_string() && tag->as_string() == name;
}

Key read_key_class(const json::Value& value) { return read_key_data(like_data(value)); }

ChordValue read_chord_class(const json::Value& value) {
  return read_chord_value(like_data(value), get(value, "key"));
}

Progression read_progression_class(const json::Value& value) {
  return read_progression_value(get(value, "chords"), get(value, "key"));
}

Key read_key_instance(const Args& a, std::size_t i) {
  return kept_value<Key>(a, i, "Key", read_key_class);
}

ChordValue read_chord_instance(const Args& a, std::size_t i) {
  return kept_value<ChordValue>(a, i, "Chord", read_chord_class);
}

Progression read_progression_instance(const Args& a, std::size_t i) {
  return kept_value<Progression>(a, i, "Progression", read_progression_class);
}

namespace {

Timeline read_timeline_class(const json::Value& value) {
  return read_timeline_data(like_data(value));
}

Score read_score_class(const json::Value& value) { return read_score_data(like_data(value)); }

}  // namespace

const Timeline& timeline_instance(const Args& a, std::size_t i) {
  return kept_value<Timeline>(a, i, "Timeline", read_timeline_class);
}

const Score& score_instance(const Args& a, std::size_t i) {
  return kept_value<Score>(a, i, "Score", read_score_class);
}

bool decode_m2_class(const json::Value& value, std::string_view name,
                     std::shared_ptr<const Decoded>& kept) {
  if (name == "Key") {
    kept = decoded_value(read_key_class(value));
  } else if (name == "Chord") {
    kept = decoded_value(read_chord_class(value));
  } else if (name == "Progression") {
    kept = decoded_value(read_progression_class(value));
  } else if (name == "Timeline") {
    kept = decoded_value(read_timeline_class(value));
  } else if (name == "Score") {
    kept = decoded_value(read_score_class(value));
  } else {
    return false;
  }
  return true;
}

}  // namespace cantus::ops
