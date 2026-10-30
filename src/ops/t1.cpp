// Op adapters of theory/chord, theory/scale, theory/spelling.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_c2.h, ops/codec_t1.h), in the TS order and with the TS names, then
// calls the typed function. A guard that returns its argument returns the wire value it was given,
// and so does a result field TS copies from an argument unread.

#include <cmath>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/pitch.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/spelling.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_t1.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"
#include "theory/chord/chord.h"
#include "theory/chord/spec.h"
#include "theory/scale/masks.h"
#include "theory/spelling/spelling.h"

namespace cantus::ops {

namespace {

/** A scale name argument, which TS refuses unless it is a string (`resolveScaleName`). */
const std::string& scale_name_arg(const json::Value& name) {
  if (!name.is_string()) {
    throw InvalidInputError("scale name must be a string; received " + describe_rejected(name));
  }
  return name.as_string();
}

/** The names of the two key modes, for assert_one_of(). */
std::vector<std::string_view> key_mode_names() {
  return {to_string(KeyMode::kMajor), to_string(KeyMode::kMinor)};
}

/** A mask table as the object TS exports it as. */
json::Value mask_table(const std::vector<NamedScaleMask>& table) {
  json::Object o;
  for (const NamedScaleMask& entry : table) {
    o.set(std::string(entry.name), static_cast<double>(entry.mask));
  }
  return json::Value(std::move(o));
}

/** `a === b` over two wire values that are not objects. */
bool strictly_equal(const json::Value& a, const json::Value& b) {
  std::optional<double> x = number_of(a);
  std::optional<double> y = number_of(b);
  if (x && y) {
    return *x == *y;
  }
  if (a.is_string() && b.is_string()) {
    return a.as_string() == b.as_string();
  }
  if (a.is_bool() && b.is_bool()) {
    return a.as_bool() == b.as_bool();
  }
  return (a.is_null() && b.is_null()) || (is_undefined(a) && is_undefined(b));
}

//--------------------------------------------------------------------------------------------
// theory/scale

void register_masks() {
  def("$const:MAJOR_MASK", [](Args&) -> json::Value { return to_json(MAJOR_MASK); });
  def("$const:NATURAL_MINOR_MASK",
      [](Args&) -> json::Value { return to_json(NATURAL_MINOR_MASK); });
  def("$const:HARMONIC_MINOR_MASK",
      [](Args&) -> json::Value { return to_json(HARMONIC_MINOR_MASK); });
  def("$const:MELODIC_MINOR_MASK",
      [](Args&) -> json::Value { return to_json(MELODIC_MINOR_MASK); });
  def("$const:DORIAN_MASK", [](Args&) -> json::Value { return to_json(DORIAN_MASK); });
  def("$const:PHRYGIAN_MASK", [](Args&) -> json::Value { return to_json(PHRYGIAN_MASK); });
  def("$const:LYDIAN_MASK", [](Args&) -> json::Value { return to_json(LYDIAN_MASK); });
  def("$const:MIXOLYDIAN_MASK", [](Args&) -> json::Value { return to_json(MIXOLYDIAN_MASK); });
  def("$const:LOCRIAN_MASK", [](Args&) -> json::Value { return to_json(LOCRIAN_MASK); });
  def("$const:MAJOR_PENTATONIC_MASK",
      [](Args&) -> json::Value { return to_json(MAJOR_PENTATONIC_MASK); });
  def("$const:MINOR_PENTATONIC_MASK",
      [](Args&) -> json::Value { return to_json(MINOR_PENTATONIC_MASK); });
  def("$const:BLUES_MASK", [](Args&) -> json::Value { return to_json(BLUES_MASK); });
  def("$const:WHOLE_TONE_MASK", [](Args&) -> json::Value { return to_json(WHOLE_TONE_MASK); });
  def("$const:OCTATONIC_HALF_WHOLE_MASK",
      [](Args&) -> json::Value { return to_json(OCTATONIC_HALF_WHOLE_MASK); });
  def("$const:OCTATONIC_WHOLE_HALF_MASK",
      [](Args&) -> json::Value { return to_json(OCTATONIC_WHOLE_HALF_MASK); });
  def("$const:CHROMATIC_MASK", [](Args&) -> json::Value { return to_json(CHROMATIC_MASK); });
  def("$const:LYDIAN_DOMINANT_MASK",
      [](Args&) -> json::Value { return to_json(LYDIAN_DOMINANT_MASK); });
  def("$const:MIXOLYDIAN_B13_MASK",
      [](Args&) -> json::Value { return to_json(MIXOLYDIAN_B13_MASK); });
  def("$const:LOCRIAN_NATURAL2_MASK",
      [](Args&) -> json::Value { return to_json(LOCRIAN_NATURAL2_MASK); });
  def("$const:ALTERED_MASK", [](Args&) -> json::Value { return to_json(ALTERED_MASK); });
  def("$const:PHRYGIAN_DOMINANT_MASK",
      [](Args&) -> json::Value { return to_json(PHRYGIAN_DOMINANT_MASK); });
  def("$const:MIYAKO_BUSHI_MASK", [](Args&) -> json::Value { return to_json(MIYAKO_BUSHI_MASK); });
  def("$const:RITSU_MASK", [](Args&) -> json::Value { return to_json(RITSU_MASK); });
  def("$const:RYUKYU_MASK", [](Args&) -> json::Value { return to_json(RYUKYU_MASK); });
  def("$const:DOUBLE_HARMONIC_MASK",
      [](Args&) -> json::Value { return to_json(DOUBLE_HARMONIC_MASK); });
  def("$const:TODI_MASK", [](Args&) -> json::Value { return to_json(TODI_MASK); });
  def("$const:MARWA_MASK", [](Args&) -> json::Value { return to_json(MARWA_MASK); });
  def("$const:PURVI_MASK", [](Args&) -> json::Value { return to_json(PURVI_MASK); });
  def("$const:NAMED_SCALES", [](Args&) -> json::Value { return mask_table(NAMED_SCALES); });
  def("$const:WORLD_SCALES", [](Args&) -> json::Value { return mask_table(WORLD_SCALES); });
  def("$const:SCALE_ALIASES", [](Args&) -> json::Value {
    json::Object o;
    for (const ScaleAlias& entry : SCALE_ALIASES) {
      o.set(std::string(entry.alias), entry.name);
    }
    return json::Value(std::move(o));
  });
  def("maskFromOffsets", [](Args& a) -> json::Value {
    const json::Array& offsets = assert_array(a[0], "offsets");
    std::vector<double> read;
    for (std::size_t index = 0; index < offsets.size(); ++index) {
      read.push_back(assert_integer(offsets[index], "offsets[" + index_text(index) + "]"));
    }
    return to_json(mask_from_offsets(read));
  });
  def("assertModeMask", [](Args& a) -> json::Value {
    with_name_arg(a, 1, "modeMask12", [&](const std::string& name) { read_mode_mask(a[0], name); });
    return a.take(0);
  });
  def("resolveScaleName", [](Args& a) -> json::Value {
    std::optional<std::string_view> canonical = resolve_scale_name(scale_name_arg(a[0]));
    return canonical ? json::Value(*canonical) : undefined_value();
  });
  def("namedScaleMask", [](Args& a) -> json::Value {
    std::optional<int> mask = named_scale_mask(scale_name_arg(a[0]));
    return mask ? to_json(*mask) : undefined_value();
  });
  def("requireScaleMask", [](Args& a) -> json::Value {
    return to_json(with_name_arg(a, 1, "scale", [&](const std::string& label) {
      return require_scale_mask(scale_name_arg(a[0]), label);
    }));
  });
  def("variantOfMask", [](Args& a) -> json::Value {
    return to_json(variant_of_mask(read_mode_mask(a[0], "modeMask12")));
  });
  def("assertKeyVariant", [](Args& a) -> json::Value {
    KeyVariant variant = *parse_key_variant(assert_one_of(a[0], key_variant_names(), "variant"));
    assert_key_variant(variant, read_mode_mask(a[1], "modeMask12"));
    return undefined_value();
  });
}

void register_keys() {
  def("toKeyScale", [](Args& a) -> json::Value { return to_json(read_key_like(a[0])); });
  def("resolveKey",
      [](Args& a) -> json::Value { return scale_first(resolve_key(read_key_arg(a[0]))); });
  def("scaleOf", [](Args& a) -> json::Value {
    assert_record(a[0], "key");
    read_mask_of(get(a[0], "scale"), "key.scale");
    json::Value key = a.take(0);
    return std::move(*key.as_object().find("scale"));
  });
  def("tryResolveKeyName", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    NoteNameOptions opts;
    std::optional<ParseResult<ResolvedKey>> result;
    try {
      if (!a[0].is_string()) {
        throw InvalidInputError("key name must be a string; received " + js::type_of(a[0]));
      }
      opts.system = read_note_name_system(asked);
    } catch (const InvalidInputError& e) {
      result = ParseResult<ResolvedKey>::failure(e);
    }
    if (!result) {
      result = try_resolve_key_name(a[0].as_string(), opts);
    }
    json::Object o;
    o.set("ok", result->ok());
    if (result->ok()) {
      o.set("value", scale_first(result->value()));
    } else {
      o.set("error", error_to_json(result->error()));
    }
    return json::Value(std::move(o));
  });
  def("majorKey", [](Args& a) -> json::Value {
    return to_json(major_key(assert_finite_number(a[0], "pitch")));
  });
  def("minorKey", [](Args& a) -> json::Value {
    return to_json(minor_key(assert_finite_number(a[0], "pitch")));
  });
  def("scaleByName", [](Args& a) -> json::Value {
    // namedScale reads the root before the name.
    double root = assert_finite_number(a[1], "pitch");
    return to_json(scale_by_name(scale_name_arg(a[0]), root));
  });
}

void register_degrees() {
  def("isScaleTone", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[1]);
    return to_json(is_scale_tone(assert_finite_number(a[0], "pitch"), key));
  });
  def("nearestScaleTone", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[1]);
    return to_json(nearest_scale_tone(assert_finite_number(a[0], "pitch"), key));
  });
  def("scaleLadderPosition", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[1]);
    return to_json(scale_ladder_position(assert_finite_number(a[0], "pitch"), key));
  });
  def("scaleLadderPitch", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[1]);
    return to_json(scale_ladder_pitch(assert_finite_number(a[0], "rung"), key));
  });
  def("shiftByScaleDegrees", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[2]);
    double degrees = assert_finite_number(a[1], "degrees");
    // A shift of no degrees hands the pitch back untouched.
    if (std::trunc(degrees) == 0) {
      return a.take(0);
    }
    return to_json(shift_by_scale_degrees(assert_finite_number(a[0], "pitch"), degrees, key));
  });
  def("pitchToScaleDegree", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[1]);
    return to_json(pitch_to_scale_degree(assert_finite_number(a[0], "pitch"), key));
  });
  def("diatonicPitchClasses",
      [](Args& a) -> json::Value { return to_json(diatonic_pitch_classes(read_key_like(a[0]))); });
  def("scaleTonesInDegreeOrder", [](Args& a) -> json::Value {
    return to_json(scale_tones_in_degree_order(read_key_like(a[0])));
  });
}

