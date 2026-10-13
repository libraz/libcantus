/**
 * @file codec_a2.h
 * @brief Wire codec of the types of analyze/timeline, analyze/spelling, analyze/reduction:
 *        CANTUS_JSON_FIELDS for output, and readers of the chord timelines the ops take.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_A2_H_
#define CANTUS_SRC_OPS_CODEC_A2_H_

#include <cstddef>
#include <memory>
#include <optional>
#include <string_view>
#include <vector>

#include "analyze/timeline/timeline.h"
#include "cantus/analyze/reduction.h"
#include "cantus/analyze/timeline.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_a1b.h"
#include "ops/codec_t2.h"

namespace cantus {

inline json::Value to_json(ReductionLevel level) { return json::Value(to_string(level)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(CadenceHit, atBeat, cadence, from, to)
CANTUS_JSON_FIELDS(ReducedChord, chord, startBeat, endBeat, level, rationale)

/** A timeline is a hybrid: `{"$hy": "ChordTimeline", "segments": [...]}`. */
void write_fields(const ChordTimeline& v, FieldWriter& w);

/** The result of chordTimelineFromNotes; its prevailing key is written scale first. */
void write_fields(const ChordTimelineResult& v, FieldWriter& w);

/** Whether a wire value is a chord timeline hybrid. */
bool is_timeline_hybrid(const json::Value& value);

/**
 * Whether a wire value is a function to an analysis that asks a timeline for its chords: a
 * callback, or a chord timeline hybrid, whose `at` is a method.
 */
bool is_chord_function(const json::Value& value);

/**
 * `assertChordTimeline(timeline, name)` over a wire value.
 * @returns The timeline's segments.
 * @throws InvalidInputError with the TS message.
 */
const json::Array& assert_wire_timeline(const json::Value& timeline,
                                        std::string_view name = "timeline");

/**
 * `chordAtBeat(segments, beat)` over wire segments: the covering segment's chord as written, or
 * null.
 * @throws InvalidInputError if `beat` is not finite.
 */
json::Value timeline_chord_at(const json::Array& segments, double beat);

/**
 * The segments of a wire timeline as an analysis reads them: their beats, and each chord read
 * once, the first time it is asked for, the way TS reads it at that point.
 */
class WireSegments {
 public:
  explicit WireSegments(const json::Array& segments);

  std::size_t size() const noexcept { return segments_->size(); }

  /** The segment's beats, each as a number. */
  std::vector<SegmentSpan> spans() const;

  /** The chord value of segment `i` as the caller wrote it. */
  const json::Value& chord_value(std::size_t i) const;

  /**
   * The chord of segment `i` as the analyses that take chord data as it is read it.
   * @throws js::TypeError if the segment has no chord.
   */
  const Chord& raw(std::size_t i);

  /** The chord of segment `i` after `toChordData`. @throws InvalidInputError if it is not one. */
  const Chord& checked(std::size_t i);

  /** The ways of reading a chord, as the analyses take them. */
  ChordReads reads();

  /** `pitchClassOf(chord.rootPc)` of segment `i`'s chord as written. */
  int root_pc(std::size_t i) const;

  /**
   * The scans of `isDominantChordOf` over segment `i`'s interval template as written.
   * @throws js::TypeError if it is not an array.
   * @throws InvalidInputError if an interval it reaches is not a number.
   */
  void scan_dominant(std::size_t i) const;

  /**
   * `chordPitchClasses(chord)` of segment `i`'s chord as written.
   * @throws InvalidInputError if it is not a chord.
   */
  void check_pitch_classes(std::size_t i) const;

  /**
   * The reads of `isTonicSixFour` over segment `i`'s interval template as written.
   * @throws js::TypeError if it is missing.
   * @throws InvalidInputError if an interval it reaches is not a number.
   */
  void scan_six_four(std::size_t i) const;

 private:
  const json::Array* segments_;
  std::vector<std::optional<Chord>> raw_;
  std::vector<std::optional<ChordData>> checked_;
};

/**
 * `text.at(index)` or `list.at(index)` of a wire string or array: the element at a position
 * counted from either end, or undefined.
 */
json::Value indexed_at(const json::Value& held, double index);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_A2_H_
