// Shared interval reading for the counterpoint rules: ts/src/theory/counterpoint/internal.ts.

#include "theory/counterpoint/internal.h"

#include <cmath>
#include <string>

#include "cantus/core/errors.h"
#include "core/validation/validation.h"

namespace cantus {

namespace {

/** Whether `quality` is `P`, `M`, `m`, or a run of one glyph `A` or `d` (`/^(P|M|m|A+|d+)$/`). */
bool is_quality_label(const std::string& quality) {
  if (quality.empty()) {
    return false;
  }
  if (quality == "P" || quality == "M" || quality == "m") {
    return true;
  }
  char glyph = quality[0];
  if (glyph != 'A' && glyph != 'd') {
    return false;
  }
  return quality.find_first_not_of(glyph) == std::string::npos;
}

}  // namespace

double pitch_of(const PitchArg& value) {
  if (const double* number = std::get_if<double>(&value.value())) {
    return *number;
  }
  return note_to_midi(std::get<NoteData>(value.value()));
}

bool is_augmented_spelled_interval(const SpelledInterval& interval) {
  return interval.number >= 2 && interval.quality.rfind('A', 0) == 0;
}

int simple_interval_number(double number) {
  return static_cast<int>(std::fmod(std::fabs(number) - 1, 7)) + 1;
}

ConsonanceClass classify_spelled_interval(const SpelledInterval& interval, bool two_voice) {
  // The two fields the answer is read from are both checked: an interval carrying neither would
  // classify as a dissonance, the verdict a real tritone gets.
  int simple = simple_interval_number(assert_degree(interval.number, "interval.number"));
  if (!is_quality_label(interval.quality)) {
    throw InvalidInputError("interval.quality must be an interval quality; received " +
                            describe_rejected(json::Value(interval.quality)));
  }
  if (interval.quality == "P") {
    if (simple == 1 || simple == 5) {
      return ConsonanceClass::kPerfectConsonance;
    }
    if (simple == 4) {
      return two_voice ? ConsonanceClass::kDissonance : ConsonanceClass::kImperfectConsonance;
    }
    return ConsonanceClass::kDissonance;
  }
  if ((interval.quality == "M" || interval.quality == "m") && (simple == 3 || simple == 6)) {
    return ConsonanceClass::kImperfectConsonance;
  }
  return ConsonanceClass::kDissonance;
}

}  // namespace cantus
