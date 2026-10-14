// The degree reading of ts/src/generate/bass/degrees.ts.

#include "generate/bass/degrees.h"

#include <array>
#include <cmath>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/chordscale.h"
#include "cantus/theory/scale.h"
#include "generate/bass/limits.gen.h"
#include "theory/chord/chord.h"

namespace cantus {

namespace {

/** Semitones above the root for each degree of a major scale, 1-based. */
constexpr int kMajorSemitones[] =
#include "generate/bass/major_degree_semitones.gen.inc"
    ;

/** `table[index]` of a seven-entry array: absent for an index that names no entry. */
bool is_degree_index(double index) {
  return std::trunc(index) == index && index >= 0 && index < BASS_HEPTATONIC_SIZE;
}

/** The tone standing in the place of a degree the chord replaced (`replacedDegreeSemitone`). */
std::optional<double> replaced_degree_semitone(double degree, const Chord& chord) {
  if (degree != 3) {
    return std::nullopt;
  }
  auto sounds = [&chord](int semitones) {
    for (double interval : chord.intervals) {
      if (pitch_class_of(interval) == semitones) {
        return true;
      }
    }
    return false;
  };
  if (sounds(3) || sounds(4)) {
    return std::nullopt;
  }
  if (sounds(5)) {
    return 5;
  }
  if (sounds(2)) {
    return 2;
  }
  return std::nullopt;
}

}  // namespace

std::optional<double> chord_degree_semitone(double degree, const Chord& chord) {
  for (double interval : chord.intervals) {
    std::optional<int> found = degree_of_interval(interval, chord);
    if (found && *found == degree) {
      return interval;
    }
  }
  return std::nullopt;
}

std::optional<std::vector<int>> implied_scale_tones(const Chord& chord,
                                                    const std::string* unknown_quality) {
  if (!chord_degree_semitone(7, chord)) {
    return std::nullopt;
  }
  if (unknown_quality != nullptr) {
    throw InvalidInputError("Unknown chord quality: " + *unknown_quality);
  }
  for (const ChordScaleMatch& match : chord_scales(chord)) {
    std::optional<int> mask = named_scale_mask(match.name);
    if (!mask) {
      continue;
    }
    std::vector<int> tones;
    for (int offset = 0; offset < 12; ++offset) {
      if (((*mask >> offset) & 1) == 1) {
        tones.push_back(offset);
      }
    }
    if (static_cast<int>(tones.size()) == BASS_HEPTATONIC_SIZE) {
      return tones;
    }
  }
  return std::nullopt;
}

double degree_semitone(double degree, double alter, const Chord& chord, const KeyScale& key,
                       const std::optional<std::vector<int>>& implied) {
  double octaves = std::floor((degree - 1) / 7);
  double within = std::fmod(degree - 1, 7) + 1;
  double template_semitone =
      is_degree_index(within - 1) ? kMajorSemitones[static_cast<int>(within - 1)] : 0;
  double semitone;
  if (alter != 0) {
    semitone = template_semitone;
  } else if (std::optional<double> own = chord_degree_semitone(within, chord)) {
    semitone = *own;
  } else if (std::optional<double> replaced = replaced_degree_semitone(within, chord)) {
    semitone = *replaced;
  } else if (implied && is_degree_index(within - 1)) {
    semitone = (*implied)[static_cast<std::size_t>(within - 1)];
  } else {
    // A degree neither the chord nor its quality settles is a passing tone, so the key decides.
    semitone = nearest_scale_tone(chord.rootPc + template_semitone, key) - chord.rootPc;
  }
  return pitch_class_of(semitone) + 12 * octaves + alter;
}

}  // namespace cantus
