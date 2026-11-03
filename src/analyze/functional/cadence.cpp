// Cadence detection between two successive chords: ts/src/analyze/functional/cadence.ts.

#include "analyze/functional/cadence.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <string>
#include <string_view>

#include "analyze/functional/internal.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "core/validation/validation.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

constexpr std::size_t kTypeCount = static_cast<std::size_t>(CadenceType::kModal) + 1;

/** CADENCE_TYPES, indexed by CadenceType. */
constexpr std::array<std::string_view, kTypeCount> kCadenceTypeNames = {
#include "analyze/functional/cadence_types.gen.inc"
};
static_assert(!kCadenceTypeNames.back().empty(), "CADENCE_TYPES and CadenceType disagree");

constexpr std::array<std::string_view, 2> kStrengthNames = {"perfect", "imperfect"};

/**
 * How far above the tonic a scale degree lies, read in the heptatonic frame the key's degrees are
 * numbered in (`degreeOffset`).
 */
int degree_offset(int degree_number, const KeyScale& key) {
  return pitch_class_of(degree_root_pc(degree_number, roman_reference(key)) - key.rootPc);
}

/** Whether the chord's own third, major or minor, is a tone of the key (`thirdBelongsToKey`). */
bool third_belongs_to_key(const Chord& chord, const KeyScale& key) {
  return std::any_of(chord.intervals.begin(), chord.intervals.end(), [&](double interval) {
    int reduced = pitch_class_of(interval);
    return (reduced == 3 || reduced == 4) &&
           is_scale_tone(pitch_class_of(chord.rootPc + interval), key);
  });
}

/** The offsets a deceptive cadence may land on (`deceptiveTargets`). */
std::vector<int> deceptive_targets(const KeyScale& key) {
  int submediant = degree_offset(CADENCE_SUBMEDIANT_DEGREE, key);
  if (is_minor_scale(key)) {
    return {submediant};
  }
  int borrowed = degree_offset(CADENCE_SUBMEDIANT_DEGREE, parallel_scale(key));
  if (borrowed == submediant) {
    return {submediant};
  }
  return {submediant, borrowed};
}

/** Whether an arrival on the dominant degree rests there as a half cadence (`restsOnDominant`). */
bool rests_on_dominant(const Chord& to, const KeyScale& key) {
  if (has_major_third(to) || is_dominant_chord_of(to, key)) {
    return true;
  }
  std::optional<ScaleSystem> system = scale_system_of(key);
  if (!system || *system != ScaleSystem::kModal) {
    return false;
  }
  int dominant_pc = pitch_class_of(key.rootPc + degree_offset(CADENCE_DOMINANT_DEGREE, key));
  bool leading_tone_dominant = is_scale_tone(pitch_class_of(dominant_pc + 4), key);
  return !leading_tone_dominant && third_belongs_to_key(to, key);
}

/** Whether a chord is the key's tonic triad standing on its own fifth (`isTonicSixFour`). */
bool is_tonic_six_four(const Chord& chord, const KeyScale& key) {
  if (pitch_class_of(chord.rootPc - key.rootPc) != 0 || !chord.bassPc) {
    return false;
  }
  bool is_triad = chord.intervals.size() == 3 &&
                  std::any_of(chord.intervals.begin(), chord.intervals.end(),
                              [](double interval) { return pitch_class_of(interval) == 7; });
  return is_triad && pitch_class_of(*chord.bassPc - chord.rootPc) == 7;
}

/** The lowest and highest sounding pitches of a voicing (`outerPitches`). */
struct OuterPitches {
  std::optional<double> bass;
  std::optional<double> soprano;
};

OuterPitches outer_pitches(const std::vector<double>& voicing) {
  OuterPitches out;
  for (double pitch : voicing) {
    // Non-finite entries name no pitch, so they are skipped.
    if (!std::isfinite(pitch)) {
      continue;
    }
    if (!out.bass || pitch < *out.bass) {
      out.bass = pitch;
    }
    if (!out.soprano || pitch > *out.soprano) {
      out.soprano = pitch;
    }
  }
  return out;
}

