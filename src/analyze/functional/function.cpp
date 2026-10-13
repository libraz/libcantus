// Harmonic function, diatonicity, parallel-key mirroring and full chord analysis:
// ts/src/analyze/functional/function.ts.

#include "analyze/functional/function.h"

#include <array>
#include <string>

#include "analyze/functional/augmented_sixth.h"
#include "analyze/functional/borrowed.h"
#include "analyze/functional/internal.h"
#include "analyze/functional/rationale.h"
#include "analyze/functional/roman.h"
#include "analyze/functional/tonicization.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "core/pitch/pitch.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

/** A name and the text it stands for (`Record<string, string>`). */
struct NamedText {
  std::string_view name;
  std::string_view text;
};

constexpr std::size_t kFunctionCount = static_cast<std::size_t>(HarmonicFunction::kDominant) + 1;

/** HARMONIC_FUNCTIONS, indexed by HarmonicFunction. */
constexpr std::array<std::string_view, kFunctionCount> kHarmonicFunctionNames = {
#include "analyze/functional/harmonic_functions.gen.inc"
};
static_assert(!kHarmonicFunctionNames.back().empty(),
              "HARMONIC_FUNCTIONS and HarmonicFunction disagree");

/** Harmonic function of each semitone offset above the tonic, major context. */
constexpr std::array<std::string_view, 12> kFunctionByOffset = {
#include "analyze/functional/function_by_offset.gen.inc"
};

/** Harmonic function of each root offset in a natural-minor context. */
constexpr std::array<std::string_view, 12> kMinorFunctionByOffset = {
#include "analyze/functional/minor_function_by_offset.gen.inc"
};

constexpr std::size_t kOverrideCount = static_cast<std::size_t>(FunctionReason::kFlatSideMajor) + 1;

/** What a rule overriding the degree table found, phrased for a rationale. */
constexpr std::array<NamedText, kOverrideCount> kFunctionReasonPhrase = {
#include "analyze/functional/function_reason_phrase.gen.inc"
};
static_assert(!kFunctionReasonPhrase.back().name.empty(),
              "FUNCTION_REASON_PHRASE and FunctionReason disagree");

constexpr std::size_t kSourceCount = static_cast<std::size_t>(BorrowedSource::kNeapolitan) + 1;

/** Where a borrowed chord came from, phrased for a rationale, indexed by BorrowedSource. */
constexpr std::array<NamedText, kSourceCount> kBorrowedSourcePhrase = {
#include "analyze/functional/borrowed_source_phrase.gen.inc"
};
static_assert(!kBorrowedSourcePhrase.back().name.empty(),
              "BORROWED_SOURCE_PHRASE and BorrowedSource disagree");

HarmonicFunction function_named(std::string_view name) { return *parse_harmonic_function(name); }

/** The function the root's offset above the tonic maps to, before any override (`degreeFunction`).
 */
HarmonicFunction degree_function(const Chord& chord, const KeyScale& key) {
  const auto& functions = is_minor_scale(key) ? kMinorFunctionByOffset : kFunctionByOffset;
  return function_named(
      functions[static_cast<std::size_t>(pitch_class_of(chord.rootPc - key.rootPc))]);
}

std::string_view override_phrase(FunctionReason reason) {
  return kFunctionReasonPhrase[static_cast<std::size_t>(reason)].text;
}

/** Build the rationale for a chord's function and borrowing (`describeChord`). */
std::string describe_chord(HarmonicFunction fn, FunctionReason reason, const std::string& roman,
                           const Nullable<BorrowedSource>& source) {
  std::string name(to_string(fn));
  std::string head =
      reason == FunctionReason::kDegree
          ? capitalize(name) + ": " + roman + " takes the " + name +
                " function of its degree in the key"
          : capitalize(name) + ": " + roman + " is " + std::string(override_phrase(reason));
  // The Neapolitan rule already says where the chord comes from; repeating the source would make
  // the rationale name it twice.
  if (!source || reason == FunctionReason::kNeapolitan) {
    return head;
  }
  return head + ", " + std::string(kBorrowedSourcePhrase[static_cast<std::size_t>(*source)].text);
}

/** The readings of the chord's function that were considered and rejected. */
std::vector<RejectedCandidate> function_alternatives(const Chord& chord, const KeyScale& key,
                                                     FunctionReason reason,
                                                     HarmonicFunction accepted) {
  std::vector<RejectedCandidate> out;
  if (reason == FunctionReason::kDegree) {
    // The sonority could tonicize, and only its being in the key stopped it.
    if (points_at_tonicizable_degree(chord, key) && is_diatonic_chord(chord, key)) {
      out.push_back(RejectedCandidate{
          "applied dominant",
          "The chord is diatonic to the key, so it keeps the function of its degree rather than "
          "tonicizing another"});
    }
  } else {
    HarmonicFunction by_degree = degree_function(chord, key);
    if (by_degree != accepted) {
      std::string name(to_string(by_degree));
      out.push_back(
          RejectedCandidate{name + " by scale degree", "The degree the root stands on reads as " +
                                                           name + ", but the chord is " +
                                                           std::string(override_phrase(reason))});
    }
  }
  Nullable<AugmentedSixthKind> sixth = augmented_sixth_kind_of(chord, key);
  if (sixth && *sixth == AugmentedSixthKind::kGerman) {
    out.push_back(RejectedCandidate{
        "tritone substitute",
        "The German sixth sounds a dominant seventh, but the lowered submediant under it fixes "
        "the reading as an augmented sixth"});
  }
  return out;
}

}  // namespace

