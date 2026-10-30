/**
 * @file timeline.h
 * @brief Internal entry points of ts/src/analyze/timeline/index.ts beside the public API in
 *        cantus/analyze/timeline.h: the segment lookups, the boundary search tables, and the
 *        incremental analysis that keeps the evidence of one run for the next.
 */
#ifndef CANTUS_SRC_ANALYZE_TIMELINE_TIMELINE_H_
#define CANTUS_SRC_ANALYZE_TIMELINE_TIMELINE_H_

#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string_view>
#include <vector>

#include "analyze/histogram.h"
#include "analyze/keys/keys.h"
#include "cantus/analyze/timeline.h"

namespace cantus {

/**
 * The chord sounding at a beat over segments in beat order (`chordAtBeat`), or null.
 * @throws InvalidInputError if `beat` is not finite.
 */
Nullable<Chord> chord_at_beat(const std::vector<ChordSegment>& segments, double beat);

/** The segment a chord arrives on at a beat, if one begins there (`segmentStartingAt`). */
const ChordSegment* segment_starting_at(const std::vector<ChordSegment>& segments, double beat);

/** segment_starting_at() over the beats of the segments alone. */
const SegmentSpan* segment_span_starting_at(const std::vector<SegmentSpan>& segments, double beat);

/**
 * Reject the span at `index` when it ends at or before its start, or starts before the span
 * before it ends (`assertSpansInOrder`, one step).
 * @throws InvalidInputError naming the span.
 */
void assert_span_in_order(double start_beat, double end_beat, const double* previous_end,
                          std::size_t index, std::string_view name);

/**
 * Reject spans that are not disjoint, in beat order, and of positive length
 * (`assertSpansInOrder`). The beats must already be known to be finite.
 * @throws InvalidInputError naming the first span out of order.
 */
template <class Span>
void assert_spans_in_order(const std::vector<Span>& spans, std::string_view name) {
  for (std::size_t index = 0; index < spans.size(); ++index) {
    const double* previous_end = index > 0 ? &spans[index - 1].endBeat : nullptr;
    assert_span_in_order(spans[index].startBeat, spans[index].endBeat, previous_end, index, name);
  }
}

/**
 * The key regions a stated key describes, from where the music starts to where the analysed span
 * ends (`statedKeyRegions`); none when the span is empty.
 */
std::vector<KeyRegion> stated_key_regions(const ResolvedKey& key, double start_beat,
                                          double end_beat);

/** Number of candidates the boundary search scores each slot against. */
std::size_t lexicon_size();

/** The tables the boundary search runs on, sized once for the whole piece (`BoundaryTables`). */
struct BoundaryTables {
  /** Fit of slot `i` to candidate `c`, at `scores[i * lexicon_size() + c]`. */
  std::vector<double> scores;
  /** Chosen predecessor of slot `i`, candidate `c`, at the same index. */
  std::vector<std::int32_t> back;
  /** The two rolling cost rows the recurrence alternates between. */
  std::vector<double> costs;
  std::vector<double> spare;
  /** The winning candidate of each slot, filled by the backward pass. */
  std::vector<std::int32_t> path;
};

/**
 * Allocate the boundary-search tables for `slot_count` slots (`createBoundaryTables`).
 * @throws BudgetExceededError if the tables exceed the budget.
 */
BoundaryTables create_boundary_tables(double slot_count, std::optional<double> budget);

/** Score one slot against the whole lexicon, into its row of the score table (`scoreSlot`). */
void score_slot(BoundaryTables& tables, const WindowWeights& slot, std::size_t index);

/**
 * Which object a chord stands for: a window's reading is cached and handed to the next analysis
 * of the same span, so one chord object reaches both the analysis made before an edit and the
 * one made after it, and a host that tells objects apart can tell that it did.
 */
using ChordObject = std::shared_ptr<const void>;

/** A reading of a window's tones as one chord: the chord, its confidence, and which object. */
struct WindowReading {
  Chord chord;
  double confidence = 0;
  ChordObject object;
};

/** A window's inferred chord and its confidence (`WindowChord`). */
struct WindowChord : WindowReading {
  /** The augmented-sixth reading of the very same tones, when they spell one over the bass. */
  std::optional<WindowReading> augmented;
  /** A diminished seventh read on each of its tones, in pitch-class order (`rootings`). */
  std::vector<WindowReading> rootings;
};

/** A half-open run of slots whose contents an edit may have changed (`DirtySlots`). */
struct DirtySlots {
  double from = 0;
  double to = 0;
};

/** The cache key of one settled span read in one key. */
struct WindowKey {
  double startBeat = 0;
  double endBeat = 0;
  int rootPc = 0;
  int modeMask12 = 0;