void register_signature() {
  def("isSignatureKey", [](Args& a) -> json::Value {
    return to_json(is_signature_key(KeyScale{0, read_mask_of(a[0], "key")}));
  });
  def("keySignatureFifths", [](Args& a) -> json::Value {
    NoteData tonic = read_note_like(a[0]);
    KeyScale key = read_key_like(a[1]);
    return to_json(key_signature_fifths(tonic, key));
  });
  def("keyFromFifths", [](Args& a) -> json::Value {
    double fifths = assert_integer(a[0], "fifths", -MAX_FIFTHS, MAX_FIFTHS);
    KeyMode mode =
        *parse_key_name_mode(assert_one_of(arg_or(a, 1, "major"), key_mode_names(), "mode"));
    return to_json(key_from_fifths(fifths, mode));
  });
}

void register_relations() {
  def("spelledKeyOf", [](Args& a) -> json::Value {
    const json::Value& key = assert_record(a[0], "key");
    double root = assert_finite_number(get(key, "rootPc"), "pitch");
    int mask = read_mode_mask(get(key, "modeMask12"), "key.modeMask12");
    // The candidate tonics are weighed by spelling the key, which reads it as a KeyLike.
    if ((mask & 1) == 0) {
      throw InvalidInputError("key.modeMask12 must include its root; received " +
                              js::to_string(mask));
    }
    assert_integer(get(key, "rootPc"), "key.rootPc");
    json::Value out = to_json(spelled_key_of(KeyScale{pitch_class_of(root), mask}));
    // The key is paired with the answer exactly as it was handed in.
    out.as_object().set("scale", a.take(0));
    return out;
  });
  def("relativeKeyOf", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[1]);
    return to_json(relative_key_of(read_note_like(a[0]), key));
  });
  def("parallelKeyOf", [](Args& a) -> json::Value {
    NoteData tonic = read_note_like(a[0]);
    return to_json(parallel_key_of(tonic, read_key_like(a[1])));
  });
  def("dominantKeyOf", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[1]);
    return to_json(dominant_key_of(read_note_like(a[0]), key));
  });
  def("subdominantKeyOf", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[1]);
    return to_json(subdominant_key_of(read_note_like(a[0]), key));
  });
  def("enharmonicKeyOf", [](Args& a) -> json::Value {
    NoteData tonic = read_note_like(a[0]);
    return to_json(enharmonic_key_of(tonic, read_key_like(a[1])));
  });
  def("relatedKeysOf", [](Args& a) -> json::Value {
    NoteData tonic = read_note_like(a[0]);
    return to_json(related_keys_of(tonic, read_key_like(a[1])));
  });
  def("keyRelationBetween", [](Args& a) -> json::Value {
    const json::Value& from = assert_record(a[0], "a");
    const json::Value& to = assert_record(a[1], "b");
    int from_mask = read_mask_of(get(from, "scale"), "a.scale");
    int to_mask = read_mask_of(get(to, "scale"), "b.scale");
    int from_root =
        pitch_class_of(assert_finite_number(get(get(from, "scale"), "rootPc"), "pitch"));
    int to_root = pitch_class_of(assert_finite_number(get(get(to, "scale"), "rootPc"), "pitch"));
    KeyScale to_scale{to_root, to_mask};
    if (from_root == to_root && is_minor_mask(from_mask) == is_minor_mask(to_mask)) {
      // The two sound alike; the tonics are then compared as written.
      const json::Value& from_tonic = get(from, "tonic");
      const json::Value& to_tonic = get(to, "tonic");
      int from_letter =
          diatonic_letter_of(assert_finite_number(get(from_tonic, "letter"), "diatonic letter"));
      int to_letter =
          diatonic_letter_of(assert_finite_number(get(to_tonic, "letter"), "diatonic letter"));
      bool same = from_letter == to_letter &&
                  strictly_equal(get(from_tonic, "alter"), get(to_tonic, "alter"));
      return to_json(same ? KeyRelation::kSame : KeyRelation::kEnharmonic);
    }
    // Every relation reads the first key as a KeyLike, scale before tonic.
    KeyScale from_scale = read_key_like(get(from, "scale"));
    NoteData from_tonic = read_note_like(get(from, "tonic"));
    return to_json(key_relation_between(ResolvedKey{from_scale, from_tonic, KeyVariant::kModal},
                                        ResolvedKey{to_scale, {}, KeyVariant::kModal}));
  });
}

