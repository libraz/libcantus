// What the stages of the harmonizer share: ts/src/generate/harmonize/internal.ts.

#include "generate/harmonize/internal.h"

#include <cmath>
#include <limits>

#include "cantus/analyze/functional.h"
#include "cantus/core/pitch.h"
#include "js/math.h"
#include "theory/tendency/tendency.h"

namespace cantus {

const Candidate& fallback_candidate() {
  static const Candidate kFallback = [] {
    Candidate out;
    out.rootPc = 0;
    out.quality = ChordQuality::kMaj;
    out.pcs = chord_pitch_classes(make_chord(0, ChordQuality::kMaj));
    return out;
  }();
  return kFallback;
}

double default_harmonic_rhythm(const TimeSignature& ts) {
  double bar = beats_per_bar(ts);
  double half = bar / 2;
  return std::fmod(half, pulse_beats(ts)) == 0 ? half : bar;
}

bool is_key_tone(double pitch, const KeyScale& key) {
  return is_scale_tone(pitch, key) ||
         (cadences_through_raised_seventh(key) && pitch_class_of(pitch) == leading_tone_pc_of(key));
}

KeyScale infer_key(const std::vector<NoteEvent>& melody) {
  KeyScale best = major_key(0).scale();
  double best_score = -std::numeric_limits<double>::infinity();
  std::vector<KeyScale> candidates;
  for (int tonic = 0; tonic < 12; ++tonic) {
    candidates.push_back(major_key(tonic).scale());
    candidates.push_back(minor_key(tonic).scale());
  }
  for (const KeyScale& key : candidates) {
    int tonic = pitch_class_of(key.rootPc);
    double score = 0;
    for (const NoteEvent& n : melody) {
      double w = js::max(0.25, n.durationBeat);
      int pc = pitch_class_of(n.pitch);
      if (is_key_tone(n.pitch, key)) {
        score += w;
      }
      if (pc == tonic) {
        score += 0.5 * w;
      }
    }
    if (score > best_score) {
      best_score = score;
      best = key;
    }
  }
  return best;
}

}  // namespace cantus
