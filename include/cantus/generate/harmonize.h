/**
 * @file harmonize.h
 * @brief Public C++ API of ts/src/generate/harmonize: a min-cost chord progression for a melody,
 *        and the classification of a melody's ornamental tones it is built on.
 *
 * The melody's ornaments are classified first, from the melody and the metre alone; the chords then
 * have to explain the structural tones only. The melody is cut into slots by the harmonic rhythm,
 * each slot is scored against the candidate chords the harmonic dial opens, and a Viterbi search
 * picks the lowest-cost path through a functional-flow transition cost and a cadence bonus. The
 * seed drives a deterministic tie-break only.
 */
#ifndef CANTUS_GENERATE_HARMONIZE_H_
#define CANTUS_GENERATE_HARMONIZE_H_

#include <cstdint>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/harmony.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** What a melody note contributes to the harmony (`MelodyToneRole`). */
enum class MelodyToneRole : std::uint8_t {
  kStructural,
  kPassing,
  kNeighbor,
  kAppoggiatura,
  kSuspension,
  kAnticipation,
  kEscape,
};

/** The TS name of a melody tone role ("structural", "passing", ...). */
std::string_view to_string(MelodyToneRole role);

/** The melody tone role named `name`, or nullopt. */
std::optional<MelodyToneRole> parse_melody_tone_role(std::string_view name);

/** One melody note's classification (`ClassifiedMelodyTone`). */
struct ClassifiedMelodyTone {
  /** Index in the classified melody. */
  std::size_t noteIndex = 0;
  /** The figure the note forms. */
  MelodyToneRole role = MelodyToneRole::kStructural;
  /** True for every role but `structural`. */
  bool ornamental = false;
};

/**
 * Classify a melody's ornaments from the melody and the metre alone (`classifyMelodyTones`).
 * @param melody The melody, in ascending onset order.
 * @param ts Time signature used to weight metric accents.
 * @returns One classification per input note, in input order.
 * @throws InvalidInputError if the meter or a note is invalid.
 */
std::vector<ClassifiedMelodyTone> classify_melody_tones(const std::vector<NoteEvent>& melody,
                                                        const MeterArg& ts);

/** Which placements of the melody the search tries (`HarmonizePlacement`). */
struct HarmonizePlacement {
  /** Move the melody into the key it is harmonized in. */
  bool transposeSearch = false;
  /** Search octave placements as well. */
  bool octaveSearch = false;
};

/** How far beyond the key's own triads the chord vocabulary reaches (`reharmonize`). */
enum class ReharmonizeStrength : std::uint8_t { kDiatonic, kSecondaryDominant, kBorrowed };

/** The TS name of a strength ("diatonic", "secondaryDominant" or "borrowed"). */
std::string_view to_string(ReharmonizeStrength strength);

/** The strength named `name`, or nullopt. */
std::optional<ReharmonizeStrength> parse_reharmonize_strength(std::string_view name);

/** Options of harmonize_melody() (`HarmonizeOptions`). */
struct HarmonizeOptions {
  explicit HarmonizeOptions(std::vector<NoteEvent> melody_) : melody(std::move(melody_)) {}

  /** The melody to harmonize, in ascending onset order. */
  std::vector<NoteEvent> melody;
  /** The key to harmonize in; the name "infer" (the default) estimates it from the melody. */
  std::optional<KeyArg> key;
  /** Length of each chord slot in beats; half a bar of `ts`, or the bar where half is off a pulse.
   */
  std::optional<double> harmonicRhythm;
  /** Time signature the melody is barred in; 4/4 when absent. */
  std::optional<MeterArg> ts;
  /** The named dial position, used where `ctx` sets no harmonic complexity; diatonic when absent.
   */
  std::optional<ReharmonizeStrength> reharmonize;
  /** Whether to search transpositions and octave placements; both off when absent. */
  std::optional<HarmonizePlacement> placement;
  /** Beats at which the melody's phrases end, so a longer line closes at each of them. */
  std::optional<std::vector<double>> phraseEnds;
  /** The generation context; its harmonic dial and seed are read. */
  std::optional<GenerationContextInput> ctx;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/** One melody note's role in the chord sounding under it. */
struct HarmonizedNoteRole {
  std::size_t noteIndex = 0;
  HarmonyRole role = HarmonyRole::kRoot;
};

/** The chosen transpose, key, chord path and per-note roles (`HarmonizeResult`). */
struct HarmonizeResult {
  /** How far the melody was moved, in semitones. */
  double transposeSemitones = 0;
  /** The key the chords are in, whole. */
  ResolvedKey key;
  /** One span per chord change, each starting on a harmonic-rhythm boundary. */
  std::vector<ChordSpan> chords;
  /** Each melody note's role in the chord sounding under it. */
  std::vector<HarmonizedNoteRole> melodyRoles;
};

/**
 * Harmonize a melody with a min-cost chord progression (`harmonizeMelody`).
 * @throws InvalidInputError if the melody, the key, the meter, the context or an option is
 *   malformed.
 * @throws BudgetExceededError if the search is larger than the budget allows.
 */
HarmonizeResult harmonize_melody(const HarmonizeOptions& opts);

}  // namespace cantus

#endif  // CANTUS_GENERATE_HARMONIZE_H_
