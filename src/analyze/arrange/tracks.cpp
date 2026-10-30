// Arrangement track-role analysis: ts/src/analyze/arrange/tracks.ts.

#include "analyze/arrange/tracks.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>

#include "analyze/adjacency.h"
#include "analyze/grid.h"
#include "analyze/keys/keys.h"
#include "cantus/analyze/functional.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"

namespace cantus {

namespace {

/** Sounding pitches of every sub-voice at a beat (`SoundingVoice`). */
struct SoundingVoice {
  std::size_t track;
  std::size_t voice;
  /** The track's index in the caller's input array. */
  std::size_t trackIndex;
  const PreparedNote* note;
  VoiceSnapshot snapshot;
};

using SoundingCache = std::map<double, std::vector<SoundingVoice>>;

/** Build one complete arrangement snapshot for an evaluation beat (`soundingVoicesAt`). */
std::vector<SoundingVoice> sounding_voices_at(const std::vector<PreparedTrack>& prepared,
                                              double beat) {
  std::vector<SoundingVoice> out;
  for (std::size_t t = 0; t < prepared.size(); ++t) {
    const PreparedTrack& track = prepared[t];
    if (is_percussion(track.role)) {
      continue;
    }
    for (std::size_t v = 0; v < track.voices.size(); ++v) {
      // Each sub-voice is monophonic, so this is one binary search per voice.
      const PreparedNote* note = track.voices[v].at(beat);
      if (note == nullptr) {
        continue;
      }
      VoiceSnapshot snap;
      snap.pitch = note->pitch;
      // Motion reasons compare one real transition shared by both voices: a voice attacking
      // exactly here contributes its adjacent predecessor; a sustained voice contributes the
      // same pitch (oblique motion).
      std::optional<int> previous =
          same_instant(note->startBeat, beat) ? note->prevPitch : std::optional<int>(note->pitch);
      if (previous) {
        snap.prevPitch = previous;
      }
      out.push_back(SoundingVoice{t, v, track.trackIndex, note, snap});
    }
  }
  return out;
}

/** Every simultaneous voice except the one being evaluated (`otherVoicesSounding`). */
std::vector<SoundingVoice> other_voices_sounding(const std::vector<PreparedTrack>& prepared,
                                                 std::size_t exclude_track,
                                                 std::size_t exclude_voice, double beat,
                                                 SoundingCache& cache) {
  auto found = cache.find(beat);
  if (found == cache.end()) {
    found = cache.emplace(beat, sounding_voices_at(prepared, beat)).first;
  }
  std::vector<SoundingVoice> out;
  for (const SoundingVoice& voice : found->second) {
    if (voice.track != exclude_track || voice.voice != exclude_voice) {
      out.push_back(voice);
    }
  }
  return out;
}

/** Name a sounding voice the way a Conflict names its own note (`conflictPartner`). */
ConflictPartner conflict_partner(const SoundingVoice& sounding, int reasons) {
  ConflictPartner partner;
  partner.trackIndex = sounding.trackIndex;
  partner.noteId = sounding.note->id;
  partner.reasons = reasons;
  partner.originalIndex = sounding.note->originalIndex;
  return partner;
}

/** The snapshots evaluate_safety() reads, in the order partners index them (`snapshotsOf`). */
std::vector<VoiceSnapshot> snapshots_of(const std::vector<SoundingVoice>& voices) {
  std::vector<VoiceSnapshot> out;
  for (const SoundingVoice& voice : voices) {
    out.push_back(voice.snapshot);
  }
  return out;
}

/** The others sounding at a beat, as `analyzeVoice` asks for them. */
std::vector<OtherVoice> as_other_voices(const std::vector<SoundingVoice>& voices) {
  std::vector<OtherVoice> out;
  for (const SoundingVoice& voice : voices) {
    double pitch = voice.snapshot.pitch;
    out.push_back(OtherVoice{[pitch] { return pitch; }, [pitch] { return pitch; }});
  }
  return out;
}

/** Index of the first segment starting strictly after a beat (`firstSegmentAfter`). */
std::size_t first_segment_after(const std::vector<SegmentSpan>& segments, double beat) {
  std::size_t low = 0;
  std::size_t high = segments.size();
  while (low < high) {
    std::size_t middle = (low + high) / 2;
    if (segments[middle].startBeat <= beat + BEAT_EPS) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * The beats at which a note must be checked against the harmony (`evaluationBeats`): its onset,
 * plus the onset of every later chord segment the note sustains across.
 */
std::vector<double> evaluation_beats(const VoiceNote& note,
                                     const std::vector<SegmentSpan>& segments) {
  double note_end = note.startBeat + note.durationBeat;
  std::vector<double> beats = {note.startBeat};
  for (std::size_t i = first_segment_after(segments, note.startBeat); i < segments.size(); ++i) {
    double start = segments[i].startBeat;
    if (start >= note_end - BEAT_EPS) {
      break;
    }
    beats.push_back(start);
  }
  return beats;
}

}  // namespace

TimelineHost host_of(const ChordTimeline& timeline) {
  TimelineHost host;
  for (const ChordSegment& segment : timeline.segments) {
    host.spans.push_back(SegmentSpan{segment.startBeat, segment.endBeat});
  }
  ChordSource chord_at = [&timeline](std::size_t index) -> const Chord& {
    return timeline.segments[index].chord;
  };
  host.chords = ChordReads{chord_at, chord_at, {}, {}, {}, {}};
  host.voice_at = [&timeline](double beat) -> std::optional<VoiceChord> {
    Nullable<Chord> chord = chord_at_beat(timeline.segments, beat);
    if (!chord) {
      return std::nullopt;
    }
    return VoiceChord{*chord, std::nullopt};
  };
  host.found_at = [&timeline](double beat) -> std::optional<FoundChord> {
    Nullable<Chord> chord = chord_at_beat(timeline.segments, beat);
    if (!chord) {
      return std::nullopt;
    }
    auto held = std::make_shared<Chord>(*chord);
    return FoundChord{*chord, [held]() -> const Chord& { return *held; },
                      [held] { return chord_pitch_classes(*held); }};
  };
  return host;
}

TrackPass analyze_tracks(const std::vector<PreparedTrack>& prepared,
                         const ArrangementHarmony& harmony, SafetyProfile profile,
                         double min_severity, const MeterMap& meters) {
  const MeterArg meter_arg(meters);
  const TimelineHost& timeline = harmony.timeline;
  TrackPass pass;
  // A cadence is heard in the key it arrives in, which after a modulation is not the key the
  // piece opened in.
  pass.cadences =
      detect_cadences_over(timeline.spans, timeline.chords, harmony.scale_at, &pass.arrivals);
  SoundingCache sounding_cache;

  for (std::size_t t = 0; t < prepared.size(); ++t) {
    const PreparedTrack& track = prepared[t];
    if (is_percussion(track.role)) {
      // A drum hit has no harmonic reading, so labelling it against the chord would produce
      // noise rather than analysis.
      pass.tracks.push_back(TrackAnalysis{track.name, track.role, {}});
      continue;
    }
    std::vector<AnalyzedNote> notes;
    for (std::size_t v = 0; v < track.voices.size(); ++v) {
      const PreparedVoice& sub_voice = track.voices[v];
      VoiceHost host;
      host.chord_at = timeline.voice_at;
      host.key_at = harmony.scale_at;
      host.others_at = [&](double beat) {
        return as_other_voices(other_voices_sounding(prepared, t, v, beat, sounding_cache));
      };
      std::vector<AnalyzedNote> analyzed = analyze_voice_over(sub_voice.voice, host);
      for (const AnalyzedNote& note : analyzed) {
        AnalyzedNote tagged = note;
        tagged.trackIndex = static_cast<double>(track.trackIndex);
        notes.push_back(std::move(tagged));
      }
      std::map<double, const std::vector<TheoryLabel>*> labels_by_id;
      for (const AnalyzedNote& note : analyzed) {
        labels_by_id.emplace(note.noteId, &note.labels);
      }

      for (std::size_t note_index = 0; note_index < sub_voice.voice.size(); ++note_index) {
        const VoiceNote& note = sub_voice.voice[note_index];
        const PreparedNote& prepared_note = sub_voice.sounding[note_index];
        for (double beat : evaluation_beats(note, timeline.spans)) {
          bool at_onset = same_instant(beat, note.startBeat);
          std::vector<SoundingVoice> others =
              other_voices_sounding(prepared, t, v, beat, sounding_cache);
          SafetyQuery query;
          query.profile = profile;
          query.candidatePitch = note.pitch;
          query.prevPitch = at_onset ? prepared_note.prevPitch : std::optional<int>(note.pitch);
          std::optional<FoundChord> found = timeline.found_at(beat);
          if (found) {
            query.chord = found->raw;
          }
          query.key = harmony.scale_at(beat);
          query.otherVoices = snapshots_of(others);
          query.strongBeat = is_strong_beat(beat, meter_arg);
          // Most evaluations become no reportable conflict. Avoid their replacement-pitch scan,
          // then collect suggestions only for the conflicts we will retain.
          EvaluateSafetyOptions cheap;
          cheap.suggestions = false;
          SafetyResult result = evaluate_safety(query, cheap);
          if (result.safety != NoteSafety::kSafe &&
              static_cast<double>(result.safety) >= min_severity) {
            EvaluateSafetyOptions full;
            full.partners = true;
            result = evaluate_safety(query, full);
            Conflict conflict;
            conflict.beat = beat;
            conflict.trackName = track.name;
            conflict.trackIndex = track.trackIndex;
            conflict.noteId = *note.id;
            conflict.pitch = note.pitch;
            auto labels = labels_by_id.find(*note.id);
            if (labels != labels_by_id.end()) {
              conflict.labels = *labels->second;
            }
            conflict.safety = result.safety;
            conflict.reasons = result.reasons;
            if (note.originalIndex) {
              conflict.originalIndex = static_cast<std::size_t>(*note.originalIndex);
            }
            conflict.rationale = result.rationale;
            conflict.resolveTo = result.resolveTo;
            conflict.suggestions = result.suggestions;
            if (result.partners) {
              std::vector<ConflictPartner> partners;
              for (const SafetyPartner& partner : *result.partners) {
                partners.push_back(conflict_partner(others[static_cast<std::size_t>(partner.index)],
                                                    partner.reasons));
              }
              conflict.partners = std::move(partners);
            }
            pass.conflicts.push_back(std::move(conflict));
          }
        }
      }
    }
    // Sub-voice results interleave; restore the track's onset-then-pitch order.
    std::stable_sort(notes.begin(), notes.end(), [](const AnalyzedNote& a, const AnalyzedNote& b) {
      return a.noteId - b.noteId < 0;
    });
    pass.tracks.push_back(TrackAnalysis{track.name, track.role, std::move(notes)});
  }

  std::stable_sort(
      pass.conflicts.begin(), pass.conflicts.end(), [](const Conflict& a, const Conflict& b) {
        double by_safety = static_cast<double>(b.safety) - static_cast<double>(a.safety);
        double order = by_safety != 0 && !std::isnan(by_safety) ? by_safety : a.beat - b.beat;
        return order < 0;
      });
  return pass;
}

CallerKeys caller_keys(const TimelineHost& timeline, const std::optional<KeyArg>& key,
                       const std::optional<std::vector<KeyRegion>>& given,
                       const std::vector<NoteEvent>& pooled, const MeterMap& meters,
                       std::optional<double> budget) {
  // The span is the one the notes sound over, not the one the chords cover: a chart of the
  // opening bars is a partial answer about the harmony and no answer at all about where the
  // piece ends.
  double chart_end = -std::numeric_limits<double>::infinity();
  for (const SegmentSpan& segment : timeline.spans) {
    chart_end = js::max(chart_end, segment.endBeat);
  }
  double sounding_end = latest_sounding_end(pooled, -std::numeric_limits<double>::infinity());
  double span_end = js::max(chart_end, sounding_end);
  double total_beats = std::isfinite(span_end) ? span_end : 0;
  // ...and it begins where the music begins.
  double music_start = grid_for_notes(pooled, beats_per_bar_at(0, MeterArg(meters))).startBeat;
  CallerKeys out;
  if (given) {
    out.keys = *given;
  } else {
    if (key) {
      out.keys = stated_key_regions(resolve_key(*key), music_start, total_beats);
    } else {
      KeyTimelineOptions key_options;
      key_options.meters = meters;
      key_options.totalBeats = total_beats;
      key_options.budget = budget;
      out.keys = key_timeline_from_notes(pooled, key_options);
    }
    attach_pivots_over(out.keys, timeline.spans, timeline.chords.raw);
  }
  Nullable<ResolvedKey> prevailing = prevailing_key_of(out.keys);
  out.prevailing_key = prevailing ? *prevailing : resolve_key(major_key(0));
  out.segment_confidence.assign(timeline.spans.size(), 0);
  return out;
}

ArrangementRun analyze_arrangement_with(const std::vector<ArrangementTrack>& tracks,
                                        const ArrangementOptions& opts, TimelineEvidence* previous,
                                        const DirtySlots* dirty) {
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
  // The pooled total is what the downstream timeline analysis actually sizes its work by.
  assert_generation_budget(note_count, "arrangement notes", budget);
  SafetyProfile profile = arrangement_profile(opts.profile);
  // A severity outside the scale narrows the report to nothing, which reads exactly like a clean
  // arrangement.
  double min_severity = opts.minSeverity
                            ? assert_integer(*opts.minSeverity, "arrangement minSeverity",
                                             static_cast<double>(NoteSafety::kSafe),
                                             static_cast<double>(NoteSafety::kDissonant))
                            : static_cast<double>(NoteSafety::kWarning);
  assert_given_timeline(opts.timeline, "arrangement timeline");
  assert_given_keys(opts.keys, "arrangement keys");
  std::optional<std::set<std::size_t>> harmony_tracks =
      harmony_track_set(opts.harmonyTracks, tracks);
  std::vector<PreparedTrack> prepared = prepare_tracks(tracks);
  // Every note is evaluated against the other sub-voices sounding beneath it, so the work is the
  // product of the two.
  double voice_count = 0;
  for (const PreparedTrack& track : prepared) {
    voice_count += static_cast<double>(track.voices.size());
  }
  assert_generation_budget(note_count * voice_count, "arrangement note-voice comparisons", budget);
  std::vector<NoteEvent> pooled = pool_notes(tracks, harmony_tracks ? &*harmony_tracks : nullptr);

  ArrangementRun run;
  ArrangementHarmony harmony;
  std::vector<KeyRegion> keys;
  ResolvedKey prevailing_key;
  std::vector<double> segment_confidence;
  ChordTimeline timeline;
  if (!opts.timeline) {
    ChordTimelineOptions timeline_options;
    timeline_options.key = opts.key;
    timeline_options.meters = MeterArg(meters);
    timeline_options.pickupBeats = opts.pickupBeats;
    timeline_options.harmonicRhythm = opts.harmonicRhythm;
    timeline_options.budget = budget;
    TimelineAnalysis inferred = analyze_timeline(pooled, timeline_options, previous, dirty);
    run.evidence = std::make_unique<TimelineEvidence>(std::move(inferred.evidence));
    timeline = std::move(inferred.result.timeline);
    segment_confidence = std::move(inferred.result.segmentConfidence);
    if (opts.keys) {
      // Override an inferred result's key regions with ones the caller already had.
      keys = *opts.keys;
      Nullable<ResolvedKey> given_prevailing = prevailing_key_of(keys);
      prevailing_key = given_prevailing ? *given_prevailing : inferred.result.prevailingKey;
    } else {
      keys = std::move(inferred.result.keys);
      prevailing_key = std::move(inferred.result.prevailingKey);
    }
    harmony.timeline = host_of(timeline);
  } else {
    timeline = *opts.timeline;
    harmony.timeline = host_of(timeline);
    CallerKeys caller = caller_keys(harmony.timeline, opts.key, opts.keys, pooled, meters, budget);
    keys = std::move(caller.keys);
    prevailing_key = std::move(caller.prevailing_key);
    segment_confidence = std::move(caller.segment_confidence);
  }
  KeyLookup key_at(keys, prevailing_key);
  // The pitch classes of the key in force, for the readings that ask which notes are in the key
  // rather than how it is written.
  harmony.scale_at = [&key_at](double beat) { return scale_of(key_at(beat)); };
  TrackPass pass = analyze_tracks(prepared, harmony, profile, min_severity, meters);

  run.analysis.keys = std::move(keys);
  run.analysis.prevailingKey = std::move(prevailing_key);
  run.analysis.timeline = std::move(timeline);
  run.analysis.segmentConfidence = std::move(segment_confidence);
  run.analysis.cadences = std::move(pass.cadences);
  run.analysis.tracks = std::move(pass.tracks);
  run.analysis.conflicts = std::move(pass.conflicts);
  return run;
}

std::vector<AnalyzedNote> analyze_polyphony_over(
    const std::vector<NoteEvent>& passage,
    const std::function<std::optional<VoiceChord>(double)>& chord_at,
    const std::function<KeyAtBeat()>& key) {
  std::vector<PreparedTrack> prepared;
  {
    ArrangementTrack only;
    only.notes = passage;
    prepared = prepare_tracks({only});
  }
  const PreparedTrack& track = prepared[0];
  // Every note is read against the other sub-voices sounding under it, so the work is the product
  // of the two. This entry point takes no options, so it is the default budget it is charged
  // against.
  assert_generation_budget(
      static_cast<double>(passage.size()) * static_cast<double>(track.voices.size()),
      "polyphony note-voice comparisons");
  SoundingCache sounding_cache;
  std::map<double, AnalyzedNote> by_index;
  for (std::size_t v = 0; v < track.voices.size(); ++v) {
    VoiceHost host;
    host.chord_at = chord_at;
    host.key_at = key();
    host.others_at = [&](double beat) {
      return as_other_voices(other_voices_sounding(prepared, 0, v, beat, sounding_cache));
    };
    for (const AnalyzedNote& note : analyze_voice_over(track.voices[v].voice, host)) {
      if (note.originalIndex) {
        // The split's own bookkeeping stops here: the caller asked about its own array, so the
        // answer carries that position as the id and nothing that says the notes were taken
        // apart on the way.
        AnalyzedNote annotation = note;
        double original = *note.originalIndex;
        annotation.originalIndex.reset();
        annotation.noteId = original;
        by_index[original] = std::move(annotation);
      }
    }
  }
  // A note of no length never sounds, so the split drops it and no other voice can be dissonant
  // against it; it is still one of the caller's notes, and reading it against the chord alone
  // says what it is.
  std::vector<AnalyzedNote> out;
  for (std::size_t index = 0; index < passage.size(); ++index) {
    auto found = by_index.find(static_cast<double>(index));
    if (found != by_index.end()) {
      out.push_back(found->second);
      continue;
    }
    VoiceNote lone;
    static_cast<NoteEvent&>(lone) = passage[index];
    lone.id = static_cast<double>(index);
    VoiceHost host;
    host.chord_at = chord_at;
    host.key_at = key();
    host.others_at = [](double) { return std::vector<OtherVoice>{}; };
    std::vector<AnalyzedNote> only = analyze_voice_over({lone}, host);
    if (!only.empty()) {
      out.push_back(std::move(only.front()));
    } else {
      AnalyzedNote bare;
      bare.noteId = static_cast<double>(index);
      bare.pitch = passage[index].pitch;
      bare.startBeat = passage[index].startBeat;
      bare.durationBeat = passage[index].durationBeat;
      out.push_back(std::move(bare));
    }
  }
  return out;
}

//--------------------------------------------------------------------------------------------
// Public entry points

std::vector<AnalyzedNote> analyze_polyphony(
    const std::vector<NoteEvent>& notes,
    const std::function<Nullable<Chord>(double)>& chord_at_beat, const KeyContext& key) {
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  assert_note_events(notes, "notes", note_options);
  return analyze_polyphony_over(
      notes,
      [&chord_at_beat](double beat) -> std::optional<VoiceChord> {
        Nullable<Chord> chord = chord_at_beat(beat);
        if (!chord) {
          return std::nullopt;
        }
        return VoiceChord{*chord, std::nullopt};
      },
      [&key] { return key_scale_at(key); });
}

ArrangementAnalysis analyze_arrangement(const std::vector<ArrangementTrack>& tracks,
                                        const ArrangementOptions& opts) {
  return analyze_arrangement_with(tracks, opts).analysis;
}

}  // namespace cantus
