// Shared helpers of the functional-harmony modules: ts/src/analyze/functional/internal.ts.

#include "analyze/functional/internal.h"

#include <cmath>

#include "cantus/core/pitch.h"
#include "cantus/theory/scale.h"
#include "theory/scale/masks.h"
#include "theory/tendency/tendency.h"

namespace cantus {

bool is_minor_scale(const KeyScale& key) { return is_minor_mask(key.modeMask12); }

KeyScale parallel_scale(const KeyScale& key) {
  return KeyScale{pitch_class_of(key.rootPc),
                  is_minor_scale(key) ? MAJOR_MASK : NATURAL_MINOR_MASK};
}

int degree_root_pc(double degree_number, const KeyScale& key) {
  std::vector<int> tones = scale_tones_in_degree_order(key);
  if (tones.empty()) {
    return pitch_class_of(key.rootPc);
  }
  // A plain `%` yields a negative index for a degree below the first; wrap into range instead.
  auto count = static_cast<double>(tones.size());
  double index = std::fmod(std::fmod(degree_number - 1, count) + count, count);
  // An index that is not a whole number reads as undefined in TS and collapses to the tonic.
  if (!std::isfinite(index) || index != std::floor(index)) {
    return pitch_class_of(key.rootPc);
  }
  return tones[static_cast<std::size_t>(index)];
}

std::vector<int> lowered_degrees(const KeyScale& key) {
  std::vector<int> tones = scale_tones_in_degree_order(key);
  std::vector<int> out;
  if (tones.size() != 7) {
    return out;
  }
  std::vector<int> major =
      scale_tones_in_degree_order(KeyScale{pitch_class_of(key.rootPc), MAJOR_MASK});
  for (std::size_t index = 0; index < 7; ++index) {
    if (pitch_class_of(major[index] - tones[index]) == 1) {
      out.push_back(static_cast<int>(index) + 1);
    }
  }
  return out;
}

KeyScale roman_reference(const KeyScale& key) { return heptatonic_frame_of(key); }

}  // namespace cantus