/** The pitch class sounding in a chord's bass (`bassPcOf`). */
int bass_pc_of(const Chord& chord, const std::optional<double>& voiced_bass) {
  if (voiced_bass) {
    return pitch_class_of(*voiced_bass);
  }
  return pitch_class_of(chord.bassPc ? *chord.bassPc : chord.rootPc);
}

/** Classify the motion between two chords, before inversion is weighed (`cadenceType`). */
Nullable<CadenceType> cadence_type(const Chord& from, const Chord& to, const KeyScale& key,
                                   int from_bass_pc, int to_bass_pc) {
  int tonic = pitch_class_of(key.rootPc);
  int from_offset = pitch_class_of(from.rootPc - tonic);
  int to_offset = pitch_class_of(to.rootPc - tonic);
  bool dominant = is_dominant_chord_of(from, key);
  if ((dominant || is_leading_tone_chord_of(from, key)) && to_offset == 0) {
    return CadenceType::kAuthentic;
  }
  // The subdominant is the chord on the key's own fourth degree, which lydian puts a tritone above
  // the tonic.
  if (from_offset == degree_offset(CADENCE_SUBDOMINANT_DEGREE, key) && to_offset == 0) {
    return CadenceType::kPlagal;
  }
  // bVII to I: the modal cadence of rock and pop, which has no leading tone at all.
  if (from_offset == 10 && to_offset == 0 && has_major_third(from)) {
    return CadenceType::kModal;
  }
  if (dominant) {
    std::vector<int> targets = deceptive_targets(key);
    if (std::find(targets.begin(), targets.end(), to_offset) != targets.end()) {
      return CadenceType::kDeceptive;
    }
  }
  // A move to the dominant is a half cadence, but a no-root-motion V-to-V repeat is not a cadence.
  int dominant_offset = degree_offset(CADENCE_DOMINANT_DEGREE, key);
  bool half =
      to_offset == dominant_offset && rests_on_dominant(to, key) && from_offset != dominant_offset;
  // The Phrygian cadence is that half cadence approached by a semitone descent in the bass.
  if (half && is_minor_scale(key) && from_offset == 5 &&
      pitch_class_of(from_bass_pc - tonic) == 8 && pitch_class_of(to_bass_pc - tonic) == 7) {
    return CadenceType::kPhrygian;
  }
  if (half) {
    return CadenceType::kHalf;
  }
  return std::nullopt;
}

/** Perfect or imperfect, for a cadence already known to be authentic (`authenticStrength`). */
Nullable<CadenceStrength> authentic_strength(bool leading_tone, bool root_position, bool voiced,
                                             const Nullable<ChordToneRole>& soprano) {
  if (leading_tone || !root_position) {
    return CadenceStrength::kImperfect;
  }
  if (!voiced) {
    return std::nullopt;
  }
  return soprano && *soprano == ChordToneRole::kRoot ? CadenceStrength::kPerfect
                                                     : CadenceStrength::kImperfect;
}

/** The facts a rationale and its rejected rivals are phrased from (`CadenceFacts`). */
struct CadenceFacts {
  Nullable<CadenceType> type;
  Nullable<CadenceStrength> strength;
  bool rootPosition = false;
  bool evaded = false;
  /** The approach is a leading-tone chord standing in for the dominant. */
  bool leadingTone = false;
  int fromOffset = 0;
  int toOffset = 0;
  bool minor = false;
  /** The arrival stands on the fifth degree, whatever its third. */
  bool onFifthDegree = false;
  /** The dominant was reached as a cadential six-four over its own bass. */
  bool sixFour = false;
  /** The pair is that six-four resolving inside the dominant it stands on. */
  bool withinSixFour = false;
};

/** Which of the three conditions of a perfect authentic cadence went unmet (`imperfectReason`). */
std::string imperfect_reason(const CadenceFacts& facts) {
  if (facts.leadingTone) {
    return "the dominant root never sounds under the leading-tone chord";
  }
  if (!facts.rootPosition) {
    return "a chord stands on something other than its own root";
  }
  return "the soprano does not land on the tonic";
}

