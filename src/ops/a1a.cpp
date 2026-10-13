// Op adapters of analyze (layer root), analyze/functional.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_c2.h, ops/codec_t1.h, ops/codec_t2.h, ops/codec_a1a.h), in the TS
// order and with the TS names, then calls the typed function. The layer-root files have no
// public op.

#include <algorithm>
#include <cmath>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "analyze/functional/augmented_sixth.h"
#include "analyze/functional/roman.h"
#include "cantus/analyze/functional.h"
#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "core/pitch/pitch.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1a.h"
#include "ops/codec_c2.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** The names of the augmented-sixth kinds, for assert_one_of(). */
std::vector<std::string_view> kind_names() {
  std::vector<std::string_view> names;
  for (AugmentedSixthKind kind :
       {AugmentedSixthKind::kItalian, AugmentedSixthKind::kFrench, AugmentedSixthKind::kGerman}) {
    names.push_back(to_string(kind));
  }
  return names;
}

/** `assertOneOf(kind, KINDS, 'augmented sixth kind')`. */
AugmentedSixthKind read_kind(const json::Value& value) {
  return *parse_augmented_sixth_kind(assert_one_of(value, kind_names(), "augmented sixth kind"));
}

/**
 * What renderRoman asks of a chord's quality before it styles a numeral. The style table has no
 * entry for a quality no table has, which TS meets as a plain TypeError, unless a guard on the
 * chord's tones refuses the quality first: the tonicizing reading asks for the tones, and so does
 * a chord on the lowered submediant. A name the table inherits from Object.prototype finds a
 * value that carries no style, which the numeral then shows.
 */
std::optional<InheritedQuality> settle_numeral_quality(ChordData& data,
                                                       const ChordToRomanOptions& options,
                                                       const ResolvedKey& key) {
  const json::Value& quality = get(data.wire, "quality");
  std::optional<ChordQuality> known = table_quality(quality);
  if (known) {
    data.chord.quality = *known;
    return std::nullopt;
  }
  double bass = data.chord.bassPc ? *data.chord.bassPc : data.chord.rootPc;
  if (options.applied == true || pitch_class_of(bass) == augmented_sixth_bass_pc(key.scale)) {
    assert_chord_quality(data.wire);
  }
  if (js::type_of(quality) != "symbol" && inherits_object_member(js::template_string(quality))) {
    // Outside every set of qualities a numeral looks a quality up in.
    data.chord.quality = ChordQuality::kSus2;
    return InheritedQuality{js::template_string(quality)};
  }
  throw js::TypeError(
      "Cannot destructure property 'lower' of 'romanStyle(...)' as it is undefined.");
}

template <class Options>
Options read_numeral_options(const json::Value& asked) {
  Options opts;
  static_cast<ChordToRomanOptions&>(opts) = read_chord_to_roman_options(asked);
  opts.alternatives = field(asked, "alternatives") != nullptr &&
                      field(asked, "alternatives")->is_bool() &&
                      field(asked, "alternatives")->as_bool();
  return opts;
}

