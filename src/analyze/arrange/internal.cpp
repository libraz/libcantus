// Shared helpers for the arrangement analyses: ts/src/analyze/arrange/internal.ts.

#include "analyze/arrange/internal.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include "analyze/adjacency.h"
#include "analyze/timeline/timeline.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** DEFAULT_PROFILE_NAMES: the safety profile an arrangement is judged under by default. */
constexpr std::string_view kDefaultProfileNames[] =
#include "analyze/arrange/default_profile_names.gen.inc"
    ;

/** TRACK_ROLES. */
constexpr std::string_view kTrackRoleNames[] =
#include "analyze/arrange/track_roles.gen.inc"
    ;

static_assert(std::size(kTrackRoleNames) == 5, "TRACK_ROLES and TrackRole disagree");

constexpr double kMaxLaneLeap = MAX_LANE_LEAP;

/** The notes of a sub-voice being built, as indices into the ordered notes. */
using Lane = std::vector<std::size_t>;

/**
 * Choose a free lane for each note of one simultaneous block (`pairWithFreeLanes`), by the rule
 * the note-by-note path follows: each note joins the free lane whose last pitch is nearest its
 * own, with the block's low-to-high order preserved so no two assignments cross.
 */
struct FreeLane {
  std::size_t index;
  int last_pitch;
};

std::vector<std::optional<std::size_t>> pair_with_free_lanes(const std::vector<VoiceNote>& block,
                                                             const std::vector<FreeLane>& lanes) {
  const std::size_t note_count = block.size();
  const std::size_t lane_count = lanes.size();
  std::vector<std::optional<std::size_t>> assignment(note_count);
  if (lane_count == 0) {
    return assignment;
  }
  // Cost of the cheapest order-preserving assignment of the first i notes over the first j
  // lanes, and the step it ends with: 0 leaves lane j-1 unused, 1 pairs note i-1 with it, 2
  // leaves note i-1 without a lane.
  const std::size_t width = lane_count + 1;
  std::vector<double> cost((note_count + 1) * width, 0);
  std::vector<unsigned char> step((note_count + 1) * width, 0);
  for (std::size_t i = 1; i <= note_count; ++i) {
    cost[i * width] = static_cast<double>(i) * kMaxLaneLeap;
    step[i * width] = 2;
  }
  for (std::size_t i = 1; i <= note_count; ++i) {
    for (std::size_t j = 1; j <= lane_count; ++j) {
      double best = cost[i * width + j - 1];
      unsigned char choice = 0;
      double unpaired = cost[(i - 1) * width + j] + kMaxLaneLeap;
      if (unpaired < best) {
        best = unpaired;
        choice = 2;
      }
      double distance = std::fabs(static_cast<double>(lanes[j - 1].last_pitch) -
                                  static_cast<double>(block[i - 1].pitch));
      double paired = cost[(i - 1) * width + j - 1] + distance;
      if (distance <= kMaxLaneLeap && paired < best) {
        best = paired;
        choice = 1;
      }
      cost[i * width + j] = best;
      step[i * width + j] = choice;
    }
  }
  for (std::size_t i = note_count, j = lane_count; i > 0;) {
    if (j == 0 || step[i * width + j] == 2) {
      i -= 1;
    } else if (step[i * width + j] == 1) {
      assignment[i - 1] = lanes[j - 1].index;
      i -= 1;
      j -= 1;
    } else {
      j -= 1;
    }
  }
  return assignment;
}

/**
 * Split a track's ordered notes into monophonic sub-voices (`splitIntoSubVoices`). Each note
 * joins the free sub-voice whose last pitch is nearest its own; ties go to the lane that ended
 * latest; a connection wider than MAX_LANE_LEAP opens a new sub-voice instead.
 */