/** The rationale for a pair that forms no cadence at all (`describeNonCadence`). */
std::string describe_non_cadence(const CadenceFacts& facts) {
  if (facts.fromOffset == facts.toOffset) {
    return "No cadence: the harmony repeats, so there is no root motion to cadence with";
  }
  if (facts.toOffset == 0) {
    return "No cadence: the tonic is approached by none of the chords that cadence onto it";
  }
  if (facts.onFifthDegree) {
    return "No cadence: the arrival stands on the fifth degree but sounds no third the key rests "
           "on, so it is not the dominant a half cadence comes to";
  }
  return "No cadence: the motion arrives on neither the tonic nor the dominant";
}

/** Build the rationale for a classified pair (`describeCadence`). */
std::string describe_cadence(const CadenceFacts& facts) {
  std::string text;
  if (!facts.type) {
    text = describe_non_cadence(facts);
  } else {
    switch (*facts.type) {
      case CadenceType::kAuthentic: {
        std::string approach = facts.leadingTone ? "leading-tone chord" : "dominant";
        std::string head = "Authentic cadence: the " + approach + " resolves onto the tonic";
        if (facts.strength && *facts.strength == CadenceStrength::kPerfect) {
          text = head + ", perfect with both chords on their roots and the tonic in the soprano";
        } else if (facts.strength) {
          text = head + ", imperfect because " + imperfect_reason(facts);
        } else {
          text = head +
                 "; no voicing names the soprano, so it is graded neither perfect nor "
                 "imperfect";
        }
        break;
      }
      case CadenceType::kPlagal:
        text = "Plagal cadence: the subdominant falls onto the tonic";
        break;
      case CadenceType::kModal:
        text =
            "Modal cadence: the major triad on the subtonic rises onto the tonic with no leading "
            "tone";
        break;
      case CadenceType::kDeceptive:
        text = "Deceptive cadence: the dominant resolves onto the submediant in place of the tonic";
        break;
      case CadenceType::kPhrygian:
        text =
            "Phrygian cadence: the bass falls a semitone from the lowered submediant onto the "
            "dominant, and the motion rests there";
        break;
      case CadenceType::kHalf:
        text = facts.withinSixFour
                   ? "Half cadence: the motion comes to rest on the dominant, which the tonic "
                     "six-four standing on its bass was already sounding"
                   : "Half cadence: the motion comes to rest on the dominant";
        break;
    }
  }
  if (facts.evaded) {
    text += "; the tonic arrives inverted, so the arrival the ear was promised is withheld";
  }
  // The six-four is the dominant already, so the cadence is one event that started when it sounded.
  if (facts.sixFour) {
    return text +
           "; the dominant was reached as a cadential six-four, a double appoggiatura over the "
           "same bass, so the cadence begins there rather than at the dominant's own arrival";
  }
  return text;
}

/** The cadences the pair came close to forming, and why each was turned down. */
std::vector<RejectedCandidate> cadence_alternatives(const CadenceFacts& facts) {
  std::vector<RejectedCandidate> out;
  if (facts.type && *facts.type == CadenceType::kDeceptive) {
    out.push_back(RejectedCandidate{
        "authentic",
        "The dominant was prepared, but the arrival is the submediant rather than the tonic"});
  } else if ((!facts.type || *facts.type != CadenceType::kAuthentic) && facts.toOffset == 0) {
    out.push_back(RejectedCandidate{
        "authentic",
        "The arrival is the tonic, but the chord before it is neither the dominant nor a "
        "leading-tone chord"});
  }
  if (facts.type && *facts.type == CadenceType::kAuthentic &&
      !(facts.strength && *facts.strength == CadenceStrength::kPerfect)) {
    out.push_back(RejectedCandidate{
        "perfect authentic",
        !facts.strength
            ? "The chords meet every condition a voicing can be judged without, but no voicing "
              "names the soprano"
            : "The cadence is authentic, but " + imperfect_reason(facts)});
  }
  if (facts.type && *facts.type == CadenceType::kHalf && facts.minor && facts.fromOffset == 5) {
    out.push_back(RejectedCandidate{
        "phrygian",
        "The dominant is approached from the subdominant, but the bass does not fall a semitone "
        "from the lowered submediant onto it"});
  }
  if (!facts.type && facts.onFifthDegree && facts.fromOffset != facts.toOffset) {
    out.push_back(RejectedCandidate{
        "half",
        "The arrival stands on the fifth degree, but a half cadence rests on the dominant the key "
        "has: the major third, or the mode's own third where that dominant carries no leading "
        "tone"});
  }
  return out;
}

}  // namespace

