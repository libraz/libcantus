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

/** Whether a dissonance between two chord tones is one the chord is built from
 * (`isStructuralChordDissonance`). */
bool is_structural_chord_dissonance(int a, int b, const Chord& chord) {
  int raw_class = pitch_class_of(std::abs(a - b));
  int a_offset = interval_above_root(a, chord);
  int b_offset = interval_above_root(b, chord);
  bool root_seventh = (a_offset == 0 && (b_offset == 10 || b_offset == 11)) ||
                      (b_offset == 0 && (a_offset == 10 || a_offset == 11));
  if (raw_class != 6 && !root_seventh) {
    return false;
  }
  return is_chord_member(a, chord) && is_chord_member(b, chord);
}

/** Nearest chord tone at or below the candidate, within two semitones (`stepResolution`). */
std::optional<int> step_resolution(int pitch, const Chord& chord) {
  for (int delta = 1; delta <= 2; ++delta) {
    if (is_chord_member(pitch - delta, chord)) {
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
                               bool collect_partners);

/** Safe alternative pitches near a rejected candidate, nearest first, the pitch below before the
 * one above (`findSafeNearby`). */
std::vector<int> find_safe_nearby(const SafetyContext& q, int candidate) {
  std::vector<int> out;
  for (int d = 1; d <= SUGGESTION_WINDOW; ++d) {
    for (int p : {candidate - d, candidate + d}) {
      if (p < 0 || p > 127) {
        continue;
      }
      if (evaluate_internal(q, p, false, false).safety == NoteSafety::kSafe) {
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
                               bool collect_partners) {
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

  // A chromatic avoid note remains chromatic: the avoid-note branch below refines the resolution
  // guidance but must not erase the key relationship.
  if (!in_scale && (chord == nullptr || !is_chord_member(pitch, *chord))) {
    reasons |= bit(ReasonFlag::kNonScale);
    raise(NoteSafety::kDissonant);
  }

  if (chord != nullptr && is_chord_member(pitch, *chord)) {
    reasons |= bit(ReasonFlag::kChordTone);
  } else if (chord != nullptr) {
    int ic = interval_above_root(pitch, *chord);
    bool is_tension = ic == 2 || ic == 5 || ic == 9;
    bool avoid = (ic == 5 && avoids_fourth(*chord)) || (ic == 11 && avoids_major_seventh(*chord));
    if (avoid) {
      reasons |= bit(ReasonFlag::kAvoidNote);
      if (is_tension) {
        reasons |= bit(ReasonFlag::kTension);
      }
      reasons |= bit(ReasonFlag::kNeedsResolution);
      resolve_to = step_resolution(pitch, *chord);
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
  if (chord != nullptr && !is_chord_member(pitch, *chord)) {
    int ic = interval_above_root(pitch, *chord);
    for (double interval : chord->intervals) {
      double offset = std::fmod(std::fmod(interval, 12) + 12, 12);
      if (std::fabs(ic - offset) == 6) {
        reasons |= bit(ReasonFlag::kTritone);
        break;
      }
    }
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
      if (chord != nullptr && is_structural_chord_dissonance(pitch, ov.pitch, *chord)) {
        continue;
      }
      // Pop reads a fourth between two chord tones as the chord in inversion; strict keeps the
      // six-four a dissonance.
      if (chord != nullptr && q.profile == SafetyProfile::kPop &&
          pitch_class_of(std::abs(pitch - ov.pitch)) == 5 && is_chord_member(pitch, *chord) &&
          is_chord_member(ov.pitch, *chord)) {
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
  result.rationale = describe(reasons, q);
  result.resolveTo = resolve_to;
  if (collect_suggestions && level != NoteSafety::kSafe) {
    std::vector<int> suggestions = find_safe_nearby(q, pitch);
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
  for (std::size_t index = 0; index < PROFILE_WEIGHTS.size(); ++index) {
    if (PROFILE_WEIGHTS[index].name == name) {
      return static_cast<SafetyProfile>(index);
    }
  }
  return std::nullopt;
}

ProfileWeights profile_weights(SafetyProfile profile, const ProfileWeightOverrides& overrides) {
  ProfileWeights weights = base_weights(profile);
  auto apply = [](double& target, const std::optional<double>& value, std::string_view field) {
    if (value) {
      target = assert_finite_number(*value, "weight " + std::string(field));
    }
  };
  apply(weights.imperfectConsonance, overrides.imperfectConsonance, "imperfectConsonance");
  apply(weights.perfectConsonance, overrides.perfectConsonance, "perfectConsonance");
  apply(weights.dissonance, overrides.dissonance, "dissonance");
  apply(weights.chordTone, overrides.chordTone, "chordTone");
  apply(weights.contraryMotion, overrides.contraryMotion, "contraryMotion");
  apply(weights.obliqueMotion, overrides.obliqueMotion, "obliqueMotion");
  apply(weights.similarMotion, overrides.similarMotion, "similarMotion");
  apply(weights.parallelImperfect, overrides.parallelImperfect, "parallelImperfect");
  apply(weights.stepwise, overrides.stepwise, "stepwise");
  apply(weights.melodicDistance, overrides.melodicDistance, "melodicDistance");
  apply(weights.forbiddenLeap, overrides.forbiddenLeap, "forbiddenLeap");
  apply(weights.registerDrift, overrides.registerDrift, "registerDrift");
  return weights;
}

namespace {

/** The weight fields, in the order of the weight table, with the override member of each. */
constexpr std::pair<std::string_view, std::optional<double> ProfileWeightOverrides::*>
    kWeightOverrideFields[] = {
        {"imperfectConsonance", &ProfileWeightOverrides::imperfectConsonance},
        {"perfectConsonance", &ProfileWeightOverrides::perfectConsonance},
        {"dissonance", &ProfileWeightOverrides::dissonance},
        {"chordTone", &ProfileWeightOverrides::chordTone},
        {"contraryMotion", &ProfileWeightOverrides::contraryMotion},
        {"obliqueMotion", &ProfileWeightOverrides::obliqueMotion},
        {"similarMotion", &ProfileWeightOverrides::similarMotion},
        {"parallelImperfect", &ProfileWeightOverrides::parallelImperfect},
        {"stepwise", &ProfileWeightOverrides::stepwise},
        {"melodicDistance", &ProfileWeightOverrides::melodicDistance},
        {"forbiddenLeap", &ProfileWeightOverrides::forbiddenLeap},
        {"registerDrift", &ProfileWeightOverrides::registerDrift},
};

}  // namespace

std::optional<double> ProfileWeightOverrides::*weight_override_member(std::string_view field) {
  for (const auto& [name, member] : kWeightOverrideFields) {
    if (name == field) {
      return member;
    }
  }
  return nullptr;
}

std::vector<std::pair<std::string_view, double>> named_weight_overrides(
    const ProfileWeightOverrides& overrides) {
  std::vector<std::pair<std::string_view, double>> named;
  for (const auto& [name, member] : kWeightOverrideFields) {
    if (overrides.*member) {
      named.emplace_back(name, *(overrides.*member));
    }
  }
  return named;
}

SafetyResult evaluate_safety(const SafetyQuery& query, const EvaluateSafetyOptions& opts) {
  assert_safety_context(query);
  assert_midi_pitch(query.candidatePitch, "candidatePitch");
  return evaluate_internal(query, query.candidatePitch, opts.suggestions.value_or(true),
                           opts.partners.value_or(false));
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
  for (double pitch = high; pitch >= low; pitch -= 1) {
    SafetyResult result = evaluate_internal(context, static_cast<int>(pitch), false, false);
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
