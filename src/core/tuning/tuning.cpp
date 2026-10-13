// Tunings of ts/src/core/tuning/index.ts.

#include "cantus/core/tuning.h"

#include <array>
#include <limits>
#include <string>
#include <string_view>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** `Number.MIN_VALUE` and `Number.MAX_VALUE`. */
constexpr double kMinValue = std::numeric_limits<double>::denorm_min();
constexpr double kMaxValue = std::numeric_limits<double>::max();

/** A generated JUST_RATIOS row: the semitone class as the object key, and its ratio. */
struct JustRatioRow {
  std::string_view key;
  double ratio[2];
};

constexpr std::array<JustRatioRow, 13> kJustRatios = {
#include "core/tuning/just_ratios.gen.inc"
};

/** Validate a tuning table's fields in the order TS reads them (`assertTuning`). */
void assert_tuning(const TuningTable& tuning) {
  assert_finite_number(tuning.refStep, "tuning.refStep");
  assert_range(tuning.refFreq, kMinValue, kMaxValue, "tuning.refFreq");
  assert_positive_int(tuning.divisions, "tuning.divisions");
}

}  // namespace

const TuningTable TWELVE_TET =
#include "core/tuning/twelve_tet.gen.inc"
    ;

TuningTable edo(int n, double ref_freq, double ref_step) {
  assert_positive_int(n, "EDO divisions");
  assert_range(ref_freq, kMinValue, kMaxValue, "reference frequency");
  assert_finite_number(ref_step, "reference step");
  return TuningTable{ref_step, ref_freq, n};
}

double frequency_of(double step, const TuningTable& tuning) {
  assert_finite_number(step, "step");
  assert_tuning(tuning);
  double result = tuning.refFreq * js::pow(2, (step - tuning.refStep) / tuning.divisions);
  return assert_range(result, kMinValue, kMaxValue, "frequency result");
}

double nearest_step(double freq, const TuningTable& tuning) {
  assert_range(freq, kMinValue, kMaxValue, "frequency");
  assert_tuning(tuning);
  return js::round(tuning.refStep + tuning.divisions * js::log2(freq / tuning.refFreq));
}

double step_of(double freq, const TuningTable& tuning) {
  assert_range(freq, kMinValue, kMaxValue, "frequency");
  assert_tuning(tuning);
  return tuning.refStep + tuning.divisions * js::log2(freq / tuning.refFreq);
}

double cents_from_nearest_step(double freq, const TuningTable& tuning) {
  double exact = step_of(freq, tuning);
  return cents_of_steps(exact - js::round(exact), tuning);
}

double steps_of_cents(double cents, const TuningTable& tuning) {
  assert_finite_number(cents, "cents");
  assert_tuning(tuning);
  return assert_finite_number((cents * tuning.divisions) / 1200, "steps result");
}

double cents_to_ratio(double cents) {
  assert_finite_number(cents, "cents");
  double result = js::pow(2, cents / 1200);
  return assert_range(result, kMinValue, kMaxValue, "ratio result");
}

double cents_between_freq(double a, double b) {
  assert_range(a, kMinValue, kMaxValue, "first frequency");
  assert_range(b, kMinValue, kMaxValue, "second frequency");
  return 1200 * (js::log2(b) - js::log2(a));
}

double cents_of_steps(double steps, const TuningTable& tuning) {
  assert_finite_number(steps, "steps");
  assert_tuning(tuning);
  return assert_finite_number((steps * 1200) / tuning.divisions, "cents result");
}

double ratio_to_cents(double numerator, double denominator) {
  assert_range(numerator, kMinValue, kMaxValue, "ratio numerator");
  assert_range(denominator, kMinValue, kMaxValue, "ratio denominator");
  return 1200 * (js::log2(numerator) - js::log2(denominator));
}

JustRatio just_ratio(int semitone_class) {
  std::string key = js::to_string(semitone_class);
  for (const JustRatioRow& row : kJustRatios) {
    if (row.key == key) {
      return JustRatio{row.ratio[0], row.ratio[1]};
    }
  }
  throw InvalidInputError("semitone class has no just ratio: " + key);
}

double just_deviation_cents(int semitone_class) {
  assert_integer(semitone_class, "semitone class", 0, 12);
  JustRatio ratio = just_ratio(semitone_class);
  return ratio_to_cents(ratio.numerator, ratio.denominator) - semitone_class * 100;
}

}  // namespace cantus
