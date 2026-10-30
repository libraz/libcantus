// The counter-melody generator of ts/src/generate/countermelody/index.ts.

#include "generate/countermelody/countermelody.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <string>
#include <utility>

#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"
#include "cantus/core/event_index.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "cantus/theory/counterpoint.h"
#include "core/validation/validation.h"
#include "generate/countermelody/limits.gen.h"
#include "js/math.h"
#include "js/number.h"
#include "theory/safety/weights.h"

namespace cantus {

namespace {

/** Whether a beat position falls on a whole quarter-note beat. */
bool is_whole_beat(double beat) { return std::abs(beat - js::round(beat)) < BEAT_EPS; }

/** The melody note sounding at a beat (latest onset wins on overlaps). */
std::optional<NoteEvent> melody_note_at(const NoteEventIndex& melody, double beat) {
  std::optional<IndexedNoteEvent> found = melody.at(beat);
  if (!found) {
    return std::nullopt;
  }
  return found->note;
}

/** Melody voice at a transition, including the pitch immediately before it. */
std::optional<VoiceSnapshot> melody_snapshot_at(const NoteEventIndex& melody, double beat) {
  std::optional<NoteEvent> current = melody_note_at(melody, beat);
  if (!current) {
    return std::nullopt;
  }
  bool attacked = std::abs(current->startBeat - beat) < BEAT_EPS;
  std::optional<NoteEvent> previous =
      attacked ? melody_note_at(melody, beat - BEAT_EPS * 2) : current;
  VoiceSnapshot snapshot;
  snapshot.pitch = current->pitch;
  if (previous) {
    snapshot.prevPitch = previous->pitch;
  }
  return snapshot;
}

/** Counter onsets mirroring the melody's own onsets, deduplicated. */
std::vector<double> follow_onsets(const NoteEventIndex& melody) {
  std::vector<double> onsets;
  std::set<double> seen;
  for (const IndexedNoteEvent& indexed : melody.notes()) {
    // A Set keeps +0 for a -0.
    if (seen.insert(indexed.note.startBeat).second) {
      onsets.push_back(indexed.note.startBeat == 0 ? 0.0 : indexed.note.startBeat);
    }
  }
  return onsets;
}

/** Counter onsets complementing the melody (`complementOnsets`). */
std::vector<double> complement_onsets(const NoteEventIndex& melody, const TimeSignature& ts,
                                      double span_start, double span_end, const Draw& draw) {
  std::vector<double> onsets;
  double grid_start = std::floor(span_start / COUNTER_GRID_STEP) * COUNTER_GRID_STEP;
  double last = -std::numeric_limits<double>::infinity();
  for (double beat = grid_start; beat < span_end - BEAT_EPS; beat += COUNTER_GRID_STEP) {
    bool attacked = melody.attacks_at(beat);
    bool sounding = melody_note_at(melody, beat).has_value();
    bool place = false;
    if (!attacked && !sounding) {
      place = is_whole_beat(beat);
    } else if (!attacked) {
      place =
          draw.prob(is_whole_beat(beat) ? COUNTER_HOLD_ON_BEAT_PROB : COUNTER_HOLD_OFF_BEAT_PROB,
                    {std::string("hold"), beat});
    } else if (is_strong_beat(beat, ts)) {
      place = draw.prob(COUNTER_REINFORCE_PROB, {std::string("reinforce"), beat});
    }
    if (place && beat - last >= COUNTER_MIN_ONSET_GAP - BEAT_EPS) {
      onsets.push_back(beat);
      last = beat;
    }
  }
  return onsets;
}

/** Whether an interval class is a third or a sixth (an imperfect consonance). */
bool imperfect_class(double ic) { return ic == 3 || ic == 4 || ic == 8 || ic == 9; }

/** Whether two successive intervals are the same imperfect consonance. */
bool keeps_imperfect_interval(double before, double now) {
  if (!imperfect_class(before) || !imperfect_class(now)) {
    return false;
  }
  return (before <= 4) == (now <= 4);
}

/** Preference score for one candidate counter pitch (`scoreCandidate`). */
double score_candidate(double pitch, std::optional<double> mel_pitch,
                       std::optional<double> mel_prev, std::optional<double> prev_pitch,
                       const Nullable<Chord>& chord, double center, const ProfileWeights& weights) {
  double score = 0;
  std::optional<double> ic;
  if (mel_pitch) {
    ic = std::fmod(std::abs(pitch - *mel_pitch), 12);
  }
  if (ic) {
    if (imperfect_class(*ic)) {
      score += weights.imperfectConsonance;
    } else if (*ic == 0 || *ic == 7) {
      score += weights.perfectConsonance;
    } else if (*ic == 1 || *ic == 2 || *ic == 6 || *ic == 10 || *ic == 11) {
      // The fourth is left unpriced: whether it is a dissonance depends on what is under it.
      score += weights.dissonance;
    }
  }
  if (chord && chord_tone_role(pitch, *chord)) {
    score += weights.chordTone;
  }
  if (prev_pitch) {
    double move = pitch - *prev_pitch;
    double dist = std::abs(move);
    score += dist * weights.melodicDistance;
    if (dist > 0 && dist <= 2) {
      score += weights.stepwise;
    }
    if (is_forbidden_melodic_leap(*prev_pitch, pitch)) {
      score += weights.forbiddenLeap;
    }
    if (mel_pitch && mel_prev && ic) {
      double mel_move = *mel_pitch - *mel_prev;
      if ((move > 0 && mel_move < 0) || (move < 0 && mel_move > 0)) {
        score += weights.contraryMotion;
      } else if (move == 0 || mel_move == 0) {
        score += weights.obliqueMotion;
      } else if (keeps_imperfect_interval(std::fmod(std::abs(*prev_pitch - *mel_prev), 12), *ic)) {
        score += weights.parallelImperfect;
      } else {
        score += weights.similarMotion;
      }
    }
  }
  score += std::abs(pitch - center) * weights.registerDrift;
  return score;
}

/** Event boundaries at which a held counter pitch can acquire a new context. */
std::vector<double> held_note_boundaries(const NoteEventIndex& melody, double start_beat,
                                         double end_beat, const std::vector<double>& change_beats) {
  std::set<double> boundaries{start_beat};
  for (double onset : melody.onsets_between(start_beat, end_beat)) {
    boundaries.insert(onset);
  }
  for (double beat : change_beats) {
    if (beat > start_beat + BEAT_EPS && beat < end_beat - BEAT_EPS) {
      boundaries.insert(beat);
    }
  }
  // `chordAt` is opaque: probe the half-beat grid so ordinary chord changes are still found.
  double first_grid = std::floor(start_beat / COUNTER_GRID_STEP + 1) * COUNTER_GRID_STEP;
  for (double beat = first_grid; beat < end_beat - BEAT_EPS; beat += COUNTER_GRID_STEP) {
    boundaries.insert(beat);
  }
  return std::vector<double>(boundaries.begin(), boundaries.end());
}

/** Everything about one boundary inside a held counter note that does not depend on the pitch. */
struct BoundaryContext {
  /** Melody voice sounding at the boundary, if any. */
  std::optional<VoiceSnapshot> melodyVoice;
  /** `melodyVoice` in the array shape the safety query takes. */
  std::vector<VoiceSnapshot> otherVoices;
  /** Chord reported by the caller's callback at the boundary. */
  Nullable<Chord> chord;
  bool strongBeat = false;
  /** Whether the boundary is the counter note's own onset. */
  bool atCounterOnset = false;
};

/** Resolve the candidate-independent context at every boundary a counter note spans. */
std::vector<BoundaryContext> boundary_contexts(const NoteEventIndex& melody,
                                               const CounterRequest& request, double start_beat,
                                               double end_beat) {
  std::vector<double> boundaries =
      held_note_boundaries(melody, start_beat, end_beat, request.change_beats);
  std::vector<BoundaryContext> contexts;
  for (double boundary : boundaries) {
    BoundaryContext context;
    context.melodyVoice = melody_snapshot_at(melody, boundary);
    if (context.melodyVoice) {
      context.otherVoices.push_back(*context.melodyVoice);
    }
    context.chord = request.chord_at(boundary);
    context.strongBeat = is_strong_beat(boundary, request.ts);
    context.atCounterOnset = std::abs(boundary - start_beat) < BEAT_EPS;
    contexts.push_back(std::move(context));
  }
  return contexts;
}

/** Worst safety reached while `pitch` is held through its complete interval; nullopt if unusable.
 */
std::optional<NoteSafety> held_pitch_safety(double pitch,
                                            const std::vector<BoundaryContext>& contexts,
                                            std::optional<double> prev_pitch, const KeyScale& key,
                                            SafetyProfile profile, CounterSide side, double low,
                                            double high) {
  NoteSafety worst = NoteSafety::kSafe;
  for (const BoundaryContext& context : contexts) {
    if (context.melodyVoice &&
        ((side == CounterSide::kBelow && pitch >= context.melodyVoice->pitch) ||
         (side == CounterSide::kAbove && pitch <= context.melodyVoice->pitch))) {
      return std::nullopt;
    }
    // Only `safety` is read, so the suggestion search is turned off.
    SafetyQuery query;
    query.profile = profile;
    query.candidatePitch = static_cast<int>(pitch);
    if (context.atCounterOnset) {
      if (prev_pitch) {
        query.prevPitch = static_cast<int>(*prev_pitch);
      }
    } else {
      query.prevPitch = static_cast<int>(pitch);
    }
    query.chord = context.chord;
    query.key = key;
    query.otherVoices = context.otherVoices;
    query.strongBeat = context.strongBeat;
    query.vocalLow = static_cast<int>(low);
    query.vocalHigh = static_cast<int>(high);
    EvaluateSafetyOptions options;
    options.suggestions = false;
    SafetyResult result = evaluate_safety(query, options);
    worst = static_cast<NoteSafety>(
        js::max(static_cast<double>(worst), static_cast<double>(result.safety)));
    if (worst == NoteSafety::kDissonant) {
      return worst;
    }
  }
  return worst;
}

}  // namespace

const TimeSignature kCounterDefaultTs =
#include "generate/countermelody/default_ts.gen.inc"
    ;

std::vector<std::string_view> counter_rhythm_names() {
  return {to_string(CounterRhythm::kComplement), to_string(CounterRhythm::kFollow)};
}

std::vector<std::string_view> counter_register_names() {
  return {to_string(CounterRegister::kAbove), to_string(CounterRegister::kBelow)};
}

std::string_view to_string(CounterRegister side) {
  switch (side) {
    case CounterRegister::kAbove:
      return "above";
    case CounterRegister::kBelow:
      return "below";
  }
  return "below";
}

std::optional<CounterRegister> parse_counter_register(std::string_view name) {
  for (CounterRegister side : {CounterRegister::kAbove, CounterRegister::kBelow}) {
    if (to_string(side) == name) {
      return side;
    }
  }
  return std::nullopt;
}

std::string_view to_string(CounterRhythm rhythm) {
  switch (rhythm) {
    case CounterRhythm::kComplement:
      return "complement";
    case CounterRhythm::kFollow:
      return "follow";
  }
  return "complement";
}

std::optional<CounterRhythm> parse_counter_rhythm(std::string_view name) {
  for (CounterRhythm rhythm : {CounterRhythm::kComplement, CounterRhythm::kFollow}) {
    if (to_string(rhythm) == name) {
      return rhythm;
    }
  }
  return std::nullopt;
}

void assert_weight_override(std::string_view field, double value) {
  assert_finite_number(value, "countermelody weights." + std::string(field));
}

std::vector<NoteEvent> generate_counter_melody_with(const CounterRequest& request,
                                                    const ResolvedContext& resolved) {
  NoteEventIndexOptions index_options;
  index_options.tieBreak =
      request.side == CounterSide::kBelow ? OnsetTieBreak::kHighest : OnsetTieBreak::kLowest;
  NoteEventIndex melody(sounding_notes_only(request.melody), index_options);
  Draw draw = resolved.part("countermelody");
  // The options are checked before the empty-melody exit, so a malformed option is refused
  // whether or not the melody happens to sound.
  if (melody.notes().empty()) {
    return {};
  }

  double span_start = melody.notes().front().note.startBeat;
  double span_end = span_start;
  for (const IndexedNoteEvent& n : melody.notes()) {
    span_end = js::max(span_end, n.endBeat);
  }
  assert_generation_budget(std::ceil((span_end - span_start) / COUNTER_GRID_STEP),
                           "countermelody grid");
  double pitch_sum = 0;
  for (const IndexedNoteEvent& n : melody.notes()) {
    pitch_sum += n.note.pitch;
  }
  double mean_pitch = pitch_sum / static_cast<double>(melody.notes().size());
  double default_center = request.side == CounterSide::kBelow
                              ? mean_pitch - COUNTER_REGISTER_OFFSET
                              : mean_pitch + COUNTER_REGISTER_OFFSET;
  double low = request.pitch_low(js::round(default_center) - COUNTER_DEFAULT_HALF_RANGE);
  double high = request.pitch_high(js::round(default_center) + COUNTER_DEFAULT_HALF_RANGE);
  if (low > high) {
    throw InvalidInputError("countermelody pitchLow must not exceed pitchHigh; received " +
                            js::to_string(low) + " > " + js::to_string(high));
  }
  assert_generation_budget(high - low + 1, "countermelody pitch candidates");
  request.assert_change_beats();
  double center = (low + high) / 2;

  std::vector<double> onsets =
      request.rhythm == CounterRhythm::kFollow
          ? follow_onsets(melody)
          : complement_onsets(melody, request.ts, span_start, span_end, draw);
  // Each candidate pitch is evaluated at every boundary its note spans, so the whole search is
  // bounded by the total boundary count times the register width.
  double boundary_estimate =
      static_cast<double>(onsets.size()) + std::ceil((span_end - span_start) / COUNTER_GRID_STEP) +
      static_cast<double>(melody.notes().size()) + static_cast<double>(request.change_beats.size());
  assert_generation_budget(boundary_estimate * (high - low + 1), "countermelody search");
  std::vector<double> jitter;
  for (double index = 0; index < high - low + 1; index += 1) {
    jitter.push_back(draw.at({std::string("jitter"), index}) * COUNTER_TIE_BREAK_JITTER);
  }

  std::vector<NoteEvent> out;
  std::optional<double> prev_pitch;
  for (std::size_t onset_index = 0; onset_index < onsets.size(); ++onset_index) {
    double beat = onsets[onset_index];
    double end_beat = onset_index + 1 < onsets.size() ? onsets[onset_index + 1]
                                                      : js::max(span_end, beat + COUNTER_GRID_STEP);
    std::optional<NoteEvent> mel_note = melody_note_at(melody, beat);
    std::optional<double> mel_pitch;
    if (mel_note) {
      mel_pitch = mel_note->pitch;
    }
    std::optional<VoiceSnapshot> melody_voice = melody_snapshot_at(melody, beat);
    std::optional<double> mel_prev;
    if (melody_voice && melody_voice->prevPitch) {
      mel_prev = *melody_voice->prevPitch;
    }
    std::vector<BoundaryContext> contexts = boundary_contexts(melody, request, beat, end_beat);
    // `contexts[0]?.chord ?? chordAt(beat)`: a boundary with no chord asks the callback again.
    Nullable<Chord> chord = contexts.front().chord;
    if (!chord) {
      chord = request.chord_at(beat);
    }
    std::vector<VoiceSnapshot> other_voices;
    if (melody_voice) {
      other_voices.push_back(*melody_voice);
    }

    SafetyContext safety;
    safety.profile = request.profile;
    if (prev_pitch) {
      safety.prevPitch = static_cast<int>(*prev_pitch);
    }
    safety.chord = chord;
    safety.key = request.key;
    safety.otherVoices = other_voices;
    safety.strongBeat = is_strong_beat(beat, request.ts);
    safety.vocalLow = static_cast<int>(low);
    safety.vocalHigh = static_cast<int>(high);
    std::vector<double> candidates = enumerate_safe_pitches(safety, low, high);

    std::optional<double> best_pitch;
    NoteSafety best_worst_safety = NoteSafety::kDissonant;
    double best_score = -std::numeric_limits<double>::infinity();
    for (double candidate : candidates) {
      std::optional<NoteSafety> worst_safety = held_pitch_safety(
          candidate, contexts, prev_pitch, request.key, request.profile, request.side, low, high);
      if (!worst_safety || *worst_safety == NoteSafety::kDissonant) {
        continue;
      }
      if (mel_pitch && prev_pitch && mel_prev &&
          // Parallel octaves are the perfect-class-zero case of this predicate.
          creates_parallel_perfect(*prev_pitch, candidate, *mel_prev, *mel_pitch)) {
        continue;
      }
      double score = score_candidate(candidate, mel_pitch, mel_prev, prev_pitch, chord, center,
                                     request.weights) +
                     (candidate - low >= 0 && candidate - low < static_cast<double>(jitter.size())
                          ? jitter[static_cast<std::size_t>(candidate - low)]
                          : 0);
      bool tie = std::abs(score - best_score) <= COUNTER_SCORE_EPS &&
                 candidate < best_pitch.value_or(std::numeric_limits<double>::infinity());
      if (*worst_safety < best_worst_safety ||
          (*worst_safety == best_worst_safety && (score > best_score + COUNTER_SCORE_EPS || tie))) {
        best_worst_safety = *worst_safety;
        best_score = score;
        best_pitch = candidate;
      }
    }

    if (!best_pitch) {
      // No unchecked fallback: the previous note ends at this onset, leaving an explicit rest.
      prev_pitch.reset();
      continue;
    }
    double pitch = *best_pitch;
    double velocity =
        js::max(1.0, js::min(127.0, js::round((mel_note && mel_note->velocity
                                                   ? static_cast<double>(*mel_note->velocity)
                                                   : COUNTER_DEFAULT_MELODY_VELOCITY) -
                                              COUNTER_VELOCITY_DROP)));
    NoteEvent note;
    note.pitch = static_cast<int>(clamp_to_midi(pitch));
    note.startBeat = beat;
    note.durationBeat = end_beat - beat;
    note.velocity = static_cast<int>(velocity);
    out.push_back(note);
    prev_pitch = pitch;
  }
  return out;
}

std::vector<NoteEvent> generate_counter_melody(const CounterMelodyOptions& opts) {
  CounterRequest request;
  if (opts.timeline) {
    const ChordTimeline& timeline = *opts.timeline;
    request.chord_at = [&timeline](double beat) { return timeline.at(beat); };
  } else if (opts.chordAt) {
    request.chord_at = opts.chordAt;
  } else {
    throw InvalidInputError("countermelody needs a timeline or a chordAt callback");
  }
  std::vector<double> change_beats;
  if (opts.timeline) {
    for (const ChordSegment& segment : opts.timeline->segments) {
      change_beats.push_back(segment.startBeat);
      change_beats.push_back(segment.endBeat);
    }
  } else if (opts.chordChangeBeats) {
    change_beats = *opts.chordChangeBeats;
  }
  request.side = opts.register_.value_or(CounterRegister::kBelow) == CounterRegister::kBelow
                     ? CounterSide::kBelow
                     : CounterSide::kAbove;
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  assert_note_events(opts.melody, "countermelody melody", note_options);
  request.melody = opts.melody;
  request.ts = meter_at(0, to_meter_data(opts.ts.value_or(MeterArg(kCounterDefaultTs)), "ts"));
  assert_time_signature(request.ts);
  request.rhythm = opts.rhythm.value_or(CounterRhythm::kComplement);
  request.profile = opts.profile.value_or(SafetyProfile::kPop);
  ProfileWeightOverrides overrides = opts.weights.value_or(ProfileWeightOverrides{});
  for (const auto& [field, value] : named_weight_overrides(overrides)) {
    assert_weight_override(field, value);
  }
  request.weights = profile_weights(request.profile, overrides);
  // The key is read into its plain form once, here at the boundary.
  request.key = to_key_scale(opts.key);
  ResolvedContext resolved = resolve_context(opts.ctx);
  request.change_beats = change_beats;
  request.assert_change_beats = [change_beats]() {
    assert_generation_budget(static_cast<double>(change_beats.size()), "chord change beats");
    for (std::size_t index = 0; index < change_beats.size(); ++index) {
      assert_range(change_beats[index], 0, kMaxSafeInteger,
                   "chordChangeBeats[" + index_text(index) + "]");
    }
  };
  std::optional<double> given_low = opts.pitchLow;
  std::optional<double> given_high = opts.pitchHigh;
  request.pitch_low = [given_low](double fallback) {
    return clamp_to_midi(given_low.value_or(fallback), "countermelody pitchLow");
  };
  request.pitch_high = [given_high](double fallback) {
    return clamp_to_midi(given_high.value_or(fallback), "countermelody pitchHigh");
  };
  return generate_counter_melody_with(request, resolved);
}

}  // namespace cantus