void register_systems() {
  def("$const:SCALE_SYSTEMS", [](Args&) -> json::Value {
    json::Object o;
    for (const ScaleSystemEntry& entry : SCALE_SYSTEMS) {
      o.set(std::string(entry.name), to_json(entry.system));
    }
    return json::Value(std::move(o));
  });
  def("scaleSystemOf", [](Args& a) -> json::Value {
    if (a[0].is_string()) {
      return to_json(scale_system_of(a[0].as_string()));
    }
    std::optional<ScaleSystem> system = scale_system_of(KeyScale{0, read_mask_of(a[0], "scale")});
    return system ? to_json(*system) : undefined_value();
  });
  def("supportsFunctionalHarmony", [](Args& a) -> json::Value {
    if (a[0].is_string()) {
      return to_json(supports_functional_harmony(a[0].as_string()));
    }
    return to_json(supports_functional_harmony(KeyScale{0, read_mask_of(a[0], "scale")}));
  });
}

//--------------------------------------------------------------------------------------------
// theory/chord

void register_chords() {
  def("chordQualities", [](Args&) -> json::Value { return to_json(chord_qualities()); });
  def("chordSpecIntervals",
      [](Args& a) -> json::Value { return to_json(chord_spec_intervals(read_chord_spec(a[0]))); });
  def("chordSpecQuality",
      [](Args& a) -> json::Value { return to_json(chord_spec_quality(read_chord_spec(a[0]))); });
  def("chordFromDegree", [](Args& a) -> json::Value {
    double degree = assert_degree(a[0], "chord degree");
    ChordQuality ext = read_chord_quality(a[1]);
    return to_json(chord_from_degree(degree, ext, read_key_arg(a[2])));
  });
  def("makeChord", [](Args& a) -> json::Value {
    return to_json(make_chord_from_wire(a[0], a[1], a.undefined(2) ? undefined_value() : a[2]));
  });
  def("chordFromSpec",
      [](Args& a) -> json::Value { return to_json(chord_from_spec(read_chord_spec(a[0]))); });
  def("chordSpecOf", [](Args& a) -> json::Value {
    const json::Value& value = assert_record(a[0], "chord");
    assert_finite_number(get(value, "rootPc"), "chord rootPc");
    const json::Value& bass = get(value, "bassPc");
    if (!is_undefined(bass)) {
      assert_finite_number(bass, "pitch");
    }
    Chord chord = read_chord_fields(value);
    chord.intervals = read_spec_intervals(get(value, "intervals"));
    read_spec_quality(chord, get(value, "quality"));
    return to_json(chord_spec_of(chord));
  });
  def("chordFromSpan",
      [](Args& a) -> json::Value { return to_json(chord_from_span(read_chord_span(a[0]))); });
  def("spanFromChord", [](Args& a) -> json::Value {
    double start = assert_finite_number(a[1], "chord span startBeat");
    const json::Value& value = assert_chord(a[0]);
    ChordSpan span = span_from_chord(read_chord_fields(value), start);
    // The span carries the chord's own fields as written.
    json::Object out;
    out.set("rootPc", get(value, "rootPc"));
    out.set("quality", get(value, "quality"));
    out.set("startBeat", a[1]);
    const json::Value& bass = get(value, "bassPc");
    if (!is_undefined(bass)) {
      out.set("bassPc", bass);
    }
    if (span.intervals) {
      out.set("intervals", get(value, "intervals"));
    }
    return json::Value(std::move(out));
  });
  def("transposeChord", [](Args& a) -> json::Value {
    const json::Value& value = assert_chord(a[0]);
    double semitones = assert_finite_number(a[1], "semitones");
    json::Value out = to_json(transpose_chord(read_chord_fields(value), semitones));
    // The template is carried over as written.
    out.as_object().set("intervals", get(value, "intervals"));
    return out;
  });
  def("chordPitchClasses", [](Args& a) -> json::Value {
    const json::Value& value = assert_chord(a[0]);
    const json::Value& asked = assert_options(a[1], "opts");
    ChordPitchClassOptions opts;
    const json::Value& include_bass = get(asked, "includeBass");
    // `opts.includeBass !== false`.
    bool with_bass = !(include_bass.is_bool() && !include_bass.as_bool());
    opts.includeBass = with_bass;
    assert_mask_inputs(value, with_bass);
    return to_json(chord_pitch_classes(read_chord_fields(value), opts));
  });
  def("intervalAboveRoot", [](Args& a) -> json::Value {
    double pitch = assert_finite_number(a[0], "pitch");
    const json::Value& value = assert_chord(a[1]);
    return to_json(interval_above_root(pitch, read_chord_fields(value)));
  });
  def("isChordMember", [](Args& a) -> json::Value {
    if (a[1].is_null()) {
      return to_json(false);
    }
    assert_mask_inputs(a[1]);
    Chord chord = read_chord_fields(a[1]);
    // The chord's tones are read before the pitch is.
    chord_pc_mask(chord);
    return to_json(is_chord_member(assert_finite_number(a[0], "pitch"), chord));
  });
  def("chordToneRole", [](Args& a) -> json::Value {
    const json::Value& value = assert_record(a[1], "chord");
    Chord chord = read_chord_fields(value);
    // The role the chord's own spelling gives the pitch: the tone it is found among, as
    // `pitchClass(chord.rootPc + interval) === pitchClass(pitch)` finds it.
    bool spelled = false;
    if (reads_tone_letter_offsets(value)) {
      const json::Value& root = get(value, "rootPc");
      std::optional<std::vector<int>> offsets = chord_tone_letter_offsets(chord);
      for (std::size_t index = 0; index < chord.intervals.size(); ++index) {
        double tone = assert_finite_number(
            js::add(root, value.as_object().find("intervals")->as_array()[index]), "pitch");
        if (pitch_class_of(tone) == pitch_class_of(assert_finite_number(a[0], "pitch"))) {
          spelled = offsets && index < offsets->size();
          break;
        }
      }
    }
    if (!spelled) {
      assert_finite_number(a[0], "pitch");
      assert_finite_number(get(value, "rootPc"), "pitch");
      // `for (const interval of chord.intervals)`.
      const json::Value& intervals = get(value, "intervals");
      if (!intervals.is_array() && !intervals.is_string()) {
        throw js::TypeError("chord.intervals is not iterable");
      }
    }
    return to_json(chord_tone_role(*number_of(a[0]), chord));
  });
  def("diatonicTriad", [](Args& a) -> json::Value {
    // The key is resolved before the degree is checked, as the stacking is handed a resolved key.
    ResolvedKey key = resolve_key(read_key_arg(a[1]));
    return to_json(diatonic_triad(assert_degree(a[0], "chord degree"), KeyArg(key)));
  });
  def("diatonicSeventh", [](Args& a) -> json::Value {
    ResolvedKey key = resolve_key(read_key_arg(a[1]));
    return to_json(diatonic_seventh(assert_degree(a[0], "chord degree"), KeyArg(key)));
  });
}

