/**
 * @file voicing.h
 * @brief Public C++ API of ts/src/theory/voicing: realize chords as MIDI voicings, one pitch per
 *        voice, by a bounded search that scores structure, voice leading and the written rules.
 *
 * Every voicing is ascending (index 0 is the lowest voice). The search is deterministic: the same
 * chords and options always give the same pitches.
 */
#ifndef CANTUS_THEORY_VOICING_H_
#define CANTUS_THEORY_VOICING_H_

#include <cstdint>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"

namespace cantus {

/** An inclusive MIDI pitch range for a single voice (`VoiceRange`). */
struct VoiceRange {
  double min = 0;
  double max = 0;
};

/** Default four-voice SATB ranges, ascending: bass, tenor, alto, soprano (`SATB_RANGES`). */
extern const std::vector<VoiceRange> SATB_RANGES;

/** A tertian voicing style for voice_chord_styled() (`VoicingStyle`). */
enum class VoicingStyle : std::uint8_t { kClose, kDrop2, kDrop3, kShell, kRootless };

/** The TS name of a style ("close", "drop2", "drop3", "shell" or "rootless"). */
std::string_view to_string(VoicingStyle style);

/** The style named `name`, or nullopt. */
std::optional<VoicingStyle> parse_voicing_style(std::string_view name);

/** Options of voice_chord(), voice_progression() and next_voicing() (`VoicingOptions`). */
struct VoicingOptions {
  /** Number of voices to realize; ignored when `ranges` is given. Defaults to 4. */
  std::optional<double> voices;
  /** Explicit per-voice ranges, ascending; they take precedence over `voices`. */
  std::optional<std::vector<VoiceRange>> ranges;
  /** Maximum spacing in semitones between adjacent upper voices. Defaults to 12. */
  std::optional<double> maxSpacing;
  /** Maximum candidate voicings evaluated for one chord. Defaults to 4000. */
  std::optional<double> maxCandidates;
  /** Maximum number of chords voice_progression() will voice. Defaults to the generation budget. */
  std::optional<double> budget;
  /** The prevailing key; it enables the rules that only make sense against a tonic. */
  std::optional<KeyArg> key;
  /** The chord the current voicing was written on, for the rules read from the chord left. */
  std::optional<ChordArg> previousChord;
};

/** Options of voice_chord_styled() (`StyledVoicingOptions`). */
struct StyledVoicingOptions {
  /** The style to build. Defaults to close. */
  std::optional<VoicingStyle> style;
  /** Constrain the highest voice to this pitch class when given. */
  std::optional<double> topNote;
  /** Base octave in scientific pitch notation. Defaults to 4. */
  std::optional<double> octave;
  /** Omit the root regardless of style. */
  std::optional<bool> rootless;
};

/**
 * Realize one chord as one MIDI pitch per voice (`voiceChord`).
 * @throws InvalidInputError if the options are malformed.
 * @throws NoSolutionError if no voicing fits the ranges.
 */
std::vector<int> voice_chord(const ChordArg& chord, const VoicingOptions& opts = {});

/**
 * Voice a chord progression with smooth voice leading (`voiceProgression`).
 * @throws InvalidInputError if the options are malformed.
 * @throws BudgetExceededError if the progression is longer than `opts.budget`.
 * @throws NoSolutionError carrying the failing chord's index when a chord fits no voicing.
 */
std::vector<std::vector<int>> voice_progression(const std::vector<ChordArg>& chords,
                                                const VoicingOptions& opts = {});

/**
 * Voice a chord to follow smoothly from an arbitrary current voicing (`nextVoicing`).
 * @throws InvalidInputError if `current` is empty or non-finite where the ranges are derived from
 *   it, asks for more voices than the search takes, or the options are malformed.
 * @throws NoSolutionError if no voicing fits the ranges.
 */
std::vector<int> next_voicing(const std::vector<double>& current, const ChordArg& chord,
                              const VoicingOptions& opts = {});

/**
 * The summed absolute semitone motion between two voicings, or infinity when their lengths differ
 * (`voiceLeadingCost`).
 * @throws InvalidInputError if a pitch is not finite.
 */
double voice_leading_cost(const std::vector<double>& from, const std::vector<double>& to);

/**
 * Realize a chord as an explicit tertian voicing in a chosen style (`voiceChordStyled`).
 * @throws InvalidInputError if the octave or top note is malformed, or the stack would run outside
 *   MIDI 0..127.
 */
std::vector<int> voice_chord_styled(const ChordArg& chord, const StyledVoicingOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_THEORY_VOICING_H_
