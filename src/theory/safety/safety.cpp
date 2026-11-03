// Judge whether a pitch can be placed in a voice: ts/src/theory/safety/index.ts.

#include "cantus/theory/safety.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/theory/counterpoint.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "theory/chord/chord.h"
#include "theory/safety/limits.gen.h"
#include "theory/safety/weights.h"

namespace cantus {

namespace {

constexpr NamedProfileWeights kProfileWeightRows[] =
#include "theory/safety/profile_weights.gen.inc"
    ;

/** The minimum verdict each non-informational reason contributes (`REASON_SEVERITY`). */
struct ReasonSeverity {
  std::uint32_t flag;
  int pop;
  int strict;
};

constexpr ReasonSeverity kReasonSeverity[] =
#include "theory/safety/reason_severity.gen.inc"
    ;

/** Wording for every reason flag, most to least specific (`REASON_TEXT`). */
struct ReasonText {
  std::uint32_t flag;
  std::string_view text;
};

constexpr ReasonText kReasonText[] =
#include "theory/safety/reason_text.gen.inc"
    ;

std::uint32_t bit(ReasonFlag flag) { return static_cast<std::uint32_t>(flag); }

NoteSafety severity_at(int level) { return static_cast<NoteSafety>(level); }

/** `minimumSafetyForReasons`. */
NoteSafety minimum_safety_for_reasons(std::uint32_t reasons, SafetyProfile profile) {
  NoteSafety minimum = NoteSafety::kSafe;
  for (const ReasonSeverity& entry : kReasonSeverity) {
    if ((reasons & entry.flag) != 0) {
      NoteSafety severity =
          severity_at(profile == SafetyProfile::kStrict ? entry.strict : entry.pop);
      if (severity > minimum) {
        minimum = severity;
      }
    }
  }
  return minimum;
}

bool has_interval(const Chord& chord, double semitones) {
  return std::find(chord.intervals.begin(), chord.intervals.end(), semitones) !=
         chord.intervals.end();
}

/** Whether the perfect fourth is an avoid note over this chord (`avoidsFourth`). */
bool avoids_fourth(const Chord& chord) { return has_interval(chord, 4) && !has_interval(chord, 5); }

/** Whether the major seventh is an avoid note over this chord (`avoidsMajorSeventh`). */
bool avoids_major_seventh(const Chord& chord) {
  return has_interval(chord, 4) && has_interval(chord, 10);
}

/** What a safety query reads off its chord, however many candidates it weighs (`ChordFacts`). */
struct ChordFacts {
  const Chord* chord;
  /** The chord's pitch classes as a twelve-bit mask. */
  int mask;
  /** The whole interval classes above its root as a twelve-bit mask. */
  int offsets;
  bool avoids_fourth;
  bool avoids_major_seventh;
};

/** What the candidates of one query share; the chord facts are read on first use (`QueryShare`). */
struct QueryShare {
  std::optional<ChordFacts> facts;
};

/** Read the facts of a chord, rejecting one whose pitch classes cannot be read
 * (`chordFactsOf`). */
ChordFacts chord_facts_of(const Chord& chord) {
  int mask = chord_pc_mask(chord);
  int offsets = 0;
  for (double interval : chord.intervals) {
    double offset = js::floor_mod(interval, 12);
    if (std::floor(offset) == offset) {
      offsets |= 1 << static_cast<int>(offset);
    }
  }
  return ChordFacts{&chord, mask, offsets, avoids_fourth(chord), avoids_major_seventh(chord)};
}

/** Whether a pitch's class is set in a twelve-bit pitch-class mask (`soundsInMask`). */
bool sounds_in_mask(int mask, double pitch) { return ((mask >> pitch_class_of(pitch)) & 1) == 1; }

/** Whether a dissonance between two chord tones is one the chord is built from
 * (`isStructuralChordDissonance`). */
bool is_structural_chord_dissonance(int a, int b, const ChordFacts& facts) {
  int raw_class = pitch_class_of(std::abs(a - b));
  int a_offset = interval_above_root(a, *facts.chord);
  int b_offset = interval_above_root(b, *facts.chord);
  bool root_seventh = (a_offset == 0 && (b_offset == 10 || b_offset == 11)) ||
                      (b_offset == 0 && (a_offset == 10 || a_offset == 11));
  if (raw_class != 6 && !root_seventh) {
    return false;
  }
  return sounds_in_mask(facts.mask, a) && sounds_in_mask(facts.mask, b);
}

/** Nearest chord tone at or below the candidate, within two semitones (`stepResolution`). */
std::optional<int> step_resolution(int pitch, const ChordFacts& facts) {
  for (int delta = 1; delta <= 2; ++delta) {
    if (sounds_in_mask(facts.mask, pitch - delta)) {
      return pitch - delta;
    }
  }
  return std::nullopt;
}

/** The severity a single flag carries under a profile; Safe when purely informational
 * (`severityOfReason`). */
NoteSafety severity_of_reason(std::uint32_t flag, SafetyProfile profile) {
  for (const ReasonSeverity& entry : kReasonSeverity) {
    if (entry.flag == flag) {
      return severity_at(profile == SafetyProfile::kStrict ? entry.strict : entry.pop);
    }
  }
  return NoteSafety::kSafe;
}

/** A short human explanation from the reason flags (`describe`). */
std::string describe(std::uint32_t reasons, const SafetyContext& q) {
  std::optional<std::string_view> best;
  int best_severity = -1;
  for (const ReasonText& entry : kReasonText) {
    if ((reasons & entry.flag) == 0) {
      continue;
    }
    int severity = static_cast<int>(severity_of_reason(entry.flag, q.profile));
    if (severity > best_severity) {
      best_severity = severity;
      best = entry.text;
    }
  }
  if (best) {
    return std::string(*best);
  }
  return q.chord ? "Placeable" : "No chord context";
}

/** Validate every pitch a public safety entry point reads (`assertSafetyContext`). */
void assert_safety_context(const SafetyContext& q) {
  if (q.prevPitch) {
    assert_midi_pitch(*q.prevPitch, "prevPitch");
  }
  if (q.vocalLow) {
    assert_midi_pitch(*q.vocalLow, "vocalLow");
  }
  if (q.vocalHigh) {
    assert_midi_pitch(*q.vocalHigh, "vocalHigh");
  }
  if (q.vocalLow && q.vocalHigh && *q.vocalLow > *q.vocalHigh) {
    throw InvalidInputError("vocalLow must not exceed vocalHigh");
  }
  assert_generation_budget(static_cast<double>(q.otherVoices.size()), "other voices");
  for (std::size_t index = 0; index < q.otherVoices.size(); ++index) {
    const VoiceSnapshot& voice = q.otherVoices[index];
    std::string label = "otherVoices[" + index_text(index) + "]";
    assert_midi_pitch(voice.pitch, label + ".pitch");
    if (voice.prevPitch) {
      assert_midi_pitch(*voice.prevPitch, label + ".prevPitch");
    }
  }
}

SafetyResult evaluate_internal(const SafetyContext& q, int pitch, bool collect_suggestions,
                               bool collect_partners, QueryShare& share,
                               bool describe_reasons = true);

/** Safe alternative pitches near a rejected candidate, nearest first, the pitch below before the
 * one above (`findSafeNearby`). */
std::vector<int> find_safe_nearby(const SafetyContext& q, int candidate, QueryShare& share) {
  std::vector<int> out;
  for (int d = 1; d <= SUGGESTION_WINDOW; ++d) {
    for (int p : {candidate - d, candidate + d}) {
      if (p < 0 || p > 127) {
        continue;
      }
      if (evaluate_internal(q, p, false, false, share, false).safety == NoteSafety::kSafe) {
        out.push_back(p);
        if (static_cast<int>(out.size()) >= MAX_SUGGESTIONS) {
          return out;
        }
      }
    }
  }
  return out;
}

SafetyResult evaluate_internal(const SafetyContext& q, int pitch, bool collect_suggestions,
                               bool collect_partners, QueryShare& share, bool describe_reasons) {
  std::uint32_t reasons = 0;
  NoteSafety level = NoteSafety::kSafe;
  std::optional<int> resolve_to;
  auto raise = [&](NoteSafety l) {
    if (l > level) {
      level = l;
    }
  };
  NoteSafety avoid_severity =
      q.profile == SafetyProfile::kStrict ? NoteSafety::kDissonant : NoteSafety::kWarning;
  NoteSafety parallel_severity = avoid_severity;

  if ((q.vocalLow && pitch < *q.vocalLow) || (q.vocalHigh && pitch > *q.vocalHigh)) {
    reasons |= bit(ReasonFlag::kOutOfRange);
    raise(NoteSafety::kWarning);
  }

  bool in_scale = is_scale_tone(pitch, q.key);
  const Chord* chord = q.chord ? &*q.chord : nullptr;
  if (chord != nullptr && !share.facts) {
    share.facts = chord_facts_of(*chord);
  }
  const ChordFacts* facts = share.facts ? &*share.facts : nullptr;
  bool member = facts != nullptr && sounds_in_mask(facts->mask, pitch);
  // Where the pitch sits above the root of a chord it is not a tone of.
  std::optional<int> ic;
  if (facts != nullptr && !member) {
    ic = interval_above_root(pitch, *facts->chord);
  }

  // A chromatic avoid note remains chromatic: the avoid-note branch below refines the resolution
  // guidance but must not erase the key relationship.
  if (!in_scale && !member) {
    reasons |= bit(ReasonFlag::kNonScale);
    raise(NoteSafety::kDissonant);
  }

  if (member) {
    reasons |= bit(ReasonFlag::kChordTone);
  } else if (ic) {
    bool is_tension = *ic == 2 || *ic == 5 || *ic == 9;
    bool avoid = (*ic == 5 && facts->avoids_fourth) || (*ic == 11 && facts->avoids_major_seventh);
    if (avoid) {
      reasons |= bit(ReasonFlag::kAvoidNote);
      if (is_tension) {
        reasons |= bit(ReasonFlag::kTension);
      }
      reasons |= bit(ReasonFlag::kNeedsResolution);
      resolve_to = step_resolution(pitch, *facts);
      raise(avoid_severity);
    } else if (is_tension && in_scale) {
      reasons |= bit(ReasonFlag::kTension);
      raise(NoteSafety::kWarning);
    } else if (in_scale) {
      reasons |= bit(ReasonFlag::kScaleTone);
      raise(NoteSafety::kWarning);
    }
  } else if (in_scale) {
    reasons |= bit(ReasonFlag::kScaleTone);
    raise(NoteSafety::kWarning);
  }

  // Harmonic tritone against a chord tone. A chord tone is never flagged for a tritone its own
  // chord spells: the interval is the chord's identity, not a clash with it.
  if (ic && ((facts->offsets >> ((*ic + 6) % 12)) & 1) == 1) {
    reasons |= bit(ReasonFlag::kTritone);
  }

  if (q.prevPitch) {
    // Quality flags reduce the melodic interval to its pitch-class interval so compound intervals
    // are treated like their simple form; the forbidden-leap flag defers to the counterpoint
    // rule, which keeps the octave boundary.
    double pc = std::fmod(std::fabs(pitch - *q.prevPitch), 12);
    if (pc == 6) {
      reasons |= bit(ReasonFlag::kMelodicTritone);
      raise(q.profile == SafetyProfile::kStrict ? NoteSafety::kDissonant : NoteSafety::kWarning);
    }
    if (is_forbidden_melodic_leap(*q.prevPitch, pitch)) {
      reasons |= bit(ReasonFlag::kLargeLeap);
      raise(parallel_severity);
    }
    if (pc == 1) {
      reasons |= bit(ReasonFlag::kMinorSecond);
    }
    if (pc == 11) {
      reasons |= bit(ReasonFlag::kMajorSeventh);
    }
  }

  // The texture's outer voices, as sounding now. With one other voice both voices are outer,
  // which is the two-voice reading.
  int bass = pitch;
  int top = pitch;
  for (const VoiceSnapshot& ov : q.otherVoices) {
    bass = std::min<int>(bass, ov.pitch);
    top = std::max<int>(top, ov.pitch);
  }

  std::vector<std::uint32_t> pair_reasons;
  if (collect_partners) {
    pair_reasons.assign(q.otherVoices.size(), 0);
  }
  auto flag_pair = [&](std::size_t index, ReasonFlag flag) {
    reasons |= bit(flag);
    if (collect_partners) {
      pair_reasons[index] |= bit(flag);
    }
  };

  if (q.strongBeat) {
    for (std::size_t index = 0; index < q.otherVoices.size(); ++index) {
      const VoiceSnapshot& ov = q.otherVoices[index];
      // A fourth is dissonant against the bass and consonant between upper voices.
      bool against_bass = pitch == bass || ov.pitch == bass;
      if (!creates_vertical_dissonance(pitch, ov.pitch, against_bass)) {
        continue;
      }
      if (facts != nullptr && is_structural_chord_dissonance(pitch, ov.pitch, *facts)) {
        continue;
      }
      // Pop reads a fourth between two chord tones as the chord in inversion; strict keeps the
      // six-four a dissonance.
      if (facts != nullptr && q.profile == SafetyProfile::kPop &&
          pitch_class_of(std::abs(pitch - ov.pitch)) == 5 && member &&
          sounds_in_mask(facts->mask, ov.pitch)) {
        continue;
      }
      flag_pair(index, ReasonFlag::kVerticalDissonance);
      raise(NoteSafety::kDissonant);
      // A held pitch that was consonant on the previous step and is now dissonant against the
      // same voice is a prepared suspension.
      if (q.prevPitch && pitch == *q.prevPitch && ov.prevPitch &&
          !creates_vertical_dissonance(*q.prevPitch, *ov.prevPitch, against_bass)) {
        flag_pair(index, ReasonFlag::kSuspension);
      }
    }
  }

  if (q.prevPitch) {
    int prev = *q.prevPitch;
    for (std::size_t index = 0; index < q.otherVoices.size(); ++index) {
      const VoiceSnapshot& ov = q.otherVoices[index];
      if (!ov.prevPitch) {
        continue;
      }
      // creates_parallel_perfect covers every perfect class, so no separate octave check is
      // needed.
      if (creates_parallel_perfect(prev, pitch, *ov.prevPitch, ov.pitch)) {
        flag_pair(index, ReasonFlag::kParallelPerfect);
        raise(parallel_severity);
      }
      // A hidden perfect is exposed only between the outer voices; between inner ones the others
      // cover it, as the part-writing check reads it.
      bool outer_pair = (pitch == top && ov.pitch == bass) || (pitch == bass && ov.pitch == top);
      if (outer_pair && creates_hidden_parallel_perfect(prev, pitch, *ov.prevPitch, ov.pitch)) {
        flag_pair(index, ReasonFlag::kHiddenParallel);
        raise(parallel_severity);
      }
      int crossed_now = pitch - ov.pitch;
      int crossed_prev = prev - *ov.prevPitch;
      if (crossed_now != 0 && crossed_prev != 0 && (crossed_now > 0) != (crossed_prev > 0)) {
        flag_pair(index, ReasonFlag::kVoiceCrossing);
        raise(parallel_severity);
      }
    }
  }

  // Reason production and verdict policy stay one invariant: every policy flag contributes at
  // least its table severity, while the informational ones may coexist with Safe.
  raise(minimum_safety_for_reasons(reasons, q.profile));

  SafetyResult result;
  result.safety = level;
  result.reasons = static_cast<int>(reasons);
  if (describe_reasons) {
    result.rationale = describe(reasons, q);
  }
  result.resolveTo = resolve_to;
  if (collect_suggestions && level != NoteSafety::kSafe) {
    std::vector<int> suggestions = find_safe_nearby(q, pitch, share);
    if (!suggestions.empty()) {
      result.suggestions = std::move(suggestions);
    }
  }
  if (collect_partners) {
    std::vector<SafetyPartner> partners;
    for (std::size_t index = 0; index < pair_reasons.size(); ++index) {
      if (pair_reasons[index] != 0) {
        partners.push_back(
            SafetyPartner{static_cast<int>(index), static_cast<int>(pair_reasons[index])});
      }
    }
    if (!partners.empty()) {
      result.partners = std::move(partners);
    }
  }
  return result;
}

const ProfileWeights& base_weights(SafetyProfile profile) {
  return PROFILE_WEIGHTS[static_cast<std::size_t>(profile)].weights;
}

}  // namespace

const std::vector<NamedProfileWeights> PROFILE_WEIGHTS(std::begin(kProfileWeightRows),
                                                       std::end(kProfileWeightRows));

std::string_view to_string(SafetyProfile profile) {
  return PROFILE_WEIGHTS[static_cast<std::size_t>(profile)].name;
}

std::optional<SafetyProfile> parse_safety_profile(std::string_view name) {
  return parse_named<SafetyProfile>(PROFILE_WEIGHTS, name, &NamedProfileWeights::name);
}

namespace {

/** A weight field: its name, the override member that sets it and the weight it sets. */
struct WeightField {
  std::string_view name;
  std::optional<double> ProfileWeightOverrides::*override_member;
  double ProfileWeights::*weight;
};

/** The weight fields, in the order of the weight table. */
constexpr WeightField kWeightFields[] = {
    {"imperfectConsonance", &ProfileWeightOverrides::imperfectConsonance,
     &ProfileWeights::imperfectConsonance},
    {"perfectConsonance", &ProfileWeightOverrides::perfectConsonance,
     &ProfileWeights::perfectConsonance},
    {"dissonance", &ProfileWeightOverrides::dissonance, &ProfileWeights::dissonance},
    {"chordTone", &ProfileWeightOverrides::chordTone, &ProfileWeights::chordTone},
    {"contraryMotion", &ProfileWeightOverrides::contraryMotion, &ProfileWeights::contraryMotion},
    {"obliqueMotion", &ProfileWeightOverrides::obliqueMotion, &ProfileWeights::obliqueMotion},
    {"similarMotion", &ProfileWeightOverrides::similarMotion, &ProfileWeights::similarMotion},
    {"parallelImperfect", &ProfileWeightOverrides::parallelImperfect,
     &ProfileWeights::parallelImperfect},
    {"stepwise", &ProfileWeightOverrides::stepwise, &ProfileWeights::stepwise},
    {"melodicDistance", &ProfileWeightOverrides::melodicDistance, &ProfileWeights::melodicDistance},
    {"forbiddenLeap", &ProfileWeightOverrides::forbiddenLeap, &ProfileWeights::forbiddenLeap},
    {"registerDrift", &ProfileWeightOverrides::registerDrift, &ProfileWeights::registerDrift},
};

}  // namespace

ProfileWeights profile_weights(SafetyProfile profile, const ProfileWeightOverrides& overrides) {
  ProfileWeights weights = base_weights(profile);
  for (const WeightField& field : kWeightFields) {
    const std::optional<double>& value = overrides.*field.override_member;
    if (value) {
      weights.*field.weight = assert_finite_number(*value, "weight " + std::string(field.name));
    }
  }
  return weights;
}

std::optional<double> ProfileWeightOverrides::*weight_override_member(std::string_view field) {
  for (const WeightField& entry : kWeightFields) {
    if (entry.name == field) {
      return entry.override_member;
    }
  }
  return nullptr;
}

std::vector<std::pair<std::string_view, double>> named_weight_overrides(
    const ProfileWeightOverrides& overrides) {
  std::vector<std::pair<std::string_view, double>> named;
  for (const WeightField& entry : kWeightFields) {
    if (overrides.*entry.override_member) {
      named.emplace_back(entry.name, *(overrides.*entry.override_member));
    }
  }
  return named;
}

SafetyResult evaluate_safety(const SafetyQuery& query, const EvaluateSafetyOptions& opts) {
  assert_safety_context(query);
  assert_midi_pitch(query.candidatePitch, "candidatePitch");
  QueryShare share;
  return evaluate_internal(query, query.candidatePitch, opts.suggestions.value_or(true),
                           opts.partners.value_or(false), share);
}

std::vector<double> enumerate_safe_pitches(const SafetyContext& context, double pitch_low,
                                           double pitch_high) {
  assert_safety_context(context);
  std::vector<double> chord_tones;
  std::vector<double> others;
  // The bounds are MIDI pitches, and so is everything enumerated between them: a pitch outside
  // 0..127 cannot be written to a note event, so it is refused here.
  assert_midi_pitch(pitch_low, "pitchLow");
  assert_midi_pitch(pitch_high, "pitchHigh");
  if (pitch_low > pitch_high) {
    throw InvalidInputError("pitchLow must not exceed pitchHigh; received " +
                            js::to_string(pitch_low) + " > " + js::to_string(pitch_high));
  }
  assert_generation_budget(pitch_high - pitch_low + 1, "safe pitch candidates");
  double low = js::max(pitch_low, context.vocalLow.value_or(pitch_low));
  double high = js::min(pitch_high, context.vocalHigh.value_or(pitch_high));
  QueryShare share;
  for (double pitch = high; pitch >= low; pitch -= 1) {
    SafetyResult result =
        evaluate_internal(context, static_cast<int>(pitch), false, false, share, false);
    if (result.safety == NoteSafety::kDissonant) {
      continue;
    }
    if ((static_cast<std::uint32_t>(result.reasons) & bit(ReasonFlag::kChordTone)) != 0) {
      chord_tones.push_back(pitch);
    } else {
      others.push_back(pitch);
    }
  }
  chord_tones.insert(chord_tones.end(), others.begin(), others.end());
  return chord_tones;
}

}  // namespace cantus
