// Harmonizing a melody with a min-cost chord progression: ts/src/generate/harmonize/index.ts.

#include "generate/harmonize/harmonize.h"

#include <cmath>
#include <limits>
#include <set>
#include <string>
#include <utility>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "cantus/generate/context.h"
#include "cantus/theory/harmony.h"
#include "core/event_index/order.h"
#include "core/validation/validation.h"
#include "generate/context/context.h"
#include "generate/harmonize/candidates.h"
#include "generate/harmonize/key_fit.h"
#include "generate/harmonize/limits.gen.h"
#include "generate/harmonize/nct.h"
#include "generate/harmonize/search.h"
#include "generate/harmonize/segments.h"
#include "js/math.h"

namespace cantus {

std::string_view to_string(ReharmonizeStrength strength) {
  return kReharmonizeStrengthNames[static_cast<std::size_t>(strength)];
}

std::optional<ReharmonizeStrength> parse_reharmonize_strength(std::string_view name) {
  return parse_named<ReharmonizeStrength>(kReharmonizeStrengthNames, name);
}

HarmonizeResult harmonize_with(const HarmonizeRequest& request) {
  // Read in onset order whatever the listing, so a reordered melody is the same melody.
  const std::vector<NoteEvent> sounding = in_canonical_order(request.sounding);
  const TimeSignature& ts = request.ts;
  KeyScale key = request.key.scale;
  // Nothing to harmonize: inventing a tonic bar here would silently insert a ghost chord.
  if (sounding.empty()) {
    return HarmonizeResult{0, request.key, {}, {}};
  }
  std::vector<Candidate> candidates = build_candidates(key, request.harmonic);
  auto cand_at = [&](std::size_t i) -> const Candidate& {
    return i < candidates.size() ? candidates[i] : fallback_candidate();
  };
  std::vector<double> jitter;
  for (std::size_t index = 0; index < candidates.size(); ++index) {
    jitter.push_back(request.draw.at({std::string("jitter"), static_cast<double>(index)}) *
                     HARMONIZE_TIE_BREAK_JITTER);
  }

  // Read every onset and release as the metric position it is playing.
  double pulse = pulse_beats(ts);
  std::vector<MelodySpan> spans;
  for (const NoteEvent& note : sounding) {
    spans.push_back(MelodySpan{snap_to_pulse(note.startBeat, pulse),
                               snap_to_pulse(note.startBeat + note.durationBeat, pulse)});
  }
  double melody_start = std::numeric_limits<double>::infinity();
  double melody_end = -std::numeric_limits<double>::infinity();
  for (const MelodySpan& span : spans) {
    melody_start = js::min(melody_start, span.startBeat);
    melody_end = js::max(melody_end, span.endBeat);
  }
  double hr = request.harmonicRhythm(ts);
  BuiltSegments built =
      build_segments(spans, sounding, ts, HarmonicGrid{melody_start, melody_end, hr},
                     request.phraseEnds, request.charge);
  const std::vector<Segment>& segments = built.segments;
  PhraseEndSegments ends = phrase_end_segments(segments, built.innerEnds);
  // A cadence needs two chords to be told apart.
  std::set<std::pair<int, ChordQuality>> distinct;
  for (const Candidate& candidate : candidates) {
    distinct.insert({candidate.rootPc, candidate.quality});
  }
  std::set<std::size_t> articulated;
  if (distinct.size() > 1) {
    articulated = ends.named;
  }

  // Two independent axes: the semitone shift that puts the melody in the key it is harmonized in,
  // and the octave that puts it in a comfortable register.
  std::vector<double> semitone_shifts{0};
  if (request.placement.transposeSearch) {
    for (int s = -6; s <= 6; ++s) {
      if (s != 0) {
        semitone_shifts.push_back(s);
      }
    }
  }
  std::vector<double> octave_shifts =
      request.placement.octaveSearch ? std::vector<double>{0, -12, 12} : std::vector<double>{0};
  request.charge(static_cast<double>(semitone_shifts.size() * octave_shifts.size()) *
                     static_cast<double>(segments.size()) * static_cast<double>(candidates.size()) *
                     static_cast<double>(candidates.size()),
                 "harmonization placement search");

  double best_fit = std::numeric_limits<double>::infinity();
  double best_cost = std::numeric_limits<double>::infinity();
  double best_ts = 0;
  std::vector<std::size_t> best_path;
  for (double semitones : semitone_shifts) {
    // Pitch classes decide the path and the key fit, so an octave moves only the register.
    std::vector<NoteEvent> in_key = sounding;
    for (NoteEvent& note : in_key) {
      note.pitch = static_cast<int>(note.pitch + semitones);
    }
    HarmonizePass pass =
        harmonize_once(in_key, key, candidates, segments, jitter, ends.closing, articulated);
    // Key fit comes first: no cadence reward buys a melody note out of the key.
    double fit = key_fit_cost(in_key, key);
    for (double octave : octave_shifts) {
      double shift = semitones + octave;
      std::vector<NoteEvent> shifted = sounding;
      for (NoteEvent& note : shifted) {
        note.pitch = static_cast<int>(note.pitch + shift);
      }
      double total = pass.cost + tessitura_cost(shifted);
      if (fit < best_fit || (fit == best_fit && total < best_cost)) {
        best_fit = fit;
        best_cost = total;
        best_ts = shift;
        best_path = pass.path;
      }
    }
  }

  std::vector<ChordSpan> path_spans;
  for (std::size_t s = 0; s < best_path.size(); ++s) {
    const Candidate& cand = cand_at(best_path[s]);
    ChordSpan chord;
    chord.rootPc = cand.rootPc;
    chord.quality = cand.quality;
    chord.startBeat = s < segments.size() ? segments[s].startBeat
                                          : built.segmentStart + static_cast<double>(s) * hr;
    if (cand.degree) {
      chord.degree = *cand.degree;
    }
    if (cand.secondaryDominant) {
      chord.secondaryDominant = true;
    }
    path_spans.push_back(std::move(chord));
  }

  // A note's role is its role in the chord the search chose for the slot it was charged against.
  HarmonizeResult out{best_ts, request.key, merge_repeats(path_spans), {}};
  for (std::size_t note_index = 0; note_index < request.melody.size(); ++note_index) {
    const NoteEvent& note = request.melody[note_index];
    std::size_t seg_idx = segment_index_at(built.bounds, snap_to_pulse(note.startBeat, pulse));
    const Candidate& cand = cand_at(seg_idx < best_path.size() ? best_path[seg_idx] : 0);
    Chord chord = make_chord(cand.rootPc, cand.quality);
    out.melodyRoles.push_back(
        HarmonizedNoteRole{note_index, role_of(note.pitch + best_ts, chord).role});
  }
  return out;
}

HarmonizeResult harmonize_melody(const HarmonizeOptions& opts) {
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = opts.budget;
  assert_note_events(opts.melody, "harmonize melody", note_options);
  std::vector<double> phrase_ends = opts.phraseEnds.value_or(std::vector<double>{});
  for (double end : phrase_ends) {
    assert_finite_number(end, "harmonize phrase end");
  }
  std::vector<NoteEvent> sounding = sounding_notes_only(opts.melody);
  TimeSignature ts = meter_at(0, opts.ts.value_or(MeterArg(kGenerateDefaultTs)));
  assert_time_signature(ts);
  // The key is read once, here at the boundary, and kept whole.
  bool infer = !opts.key.has_value() || (std::holds_alternative<std::string>(opts.key->value()) &&
                                         std::get<std::string>(opts.key->value()) == "infer");
  ResolvedKey key = resolve_key(infer ? KeyArg(infer_key(sounding)) : *opts.key);
  ResolvedContext ctx = resolve_context(opts.ctx);
  double harmonic = ctx.harmonic.value_or(
      reharmonize_dial(opts.reharmonize.value_or(ReharmonizeStrength::kDiatonic)));

  HarmonizeRequest request(opts.melody, std::move(sounding), ctx.part("harmony"));
  request.phraseEnds = std::move(phrase_ends);
  request.ts = ts;
  request.key = std::move(key);
  request.placement = opts.placement.value_or(HarmonizePlacement{});
  request.harmonic = harmonic;
  std::optional<double> given_rhythm = opts.harmonicRhythm;
  request.harmonicRhythm = [given_rhythm](const TimeSignature& signature) {
    return assert_range(given_rhythm.value_or(default_harmonic_rhythm(signature)), kMinValue,
                        kMaxSafeInteger, "harmonic rhythm");
  };
  std::optional<double> budget = opts.budget;
  request.charge = [budget](double estimated, std::string_view name) {
    assert_generation_budget(estimated, name, budget);
  };
  return harmonize_with(request);
}

}  // namespace cantus