void register_functional() {
  def("$const:HARMONIC_FUNCTIONS", [](Args&) -> json::Value {
    std::vector<std::string_view> names;
    for (HarmonicFunction function :
         {HarmonicFunction::kTonic, HarmonicFunction::kSubdominant, HarmonicFunction::kDominant}) {
      names.push_back(to_string(function));
    }
    return to_json(names);
  });
  def("$const:CADENCE_TYPES", [](Args&) -> json::Value {
    std::vector<std::string_view> names;
    for (CadenceType type :
         {CadenceType::kAuthentic, CadenceType::kPlagal, CadenceType::kHalf,
          CadenceType::kDeceptive, CadenceType::kPhrygian, CadenceType::kModal}) {
      names.push_back(to_string(type));
    }
    return to_json(names);
  });

  // functional/function
  def("isMinorKey",
      [](Args& a) -> json::Value { return to_json(is_minor_key(read_key_like(a[0]))); });
  def("functionOf", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    KeyScale key = read_key_like(a[1]);
    // Every reading of the chord goes through a guard that refuses a quality no table has.
    settle_chord_quality(data);
    return to_json(function_of(data.chord, key));
  });
  def("isDiatonic", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    KeyScale key = read_key_like(a[1]);
    settle_chord_quality(data);
    return to_json(is_diatonic(data.chord, key));
  });
  def("analyzeChord", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[2], "opts");
    ChordData data = read_chord_like(a[0]);
    KeyScale key = read_key_like(a[1]);
    settle_chord_quality(data);
    return to_json(
        analyze_chord(data.chord, key, read_numeral_options<AnalyzeChordOptions>(asked)));
  });
  def("secondaryDominant", [](Args& a) -> json::Value {
    KeyScale key = read_key_like(a[1]);
    // A degree outside the scale is a caller error, not a wrap-around.
    auto count = static_cast<double>(scale_tones_in_degree_order(key).size());
    double degree = assert_integer(a[0], "targetDegree", 1, count);
    return to_json(secondary_dominant(degree, key));
  });
  def("secondaryDominantOf", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    Chord dominant = secondary_dominant_of(data.chord);
    // A spelling hint that is not an object is refused by the note it is moved as; a note carrying
    // an octave is moved with it.
    const json::Value& hint = get(data.wire, "rootSpelling");
    if (!is_undefined(hint)) {
      NoteData moved = transpose_note(read_note(hint, "note"), 7);
      dominant.rootSpelling =
          PitchSpelling{static_cast<double>(moved.letter), static_cast<double>(moved.alter)};
    }
    return to_json(dominant);
  });

  // functional/borrowed
  def("isBorrowedChord", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    KeyScale key = read_key_like(a[1]);
    settle_chord_quality(data);
    return to_json(is_borrowed_chord(data.chord, key));
  });
  def("borrowedSource", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    KeyScale key = read_key_like(a[1]);
    settle_chord_quality(data);
    return to_json(borrowed_source(data.chord, key));
  });

  // functional/pivot
  def("pivotChords", [](Args& a) -> json::Value {
    KeyScale from = read_key_like(a[0]);
    KeyScale to = read_key_like(a[1]);
    return to_json(pivot_chords(from, to));
  });

  // functional/cadence
  def("detectCadence", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[3], "opts");
    ChordData from = read_chord_like(a[0]);
    ChordData to = read_chord_like(a[1]);
    KeyScale key = read_key_like(a[2]);
    DetectCadenceOptions opts;
    if (const json::Value* approach = field(asked, "approach")) {
      opts.approach = ChordArg(read_chord_like(*approach).chord);
    }
    opts.voicing = read_cadence_voicing(asked);
    const json::Value* alternatives = field(asked, "alternatives");
    opts.alternatives =
        alternatives != nullptr && alternatives->is_bool() && alternatives->as_bool();
    return to_json(detect_cadence(from.chord, to.chord, key, opts));
  });

  // functional/roman
  def("chordToRoman", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    const json::Value& asked = assert_options(a[2], "opts");
    KeyArg key = read_key_arg(a[1]);
    ChordToRomanOptions options = read_chord_to_roman_options(asked);
    std::optional<InheritedQuality> inherited =
        settle_numeral_quality(data, options, resolve_key(key));
    if (inherited) {
      return to_json(render_roman(data.chord, key, options, &*inherited).roman);
    }
    return to_json(chord_to_roman(data.chord, key, options));
  });
  def("explainRoman", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[2], "opts");
    ChordData data = read_chord_like(a[0]);
    KeyArg key = read_key_arg(a[1]);
    ExplainRomanOptions options = read_numeral_options<ExplainRomanOptions>(asked);
    std::optional<InheritedQuality> inherited =
        settle_numeral_quality(data, options, resolve_key(key));
    if (!inherited) {
      return to_json(explain_roman(data.chord, key, options));
    }
    RomanRendering rendering = render_roman(data.chord, key, options, &*inherited);
    RomanExplanation explanation;
    explanation.rationale = describe_roman(rendering.roman, rendering.derivation);
    explanation.roman = std::move(rendering.roman);
    if (options.alternatives == true) {
      explanation.alternatives = roman_alternatives(data.chord, key, options, &*inherited);
    }
    return to_json(explanation);
  });
  def("romanToChord", [](Args& a) -> json::Value {
    KeyArg key = read_key_arg(a[1]);
    ResolvedKey resolved = resolve_key(key);
    if (!a[0].is_string()) {
      throw js::TypeError(is_undefined(a[0]) || a[0].is_null()
                              ? "Cannot read properties of " +
                                    std::string(a[0].is_null() ? "null" : "undefined") +
                                    " (reading 'trim')"
                              : "text.trim is not a function");
    }
    return to_json(roman_to_chord(a[0].as_string(), resolved));
  });

  // functional/augmented-sixth
  def("augmentedSixthChord", [](Args& a) -> json::Value {
    AugmentedSixthKind kind = read_kind(a[0]);
    return to_json(augmented_sixth_chord(kind, read_key_arg(a[1])));
  });
  def("augmentedSixthKind", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    KeyArg key = read_key_arg(a[1]);
    // The pitch classes are read, and the quality checked, only for a chord on the family's bass.
    ResolvedKey resolved = resolve_key(key);
    double bass = data.chord.bassPc ? *data.chord.bassPc : data.chord.rootPc;
    if (pitch_class_of(bass) == augmented_sixth_bass_pc(resolved.scale)) {
      settle_chord_quality(data);
    }
    return to_json(augmented_sixth_kind(data.chord, resolved));
  });
  def("augmentedSixthFromPitchClasses", [](Args& a) -> json::Value {
    // Null means "these pitch classes are no augmented sixth"; a value that is not a list is
    // refused.
    const json::Array& pcs = assert_array(a[0], "pcs");
    ResolvedKey key = resolve_key(read_key_arg(a[2]));
    double bass = assert_finite_number(a[1], "pitch");
    if (pitch_class_of(bass) != augmented_sixth_bass_pc(key.scale)) {
      return json::Value(nullptr);
    }
    std::vector<double> values;
    for (const json::Value& pc : pcs) {
      values.push_back(assert_finite_number(pc, "pitch"));
    }
    return to_json(augmented_sixth_from_pitch_classes(values, bass, key));
  });
  def("spellAugmentedSixth", [](Args& a) -> json::Value {
    NoteData tonic = read_note_like(a[1]);
    AugmentedSixthKind kind = read_kind(a[0]);
    return to_json(spell_augmented_sixth(kind, tonic));
  });
}

}  // namespace

void register_a1a() { register_functional(); }

}  // namespace cantus::ops
