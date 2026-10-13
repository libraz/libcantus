/**
 * @file arrange.h
 * @brief Public C++ API of ts/src/analyze/arrange: the capstone that ties the timeline,
 *        per-voice analysis, functional harmony and safety modules together for a whole
 *        multi-track piece.
 */
#ifndef CANTUS_ANALYZE_ARRANGE_H_
#define CANTUS_ANALYZE_ARRANGE_H_

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/analyze/keys.h"
#include "cantus/analyze/timeline.h"
#include "cantus/analyze/voice.h"
#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/safety.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** The musical role a track plays in the arrangement (`TrackRole`). */
enum class TrackRole : std::uint8_t { kMelody, kHarmony, kBass, kDrums, kOther };

/** The TS name of a role ("melody", "harmony", "bass", "drums" or "other"). */
std::string_view to_string(TrackRole role);

/** The role named `name`, or nullopt. */
std::optional<TrackRole> parse_track_role(std::string_view name);

/** One input track: its notes plus optional name and role (`ArrangementTrack`). */
struct ArrangementTrack {
  std::optional<std::string> name;
  std::optional<TrackRole> role;
  std::vector<NoteEvent> notes;
};

/** A track after analysis: its resolved name, role, and per-note annotations (`TrackAnalysis`). */
struct TrackAnalysis {
  std::string name;
  TrackRole role = TrackRole::kOther;
  /** One annotation per note, labelled against the inferred chords. */
  std::vector<AnalyzedNote> notes;
};

/** A note sounding with a Conflict that raises a pairwise flag against it (`ConflictPartner`). */
struct ConflictPartner {
  /** The partner's track index in the caller's input array. */
  std::size_t trackIndex = 0;
  /** The partner note's index in that track's own note array. */
  std::optional<std::size_t> originalIndex;
  /** The id the partner note carries in TrackAnalysis::notes. */
  double noteId = 0;
  /** The pairwise flags this note raises, as SafetyPartner::reasons. */
  int reasons = 0;
};

/** A note that clashes with the harmony sounding beneath it (`Conflict`). */
struct Conflict {
  double beat = 0;
  std::string trackName;
  /** The clashing track's index in the caller's input array. */
  std::size_t trackIndex = 0;
  /** The note's index in that track's own note array. */
  std::optional<std::size_t> originalIndex;
  /** The id the note carries in TrackAnalysis::notes. */
  double noteId = 0;
  int pitch = 0;
  /** The note's theory labels at its onset. */
  std::vector<TheoryLabel> labels;
  /** The clash severity: warning or dissonant. */
  NoteSafety safety = NoteSafety::kSafe;
  /** The SafetyResult::reasons bitmask. */
  int reasons = 0;
  /** Preferred stepwise resolution, when the safety evaluator provides one. */
  std::optional<int> resolveTo;
  /** Nearby fully safe replacement pitches, nearest first. */
  std::optional<std::vector<int>> suggestions;
  /** The notes behind the pairwise flags in `reasons`, when any are set. */
  std::optional<std::vector<ConflictPartner>> partners;
  std::optional<std::string> rationale;
};

/** The full result of analyze_arrangement() (`ArrangementAnalysis`). */
struct ArrangementAnalysis {
  /** The key regions the analysis ran against, in time order. */
  std::vector<KeyRegion> keys;
  /** The key held longest across `keys`, whole. */
  ResolvedKey prevailingKey;
  ChordTimeline timeline;
  std::vector<double> segmentConfidence;
  std::vector<CadenceHit> cadences;
  std::vector<TrackAnalysis> tracks;
  /** Notes clashing with the sounding harmony, worst severity first. */
  std::vector<Conflict> conflicts;
};

