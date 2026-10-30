// What a chord is to a key: ts/src/theory/tendency/index.ts.

#include "theory/tendency/tendency.h"

#include <algorithm>
#include <string_view>

#include "cantus/theory/scale.h"
#include "theory/scale/masks.h"
#include "theory/tendency/limits.gen.h"

namespace cantus {

namespace {

constexpr std::string_view kLeadingToneQualityNames[] =
#include "theory/tendency/leading_tone_quality_names.gen.inc"
    ;

constexpr int kThirdSemitones[] =
#include "theory/tendency/third_semitones.gen.inc"
    ;

std::vector<ChordQuality> leading_tone_qualities() {
  std::vector<ChordQuality> out;
  for (std::string_view name : kLeadingToneQualityNames) {
    out.push_back(*parse_chord_quality(name));
  }
  return out;
}

/** Whether a chord's template carries an interval, reduced to within an octave (`hasInterval`). */
bool has_interval(const Chord& chord, int semitones) {
  return std::any_of(chord.intervals.begin(), chord.intervals.end(),
                     [&](double interval) { return pitch_class_of(interval) == semitones; });
}

/** The third and fifth above a scale degree, measured within its own scale (`degreeTriad`). */
struct DegreeTriad {
  int third;
  int fifth;
};

DegreeTriad degree_triad(const std::vector<int>& tones, std::size_t index) {
  int root = tones[index];
  return DegreeTriad{pitch_class_of(tones[(index + 2) % tones.size()] - root),
                     pitch_class_of(tones[(index + 4) % tones.size()] - root)};
}

}  // namespace

const std::vector<ChordQuality> LEADING_TONE_QUALITIES = leading_tone_qualities();

bool is_diatonic_chord(const Chord& chord, const KeyScale& key) {
  std::vector<int> pcs = chord_pitch_classes(chord);
  return std::all_of(pcs.begin(), pcs.end(), [&](int pc) { return is_scale_tone(pc, key); });
}

bool has_major_third(const Chord& chord) { return has_interval(chord, 4); }

bool sounds_dominant_seventh(const Chord& chord) {
  return has_major_third(chord) && has_interval(chord, 10);
}

bool sounds_major_triad(const Chord& chord) {
  return has_major_third(chord) && !has_interval(chord, 10) && !has_interval(chord, 11);
}

bool has_dominant_sonority(const Chord& chord) {
  return sounds_major_triad(chord) || sounds_dominant_seventh(chord);
}

bool is_dominant_chord_of(const Chord& chord, const KeyScale& key) {
  if (pitch_class_of(chord.rootPc - key.rootPc) != 7) {
    return false;
  }
  if (has_major_third(chord)) {
    return true;
  }
  bool suspended = !has_interval(chord, 3) && (has_interval(chord, 5) || has_interval(chord, 2));
  return suspended && has_interval(chord, 10);
}

bool is_neapolitan_chord_of(const Chord& chord, const KeyScale& key) {
  return pitch_class_of(chord.rootPc - key.rootPc) == 1 && sounds_major_triad(chord) &&
         !is_diatonic_chord(chord, key);
}

KeyScale heptatonic_frame_of(const KeyScale& key) {
  if (scale_tones_in_degree_order(key).size() == 7) {
    return key;
  }
  return major_key(pitch_class_of(key.rootPc)).scale();
}

std::vector<TonicizableDegree> tonicizable_degrees(const KeyScale& key) {
  std::vector<int> tones = scale_tones_in_degree_order(heptatonic_frame_of(key));
  bool minor = is_minor_mask(key.modeMask12);
  std::vector<TonicizableDegree> out;
  for (std::size_t index = 0; index < tones.size(); ++index) {
    DegreeTriad triad = degree_triad(tones, index);
    if (triad.fifth != 7) {
      continue;
    }
    // The case follows the numeral the degree takes in this key: the fifth degree of a minor key
    // is a major V, since the key cadences through its raised seventh.
    bool dominant_degree = minor && static_cast<int>(index) + 1 == DOMINANT_DEGREE;
    out.push_back(TonicizableDegree{static_cast<int>(index) + 1, tones[index],
                                    triad.third == 3 && !dominant_degree});
  }
  return out;
}

Nullable<TonicizableDegree> applied_dominant_target(double root_pc, const KeyScale& key) {
  int target = pitch_class_of(root_pc);
  for (const TonicizableDegree& degree : tonicizable_degrees(key)) {
    if (degree.degreeNumber != 1 && degree.rootPc == target) {
      return degree;
    }
  }
  return std::nullopt;
}

bool cadences_through_raised_seventh(const KeyScale& key) {
  return is_minor_mask(key.modeMask12) && scale_system_of(key) == ScaleSystem::kCommonPractice;
}

int leading_tone_pc_of(const KeyScale& key) { return pitch_class_of(key.rootPc - 1); }

bool sounds_diminished_triad(const Chord& chord) {
  return has_interval(chord, 3) && has_interval(chord, 6) && !has_interval(chord, 7);
}

bool is_leading_tone_chord_of(const Chord& chord, const KeyScale& key) {
  return pitch_class_of(chord.rootPc) == leading_tone_pc_of(key) && sounds_diminished_triad(chord);
}

bool is_functioning_leading_tone(const Chord& chord, const KeyScale& key) {
  Nullable<ChordToneRole> role = chord_tone_role(leading_tone_pc_of(key), chord);
  if (role == ChordToneRole::kThird) {
    return pitch_class_of(chord.rootPc) == pitch_class_of(key.rootPc + 7);
  }
  if (role == ChordToneRole::kRoot) {
    return sounds_diminished_triad(chord);
  }
  return false;
}

std::optional<int> seventh_pc_of(const Chord& chord) {
  for (double interval : chord.intervals) {
    int pc = pitch_class_of(chord.rootPc + interval);
    if (chord_tone_role(pc, chord) == ChordToneRole::kSeventh) {
      return pc;
    }
  }
  return std::nullopt;
}

std::optional<int> fifth_pc_of(const Chord& chord) {
  for (double interval : chord.intervals) {
    int pc = pitch_class_of(chord.rootPc + interval);
    if (chord_tone_role(pc, chord) == ChordToneRole::kFifth) {
      return pc;
    }
  }
  return std::nullopt;
}

bool is_descending_step(const SpelledInterval& interval) {
  return interval.number == 2 && (interval.semitones == -1 || interval.semitones == -2);
}

bool is_frustrated_leading_tone(double from_pitch, double to_pitch, const Chord& next_chord) {
  double fall = from_pitch - to_pitch;
  if (std::find(std::begin(kThirdSemitones), std::end(kThirdSemitones), fall) ==
      std::end(kThirdSemitones)) {
    return false;
  }
  std::optional<int> fifth_pc = fifth_pc_of(next_chord);
  return fifth_pc && pitch_class_of(to_pitch) == *fifth_pc;
}

}  // namespace cantus