std::vector<std::vector<VoiceNote>> split_into_sub_voices(const std::vector<VoiceNote>& ordered) {
  std::vector<Lane> lanes;
  auto last_of = [&](std::size_t lane) -> const VoiceNote& { return ordered[lanes[lane].back()]; };
  auto attach_nearest = [&](std::size_t note, const std::set<std::size_t>& excluded) -> long {
    long best = -1;
    double best_distance = std::numeric_limits<double>::infinity();
    double best_end = -std::numeric_limits<double>::infinity();
    for (std::size_t lane = 0; lane < lanes.size(); ++lane) {
      if (excluded.count(lane) > 0 || lanes[lane].empty()) {
        continue;
      }
      const VoiceNote& last = last_of(lane);
      double end = last.startBeat + last.durationBeat;
      if (!has_ended(end, ordered[note].startBeat)) {
        continue;  // still sounding, so the lane is not free
      }
      double distance = std::fabs(static_cast<double>(last.pitch) - ordered[note].pitch);
      if (distance > kMaxLaneLeap) {
        continue;
      }
      if (distance < best_distance || (distance == best_distance && end > best_end)) {
        best = static_cast<long>(lane);
        best_distance = distance;
        best_end = end;
      }
    }
    if (best >= 0) {
      lanes[static_cast<std::size_t>(best)].push_back(note);
    }
    return best;
  };

  for (std::size_t start = 0; start < ordered.size();) {
    double onset = ordered[start].startBeat;
    std::size_t end = start + 1;
    while (end < ordered.size() && same_instant(ordered[end].startBeat, onset)) {
      end += 1;
    }
    // Notes struck together form a vertical slice, so their lanes are chosen as a whole.
    if (end - start > 1) {
      std::vector<VoiceNote> block(ordered.begin() + static_cast<std::ptrdiff_t>(start),
                                   ordered.begin() + static_cast<std::ptrdiff_t>(end));
      std::vector<FreeLane> free_lanes;
      for (std::size_t lane = 0; lane < lanes.size(); ++lane) {
        if (!lanes[lane].empty() &&
            has_ended(last_of(lane).startBeat + last_of(lane).durationBeat, onset)) {
          free_lanes.push_back(FreeLane{lane, last_of(lane).pitch});
        }
      }
      std::stable_sort(
          free_lanes.begin(), free_lanes.end(),
          [](const FreeLane& a, const FreeLane& b) { return a.last_pitch - b.last_pitch < 0; });
      std::vector<std::optional<std::size_t>> assignment = pair_with_free_lanes(block, free_lanes);
      // Every lane the slice takes is settled before a note is placed.
      std::set<std::size_t> taken;
      for (const std::optional<std::size_t>& lane : assignment) {
        if (lane) {
          taken.insert(*lane);
        }
      }
      for (std::size_t index = 0; index < block.size(); ++index) {
        std::size_t note = start + index;
        if (assignment[index]) {
          lanes[*assignment[index]].push_back(note);
          continue;
        }
        long attached = attach_nearest(note, taken);
        if (attached < 0) {
          lanes.push_back(Lane{note});
        } else {
          taken.insert(static_cast<std::size_t>(attached));
        }
      }
    } else if (attach_nearest(start, {}) < 0) {
      lanes.push_back(Lane{start});
    }
    start = end;
  }
  std::vector<std::vector<VoiceNote>> out;
  for (const Lane& lane : lanes) {
    std::vector<VoiceNote> voice;
    for (std::size_t note : lane) {
      voice.push_back(ordered[note]);
    }
    out.push_back(std::move(voice));
  }
  return out;
}

}  // namespace

std::string_view to_string(TrackRole role) {
  return kTrackRoleNames[static_cast<std::size_t>(role)];
}

std::optional<TrackRole> parse_track_role(std::string_view name) {
  for (std::size_t i = 0; i < std::size(kTrackRoleNames); ++i) {
    if (kTrackRoleNames[i] == name) {
      return static_cast<TrackRole>(i);
    }
  }
  return std::nullopt;
}