std::string_view to_string(CadenceType type) {
  return kCadenceTypeNames[static_cast<std::size_t>(type)];
}

std::optional<CadenceType> parse_cadence_type(std::string_view name) {
  return parse_named<CadenceType>(kCadenceTypeNames, name);
}

std::vector<CadenceType> cadence_types() { return enumerators_of<CadenceType>(kCadenceTypeNames); }

std::string_view to_string(CadenceStrength strength) {
  return kStrengthNames[static_cast<std::size_t>(strength)];
}

bool is_cadential_six_four(const Chord& chord, const Chord& next, const KeyScale& key) {
  return is_tonic_six_four(chord, key) && is_dominant_chord_of(next, key) &&
         pitch_class_of(chord.bassPc ? *chord.bassPc : chord.rootPc) ==
             pitch_class_of(next.bassPc ? *next.bassPc : next.rootPc);
}

CadenceResult cadence_between(const Chord& from, const Chord& to, const KeyScale& key,
                              const CadenceOptions& opts) {
  static const std::vector<double> kNoVoicing;
  const std::vector<double>& from_voicing = opts.voicing ? (*opts.voicing)[0] : kNoVoicing;
  const std::vector<double>& to_voicing = opts.voicing ? (*opts.voicing)[1] : kNoVoicing;
  OuterPitches from_outer = outer_pitches(from_voicing);
  OuterPitches to_outer = outer_pitches(to_voicing);
  int from_bass_pc = bass_pc_of(from, from_outer.bass);
  int to_bass_pc = bass_pc_of(to, to_outer.bass);
  bool to_root_position = to_bass_pc == pitch_class_of(to.rootPc);
  bool root_position = from_bass_pc == pitch_class_of(from.rootPc) && to_root_position;
  Nullable<ChordToneRole> soprano;
  if (to_outer.soprano) {
    soprano = chord_tone_role(*to_outer.soprano, to);
  }

  Nullable<CadenceType> type = cadence_type(from, to, key, from_bass_pc, to_bass_pc);
  bool leading_tone = is_leading_tone_chord_of(from, key);
  CadenceFacts facts;
  facts.type = type;
  if (type && *type == CadenceType::kAuthentic) {
    facts.strength =
        authentic_strength(leading_tone, root_position, to_outer.soprano.has_value(), soprano);
  }
  facts.rootPosition = root_position;
  // The dominant resolved, but onto an inverted tonic: the arrival the ear was promised is the one
  // it does not get.
  facts.evaded = type && *type == CadenceType::kAuthentic && !to_root_position;
  facts.leadingTone = leading_tone;
  facts.fromOffset = pitch_class_of(from.rootPc - key.rootPc);
  facts.toOffset = pitch_class_of(to.rootPc - key.rootPc);
  facts.minor = is_minor_scale(key);
  facts.onFifthDegree = facts.toOffset == degree_offset(CADENCE_DOMINANT_DEGREE, key);
  facts.sixFour = opts.approach && is_cadential_six_four(*opts.approach, from, key);
  facts.withinSixFour = is_cadential_six_four(from, to, key);

  CadenceResult result;
  result.type = facts.type;
  result.strength = facts.strength;
  result.rootPosition = facts.rootPosition;
  result.evaded = facts.evaded;
  result.rationale = describe_cadence(facts);
  if (opts.alternatives == true) {
    result.alternatives = cadence_alternatives(facts);
  }
  if (soprano) {
    result.soprano = *soprano;
  }
  return result;
}

CadenceResult detect_cadence(const ChordArg& from, const ChordArg& to, const KeyArg& key,
                             const DetectCadenceOptions& opts) {
  Chord from_data = to_chord_data(from);
  Chord to_data = to_chord_data(to);
  KeyScale scale = to_key_scale(key);
  CadenceOptions narrow;
  narrow.voicing = opts.voicing;
  narrow.alternatives = opts.alternatives;
  if (opts.approach) {
    narrow.approach = to_chord_data(*opts.approach);
  }
  return cadence_between(from_data, to_data, scale, narrow);
}

}  // namespace cantus
