// Unspelled scale builders of ts/src/theory/scale/scales.ts.

#include "theory/scale/scales.h"

#include "cantus/core/pitch.h"
#include "cantus/theory/scale.h"

namespace cantus {

KeyScale major_scale(double root_pc) { return KeyScale{pitch_class_of(root_pc), MAJOR_MASK}; }

KeyScale minor_scale(double root_pc) {
  return KeyScale{pitch_class_of(root_pc), NATURAL_MINOR_MASK};
}

KeyScale named_scale(std::string_view name, double root_pc) {
  int root = pitch_class_of(root_pc);
  return KeyScale{root, require_scale_mask(name)};
}

}  // namespace cantus
