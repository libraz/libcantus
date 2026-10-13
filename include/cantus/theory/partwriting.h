/**
 * @file partwriting.h
 * @brief Public C++ API of ts/src/theory/partwriting: grade a finished exercise against the
 *        classical four-part rules, or a two-voice exercise against the species rules.
 *
 * The input is spelled notes rather than MIDI pitches because two of the rules cannot be decided
 * without them: a cross relation is one letter carrying two accidentals, and an augmented second
 * is a minor third under another name. A caller holding only pitches spells them with
 * spell_voicing().
 */
#ifndef CANTUS_THEORY_PARTWRITING_H_
#define CANTUS_THEORY_PARTWRITING_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/pitch.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/voicing.h"

namespace cantus {

/** The rule a PartWritingViolation breaks (`PartWritingViolationKind`). */
enum class PartWritingViolationKind : std::uint8_t {
  kParallelFifth,
  kParallelOctave,
  kHiddenPerfect,
  kCrossRelation,
  kVoiceCrossing,
  kOverlap,
  kSpacing,
  kRange,
  kUnresolvedLeadingTone,
  kUnresolvedSeventh,
  kAugmentedMelodicInterval,
  kWrongRhythmicRatio,
  kUnpreparedDissonance,
  kUnresolvedSuspension,
  kIllegalLeap,
  kBattuta,
  kMissingCadence,
  kMelodicShape,
};

/** The TS name of a violation kind ("parallelFifth", ...). */
std::string_view to_string(PartWritingViolationKind kind);

/** The kind named `name`, or nullopt. */
std::optional<PartWritingViolationKind> parse_part_writing_violation_kind(std::string_view name);

/** One broken rule, located in the progression and in the texture (`PartWritingViolation`). */
struct PartWritingViolation {
  /** The rule that was broken. */
  PartWritingViolationKind kind = PartWritingViolationKind::kParallelFifth;
  /**
   * The voices involved, by index into a voicing (0 is the lowest). In a species exercise 0 is
   * the cantus firmus and 1 the counterpoint.
   */
  std::vector<int> voices;
  /** Index of the chord the motion starts on; in a species exercise, the counterpoint's index. */
  int fromIndex = 0;
  /** Index of the chord it ends on; equal to `fromIndex` for a vertical rule. */
  int toIndex = 0;
  /** A short sentence naming the musical reason. */
  std::string rationale;
};

/** A chord realized as one spelled note per voice, bass first (`SpelledVoicing`). */
using SpelledVoicing = std::vector<NoteData>;

/** Options of check_part_writing() (`PartWritingOptions`). */
struct PartWritingOptions {
  /** Per-voice ranges, ascending. Defaults to SATB_RANGES for four voices, else no range rule. */
  std::optional<std::vector<VoiceRange>> ranges;
  /** Maximum spacing in semitones between adjacent upper voices. Defaults to 12. */
  std::optional<double> maxSpacing;
};

/** Options of check_species() (`SpeciesOptions`). */
struct SpeciesOptions {
  /** Length of each counterpoint note, in cantus-firmus notes. */
  std::optional<std::vector<double>> durations;
  /** Which side of the cantus firmus the counterpoint is written on; by mean pitch when absent. */
  std::optional<bool> counterpointAbove;
};

/**
 * Spell a voicing given as MIDI pitches against the chord sounding under it and the key
 * (`spellVoicing`).
 * @throws InvalidInputError if the chord or the key is malformed, or a pitch is not finite.
 */
SpelledVoicing spell_voicing(const std::vector<double>& voicing, const Chord& chord,
                             const KeyArg& key);

/**
 * Check a finished part-writing exercise and report every rule it breaks, in musical order
 * (`checkPartWriting`).
 * @throws InvalidInputError if the two arrays differ in length, a note carries no octave, the
 *   spacing limit is not a non-negative finite number, or the ranges are empty, malformed or too
 *   few for the voices being checked.
 */
std::vector<PartWritingViolation> check_part_writing(const std::vector<SpelledVoicing>& voicings,
                                                     const std::vector<Chord>& chords,
                                                     const KeyArg& key,
                                                     const PartWritingOptions& opts = {});

/**
 * Check a species counterpoint exercise and report every rule it breaks (`checkSpecies`). The
 * species is 1 to 5.
 * @throws InvalidInputError if the species is not one of the five, either voice is empty, a note
 *   carries no octave, or the fifth species is given without durations.
 */
std::vector<PartWritingViolation> check_species(const std::vector<NoteData>& cantus_firmus,
                                                const std::vector<NoteData>& counterpoint,
                                                int species, const KeyArg& mode,
                                                const SpeciesOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_THEORY_PARTWRITING_H_
