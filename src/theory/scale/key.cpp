// The spelled key builders of ts/src/theory/scale/key.ts.

#include "cantus/theory/scale.h"
#include "theory/scale/scales.h"

namespace cantus {

namespace {

/** A built key, with the spelling it is conventionally written in beside it (`spelled`). */
SpelledKeyScale spelled(const KeyScale& scale) {
  ResolvedKey key = spelled_key_of(scale);
  return SpelledKeyScale{scale.rootPc, scale.modeMask12, key.tonic, key.variant};
}

}  // namespace

SpelledKeyScale major_key(double root_pc) { return spelled(major_scale(root_pc)); }

SpelledKeyScale minor_key(double root_pc) { return spelled(minor_scale(root_pc)); }

SpelledKeyScale scale_by_name(std::string_view name, double root_pc) {
  return spelled(named_scale(name, root_pc));
}

}  // namespace cantus
