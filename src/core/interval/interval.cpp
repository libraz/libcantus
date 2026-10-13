// Interval consonance of ts/src/core/interval/index.ts.

#include "cantus/core/interval.h"

#include <cmath>

#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"

namespace cantus {

namespace {

struct ConsonanceClassValues {
  int PerfectConsonance;
  int ImperfectConsonance;
  int Dissonance;
};

constexpr ConsonanceClassValues kConsonanceClassValues =
#include "core/interval/consonance_class.gen.inc"
    ;
static_assert(kConsonanceClassValues.PerfectConsonance ==
                      static_cast<int>(ConsonanceClass::kPerfectConsonance) &&
                  kConsonanceClassValues.ImperfectConsonance ==
                      static_cast<int>(ConsonanceClass::kImperfectConsonance) &&
                  kConsonanceClassValues.Dissonance ==
                      static_cast<int>(ConsonanceClass::kDissonance),
              "ConsonanceClass and the TS enum disagree");

/** The pitch class of an interval's span, octaves and direction dropped (`simpleInterval`). */
int simple_interval(double semitones) {
  assert_finite_semitones(semitones);
  return pitch_class_of(std::fabs(semitones));
}

}  // namespace

ConsonanceClass classify_interval(double semitones, bool two_voice) {
  int pc = simple_interval(semitones);
  if (pc == 0 || pc == 7) {
    return ConsonanceClass::kPerfectConsonance;
  }
  if (pc == 3 || pc == 4 || pc == 8 || pc == 9) {
    return ConsonanceClass::kImperfectConsonance;
  }
  if (pc == 5) {
    return two_voice ? ConsonanceClass::kDissonance : ConsonanceClass::kImperfectConsonance;
  }
  return ConsonanceClass::kDissonance;
}

bool is_perfect_interval(double semitones) {
  int pc = simple_interval(semitones);
  return pc == 0 || pc == 7;
}

bool is_consonant_interval(double semitones, bool two_voice) {
  int pc = simple_interval(semitones);
  if (pc == 5) {
    return !two_voice;
  }
  return pc == 0 || pc == 3 || pc == 4 || pc == 7 || pc == 8 || pc == 9;
}

}  // namespace cantus
