// Arrangement tension analysis: ts/src/analyze/arrange/tension.ts.

#include "analyze/arrange/tension.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <string_view>

#include "analyze/adjacency.h"
#include "analyze/grid.h"
#include "cantus/analyze/functional.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"

namespace cantus {

namespace {

/** A name and the number it stands for. */
struct NamedDouble {
  std::string_view name;
  double value;
};

/** FUNCTION_TENSION: tension contributed by the sounding chord's harmonic function. */
constexpr NamedDouble kFunctionTension[] =
#include "analyze/arrange/function_tension.gen.inc"
    ;

double function_tension(HarmonicFunction function) {
  for (const NamedDouble& row : kFunctionTension) {
    if (row.name == to_string(function)) {
      return row.value;
    }
  }
  return 0;
}

/** Clamp a value into [0, 1] (`clamp01`). */
double clamp01(double value) { return js::min(1, js::max(0, value)); }

/** One sounding pitched note at a beat (`allSounding`). */
std::vector<int> all_sounding(const std::vector<PreparedTrack>& prepared, double beat) {
  std::vector<int> out;
  for (const PreparedTrack& track : prepared) {
    if (is_percussion(track.role)) {
      continue;
    }
    for (const PreparedVoice& sub_voice : track.voices) {
      const PreparedNote* note = sub_voice.at(beat);
      if (note != nullptr) {
        out.push_back(note->pitch);
      }
    }
  }
  return out;
}

/** Combine the harmonic, dissonance, and span terms at one sample beat (`sampleTension`). */
double sample_tension_at(const std::vector<PreparedTrack>& prepared,
                         const ArrangementHarmony& harmony, const MeterArg& meters,
                         SafetyProfile profile, double beat) {
  std::vector<int> sounding = all_sounding(prepared, beat);
  if (sounding.empty()) {
    return 0;
  }
  KeyScale key = harmony.scale_at(beat);
  std::optional<FoundChord> chord = harmony.timeline.found_at(beat);
  double function_score = chord ? function_tension(function_of(chord->checked(), key)) : 0;

  std::optional<std::set<int>> chord_pcs;
  if (chord) {
    std::vector<int> pcs = chord->pitch_classes();
    chord_pcs = std::set<int>(pcs.begin(), pcs.end());
  }
  bool strong_beat = is_strong_beat(beat, meters);
  double non_chord = 0;
  double dissonant = 0;
  // A coarse tension sample supplies no individual voice history. Every voice at the same MIDI
  // pitch consequently receives the same safety verdict.
  std::vector<std::pair<int, int>> pitches;
  for (int pitch : sounding) {
    auto found = std::find_if(pitches.begin(), pitches.end(),
                              [pitch](const auto& entry) { return entry.first == pitch; });
    if (found == pitches.end()) {
      pitches.emplace_back(pitch, 1);
    } else {
      found->second += 1;
    }
  }
  // The voices a candidate is weighed against are the texture with one of its own occurrences
  // taken out, so the texture is written down once for the sample and that one occurrence is
  // lifted out and put back around each evaluation.
  std::vector<VoiceSnapshot> others;
  std::vector<std::size_t> first_of;
  for (const auto& [pitch, count] : pitches) {
    first_of.push_back(others.size());
    for (int i = 0; i < count; ++i) {
      VoiceSnapshot voice;
      voice.pitch = pitch;
      others.push_back(voice);
    }
  }
  for (std::size_t entry = 0; entry < pitches.size(); ++entry) {
    int pitch = pitches[entry].first;
    int count = pitches[entry].second;
    // Non-chord-tone share only applies when a chord is sounding.
    if (chord_pcs && chord_pcs->count(pitch_class_of(pitch)) == 0) {
      non_chord += count;
    }
    // One occurrence of the candidate's own pitch is moved to the end and dropped, which leaves
    // exactly the multiset the caller would have built.
    std::size_t at = first_of[entry];
    VoiceSnapshot held = others[at];
    VoiceSnapshot tail = others.back();
    others[at] = tail;
    others.pop_back();
    SafetyQuery query;
    query.profile = profile;
    query.candidatePitch = pitch;
    if (chord) {
      query.chord = chord->raw;
    }
    query.key = key;
    query.otherVoices = others;
    query.strongBeat = strong_beat;
    // Only the verdict is read, so the replacement-pitch search is skipped.
    EvaluateSafetyOptions options;
    options.suggestions = false;
    SafetyResult result = evaluate_safety(query, options);
    others.push_back(tail);
    others[at] = held;
    if (result.safety == NoteSafety::kDissonant) {
      dissonant += count;
    }
  }
  double dissonance_score = js::max(non_chord, dissonant) / static_cast<double>(sounding.size());

  double low = std::numeric_limits<double>::infinity();
  double high = -std::numeric_limits<double>::infinity();
  for (int pitch : sounding) {
    low = js::min(low, pitch);
    high = js::max(high, pitch);
  }
  double span_score = js::min(1, (high - low) / SPAN_SATURATION);

  return clamp01(FUNCTION_WEIGHT * function_score + DISSONANCE_WEIGHT * dissonance_score +
                 SPAN_WEIGHT * span_score);
}

}  // namespace

std::vector<TensionPoint> sample_tension(const std::vector<PreparedTrack>& prepared,
                                         const ArrangementHarmony& harmony, SafetyProfile profile,
                                         const MeterMap& meters, const TensionGrid& grid,
                                         std::optional<double> budget) {
  const MeterArg meter_arg(meters);
  double sample_count =
      js::max(0, std::ceil((grid.total_beats - grid.sample_start) / grid.step - BEAT_EPS));
  assert_generation_budget(sample_count, "tension samples", budget);
  // The per-sample cost is one lookup per sub-voice, so it is their product that has to stay
  // inside the budget.
  double voice_count = 0;
  for (const PreparedTrack& track : prepared) {
    voice_count += static_cast<double>(track.voices.size());
  }
  assert_generation_budget(sample_count * js::min(MAX_DISTINCT_PITCHES, voice_count) * voice_count,
                           "tension sample-voice comparisons", budget);
  std::vector<TensionPoint> points;
  for (double i = 0; i < sample_count; i += 1) {
    // The first sample is taken where the music starts rather than at the slot boundary before
    // it; every later sample stays a whole number of steps from beat 0.
    double beat =
        i == 0 ? js::max(grid.sample_start, grid.music_start) : grid.sample_start + i * grid.step;
    points.push_back(
        TensionPoint{beat, sample_tension_at(prepared, harmony, meter_arg, profile, beat)});
  }
  return points;
}

std::vector<TensionPoint> tension_curve(const std::vector<ArrangementTrack>& tracks,
                                        const TensionOptions& opts) {
  ResolveMetersOptions meter_options;
  meter_options.ts = opts.ts;
  meter_options.meters = opts.meters;
  MeterMap meters = resolve_meters(meter_options, "arrangement meters");
  std::optional<double> budget = opts.budget;
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = budget;
  if (opts.pickupBeats) {
    assert_range(*opts.pickupBeats, 0, kMaxSafeInteger, "arrangement pickupBeats");
    note_options.minStartBeat = -*opts.pickupBeats;
  }
  assert_generation_budget(static_cast<double>(tracks.size()), "arrangement tracks", budget);
  double note_count = assert_track_notes(tracks, note_options);
  // The pooled total is what the sampling and the inferred timeline size their work by.
  assert_generation_budget(note_count, "arrangement notes", budget);
  SafetyProfile profile = arrangement_profile(opts.profile);
  double step = opts.step.value_or(1);
  assert_range(step, std::numeric_limits<double>::denorm_min(), kMaxSafeInteger,
               "tension sampling step");
  // Read by no sampling this call makes, and checked all the same.
  if (opts.minSeverity) {
    assert_integer(*opts.minSeverity, "arrangement minSeverity",
                   static_cast<double>(NoteSafety::kSafe),
                   static_cast<double>(NoteSafety::kDissonant));
  }
  assert_given_timeline(opts.timeline, "arrangement timeline");
  assert_given_keys(opts.keys, "arrangement keys");
  std::optional<std::set<std::size_t>> harmony_tracks =
      harmony_track_set(opts.harmonyTracks, tracks);
  std::vector<NoteEvent> pooled = pool_notes(tracks, harmony_tracks ? &*harmony_tracks : nullptr);
  std::vector<NoteEvent> all = pool_notes(tracks);
  double total_beats = 0;
  for (const NoteEvent& note : all) {
    total_beats = js::max(total_beats, note.startBeat + note.durationBeat);
  }
  // The grid the samples sit on is a whole number of steps from beat 0, and the music itself
  // starts at `music_start`.
  GridOrigin placed = grid_for_notes(all, step);

  std::vector<KeyRegion> keys;
  ResolvedKey prevailing_key;
  ChordTimeline timeline;
  if (!opts.timeline) {
    ChordTimelineOptions timeline_options;
    timeline_options.key = opts.key;
    timeline_options.meters = MeterArg(meters);
    timeline_options.pickupBeats = opts.pickupBeats;
    timeline_options.harmonicRhythm = opts.harmonicRhythm;
    timeline_options.budget = budget;
    ChordTimelineResult inferred = chord_timeline_from_notes(pooled, timeline_options);
    timeline = std::move(inferred.timeline);
    keys = std::move(inferred.keys);
    prevailing_key = std::move(inferred.prevailingKey);
  } else {
    timeline = *opts.timeline;
    // A caller-supplied timeline still needs key regions to be read against.
    if (opts.keys) {
      keys = *opts.keys;
    } else if (opts.key) {
      KeyRegion region;
      region.startBeat = placed.startBeat;
      region.endBeat = total_beats;
      region.key = resolve_key(*opts.key);
      region.confidence = 1;
      keys.push_back(std::move(region));
    } else {
      KeyTimelineOptions key_options;
      key_options.meters = meters;
      key_options.totalBeats = total_beats;
      key_options.budget = budget;
      keys = key_timeline_from_notes(pooled, key_options);
    }
    Nullable<ResolvedKey> prevailing = prevailing_key_of(keys);
    prevailing_key = prevailing ? *prevailing : resolve_key(major_key(0));
  }
  // Harmonic tension is judged against the key in force at the sample.
  const std::vector<KeyRegion>& regions = opts.keys ? *opts.keys : keys;
  Nullable<ResolvedKey> regions_prevailing = prevailing_key_of(regions);
  KeyLookup key_at(regions, regions_prevailing ? *regions_prevailing : prevailing_key);

  std::vector<PreparedTrack> prepared = prepare_tracks(tracks);
  ArrangementHarmony harmony;
  harmony.timeline = host_of(timeline);
  harmony.scale_at = [&key_at](double beat) { return scale_of(key_at(beat)); };
  TensionGrid grid;
  grid.sample_start = placed.origin;
  grid.music_start = placed.startBeat;
  grid.total_beats = total_beats;
  grid.step = step;
  return sample_tension(prepared, harmony, profile, meters, grid, budget);
}

std::vector<TensionPoint> tension_curve_from(const std::vector<ArrangementTrack>& tracks,
                                             const ArrangementAnalysis& analysis,
                                             const TensionOptions& opts) {
  // How much of an analysis's harmony a set of options leaves in place: restricting the harmony
  // to a few tracks changes which notes state it, so nothing survives; naming a key or its
  // regions changes only what the chords are heard against.
  TensionOptions merged;
  if (!opts.harmonyTracks) {
    merged.timeline = analysis.timeline;
    if (!opts.key && !opts.keys) {
      merged.keys = analysis.keys;
    }
  }
  // The options the caller named take precedence over what was carried.
  if (opts.key) merged.key = opts.key;
  if (opts.keys) merged.keys = opts.keys;
  if (opts.timeline) merged.timeline = opts.timeline;
  if (opts.harmonyTracks) merged.harmonyTracks = opts.harmonyTracks;
  if (opts.minSeverity) merged.minSeverity = opts.minSeverity;
  if (opts.ts) merged.ts = opts.ts;
  if (opts.meters) merged.meters = opts.meters;
  if (opts.pickupBeats) merged.pickupBeats = opts.pickupBeats;
  if (opts.harmonicRhythm) merged.harmonicRhythm = opts.harmonicRhythm;
  if (opts.profile) merged.profile = opts.profile;
  if (opts.budget) merged.budget = opts.budget;
  if (opts.step) merged.step = opts.step;
  return tension_curve(tracks, merged);
}

}  // namespace cantus
