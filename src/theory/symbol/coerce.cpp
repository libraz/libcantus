// Reading a caller's chord into the one shape the library works in: ts/src/theory/symbol/coerce.ts.

#include <string>
#include <utility>
#include <variant>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/symbol.h"
#include "core/validation/validation.h"

namespace cantus {

namespace {

/** Validate plain chord data and return it in the canonical shape (`normalizedChord`). */
Chord normalized_chord(const Chord& data) {
  Chord copy;
  copy.rootPc = pitch_class_of(assert_finite_number(data.rootPc, "chord.rootPc"));
  copy.quality = data.quality;
  // Each offset is checked rather than copied blind.
  for (std::size_t index = 0; index < data.intervals.size(); ++index) {
    copy.intervals.push_back(
        assert_finite_number(data.intervals[index], "chord.intervals[" + index_text(index) + "]"));
  }
  if (data.bassPc) {
    copy.bassPc = pitch_class_of(assert_finite_number(*data.bassPc, "chord.bassPc"));
  }
  // Spelling hints are the caller's record of how the chord is written; they pass through.
  copy.rootSpelling = data.rootSpelling;
  copy.bassSpelling = data.bassSpelling;
  copy.toneSpellings = data.toneSpellings;
  return copy;
}

}  // namespace

Chord to_chord_data(const ChordArg& value) {
  if (const std::string* symbol = std::get_if<std::string>(&value.value())) {
    return parse_chord_symbol(*symbol);
  }
  return normalized_chord(std::get<Chord>(value.value()));
}

}  // namespace cantus
