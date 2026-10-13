/**
 * @file functional.h
 * @brief Public C++ API of ts/src/analyze/functional: Roman-numeral parsing and formatting,
 *        harmonic function, cadence detection, borrowed chords and augmented sixths.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and chromatic chords are
 * handled by their semitone offset rather than requiring a spelled key signature.
 */
#ifndef CANTUS_ANALYZE_FUNCTIONAL_H_
#define CANTUS_ANALYZE_FUNCTIONAL_H_

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"

namespace cantus {

/** The three broad harmonic functions of tonal music (`HarmonicFunction`). */
enum class HarmonicFunction : std::uint8_t { kTonic, kSubdominant, kDominant };

/** The TS name of a function ("tonic", "subdominant" or "dominant"). */
std::string_view to_string(HarmonicFunction function);

/** The function named `name`, or nullopt. */
std::optional<HarmonicFunction> parse_harmonic_function(std::string_view name);

/** Every function, in the order of HARMONIC_FUNCTIONS. */
std::vector<HarmonicFunction> harmonic_functions();

/** The origin of a recognized non-diatonic chord (`BorrowedSource`, without its null). */
enum class BorrowedSource : std::uint8_t { kParallelMinor, kParallelMajor, kNeapolitan };

/** The TS name of a source ("parallelMinor", "parallelMajor" or "neapolitan"). */
std::string_view to_string(BorrowedSource source);

/** The source named `name`, or nullopt. */
std::optional<BorrowedSource> parse_borrowed_source(std::string_view name);

/** The three augmented-sixth chords (`AugmentedSixthKind`). */
enum class AugmentedSixthKind : std::uint8_t { kItalian, kFrench, kGerman };

/** The TS name of a kind ("italian", "french" or "german"). */
std::string_view to_string(AugmentedSixthKind kind);

/** The kind named `name`, or nullopt. */
std::optional<AugmentedSixthKind> parse_augmented_sixth_kind(std::string_view name);

/** The named cadence types detect_cadence() classifies a chord pair as (`CadenceType`). */
enum class CadenceType : std::uint8_t { kAuthentic, kPlagal, kHalf, kDeceptive, kPhrygian, kModal };

/** The TS name of a type ("authentic", ..., "modal"). */
std::string_view to_string(CadenceType type);

/** The type named `name`, or nullopt. */
std::optional<CadenceType> parse_cadence_type(std::string_view name);

/** Every cadence type, in the order of CADENCE_TYPES. */
std::vector<CadenceType> cadence_types();

/** How conclusive an authentic cadence is (`CadenceResult['strength']`, without its null). */
enum class CadenceStrength : std::uint8_t { kPerfect, kImperfect };

/** The TS name of a strength ("perfect" or "imperfect"). */
std::string_view to_string(CadenceStrength strength);

/** A reading that was considered and rejected, and why it lost (`RejectedCandidate`). */
struct RejectedCandidate {
  /** The rejected reading, named the way the accepted one is named. */
  std::string label;
  /** Why the accepted reading was preferred over this one. */
  std::string reason;
};

/** Options of chord_to_roman() (`ChordToRomanOptions`). */
struct ChordToRomanOptions {
  /** Render a tonicizing chord as an applied numeral (`V7/V`) instead of naming its root. */
  std::optional<bool> applied;
  /** Render a first-inversion Neapolitan as `N6` instead of `bII6`. */
  std::optional<bool> neapolitan;
};

/** Options of analyze_chord(): the numeral options plus the switch for the rival readings. */
struct AnalyzeChordOptions : ChordToRomanOptions {
  /** Report the readings this analysis turned down. */
  std::optional<bool> alternatives;
};

/** Options of explain_roman(): the numeral options plus the switch for the rival spellings. */
struct ExplainRomanOptions : ChordToRomanOptions {
  /** Report the numerals the other option settings would have rendered. */
  std::optional<bool> alternatives;
};

/** The result of analyze_chord(): function, borrowing and Roman numeral (`ChordAnalysis`). */
struct ChordAnalysis {
  HarmonicFunction function = HarmonicFunction::kTonic;
  bool borrowed = false;
  Nullable<BorrowedSource> source;
  std::string roman;
  /** Why the chord reads this way. */
  std::string rationale;
  /** The readings that were considered and rejected; empty unless asked for. */
  std::vector<RejectedCandidate> alternatives;
};

/** A numeral with the reasoning behind it (`RomanExplanation`). */
struct RomanExplanation {
  std::string roman;
  std::string rationale;
  std::vector<RejectedCandidate> alternatives;
};

/** A chord that is diatonic to two keys at once, with its reading in each (`PivotChord`). */
struct PivotChord {
  Chord chord;
  /** Roman numeral in the key being left. */
  std::string romanFrom;
  /** Roman numeral in the key being entered. */
  std::string romanTo;
};

/** Options of detect_cadence() (`DetectCadenceOptions`). */
struct DetectCadenceOptions {
  /**
   * The pitches actually sounding as MIDI note numbers: the penultimate chord's voicing first,
   * then the final chord's.
   */
  std::optional<std::array<std::vector<double>, 2>> voicing;
  /** Report the cadences this pair came close to forming. */
  std::optional<bool> alternatives;
  /** The chord before `from`, which tells a cadential six-four from an inverted tonic. */
  std::optional<ChordArg> approach;
};

/** A recognized cadence, with the voice-leading facts its reading rests on (`CadenceResult`). */
struct CadenceResult {
  /** The cadence the chord pair forms, or null when it forms none. */
  Nullable<CadenceType> type;
  /** How conclusive an authentic cadence is; null for every other type. */
  Nullable<CadenceStrength> strength;
  /** The role the final chord's highest sounding pitch plays in that chord. */
  std::optional<ChordToneRole> soprano;
  /** Both chords stand on their own root. */
  bool rootPosition = false;
  /** The dominant resolved onto an inverted tonic. */
  bool evaded = false;
  std::string rationale;
  std::vector<RejectedCandidate> alternatives;
};

/** Whether a key's scale has a minor third and no major third (`isMinorKey`). */
bool is_minor_key(const KeyArg& key);

/** The harmonic function of a chord in a key (`functionOf`). */
HarmonicFunction function_of(const ChordArg& chord, const KeyArg& key);

/** Whether every pitch class of a chord belongs to the key's scale (`isDiatonic`). */
bool is_diatonic(const ChordArg& chord, const KeyArg& key);

/** Analyze a chord in a key: harmonic function, borrowing and Roman numeral (`analyzeChord`). */
ChordAnalysis analyze_chord(const ChordArg& chord, const KeyArg& key,
                            const AnalyzeChordOptions& opts = {});

/**
 * The secondary dominant (V7) that tonicizes a scale degree (`secondaryDominant`).
 * @throws InvalidInputError if `target_degree` is not an integer naming a degree in `key`.
 */
Chord secondary_dominant(double target_degree, const KeyArg& key);

/** The secondary dominant (V7) that tonicizes a chord (`secondaryDominantOf`). */
Chord secondary_dominant_of(const ChordArg& target);

/** Whether a chord is borrowed from the parallel mode (`isBorrowedChord`). */
bool is_borrowed_chord(const ChordArg& chord, const KeyArg& key);

/** Where a non-diatonic chord comes from, or null (`borrowedSource`). */
Nullable<BorrowedSource> borrowed_source(const ChordArg& chord, const KeyArg& key);

/** The chords a modulation from `from` to `to` can pivot on (`pivotChords`). */
std::vector<PivotChord> pivot_chords(const KeyArg& from, const KeyArg& to);

/** Classify the cadence formed by moving from one chord to the next (`detectCadence`). */
CadenceResult detect_cadence(const ChordArg& from, const ChordArg& to, const KeyArg& key,
                             const DetectCadenceOptions& opts = {});

/**
 * Render a chord as a Roman numeral relative to a key (`chordToRoman`).
 * @throws InvalidInputError if the key names no key.
 */
std::string chord_to_roman(const ChordArg& chord, const KeyArg& key,
                           const ChordToRomanOptions& opts = {});

/** Render a chord as a Roman numeral and say how it was arrived at (`explainRoman`). */
RomanExplanation explain_roman(const ChordArg& chord, const KeyArg& key,
                               const ExplainRomanOptions& opts = {});

/**
 * Build the chord denoted by a Roman numeral in a key (`romanToChord`).
 * @throws InvalidInputError if the text is not a numeral this grammar reads.
 */
Chord roman_to_chord(std::string_view text, const KeyArg& key);

/** Build an augmented-sixth chord in a key (`augmentedSixthChord`). */
Chord augmented_sixth_chord(AugmentedSixthKind kind, const KeyArg& key);

/** Identify a chord as one of the augmented sixths, or null (`augmentedSixthKind`). */
Nullable<AugmentedSixthKind> augmented_sixth_kind(const ChordArg& chord, const KeyArg& key);

/**
 * Read a set of sounding pitch classes over a sounding bass as an augmented sixth, or null
 * (`augmentedSixthFromPitchClasses`).
 */
Nullable<Chord> augmented_sixth_from_pitch_classes(const std::vector<double>& pcs, double bass_pc,
                                                   const KeyArg& key);

/** Spell an augmented-sixth chord from a spelled tonic, lowest note first (`spellAugmentedSixth`).
 */
std::vector<NoteData> spell_augmented_sixth(AugmentedSixthKind kind, const NoteArg& tonic);

}  // namespace cantus

#endif  // CANTUS_ANALYZE_FUNCTIONAL_H_