//--------------------------------------------------------------------------------------------
// theory/spelling

void register_spelling() {
  def("spellPitchClass", [](Args& a) -> json::Value {
    NoteData tonic = read_note_like(a[1]);
    KeyScale key = read_key_like(a[2]);
    assert_tonic_of(tonic, key, "spellPitchClass");
    SpellingContext context = read_spelling_context(a[3]);
    if (!a.undefined(3) && number_of(a[0])) {
      read_context_evidence(a[3], *number_of(a[0]), tonic, key);
    }
    if (!number_of(a[0])) {
      // A value that is no number still reaches `pc - tonicPc` before it is read as a pitch: the
      // tonic itself is answered without reading it further, unless a context is weighed.
      double offset = js::subtract(a[0], note_to_pitch_class(tonic));
      if (!std::isfinite(offset)) {
        throw InvalidInputError("pitch must be finite; received NaN");
      }
      if (pitch_class_of(offset) == 0 && a.undefined(3)) {
        return to_json(NoteData{static_cast<double>(diatonic_letter_of(tonic.letter)), tonic.alter,
                                std::nullopt});
      }
      assert_finite_number(a[0], "pitch");
    }
    return to_json(spell_pitch_class(*number_of(a[0]), tonic, key, context));
  });
  def("spellScale", [](Args& a) -> json::Value {
    NoteData tonic = read_note_like(a[0]);
    return to_json(spell_scale(tonic, read_key_like(a[1])));
  });
  def("spellPitchClasses", [](Args& a) -> json::Value {
    const json::Array& pcs = assert_array(a[0], "pcs");
    NoteData tonic = read_note_like(a[1]);
    KeyScale key = read_key_like(a[2]);
    assert_tonic_of(tonic, key, "spellPitchClasses");
    std::vector<double> read;
    for (std::size_t index = 0; index < pcs.size(); ++index) {
      read.push_back(assert_pitch_class(pcs[index], "pcs[" + index_text(index) + "]"));
    }
    return to_json(spell_pitch_classes(read, tonic, key));
  });
  def("spellChordFromRoot", [](Args& a) -> json::Value {
    const json::Value& value = assert_chord(a[0]);
    NoteData root = read_note_like(a[1]);
    reads_tone_letter_offsets(value);
    return to_json(spell_chord_from_root(read_chord_fields(value), root));
  });
  def("spellChord", [](Args& a) -> json::Value {
    const json::Value& value = assert_chord(a[0]);
    NoteData tonic = read_note_like(a[1]);
    KeyScale key = read_key_like(a[2]);
    assert_tonic_of(tonic, key, "spellChord");
    read_root_hint(value);
    reads_tone_letter_offsets(value);
    return to_json(spell_chord(read_chord_fields(value), tonic, key));
  });
  def("spellPitch", [](Args& a) -> json::Value {
    NoteData tonic = read_note_like(a[1]);
    KeyScale key = read_key_like(a[2]);
    assert_tonic_of(tonic, key, "spellPitch");
    SpellingContext context = read_spelling_context(a[3]);
    double pitch = assert_finite_number(a[0], "pitch");
    if (!a.undefined(3)) {
      read_context_evidence(a[3], pitch_class_of(js::round(pitch)), tonic, key);
    }
    return to_json(spell_pitch(pitch, tonic, key, context));
  });
  def("noteNames", [](Args& a) -> json::Value {
    const json::Array& notes = assert_array(a[0], "notes");
    std::vector<NoteArg> read;
    for (const json::Value& note : notes) {
      read.emplace_back(read_note_like(note));
    }
    return to_json(note_names(read));
  });
}

}  // namespace

void register_t1() {
  register_masks();
  register_keys();
  register_degrees();
  register_signature();
  register_relations();
  register_systems();
  register_chords();
  register_spelling();
}

}  // namespace cantus::ops