std::string_view to_string(HarmonicFunction function) {
  return kHarmonicFunctionNames[static_cast<std::size_t>(function)];
}

std::optional<HarmonicFunction> parse_harmonic_function(std::string_view name) {
  for (std::size_t i = 0; i < kHarmonicFunctionNames.size(); ++i) {
    if (kHarmonicFunctionNames[i] == name) {
      return static_cast<HarmonicFunction>(i);
    }
  }
  return std::nullopt;
}

std::string_view to_string(BorrowedSource source) {
  return kBorrowedSourcePhrase[static_cast<std::size_t>(source)].name;
}

std::optional<BorrowedSource> parse_borrowed_source(std::string_view name) {
  for (std::size_t i = 0; i < kBorrowedSourcePhrase.size(); ++i) {
    if (kBorrowedSourcePhrase[i].name == name) {
      return static_cast<BorrowedSource>(i);
    }
  }
  return std::nullopt;
}

ReasonedFunction function_with_reason(const Chord& chord, const KeyScale& key) {
  int offset = pitch_class_of(chord.rootPc - key.rootPc);
  if (is_neapolitan_chord_of(chord, key)) {
    return {HarmonicFunction::kSubdominant, FunctionReason::kNeapolitan};
  }
  if (augmented_sixth_kind_of(chord, key)) {
    return {HarmonicFunction::kSubdominant, FunctionReason::kAugmentedSixth};
  }
  if (is_applied_dominant(chord, key)) {
    return {HarmonicFunction::kDominant, FunctionReason::kApplied};
  }
  // A chord the key already contains is its own degree, however flat that degree lies.
  if (!is_minor_scale(key) && !is_diatonic_chord(chord, key) && has_major_third(chord) &&
      (offset == 8 || offset == 10)) {
    return {HarmonicFunction::kSubdominant, FunctionReason::kFlatSideMajor};
  }
  return {degree_function(chord, key), FunctionReason::kDegree};
}

bool is_minor_key(const KeyArg& key) { return is_minor_scale(to_key_scale(key)); }

HarmonicFunction function_of(const ChordArg& chord, const KeyArg& key) {
  Chord data = to_chord_data(chord);
  KeyScale scale = to_key_scale(key);
  return function_with_reason(data, scale).function;
}

bool is_diatonic(const ChordArg& chord, const KeyArg& key) {
  Chord data = to_chord_data(chord);
  KeyScale scale = to_key_scale(key);
  return is_diatonic_chord(data, scale);
}

KeyScale parallel_key(const KeyArg& key) { return parallel_scale(to_key_scale(key)); }

ChordAnalysis analyze_chord(const ChordArg& chord, const KeyArg& key,
                            const AnalyzeChordOptions& opts) {
  Chord data = to_chord_data(chord);
  KeyScale scale = to_key_scale(key);
  Nullable<BorrowedSource> source = borrowed_source_of(data, scale);
  ReasonedFunction reasoned = function_with_reason(data, scale);
  std::string roman = render_roman(data, scale, opts).roman;
  ChordAnalysis out;
  out.function = reasoned.function;
  out.borrowed = source.has_value();
  out.source = source;
  out.rationale = describe_chord(reasoned.function, reasoned.reason, roman, source);
  out.roman = std::move(roman);
  if (opts.alternatives == true) {
    out.alternatives = function_alternatives(data, scale, reasoned.reason, reasoned.function);
    for (RejectedCandidate& rival : roman_alternatives(data, scale, opts)) {
      out.alternatives.push_back(std::move(rival));
    }
  }
  return out;
}

Chord secondary_dominant(double target_degree, const KeyArg& key) {
  KeyScale scale = to_key_scale(key);
  // A degree outside the scale is a caller error, not a wrap-around.
  auto degree_count = static_cast<double>(scale_tones_in_degree_order(scale).size());
  assert_integer(target_degree, "targetDegree", 1, degree_count);
  int target_root = degree_root_pc(target_degree, scale);
  return make_chord(pitch_class_of(target_root + 7), ChordQuality::kDom7);
}

Chord secondary_dominant_of(const ChordArg& target) {
  Chord data = to_chord_data(target);
  assert_finite_number(data.rootPc, "target chord rootPc");
  Chord dominant = make_chord(pitch_class_of(data.rootPc + 7), ChordQuality::kDom7);
  // Move an explicit spelling hint rather than deriving one: the dominant of a flat-named target
  // is spelled flat, whatever key it is later read in.
  if (data.rootSpelling) {
    NoteData hint = assert_note_values(data.rootSpelling->letter, data.rootSpelling->alter,
                                       std::nullopt, "note");
    NoteData moved = transpose_note(hint, 7);
    dominant.rootSpelling =
        PitchSpelling{static_cast<double>(moved.letter), static_cast<double>(moved.alter)};
  }
  return dominant;
}

}  // namespace cantus
