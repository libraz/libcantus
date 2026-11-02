// Scale membership, degrees and the ladder of scale tones: ts/src/theory/scale/degrees.ts.

#include <algorithm>
#include <cmath>
#include <vector>

#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/theory/scale.h"
#include "js/math.h"

namespace cantus {

namespace {

/** Scale offset of a pitch relative to the key root, in [0, 11] (`scaleOffset`). */
int scale_offset(double pitch, const KeyScale& key) {
  return (pitch_class_of(pitch) - pitch_class_of(key.rootPc) + 12) % 12;
}

/** Whether a pitch belongs to an already-resolved scale (`inScale`). */
bool in_scale(double pitch, const KeyScale& scale) {
  return ((scale.modeMask12 >> scale_offset(pitch, scale)) & 1) == 1;
}

/** The key's scale offsets above its root, ascending within one octave (`scaleOffsets`). */
std::vector<int> scale_offsets(const KeyScale& key) {
  std::vector<int> offsets;
  for (int n = 0; n < 12; ++n) {
    if (((key.modeMask12 >> n) & 1) == 1) {
      offsets.push_back(n);
    }
  }
  return offsets;
}

/** `offsets[index] ?? 0` for a JS number index. */
double offset_at(const std::vector<int>& offsets, double index) {
  if (index >= 0 && index < static_cast<double>(offsets.size()) && std::floor(index) == index) {
    return offsets[static_cast<std::size_t>(index)];
  }
  return 0;
}

/** scale_ladder_position() over an already-resolved scale (`ladderPosition`). */
ScaleLadderPosition ladder_position(double pitch, const KeyScale& key) {
  assert_finite_number(pitch, "pitch");
  std::vector<int> offsets = scale_offsets(key);
  auto size = static_cast<double>(offsets.size());
  if (offsets.empty()) {
    return ScaleLadderPosition{0, 0};
  }
  double relative = pitch - pitch_class_of(key.rootPc);
  double octave = std::floor(relative / 12);
  double within = relative - octave * 12;
  std::size_t degree = 0;
  for (std::size_t n = 0; n < offsets.size(); ++n) {
    if (offsets[n] <= within) {
      degree = n;
    }
  }
  return ScaleLadderPosition{octave * size + static_cast<double>(degree), within - offsets[degree]};
}

/** scale_ladder_pitch() over an already-resolved scale (`ladderPitch`). */
double ladder_pitch(double rung, const KeyScale& key) {
  assert_finite_number(rung, "rung");
  std::vector<int> offsets = scale_offsets(key);
  auto size = static_cast<double>(offsets.size());
  if (offsets.empty()) {
    return pitch_class_of(key.rootPc);
  }
  double octave = std::floor(rung / size);
  double degree = rung - octave * size;
  return pitch_class_of(key.rootPc) + octave * 12 + offset_at(offsets, degree);
}

}  // namespace

bool is_scale_tone(double pitch, const KeyArg& key) { return in_scale(pitch, to_key_scale(key)); }

double nearest_scale_tone(double pitch, const KeyArg& key) {
  KeyScale scale = to_key_scale(key);
  assert_finite_number(pitch, "pitch");
  double base = clamp_to_midi(js::round(pitch), "pitch");
  for (int distance = 0; distance < 12; ++distance) {
    double lower = base - distance;
    if (lower >= 0 && in_scale(lower, scale)) {
      return lower;
    }
    double higher = base + distance;
    if (higher <= 127 && in_scale(higher, scale)) {
      return higher;
    }
  }
  return base;
}

ScaleLadderPosition scale_ladder_position(double pitch, const KeyArg& key) {
  return ladder_position(pitch, to_key_scale(key));
}

double scale_ladder_pitch(double rung, const KeyArg& key) {
  return ladder_pitch(rung, to_key_scale(key));
}

double shift_by_scale_degrees(double pitch, double degrees, const KeyArg& key) {
  KeyScale scale = to_key_scale(key);
  double steps = std::trunc(assert_finite_number(degrees, "degrees"));
  if (steps == 0) {
    return pitch;
  }
  ScaleLadderPosition position = ladder_position(pitch, scale);
  return ladder_pitch(position.rung + steps, scale) + position.offset;
}

int pitch_to_scale_degree(double pitch, const KeyArg& key) {
  KeyScale scale = to_key_scale(key);
  int offset = scale_offset(pitch, scale);
  if (((scale.modeMask12 >> offset) & 1) == 0) {
    return -1;
  }
  int degree = 1;
  for (int n = 0; n < offset; ++n) {
    if (((scale.modeMask12 >> n) & 1) == 1) {
      degree += 1;
    }
  }
  return degree;
}

std::vector<int> diatonic_pitch_classes(const KeyArg& key) {
  std::vector<int> pcs = scale_tones_in_degree_order(key);
  std::stable_sort(pcs.begin(), pcs.end());
  return pcs;
}

std::vector<int> scale_tones_in_degree_order(const KeyArg& key) {
  KeyScale scale = to_key_scale(key);
  int root = pitch_class_of(scale.rootPc);
  std::vector<int> pcs = scale_offsets(scale);
  for (int& pc : pcs) {
    pc = (root + pc) % 12;
  }
  return pcs;
}

}  // namespace cantus
