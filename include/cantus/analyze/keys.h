/**
 * @file keys.h
 * @brief Public C++ API of ts/src/analyze/keys: the key as it changes over time, as a run of
 *        regions each carrying the key in force over one span.
 */
#ifndef CANTUS_ANALYZE_KEYS_H_
#define CANTUS_ANALYZE_KEYS_H_

#include <optional>
#include <variant>
#include <vector>

#include "cantus/analyze/detect.h"
#include "cantus/analyze/functional.h"
#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** A span of the piece over which one key is in force (`KeyRegion`). */
struct KeyRegion {
  /** First beat of the region. */
  double startBeat = 0;
  /** End of the region, exclusive. */
  double endBeat = 0;
  /** The key in force across the region, owned by it. */
  ResolvedKey key;
  /** How well the region's music fits the key, in [0, 1]. */
  double confidence = 0;
  /** How this key relates to the previous region's; absent on the first region. */
  std::optional<KeyRelation> modulation;
  /** The chord the modulation turned on, when one was identified. */
  std::optional<PivotChord> pivot;
};

/** Options shared by the key-region entry points (`KeyTimelineOptions`). */
struct KeyTimelineOptions {
  /** A single time signature held across the whole span; defaults to 4/4. */
  std::optional<MeterArg> ts;
  /** The meter as it changes over the span; defaults to 4/4 throughout. */
  std::optional<MeterArg> meters;
  /** Expected length of one key area in beats; defaults to four bars of the opening meter. */
  std::optional<double> expectedKeyBeats;
  /** Shortest key area the search may report, in beats; defaults to one bar. */
  std::optional<double> minKeyBeats;
  /** End of the analyzed span in beats; defaults to the end of the input. */
  std::optional<double> totalBeats;
  /** Key profile the regions are scored against; defaults to Krumhansl-Kessler. */
  std::optional<std::variant<KeyProfileName, KeyProfilePair>> profile;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/**
 * Infer where the key changes from raw notes (`keyTimelineFromNotes`); empty when nothing sounds.
 * @throws InvalidInputError if an option or a note is invalid.
 * @throws BudgetExceededError if the work exceeds the budget.
 */
std::vector<KeyRegion> key_timeline_from_notes(const std::vector<NoteEvent>& notes,
                                               const KeyTimelineOptions& opts = {});

/**
 * Infer where the key changes from a chord sequence, naming the pivot chords
 * (`detectModulations`); empty when no chords were given.
 */
std::vector<KeyRegion> detect_modulations(const std::vector<ChordSegment>& chords,
                                          const KeyTimelineOptions& opts = {});

/** The single key that holds for most of a run of regions, or null (`prevailingKeyOf`). */
Nullable<ResolvedKey> prevailing_key_of(const std::vector<KeyRegion>& regions);

}  // namespace cantus

#endif  // CANTUS_ANALYZE_KEYS_H_