  bool operator<(const WindowKey& other) const;
};

/** The slot-level evidence one chord-timeline analysis drew from the notes (`TimelineEvidence`). */
struct TimelineEvidence {
  /** The grid the slots were cut on. */
  SlotGrid grid;
  double slotCount = 0;
  double totalBeats = 0;
  ChordSegmentation segmentation = ChordSegmentation::kDynamic;
  double harmonicRhythm = 0;
  /** Whether the key was given rather than searched for. */
  bool keyGiven = false;
  std::vector<WindowWeights> slotWeights;
  /** The score table the analysis ran on, or null once a later analysis has taken it over. */
  std::unique_ptr<BoundaryTables> tables;
  /** The chord inferred over each settled span; an empty reading is a window with no chord. */
  std::map<WindowKey, std::optional<WindowChord>> windows;
};

/** An analysis and the evidence behind it. */
struct TimelineAnalysis {
  ChordTimelineResult result;
  /** For each segment, the object its chord is: shared by the segments of later analyses that carry
   * it over. */
  std::vector<ChordObject> segment_objects;
  TimelineEvidence evidence;
};

/** The slots an edit over `[start_beat, end_beat)` may have changed (`dirtySlotsFor`). */
DirtySlots dirty_slots_for(const TimelineEvidence& evidence, double start_beat, double end_beat);

/**
 * chord_timeline_from_notes(), carrying over every slot the edit cannot reach (`analyzeTimeline`).
 * `previous` and `dirty`, both or neither, name the analysis being updated and the slots to
 * recompute.
 */
TimelineAnalysis analyze_timeline(const std::vector<NoteEvent>& notes,
                                  const ChordTimelineOptions& opts,
                                  TimelineEvidence* previous = nullptr,
                                  const DirtySlots* dirty = nullptr);

/**
 * The chord of a segment read the two ways TS reads it: as the data is written, for the analyses
 * that take a chord as it is, and after `toChordData`, for `detectCadence`, which checks it. Each
 * is called when the analysis first needs it, so a caller holding chords in another form can read
 * them lazily and in the order TS does.
 */
struct ChordReads {
  ChordSource raw;
  ChordSource checked;
  /**
   * `pitchClassOf(chord.rootPc)` of segment `i`'s chord as written, with the rejection of a root
   * that is no number carrying the value as the caller wrote it; unset reads `raw`.
   */
  std::function<int(std::size_t)> root_pc;
  /**
   * What `isDominantChordOf` does to the interval template of segment `i`'s chord as written,
   * once its root stands on the dominant: scan it for the intervals it asks about. Unset does
   * nothing.
   */
  std::function<void(std::size_t)> scan_dominant;
  /**
   * What `chordPitchClasses(chord)` does to segment `i`'s chord as written, which `isDiatonicChord`
   * asks of a chord standing on the tonic: refuse it unless it is a chord. Unset does nothing.
   */
  std::function<void(std::size_t)> pitch_classes;
  /**
   * What `isTonicSixFour` does to the interval template of segment `i`'s chord as written, once
   * it stands on the tonic with a bass: read its length, and for three intervals scan for the
   * fifth. Unset does nothing.
   */
  std::function<void(std::size_t)> scan_six_four;
};

/**
 * detect_cadences() over segment beats. When `arrivals` is given, it receives for each hit the
 * index of the segment the cadence arrives on.
 */
std::vector<CadenceHit> detect_cadences_over(const std::vector<SegmentSpan>& segments,
                                             const ChordReads& chords, const KeyAtBeat& key_at,
                                             std::vector<std::size_t>* arrivals = nullptr);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_TIMELINE_TIMELINE_H_
