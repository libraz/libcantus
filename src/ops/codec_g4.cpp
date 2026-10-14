#include "ops/codec_g4.h"

namespace cantus::ops {

void write_fields(const HarmonizeResult& v, FieldWriter& w) {
  w.field("transposeSemitones", v.transposeSemitones);
  w.field("key", scale_first(v.key));
  w.field("chords", v.chords);
  w.field("melodyRoles", v.melodyRoles);
}

}  // namespace cantus::ops
