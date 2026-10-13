/**
 * @file tuning.h
 * @brief Public C++ API of ts/src/core/tuning: equal-division tunings, frequencies, steps and
 *        cents.
 */
#ifndef CANTUS_CORE_TUNING_H_
#define CANTUS_CORE_TUNING_H_

namespace cantus {

/** An equal division of the octave anchored on a reference frequency (`TuningTable`). */
struct TuningTable {
  /** Step index (the MIDI number when `divisions` is 12) whose frequency is `refFreq`. */
  double refStep = 0;
  /** Frequency in Hz of `refStep`. */
  double refFreq = 0;
  /** Equal divisions of the octave. */
  int divisions = 0;
};

/** Twelve-tone equal temperament with A4 = 440 Hz (`TWELVE_TET`). */
extern const TuningTable TWELVE_TET;

/** One entry of JUST_RATIOS. */
struct JustRatio {
  double numerator = 0;
  double denominator = 0;
};

/**
 * An equal division of the octave into `n` steps (`edo`).
 * @throws InvalidInputError if `n` is not a positive integer or a reference is out of range.
 */
TuningTable edo(int n, double ref_freq = 440, double ref_step = 69);

/** Frequency in Hz of a step (`frequencyOf`). */
double frequency_of(double step, const TuningTable& tuning = TWELVE_TET);

/** The nearest step to a frequency (`nearestStep`). */
double nearest_step(double freq, const TuningTable& tuning = TWELVE_TET);

/** The fractional step of a frequency (`stepOf`). */
double step_of(double freq, const TuningTable& tuning = TWELVE_TET);

/** Cents a frequency lies above its nearest step (`centsFromNearestStep`). */
double cents_from_nearest_step(double freq, const TuningTable& tuning = TWELVE_TET);

/** Steps spanned by an interval in cents (`stepsOfCents`). */
double steps_of_cents(double cents, const TuningTable& tuning = TWELVE_TET);

/** The frequency ratio of an interval in cents (`centsToRatio`). */
double cents_to_ratio(double cents);

/** Cents between two frequencies (`centsBetweenFreq`). */
double cents_between_freq(double a, double b);

/** Cents spanned by a number of steps (`centsOfSteps`). */
double cents_of_steps(double steps, const TuningTable& tuning = TWELVE_TET);

/** Cents of the ratio `numerator / denominator` (`ratioToCents`). */
double ratio_to_cents(double numerator, double denominator);

/** The just ratio of a semitone class 0..12, indexed by class (`JUST_RATIOS`). */
JustRatio just_ratio(int semitone_class);

/**
 * How far the just ratio of a semitone class lies from the equal-tempered one, in cents
 * (`justDeviationCents`).
 * @throws InvalidInputError if the class is outside 0..12.
 */
double just_deviation_cents(int semitone_class);

}  // namespace cantus

#endif  // CANTUS_CORE_TUNING_H_
