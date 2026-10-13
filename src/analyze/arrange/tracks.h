/**
 * @file tracks.h
 * @brief Internal entry points of ts/src/analyze/arrange/tracks.ts beside the public API in
 *        cantus/analyze/arrange.h: the per-note pass over a harmony a host supplies, the
 *        analysis that carries evidence from one run to the next, and the polyphony reading.
 */
#ifndef CANTUS_SRC_ANALYZE_ARRANGE_TRACKS_H_
#define CANTUS_SRC_ANALYZE_ARRANGE_TRACKS_H_

#include <cstddef>
#include <functional>
#include <memory>
#include <optional>
#include <vector>

#include "analyze/arrange/internal.h"
#include "analyze/timeline/timeline.h"
#include "analyze/voice/voice.h"
#include "cantus/analyze/arrange.h"

namespace cantus {

/** A chord found at a beat, readable the ways the analyses read one (`timeline.at(beat)`). */
struct FoundChord {
  /** The chord as written. */
  Chord raw;
  /** The chord after `toChordData`, which refuses what is not chord data. */
  std::function<const Chord&()> checked;
  /** `chordPitchClasses` of the chord, which checks it again. */
  std::function<std::vector<int>()> pitch_classes;
};

/** What the analyses ask of a timeline: its segments, and the chord it answers with at a beat. */
struct TimelineHost {
  /** The segments' beats. */
  std::vector<SegmentSpan> spans;
  /** The segments' chords. */
  ChordReads chords;
  /** `timeline.at` as `analyzeVoice` reads the chords it is handed. */
  std::function<std::optional<VoiceChord>(double)> voice_at;
  /** `timeline.at` as the analyses that take a chord as it is written read it. */
  std::function<std::optional<FoundChord>(double)> found_at;
};

/** The host of a typed timeline; it refers to `timeline`, which must outlive it. */
TimelineHost host_of(const ChordTimeline& timeline);

/** The harmony the per-note pass reads. */
struct ArrangementHarmony {
  TimelineHost timeline;
  /** The scale in force at a beat. */
  KeyAtBeat scale_at;
};

/** What the per-note pass finds. */
struct TrackPass {
  std::vector<TrackAnalysis> tracks;
  /** Notes clashing with the harmony, worst severity first. */
  std::vector<Conflict> conflicts;
  std::vector<CadenceHit> cadences;
  /** For each cadence, the segment it arrives on. */
  std::vector<std::size_t> arrivals;
};

/**
 * Label every note of every pitched track against the harmony and the voices around it, and
 * collect the notes that clash with it. Cadences are found first.
 */
TrackPass analyze_tracks(const std::vector<PreparedTrack>& prepared,
                         const ArrangementHarmony& harmony, SafetyProfile profile,
                         double min_severity, const MeterMap& meters);

/** The key regions and confidences a caller-supplied timeline is analysed against. */
struct CallerKeys {
  std::vector<KeyRegion> keys;
  ResolvedKey prevailing_key;
  std::vector<double> segment_confidence;
};

/**
 * Key regions for a timeline the caller already had (`callerTimeline`): the given ones, the one
 * key named, or those the pooled notes give, annotated with their pivots.
 */
CallerKeys caller_keys(const TimelineHost& timeline, const std::optional<KeyArg>& key,
                       const std::optional<std::vector<KeyRegion>>& given,
                       const std::vector<NoteEvent>& pooled, const MeterMap& meters,
                       std::optional<double> budget);

/** An analysis and, when the harmony was inferred, the evidence behind it. */
struct ArrangementRun {
  ArrangementAnalysis analysis;
  std::unique_ptr<TimelineEvidence> evidence;
};

/**
 * analyze_arrangement(), carrying over the harmonic evidence an edit cannot reach and handing
 * back the evidence this pass leaves behind (`analyzeArrangementWith`).
 */
ArrangementRun analyze_arrangement_with(const std::vector<ArrangementTrack>& tracks,
                                        const ArrangementOptions& opts,
                                        TimelineEvidence* previous = nullptr,
                                        const DirtySlots* dirty = nullptr);

/**
 * analyze_polyphony() over a host: the chord each sub-voice reads as `analyzeVoice` reads it, and
 * the key, read afresh for each sub-voice as `analyzeVoice` reads it.
 */
std::vector<AnalyzedNote> analyze_polyphony_over(
    const std::vector<NoteEvent>& passage,
    const std::function<std::optional<VoiceChord>(double)>& chord_at,
    const std::function<KeyAtBeat()>& key);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_ARRANGE_TRACKS_H_
