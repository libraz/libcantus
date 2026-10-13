/**
 * @file detect.h
 * @brief Public C++ API of ts/src/analyze/detect: infer a chord name from a set of pitches, or a
 *        key from a set of pitch classes. The inverse direction of the chord and scale builders.
 */
#ifndef CANTUS_ANALYZE_DETECT_H_
#define CANTUS_ANALYZE_DETECT_H_

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** A church mode detect_key() can rank alongside the major and minor keys (`ModalScaleName`). */
enum class ModalScaleName : std::uint8_t { kDorian, kPhrygian, kLydian, kMixolydian, kLocrian };

/** The TS name of a mode ("dorian", ..., "locrian"). */
std::string_view to_string(ModalScaleName name);

/** The mode named `name`, or nullopt. */
std::optional<ModalScaleName> parse_modal_scale_name(std::string_view name);

/** Every mode DetectKeyOptions::modes accepts, in candidate order (`MODAL_SCALE_NAMES`). */
std::vector<ModalScaleName> modal_scale_names();

/** How a modal candidate is built out of its parallel major or minor key (`ModalCandidate`). */
struct ModalCandidate {
  /** The name reported as KeyMatch::scaleName when this candidate wins. */
  ModalScaleName scaleName = ModalScaleName::kDorian;
  /** The major or minor key this mode is closest to, reported as `mode`. */
  KeyNameMode mode = KeyNameMode::kMinor;
  /** The 12-bit scale mask of the mode. */
  int mask = 0;
  /** Degree pairs the mode substitutes, as `[replaced, replacing]` semitone offsets. */
  std::vector<std::array<int, 2>> substitutions;
};

/** Name of a built-in key profile (`KeyProfileName`). */
enum class KeyProfileName : std::uint8_t { kKrumhansl, kTemperley, kFlat };

/** The TS name of a profile ("krumhansl", "temperley" or "flat"). */
std::string_view to_string(KeyProfileName name);

/** The profile named `name`, or nullopt. */
std::optional<KeyProfileName> parse_key_profile_name(std::string_view name);

/** A pair of 12-entry key profiles, one per mode, each indexed from its own tonic
 * (`KeyProfilePair`). */
struct KeyProfilePair {
  /** Degree weights for a major candidate, indexed from the major tonic. */
  std::array<double, 12> major{};
  /** Degree weights for a minor candidate, indexed from the minor tonic. */
  std::array<double, 12> minor{};
};

/** How detect_chord() reads its input (`DetectChordOptions['input']`). */
enum class ChordInputKind : std::uint8_t { kAuto, kMidi, kPitchClass };

/** The TS name of an input kind ("auto", "midi" or "pitchClass"). */
std::string_view to_string(ChordInputKind kind);

/** A candidate chord interpretation of a pitch set (`ChordMatch`). */
struct ChordMatch {
  int rootPc = 0;
  ChordQuality quality = ChordQuality::kMaj;
  /** Chord tones absent from the input (an incomplete voicing). */
  std::vector<int> missingPcs;
  /** Input pitch classes not belonging to the chord. */
  std::vector<int> extraPcs;
  /** The input pitch-class set equals the chord exactly. */
  bool exact = false;
  /** Inversion implied by a known bass, or null when none can be named. */
  Nullable<int> inversion;
  /** Bass pitch class when the lowest note is not the root. */
  std::optional<int> bassPc;
};

/** Input interpretation for detect_chord() and detect_chord_best() (`DetectChordOptions`). */
struct DetectChordOptions {
  /** `kAuto` (the default) selects pitch-class mode only when all values lie in 0..11. */
  std::optional<ChordInputKind> input;
  /** Explicit bass pitch class, including for an unordered pitch-class set. */
  std::optional<double> bassPc;
};

/** A candidate key interpretation of a pitch-class set (`KeyMatch`). */
struct KeyMatch {
  /** The scale that scored best for this tonic and mode. */
  KeyScale key;
  /** The major or minor key this match is closest to. */
  KeyNameMode mode = KeyNameMode::kMajor;
  /** Which scale form `key` uses. */
  KeyVariant variant = KeyVariant::kMajor;
  /** The entry of NAMED_SCALES whose mask is `key.modeMask12`. */
  std::string scaleName;
  /** Fraction of the distinct input pitch classes that belong to `key`, in [0, 1]. */
  double fit = 0;
  /** The value the results are ranked by, in [-1, 1]. */
  double score = 0;
  /** Why this candidate scored what it did; present only when DetectKeyOptions::explain asked. */
  std::optional<std::string> rationale;
  /** The candidates ranked below the top match; carried by that match alone. */
  std::optional<std::vector<RejectedCandidate>> alternatives;
};

/** Input weighting for detect_key() (`DetectKeyOptions`). */
struct DetectKeyOptions {
  /** How much each pitch counts toward the histogram, one entry per pitch. */
  std::optional<std::vector<double>> weights;
  /** Which key profile ranks the candidates. */
  std::optional<std::variant<KeyProfileName, KeyProfilePair>> profile;
  /** Whether the church modes join the 24 major and minor keys: all of them, or a chosen few. */
  std::optional<std::variant<bool, std::vector<ModalScaleName>>> modes;
  /** Attach a rationale to every candidate, and the rivals to the top-ranked one. */
  std::optional<bool> explain;
  /** Upper bound on the input pitches processed by this detection call. */
  std::optional<double> budget;
};

/** The options of detect_key_from_notes(): those of detect_key() without the weights. */
struct DetectKeyFromNotesOptions {
  std::optional<std::variant<KeyProfileName, KeyProfilePair>> profile;
  std::optional<std::variant<bool, std::vector<ModalScaleName>>> modes;
  std::optional<bool> explain;
  std::optional<double> budget;
};

/**
 * Identify chords matching a set of pitches, best first (`detectChord`).
 * @throws InvalidInputError if a pitch is not a MIDI pitch or `bassPc` is not finite.
 * @throws BudgetExceededError if the input exceeds the generation budget.
 */
std::vector<ChordMatch> detect_chord(const std::vector<int>& pitches,
                                     const DetectChordOptions& opts = {});

/** The single best chord interpretation of a pitch set, or null (`detectChordBest`). */
Nullable<Chord> detect_chord_best(const std::vector<int>& pitches,
                                  const DetectChordOptions& opts = {});

/**
 * Rank major and minor keys by how well a set of pitch classes is distributed like each key
 * (`detectKey`); empty for an empty input.
 * @throws InvalidInputError if `weights` does not have one entry per pitch, or `profile` is not a
 *   valid pair of 12 finite entries.
 * @throws BudgetExceededError if the input exceeds the budget.
 */
std::vector<KeyMatch> detect_key(const std::vector<int>& pitches,
                                 const DetectKeyOptions& opts = {});

/**
 * Rank keys by how well they contain a set of note events, weighting each note by the music it
 * occupies (`detectKeyFromNotes`).
 */
std::vector<KeyMatch> detect_key_from_notes(const std::vector<NoteEvent>& notes,
                                            const DetectKeyFromNotesOptions& opts = {});

/** The single best key interpretation of a pitch set, or null (`detectKeyBest`). */
Nullable<KeyMatch> detect_key_best(const std::vector<int>& pitches,
                                   const DetectKeyOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_ANALYZE_DETECT_H_