const PreparedNote* PreparedVoice::at(double beat) const {
  // Index of the last span starting at or before a beat, or -1.
  std::size_t low = 0;
  std::size_t high = sounding.size();
  while (low < high) {
    std::size_t middle = (low + high) / 2;
    if (sounding[middle].startBeat <= beat + BEAT_EPS) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  if (low == 0) {
    return nullptr;
  }
  const PreparedNote& candidate = sounding[low - 1];
  return covers(candidate, beat) ? &candidate : nullptr;
}

bool covers(const PreparedNote& note, double beat) {
  return beat >= note.startBeat - BEAT_EPS && beat < note.endBeat - BEAT_EPS;
}

bool is_percussion(const std::optional<TrackRole>& role) { return role == TrackRole::kDrums; }

std::vector<std::string_view> track_role_names() {
  return std::vector<std::string_view>(std::begin(kTrackRoleNames), std::end(kTrackRoleNames));
}

SafetyProfile arrangement_profile(const std::optional<SafetyProfile>& profile) {
  return profile ? *profile : *parse_safety_profile(kDefaultProfileNames[0]);
}

double assert_track_notes(const std::vector<ArrangementTrack>& tracks,
                          const NoteEventAssertOptions& options) {
  double note_count = 0;
  for (std::size_t index = 0; index < tracks.size(); ++index) {
    assert_note_events(tracks[index].notes, "tracks[" + index_text(index) + "].notes", options);
    note_count += static_cast<double>(tracks[index].notes.size());
  }
  return note_count;
}

void assert_given_timeline(const std::optional<ChordTimeline>& timeline, std::string_view name) {
  if (timeline) {
    assert_chord_timeline(*timeline, name);
  }
}

void assert_given_keys(const std::optional<std::vector<KeyRegion>>& keys, std::string_view name) {
  if (!keys) {
    return;
  }
  for (std::size_t index = 0; index < keys->size(); ++index) {
    std::string label = join_name(name, "[") + index_text(index) + "]";
    assert_finite_number((*keys)[index].startBeat, label + ".startBeat");
    assert_finite_number((*keys)[index].endBeat, label + ".endBeat");
  }
  assert_spans_in_order(*keys, name);
}

std::optional<std::set<std::size_t>> harmony_track_set(
    const std::optional<std::vector<double>>& harmony_tracks,
    const std::vector<ArrangementTrack>& tracks, std::string_view name) {
  if (!harmony_tracks) {
    return std::nullopt;
  }
  std::set<std::size_t> only;
  for (std::size_t index = 0; index < harmony_tracks->size(); ++index) {
    double value = (*harmony_tracks)[index];
    std::string label = std::string(name) + "[" + index_text(index) + "]";
    if (!std::isfinite(value)) {
      throw InvalidInputError(label + " must be a track index; received " + js::to_string(value));
    }
    double track = std::trunc(value);
    if (track < 0 || track >= static_cast<double>(tracks.size())) {
      throw InvalidInputError(label + " " + js::to_string(track) +
                              " is outside the arrangement's " +
                              js::to_string(static_cast<double>(tracks.size())) + " tracks");
    }
    if (is_percussion(tracks[static_cast<std::size_t>(track)].role)) {
      throw InvalidInputError(label + " " + js::to_string(track) +
                              " names a percussion track, whose pitches state no harmony");
    }
    only.insert(static_cast<std::size_t>(track));
  }
  return only;
}

std::vector<NoteEvent> pool_notes(const std::vector<ArrangementTrack>& tracks,
                                  const std::set<std::size_t>* only) {
  std::vector<NoteEvent> notes;
  for (std::size_t index = 0; index < tracks.size(); ++index) {
    const ArrangementTrack& track = tracks[index];
    if (is_percussion(track.role)) {
      continue;
    }
    if (only != nullptr && only->count(index) == 0) {
      continue;
    }
    for (const NoteEvent& note : track.notes) {
      if (note.durationBeat > 0) {
        notes.push_back(note);
      }
    }
  }
  return notes;
}

std::vector<PreparedTrack> prepare_tracks(const std::vector<ArrangementTrack>& tracks) {
  double next_id = 0;
  std::vector<PreparedTrack> out;
  for (std::size_t index = 0; index < tracks.size(); ++index) {
    const ArrangementTrack& track = tracks[index];
    std::vector<std::size_t> order;
    for (std::size_t original = 0; original < track.notes.size(); ++original) {
      if (track.notes[original].durationBeat > 0) {
        order.push_back(original);
      }
    }
    std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
      double by_start = track.notes[a].startBeat - track.notes[b].startBeat;
      return (by_start != 0 && !std::isnan(by_start)
                  ? by_start
                  : static_cast<double>(track.notes[a].pitch) - track.notes[b].pitch) < 0;
    });
    std::vector<VoiceNote> ordered;
    for (std::size_t original : order) {
      VoiceNote note;
      static_cast<NoteEvent&>(note) = track.notes[original];
      note.id = next_id;
      next_id += 1;
      note.originalIndex = static_cast<double>(original);
      ordered.push_back(std::move(note));
    }
    PreparedTrack prepared;
    for (std::vector<VoiceNote>& voice : split_into_sub_voices(ordered)) {
      PreparedVoice sub;
      for (std::size_t i = 0; i < voice.size(); ++i) {
        const VoiceNote& note = voice[i];
        bool contiguous = false;
        if (i > 0) {
          contiguous = adjacent(voice[i - 1].startBeat + voice[i - 1].durationBeat, note.startBeat);
        }
        PreparedNote span;
        span.id = *note.id;
        span.originalIndex = static_cast<std::size_t>(*note.originalIndex);
        span.pitch = note.pitch;
        if (contiguous) {
          span.prevPitch = voice[i - 1].pitch;
        }
        span.startBeat = note.startBeat;
        span.endBeat = note.startBeat + note.durationBeat;
        sub.sounding.push_back(span);
      }
      sub.voice = std::move(voice);
      prepared.voices.push_back(std::move(sub));
    }
    prepared.name =
        track.name ? *track.name : "track " + js::to_string(static_cast<double>(index + 1));
    prepared.role = track.role.value_or(TrackRole::kOther);
    prepared.trackIndex = index;
    out.push_back(std::move(prepared));
  }
  return out;
}

}  // namespace cantus
