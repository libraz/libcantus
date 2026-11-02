/**
 * @file internal.h
 * @brief Internal pieces of ts/src/generate/harmonize/internal.ts: what the stages of the
 *        harmonizer share, the defaults they fall back on, and the two questions about a key that
 *        more than one of them asks.
 */
#ifndef CANTUS_SRC_GENERATE_HARMONIZE_INTERNAL_H_
#define CANTUS_SRC_GENERATE_HARMONIZE_INTERNAL_H_

#include <functional>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/harmonize.h"
#include "cantus/theory/chord.h"

namespace cantus {

/** Charges an estimate against the caller's budget under a name (`assertGenerationBudget`). */
using BudgetCharge = std::function<void(double estimated, std::string_view name)>;

/** One chord the search may place in a slot, with everything it is scored by. */
struct Candidate {
  int rootPc = 0;
  ChordQuality quality = ChordQuality::kMaj;
  std::optional<int> degree;
  bool secondaryDominant = false;
  std::optional<int> targetDegree;
  double base = 0;
  /** The candidate's pitch classes, resolved once. */
  std::vector<int> pcs;
};

/** How much of a segment a note sounds in and whether it lands on an accent. */
struct CostNote {
  /** Index in the sounding melody. */
  std::size_t index = 0;
  /** Beats of the segment the note sounds in, floored so a short note still counts. */
  double weight = 0;
  /** Whether the note enters the segment on a metric accent. */
  bool strong = false;
};

/** One span the harmony may change on. */
struct Segment {
  double startBeat = 0;
  double endBeat = 0;
  /** The segment's own length in beats. */
  double beats = 0;
  /** Every sounding note overlapping the segment, by index in the sounding melody. */
  std::vector<std::size_t> noteIndices;
  /** The notes that drive the segment's emission cost. */
  std::vector<CostNote> costNotes;
  /** Total emission weight of `costNotes`. */
  double weight = 0;
  /** The last of `costNotes`, which is the tone a phrase closes on. */
  std::optional<std::size_t> closingIndex;
};

/** The candidate a path index outside the table reads as. */
const Candidate& fallback_candidate();

/** Chord slot length assumed when the caller names none: half a bar, or the bar. */
double default_harmonic_rhythm(const TimeSignature& ts);

/** Whether a pitch belongs to the key, counting the raised seventh of a minor key. */
bool is_key_tone(double pitch, const KeyScale& key);

/** Estimate the best-fit key from a melody's pitch-class weighting, read in onset order. */
KeyScale infer_key(const std::vector<NoteEvent>& melody);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_HARMONIZE_INTERNAL_H_
