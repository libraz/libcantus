#include "ops/codec_t1.h"

#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/validate.h"
#include "theory/chord/spec.h"

namespace cantus::ops {

namespace {

std::string str(std::string_view s) { return std::string(s); }

/** `normalizedKeyScale` over wire key data. */
KeyScale normalized_key_scale(const json::Value& data) {
  double mask = assert_integer(get(data, "modeMask12"), "key.modeMask12", 1, CHROMATIC_MASK);
  if ((static_cast<int>(mask) & 1) == 0) {
    throw InvalidInputError("key.modeMask12 must include its root; received " +
                            js::to_string(mask));
  }
  double root = assert_integer(get(data, "rootPc"), "key.rootPc");
  return KeyScale{pitch_class_of(root), static_cast<int>(mask)};
}

/** Whether a wire value carries a `toJSON` the library calls. */
bool has_to_json(const json::Value& value) {
  Tag tag = tag_of(value);
  return tag == Tag::kClass || tag == Tag::kToJson;
}

/** A field read the way JS arithmetic reads it. */
double arithmetic(const json::Value& value) { return js::to_number(value); }

std::optional<PitchSpelling> read_spelling(const json::Value& value) {
  if (!is_js_object(value)) {
    return std::nullopt;
  }
  return PitchSpelling{arithmetic(get(value, "letter")), arithmetic(get(value, "alter"))};
}

/** `assertPart`: one of a fixed set of spec part names. */
std::string read_part(const json::Value& value, const std::vector<std::string_view>& allowed,
                      std::string_view name) {
  return assert_one_of(value, allowed, name);
}

/** `assertDegreeIn` over a wire value. */
template <std::size_t N>
double read_degree_in(const json::Value& value, const std::array<int, N>& allowed,
                      std::string_view name) {
  std::optional<double> number = number_of(value);
  if (!number || !includes_degree(allowed, *number)) {
    throw InvalidInputError(str(name) + " must be one of " + join_degrees(allowed) + "; received " +
                            js::template_string(value));
  }
  return *number;
}

/** `assertDegreeList` over a wire value. */
template <std::size_t N>
std::vector<int> read_degree_list(const json::Value& value, const std::array<int, N>& allowed,
                                  std::string_view name) {
  if (!value.is_array()) {
    throw InvalidInputError(str(name) + " must be an array; received " + js::type_of(value));
  }
  std::vector<int> out;
  for (const json::Value& degree : value.as_array()) {
    out.push_back(static_cast<int>(read_degree_in(degree, allowed, name)));
  }
  return out;
}

}  // namespace

json::Value scale_first(const ResolvedKey& key) {
  json::Object o;
  o.set("scale", to_json(key.scale));
  o.set("tonic", to_json(key.tonic));
  o.set("variant", to_json(key.variant));
  return json::Value(std::move(o));
}

/** `copySpanIntervals`'s checks over a wire template. */
std::vector<double> read_span_intervals(const json::Value& intervals) {
  const std::string name = "chord span intervals";
  if (!intervals.is_array()) {
    throw InvalidInputError(name + " must be an array; received " + js::type_of(intervals));
  }
  const json::Array& list = intervals.as_array();
  if (list.empty()) {
    throw InvalidInputError(name + " must name at least one interval");
  }
  std::vector<double> out;
  for (std::size_t index = 0; index < list.size(); ++index) {
    std::string at = name + "[" + index_text(index) + "]";
    if (is_undefined(list[index])) {
      throw InvalidInputError(at + " must be a semitone offset; received undefined");
    }
    out.push_back(assert_integer(list[index], at, -MAX_CHORD_INTERVAL, MAX_CHORD_INTERVAL));
  }
  return out;
}

/** `makeChord`'s prologue over wire arguments: the root, the bass when given, the quality. */
Chord make_chord_from_wire(const json::Value& root, const json::Value& quality,
                           const json::Value& bass) {
  double root_pc = assert_finite_number(root, "chord rootPc");
  std::optional<double> bass_pc;
  if (!is_undefined(bass)) {
    bass_pc = assert_finite_number(bass, "chord bassPc");
  }
  return make_chord(root_pc, read_chord_quality(quality), bass_pc);
}

ChordSpan read_chord_span(const json::Value& span) {
  assert_record(span, "chord span");
  Chord chord =
      make_chord_from_wire(get(span, "rootPc"), get(span, "quality"), get(span, "bassPc"));
  ChordSpan out{chord.rootPc, chord.quality, 0,           chord.bassPc,
                std::nullopt, std::nullopt,  std::nullopt};
  const json::Value& intervals = get(span, "intervals");
  if (!is_undefined(intervals)) {
    out.intervals = read_span_intervals(intervals);
  }
  return out;
}

std::vector<std::string_view> key_variant_names() {
  std::vector<std::string_view> names;
  for (KeyVariant variant : {KeyVariant::kMajor, KeyVariant::kNatural, KeyVariant::kHarmonic,
                             KeyVariant::kMelodic, KeyVariant::kModal}) {
    names.push_back(to_string(variant));
  }
  return names;
}

KeyScale read_key_like(const json::Value& value) {
  if (value.is_string()) {
    return to_key_scale(KeyArg(value.as_string()));
  }
  if (is_js_object(value)) {
    // The class and the plain data it serializes to carry the scale beside the spelled tonic.
    const json::Value* data = &value;
    if (has_to_json(value)) {
      data = &get(like_target(value), "scale");
    } else if (value.is_object() && value.as_object().find("scale") != nullptr) {
      data = &get(value, "scale");
    }
    if (is_js_object(*data)) {
      return normalized_key_scale(*data);
    }
  }
  throw InvalidInputError("key must be a key name or a key/scale; received " + js::type_of(value));
}

KeyArg read_key_arg(const json::Value& value) {
  if (value.is_string()) {
    return KeyArg(value.as_string());
  }
  KeyData data{read_key_like(value), std::nullopt, std::nullopt};
  const json::Value& carried = has_to_json(value) ? like_target(value) : value;
  if (is_js_object(carried)) {
    const json::Value& tonic = get(carried, "tonic");
    if (!is_undefined(tonic)) {
      data.tonic = read_note(tonic, "note");
    }
    const json::Value& variant = get(carried, "variant");
    if (!is_undefined(variant)) {
      data.variant = parse_key_variant(assert_one_of(variant, key_variant_names(), "variant"));
    }
  }
  return KeyArg(std::move(data));
}

int read_mode_mask(const json::Value& value, std::string_view name) {
  return static_cast<int>(assert_integer(value, name, 1, CHROMATIC_MASK));
}

int read_mask_of(const json::Value& value, std::string_view name) {
  const json::Value& record = assert_record(value, name);
  return read_mode_mask(get(record, "modeMask12"), join_name(name, ".modeMask12"));
}

ChordQuality read_chord_quality(const json::Value& value) {
  if (value.is_string()) {
    if (std::optional<ChordQuality> quality = parse_chord_quality(value.as_string())) {
      return *quality;
    }
  }
  throw InvalidInputError("Unknown chord quality: " + js::template_string(value));
}

const json::Value& assert_chord(const json::Value& value, std::string_view name) {
  const json::Value& chord = assert_record(value, name);
  assert_finite_number(get(chord, "rootPc"), join_name(name, ".rootPc"));
  read_chord_quality(get(chord, "quality"));
  return chord;
}

void assert_mask_inputs(const json::Value& chord) {
  assert_record(chord, "chord");
  assert_array(get(chord, "intervals"), "chord intervals");
}

Chord read_chord_fields(const json::Value& value, ChordQuality fallback) {
  Chord chord;
  chord.rootPc = arithmetic(get(value, "rootPc"));
  const json::Value& quality = get(value, "quality");
  chord.quality =
      quality.is_string() ? parse_chord_quality(quality.as_string()).value_or(fallback) : fallback;
  const json::Value& intervals = get(value, "intervals");
  if (intervals.is_array()) {
    for (const json::Value& interval : intervals.as_array()) {
      chord.intervals.push_back(arithmetic(interval));
    }
  }
  const json::Value& bass = get(value, "bassPc");
  if (!is_undefined(bass)) {
    chord.bassPc = arithmetic(bass);
  }
  chord.rootSpelling = read_spelling(get(value, "rootSpelling"));
  chord.bassSpelling = read_spelling(get(value, "bassSpelling"));
  const json::Value& tones = get(value, "toneSpellings");
  if (tones.is_array()) {
    std::vector<PitchSpelling> hints;
    bool whole = true;
    for (const json::Value& hint : tones.as_array()) {
      // A hole spoils the hint as a whole, which is what an absent hint means.
      if (is_undefined(hint)) {
        whole = false;
        break;
      }
      hints.push_back(read_spelling(hint).value_or(PitchSpelling{arithmetic(hint), 0}));
    }
    if (whole) {
      chord.toneSpellings = std::move(hints);
    }
  }
  return chord;
}

ChordSpec read_chord_spec(const json::Value& value) {
  if (value.is_null() || js::type_of(value) != "object") {
    throw InvalidInputError("chord spec must be an object; received " + js::type_of(value));
  }
  ChordSpec spec;
  spec.rootPc = assert_finite_number(get(value, "rootPc"), "chord spec rootPc");
  const json::Value& bass = get(value, "bassPc");
  if (!is_undefined(bass)) {
    spec.bassPc = assert_finite_number(bass, "chord spec bassPc");
  }
  spec.base =
      *parse_chord_base(read_part(get(value, "base"), chord_base_names(), "chord spec base"));
  const json::Value& seventh = get(value, "seventh");
  if (!is_undefined(seventh)) {
    spec.seventh =
        parse_chord_seventh(read_part(seventh, chord_seventh_names(), "chord spec seventh"));
  }
  const json::Value& alterations = get(value, "alterations");
  if (!alterations.is_array()) {
    throw InvalidInputError("chord spec alterations must be an array");
  }
  for (const json::Value& alteration : alterations.as_array()) {
    double degree = read_degree_in(get(alteration, "degree"), kAlterableDegrees,
                                   "chord spec alteration degree");
    double alter =
        read_degree_in(get(alteration, "alter"), kAlterationSteps, "chord spec alteration");
    spec.alterations.push_back(Alteration{static_cast<int>(degree), alter});
  }
  spec.additions =
      read_degree_list(get(value, "additions"), kAddableDegrees, "chord spec additions");
  spec.omissions =
      read_degree_list(get(value, "omissions"), kOmittableDegrees, "chord spec omissions");
  return spec;
}

SpellingContext read_spelling_context(const json::Value& value) {
  const json::Value& asked = assert_options(value, "context");
  SpellingContext context;
  if (const json::Value* chord = opt_null_default(asked, "chord")) {
    context.chord = read_chord_fields(*chord);
  }
  if (const json::Value* root = opt_null_default(asked, "chordRoot")) {
    context.chordRoot = arithmetic(*root);
  }
  if (const json::Value* previous = opt_strict(asked, "previous")) {
    context.previous = arithmetic(*previous);
  }
  if (const json::Value* next = opt_strict(asked, "next")) {
    context.next = arithmetic(*next);
  }
  return context;
}

}  // namespace cantus::ops
