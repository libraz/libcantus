/**
 * @file internal.h
 * @brief Internal helpers of ts/src/analyze/arrange/internal.ts: pooling every track's sounding
 *        notes, partitioning a track into monophonic sub-voices, and the checks every entry
 *        point that takes arrangement tracks applies.
 */
#ifndef CANTUS_SRC_ANALYZE_ARRANGE_INTERNAL_H_
#define CANTUS_SRC_ANALYZE_ARRANGE_INTERNAL_H_

#include <cstddef>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/analyze/arrange.h"
#include "cantus/core/validation.h"

namespace cantus {

/** A note with the pitch that immediately preceded it in the same sub-voice (`PreparedNote`). */
struct PreparedNote {
  /** The id the note carries in the analysis. */
  double id = 0;
  /** The note's index in its track's own note array. */
  std::optional<std::size_t> originalIndex;
  int pitch = 0;
  std::optional<int> prevPitch;
  double startBeat = 0;
  double endBeat = 0;
};

/** One monophonic sub-voice of a track: ordered notes plus sounding spans (`PreparedVoice`). */
struct PreparedVoice {
  /** The sub-voice's notes in time order, each with a stable id. */
  std::vector<VoiceNote> voice;
  /** The same notes as sounding spans, each carrying its predecessor's pitch. */
  std::vector<PreparedNote> sounding;

  /** The span sounding at a beat, or null; a sub-voice is monophonic, so one search finds it. */
  const PreparedNote* at(double beat) const;
};

/** A track prepared for analysis: resolved metadata plus monophonic sub-voices. */
struct PreparedTrack {
  std::string name;
  TrackRole role = TrackRole::kOther;
  /** The track's index in the caller's input array. */
  std::size_t trackIndex = 0;
  /** The track's notes partitioned into monophonic sub-voices. */
  std::vector<PreparedVoice> voices;
};

/** Whether a sounding span `[start, end)` covers a beat (`covers`). */
bool covers(const PreparedNote& note, double beat);

/** Whether a track's role means it carries no harmonic content (`isPercussion`). */
bool is_percussion(const std::optional<TrackRole>& role);

/** The names of the roles that exist (`TRACK_ROLES`), in the order of TrackRole. */
std::vector<std::string_view> track_role_names();

/** The safety profile an arrangement is judged under (`arrangementProfile`). */
SafetyProfile arrangement_profile(const std::optional<SafetyProfile>& profile);

/**
 * Validate the note array of every track, naming the track that is wrong
 * (`assertTrackNotes`).
 * @returns How many notes the tracks hold in total.
 */
double assert_track_notes(const std::vector<ArrangementTrack>& tracks,
                          const NoteEventAssertOptions& options);

/** What assert_arrangement_input() resolves. */
struct ArrangementInput {
  MeterMap meters;
  /** How many notes the tracks hold in total. */
  double noteCount = 0;
  SafetyProfile profile{};
};

/**
 * The checks every analysis over arrangement tracks opens with, in TS order
 * (`assertArrangementInput`).
 */
ArrangementInput assert_arrangement_input(const std::vector<ArrangementTrack>& tracks,
                                          const ArrangementOptions& opts);

/** Reject a caller's chord timeline whose segments lack finite bounds (`assertGivenTimeline`). */
void assert_given_timeline(const std::optional<ChordTimeline>& timeline, std::string_view name);

/** Reject key regions that lack finite bounds (`assertGivenKeys`). */
void assert_given_keys(const std::optional<std::vector<KeyRegion>>& keys, std::string_view name);

/**
 * The tracks the harmony is inferred from, checked against the tracks that exist
 * (`harmonyTrackSet`); nullopt when the caller named none.
 * @throws InvalidInputError if an index is not finite, names no track, or names a track whose
 *   notes carry no harmony.
 */
std::optional<std::set<std::size_t>> harmony_track_set(
    const std::optional<std::vector<double>>& harmony_tracks,
    const std::vector<ArrangementTrack>& tracks, std::string_view name = "harmonyTracks");

/** Every sounding note of every pitched track pooled into one flat list (`poolNotes`). */
std::vector<NoteEvent> pool_notes(const std::vector<ArrangementTrack>& tracks,
                                  const std::set<std::size_t>* only = nullptr);

/** Resolve each track's metadata and derive its monophonic sub-voices (`prepareTracks`). */
std::vector<PreparedTrack> prepare_tracks(const std::vector<ArrangementTrack>& tracks);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_ARRANGE_INTERNAL_H_