/** Options of analyze_arrangement() and tension_curve() (`ArrangementOptions`). */
struct ArrangementOptions {
  /** A single key held across the whole arrangement; searched for over time when absent. */
  std::optional<KeyArg> key;
  /** Key regions to judge against, when a previous pass already worked them out. */
  std::optional<std::vector<KeyRegion>> keys;
  /** A chord timeline to analyse against, instead of inferring one from the notes. */
  std::optional<ChordTimeline> timeline;
  /** Indices of the tracks the harmony is inferred from; every pitched track by default. */
  std::optional<std::vector<double>> harmonyTracks;
  /** Lowest severity reported in `conflicts` (0, 1 or 2); warning by default. */
  std::optional<double> minSeverity;
  /** A single time signature held across the whole arrangement; defaults to 4/4. */
  std::optional<MeterArg> ts;
  /** The meter as it changes over the arrangement; defaults to 4/4 throughout. */
  std::optional<MeterArg> meters;
  /** Length of the pickup in beats, when the piece starts with one. */
  std::optional<double> pickupBeats;
  /** Expected chord length in beats; defaults to the length of the opening bar. */
  std::optional<double> harmonicRhythm;
  /** Safety profile used for conflict detection; pop by default. */
  std::optional<SafetyProfile> profile;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/** The options of tension_curve(): those of an arrangement plus the sampling step. */
struct TensionOptions : ArrangementOptions {
  /** Distance between samples in beats; one beat by default. */
  std::optional<double> step;
};

/** A tension reading sampled at a beat (`TensionPoint`). */
struct TensionPoint {
  double beat = 0;
  /** Combined tension in [0, 1]. */
  double tension = 0;
};

/** One track's notes as they stand after an edit (`TrackEdit`). */
struct TrackEdit {
  /** Index of the track in the session's track array. */
  double trackIndex = 0;
  /** The track's notes after the edit. */
  std::vector<NoteEvent> notes;
};

/** An arrangement analysis held open for editing (`ArrangementSession`). */
class ArrangementSession {
 public:
  /** The tracks the current analysis was made from. */
  const std::vector<ArrangementTrack>& tracks() const;

  /** The analysis of those tracks. */
  const ArrangementAnalysis& analysis() const;

  /**
   * Re-analyse after replacing the notes of one or more tracks, reusing everything the edit
   * provably cannot reach. The result equals analyze_arrangement() over the edited tracks. The
   * session itself stays valid; an update returns a new one.
   * @throws InvalidInputError if an edit names a track the session lacks or holds bad notes.
   */
  ArrangementSession update(const std::vector<TrackEdit>& edits) const;

  /** Internal state of a session; the internal arrange headers define it. */
  struct State;

 private:
  friend ArrangementSession create_arrangement_session(const std::vector<ArrangementTrack>&,
                                                       const ArrangementOptions&);
  explicit ArrangementSession(std::shared_ptr<const State> state) : state_(std::move(state)) {}

  std::shared_ptr<const State> state_;
};

/**
 * Label every note of one polyphonic passage against the harmony under it and the voices around
 * it (`analyzePolyphony`); one annotation per note, in the order the notes were given, each
 * carrying its position as its id.
 * @throws InvalidInputError if the notes are not valid note events.
 */
std::vector<AnalyzedNote> analyze_polyphony(
    const std::vector<NoteEvent>& notes,
    const std::function<Nullable<Chord>(double)>& chord_at_beat, const KeyContext& key);

/**
 * Analyse a whole arrangement against the harmony inferred from it (`analyzeArrangement`).
 * @throws InvalidInputError if a track, a note or an option is invalid.
 * @throws BudgetExceededError if the work exceeds the budget.
 */
ArrangementAnalysis analyze_arrangement(const std::vector<ArrangementTrack>& tracks,
                                        const ArrangementOptions& opts = {});

/**
 * Open an arrangement analysis that can be updated a few beats at a time
 * (`createArrangementSession`).
 */
ArrangementSession create_arrangement_session(const std::vector<ArrangementTrack>& tracks,
                                              const ArrangementOptions& opts = {});

/**
 * Sample the harmonic tension of an arrangement at regular beats (`tensionCurve`).
 * @throws InvalidInputError if `step` is not positive or an option is invalid.
 */
std::vector<TensionPoint> tension_curve(const std::vector<ArrangementTrack>& tracks,
                                        const TensionOptions& opts = {});

/**
 * Sample the tension of an arrangement already analysed by analyze_arrangement(), reusing its
 * harmony (`tensionCurveFrom`).
 */
std::vector<TensionPoint> tension_curve_from(const std::vector<ArrangementTrack>& tracks,
                                             const ArrangementAnalysis& analysis,
                                             const TensionOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_ANALYZE_ARRANGE_H_
