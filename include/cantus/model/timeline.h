/**
 * @file timeline.h
 * @brief Public C++ API of ts/src/model/timeline.ts: harmony that keeps its place in time.
 *
 * A Timeline holds chord segments over a span of beats with the key regions found under them:
 * the timed counterpart of Progression, which keeps the chord order and drops the onsets.
 */
#ifndef CANTUS_MODEL_TIMELINE_H_
#define CANTUS_MODEL_TIMELINE_H_

#include <optional>
#include <string>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/analyze/keys.h"
#include "cantus/analyze/reduction.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/model/chord.h"
#include "cantus/model/key.h"
#include "cantus/model/progression.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** The plain form a Timeline hands out and is rebuilt from (`TimelineData`). */
struct TimelineData {
  std::vector<ChordSegment> segments;
  double totalBeats = 0;
  std::optional<std::vector<KeyRegion>> keys;
  /** How sure the analysis is of each segment's chord, in segment order. */
  std::optional<std::vector<double>> segmentConfidence;
};

/** One segment's Roman numeral with the beats it holds for (`TimelineRoman`). */
struct TimelineRoman {
  double startBeat = 0;
  double endBeat = 0;
  std::string roman;
};

/**
 * Chord segments over a span of beats, with the key regions found under them (`Timeline`).
 */
class Timeline {
 public:
  /**
   * Wrap plain timeline data (`new Timeline`); it is copied.
   * @throws InvalidInputError if a beat is not finite, a key region names no key, or the
   *   confidences do not run one per segment.
   */
  explicit Timeline(const TimelineData& data);

  /** A timeline from placed chords; a key becomes the one region under the span. */
  static Timeline from_chords(const std::vector<ChordSpan>& spans, double total_beats,
                              const std::optional<KeyArg>& key = std::nullopt);

  /** A timeline inferred from sounding notes (`Timeline.fromNotes`). */
  static Timeline from_notes(const std::vector<NoteEvent>& notes,
                             const ChordTimelineOptions& opts = {});

  /**
   * A progression's chords on a regular grid (`Timeline.fromProgression`).
   * @throws InvalidInputError if `beats_each` is not a positive finite number of beats.
   */
  static Timeline from_progression(const Progression& progression, double beats_each);

  /** Rebuild a timeline from its data() (`Timeline.fromData`). */
  static Timeline from_data(const TimelineData& data);

  /** Rebuild a timeline from its to_json() (`Timeline.fromJSON`). */
  static Timeline from_json(const TimelineData& data);

  /** The chord sounding at a beat, carrying the key in force there, or null (`at`). */
  Nullable<ChordValue> at(double beat) const;

  /** The chord segments, in time order (`segments`). */
  const std::vector<ChordSegment>& segments() const noexcept { return segments_; }

  /** Where the last chord stops sounding (`totalBeats`). */
  double total_beats() const noexcept { return total_beats_; }

  /** The key held longest across the span, when there is one (`key`). */
  std::optional<Key> key() const;

  /** Every key region under the span, in time order (`keys`). */
  const std::vector<KeyRegion>& keys() const noexcept { return keys_; }

  /** The per-segment confidences; empty for placed chords (`segmentConfidence`). */
  const std::vector<double>& segment_confidence() const noexcept { return segment_confidence_; }

  /** How many segments the timeline holds (`length`). */
  std::size_t length() const noexcept { return segments_.size(); }

  /** Iterate the segments in time order. */
  std::vector<ChordSegment>::const_iterator begin() const noexcept { return segments_.begin(); }
  std::vector<ChordSegment>::const_iterator end() const noexcept { return segments_.end(); }

  /** The chords in order, carrying the prevailing key (`progression`). */
  Progression progression() const;

  /**
   * The structural chords behind the surface harmony (`reduce`).
   * @throws InvalidInputError if the timeline carries no key region.
   */
  std::vector<ReducedChord> reduce(const ReduceProgressionOptions& opts = {}) const;

  /** The cadences the harmony arrives at (`cadences`). */
  std::vector<CadenceHit> cadences() const;

  /** The keys the chords themselves imply, in time order (`modulations`). */
  std::vector<KeyRegion> modulations(const KeyTimelineOptions& opts = {}) const;

  /** The chords as Roman numerals, in a key or in the key in force at each one (`roman`). */
  std::vector<TimelineRoman> roman(const std::optional<KeyArg>& key = std::nullopt,
                                   const ChordToRomanOptions& opts = {}) const;

  /**
   * The stretch between two beats, clipped to them (`slice`).
   * @throws InvalidInputError if a beat is not finite or `to_beat` precedes `from_beat`.
   */
  Timeline slice(double from_beat, double to_beat) const;

  /** The timeline moved by semitones, key regions included (`transpose`). */
  Timeline transpose(double semitones) const;

  /** The timeline moved by a spelled interval (`transposeBy`). */
  Timeline transpose_by(const IntervalArg& interval) const;

  /** Whether another timeline holds the same chords over the same span (`equals`). */
  bool equals(const Timeline& other) const;

  /** The plain data (`data`). */
  TimelineData data() const;

  /** The plain data (`toJSON`). */
  TimelineData to_json() const { return data(); }

  /** The `{ at, segments }` shape the analysis functions take (`chordTimeline`). */
  ChordTimeline chord_timeline() const { return ChordTimeline{segments_}; }

 private:
  /** The key every beat is read against, falling back to the prevailing key. */
  ResolvedKey resolved_key_at(double beat) const;
  /** The prevailing key. @throws InvalidInputError if the timeline carries no key. */
  ResolvedKey prevailing_key() const;

  std::vector<ChordSegment> segments_;
  double total_beats_ = 0;
  std::vector<KeyRegion> keys_;
  std::vector<double> segment_confidence_;
};

/** A validated copy of one key region, pivot chord included (`copyKeyRegion`). */
KeyRegion copy_key_region(const KeyRegion& region);

}  // namespace cantus

#endif  // CANTUS_MODEL_TIMELINE_H_
