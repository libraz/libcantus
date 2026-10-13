/**
 * @file chordscale.h
 * @brief Public C++ API of ts/src/theory/chordscale: which scales fit over a chord, which of their
 *        tones to avoid, and which are free colour.
 *
 * Chord-scale theory is a Western practice, so only NAMED_SCALES (and their aliases) are
 * proposed or accepted; a world scale is rejected.
 */
#ifndef CANTUS_THEORY_CHORDSCALE_H_
#define CANTUS_THEORY_CHORDSCALE_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/theory/chord.h"
#include "cantus/theory/symbol.h"

namespace cantus {

/** A named scale rooted on a pitch class that fits over a chord (`ChordScaleMatch`). */
struct ChordScaleMatch {
  std::string name;
  int rootPc = 0;
};

/** Which use an avoid note is judged for (`AvoidNoteUse`). */
enum class AvoidNoteUse : std::uint8_t {
  /** A tone that must not be sounded against the chord. */
  kHarmonic,
  /** Only what a line cannot pass through either: the semitone above the root. */
  kMelodic,
};

/** The TS name of a use ("harmonic" or "melodic"). */
std::string_view to_string(AvoidNoteUse use);

/** The use named `name`, or nullopt. */
std::optional<AvoidNoteUse> parse_avoid_note_use(std::string_view name);

/** Options of avoid_notes() (`AvoidNotesOptions`). */
struct AvoidNotesOptions {
  /** Harmonic when absent. */
  std::optional<AvoidNoteUse> use;
};

/** Options of available_tensions() (`AvailableTensionsOptions`). */
struct AvailableTensionsOptions {
  /** The chord this one resolves to. */
  std::optional<ChordArg> resolvesTo;
};

/** A scale fit over a chord with its non-chord tones sorted (`ChordScaleReportEntry`). */
struct ChordScaleReportEntry {
  std::string name;
  int rootPc = 0;
  /** May not be played at all. */
  std::vector<int> avoid;
  /** May be passed through melodically but not sounded against the chord. */
  std::vector<int> passing;
  /** May be added freely as colour. */
  std::vector<int> tensions;
};

/** A chord paired with the scale chosen for it (`ScaleChoice`). */
struct ScaleChoice {
  Chord chord;
  ChordScaleMatch scale;
};

/**
 * Whether every chord pitch class is contained in a scale (`scaleMatchesChord`).
 * @throws InvalidInputError if the mask or a pitch class is malformed.
 */
bool scale_matches_chord(const std::vector<double>& chord_pcs, double scale_mask,
                         double scale_root_pc);

/** The scales that fit over a chord, best fit first (`chordScales`). */
std::vector<ChordScaleMatch> chord_scales(const ChordArg& chord);

/**
 * A scale's avoid notes over a chord, ascending (`avoidNotes`).
 * @throws InvalidInputError if `scale_name` is not a built-in scale or names a world scale.
 */
std::vector<int> avoid_notes(const ChordArg& chord, std::string_view scale_name,
                             const AvoidNotesOptions& opts = {});

/**
 * A scale's available tensions over a chord, ascending (`availableTensions`).
 * @throws InvalidInputError as avoid_notes() does.
 */
std::vector<int> available_tensions(const ChordArg& chord, std::string_view scale_name,
                                    const AvailableTensionsOptions& opts = {});

/**
 * The best-fitting scales for a chord with their avoid notes and tensions (`chordScaleReport`).
 * @throws InvalidInputError if `limit` is not a positive integer.
 */
std::vector<ChordScaleReportEntry> chord_scale_report(const ChordArg& chord,
                                                      std::optional<double> limit = std::nullopt);

/**
 * Choose one scale per chord across a progression, favoring continuity (`scalesForChanges`).
 * @throws BudgetExceededError if the progression is longer than the generation budget.
 */
std::vector<ScaleChoice> scales_for_changes(const std::vector<Chord>& chords);

}  // namespace cantus

#endif  // CANTUS_THEORY_CHORDSCALE_H_
