/**
 * @file segments.h
 * @brief Internal pieces of ts/src/generate/harmonize/segments.ts: the spans the harmony may
 *        change on, and where the melody's notes fall in them.
 */
#ifndef CANTUS_SRC_GENERATE_HARMONIZE_SEGMENTS_H_
#define CANTUS_SRC_GENERATE_HARMONIZE_SEGMENTS_H_

#include <set>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "generate/harmonize/internal.h"

namespace cantus {

/** A melody note as the search reads it: snapped to the pulse it plays (`MelodySpan`). */
struct MelodySpan {
  double startBeat = 0;
  double endBeat = 0;
};

/** The beats the chord grid may change on: the harmonic rhythm's boundaries plus the named ends. */
std::vector<double> grid_bounds(double segment_start, double hr, double grid_count,
                                const std::vector<double>& ends);

/** The note each named phrase closes on: the last one to begin before the beat it ends at. */
std::set<std::size_t> closing_note_indices(const std::vector<MelodySpan>& spans,
                                           const std::vector<double>& ends);

/** The index of the segment a beat sounds in: the last boundary at or before it. */
std::size_t segment_index_at(const std::vector<double>& bounds, double beat);

/** Collapse runs of the same chord into one span. */
std::vector<ChordSpan> merge_repeats(const std::vector<ChordSpan>& spans);

/** Segments that close and therefore have to cadence, and those a named phrase end falls in. */
struct PhraseEndSegments {
  std::set<std::size_t> closing;
  std::set<std::size_t> named;
};

/** The segments that close (`phraseEndSegments`). */
PhraseEndSegments phrase_end_segments(const std::vector<Segment>& segments,
                                      const std::vector<double>& ends);

/** Where the melody starts and ends, and how often the chord may change. */
struct HarmonicGrid {
  double start = 0;
  double end = 0;
  double harmonicRhythm = 0;
};

/** The melody cut into the spans a chord may change on (`buildSegments`' result). */
struct BuiltSegments {
  std::vector<Segment> segments;
  std::vector<double> innerEnds;
  std::vector<double> bounds;
  double segmentStart = 0;
};

/** Cut the melody into the spans a chord may change on, and fill each with what sounds in it. */
BuiltSegments build_segments(const std::vector<MelodySpan>& spans,
                             const std::vector<NoteEvent>& melody, const TimeSignature& ts,
                             const HarmonicGrid& grid, const std::vector<double>& phrase_ends,
                             const BudgetCharge& charge);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_HARMONIZE_SEGMENTS_H_
