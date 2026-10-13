/**
 * @file timeline.h
 * @brief Public C++ API of ts/src/analyze/timeline: the chord timeline, built from placed chords
 *        or inferred from raw notes, and the cadences between its segments.
 */
#ifndef CANTUS_ANALYZE_TIMELINE_H_
#define CANTUS_ANALYZE_TIMELINE_H_

#include <cstdint>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/analyze/keys.h"
#include "cantus/analyze/voice.h"
#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** A beat-indexed sequence of chord segments (`ChordTimeline`). */
struct ChordTimeline {
  std::vector<ChordSegment> segments;

  /**
   * The chord sounding at a beat, or null where no segment covers it. A segment covers
   * `[startBeat, endBeat)`.
   * @throws InvalidInputError if `beat` is not finite.
   */
  Nullable<Chord> at(double beat) const;
};

/** How chord boundaries are placed (`ChordSegmentation`). */
enum class ChordSegmentation : std::uint8_t { kDynamic, kGrid };

/** The TS name of a segmentation ("dynamic" or "grid"). */
std::string_view to_string(ChordSegmentation segmentation);

/** The segmentation named `name`, or nullopt. */
std::optional<ChordSegmentation> parse_chord_segmentation(std::string_view name);

/** Options of chord_timeline_from_notes() (`ChordTimelineOptions`). */
struct ChordTimelineOptions {
  /** Key held across the whole span; searched for over time when absent. */
  std::optional<KeyArg> key;
  /** A single time signature held across the span; defaults to 4/4. */
  std::optional<MeterArg> ts;
  /** The meter as it changes over the span; defaults to 4/4 throughout. */
  std::optional<MeterArg> meters;
  /** Length of the pickup in beats; rejects a note that starts before it does. */
  std::optional<double> pickupBeats;
  /** Where chord boundaries may fall; defaults to dynamic. */
  std::optional<ChordSegmentation> segmentation;
  /** Expected chord length in beats; defaults to the length of the opening bar. */
  std::optional<double> harmonicRhythm;
  /** Resolution the dynamic search looks for changes at; defaults to one main pulse. */
  std::optional<double> minChordBeats;
  /** End of the analyzed span in beats; defaults to the end of the last note. */
  std::optional<double> totalBeats;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/** The result of chord_timeline_from_notes() (`ChordTimelineResult`). */
struct ChordTimelineResult {
  /** The inferred timeline, with adjacent identical chords merged. */
  ChordTimeline timeline;
  /** The key regions the analysis ran against, in time order. */
  std::vector<KeyRegion> keys;
  /** The key held longest across `keys`. */
  ResolvedKey prevailingKey;
  /** One confidence value in [0, 1] per segment, in segment order. */
  std::vector<double> segmentConfidence;
};

/** A cadence found between two consecutive timeline segments (`CadenceHit`). */
struct CadenceHit {
  /** The beat where the cadence arrives (the second chord's onset). */
  double atBeat = 0;
  /** The cadence formed by the pair; its type is never null. */
  CadenceResult cadence;
  Chord from;
  Chord to;
};

/**
 * Reject a timeline whose segments lack finite bounds (`assertChordTimeline`).
 * @param timeline The timeline as the caller passed it.
 * @param name What the argument is called in an error message.
 * @returns The same timeline.
 * @throws InvalidInputError if a segment bound is not finite.
 */
const ChordTimeline& assert_chord_timeline(const ChordTimeline& timeline,
                                           std::string_view name = "timeline");

/**
 * Build a chord timeline from placed chords (`chordTimelineFromChords`): each chord spans to the
 * next one's start, the last to `total_beats`, and segments with no length are dropped.
 * @throws InvalidInputError if `total_beats` or a start beat is out of range.
 * @throws BudgetExceededError if there are more chords than the generation budget.
 */
ChordTimeline chord_timeline_from_chords(const std::vector<ChordSpan>& chords, double total_beats);

/**
 * Infer a chord timeline from raw multi-track notes (`chordTimelineFromNotes`).
 * @throws InvalidInputError if an option or a note is invalid.
 * @throws BudgetExceededError if the work exceeds the budget.
 */
ChordTimelineResult chord_timeline_from_notes(const std::vector<NoteEvent>& notes,
                                              const ChordTimelineOptions& opts = {});

/**
 * Find cadences between consecutive segments of a chord timeline (`detectCadences`), each read
 * against the key in force where it arrives.
 * @throws InvalidInputError if the timeline is not valid or a key is not a key.
 */
std::vector<CadenceHit> detect_cadences(const ChordTimeline& timeline, const KeyContext& key);

}  // namespace cantus

#endif  // CANTUS_ANALYZE_TIMELINE_H_
