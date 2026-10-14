/**
 * @file tuning.h
 * @brief Public C++ API of ts/src/model/tuning.ts: an immutable equal temperament.
 */
#ifndef CANTUS_MODEL_TUNING_H_
#define CANTUS_MODEL_TUNING_H_

#include <optional>
#include <string>

#include "cantus/core/pitch.h"
#include "cantus/core/tuning.h"

namespace cantus {

/**
 * An immutable equal temperament: a reference pitch and a number of equal divisions of the
 * octave, with the conversions of the tuning module bound to it (`Tuning`). Every conversion takes
 * a temperament of its own, defaulting to this one.
 */
class Tuning {
 public:
  /**
   * Wrap a tuning table (`Tuning.of`).
   * @throws InvalidInputError if the table describes no temperament.
   */
  static Tuning of(const TuningTable& table);

  /**
   * An equal temperament of `divisions` steps (`Tuning.edo`).
   * @throws InvalidInputError if the divisions or the reference are out of range.
   */
  static Tuning edo(int divisions, double ref_freq = 440, double ref_step = 69);

  /** Twelve-tone equal temperament with A4 = 440 Hz (`Tuning.twelveTet`). */
  static Tuning twelve_tet();

  /** Rebuild a tuning from its `data()` (`Tuning.fromData`). */
  static Tuning from_data(const TuningTable& data);

  /** Rebuild a tuning from its `data()` (`Tuning.fromJSON`). */
  static Tuning from_json(const TuningTable& data);

  /** Cents of a frequency ratio, the same under every tuning (`Tuning.ratioToCents`). */
  static double ratio_to_cents(double numerator, double denominator);

  /** The frequency ratio an interval in cents spans (`Tuning.centsToRatio`). */
  static double cents_to_ratio(double cents);

  /** Cents between two frequencies (`Tuning.centsBetweenFreq`). */
  static double cents_between_freq(double a, double b);

  /** Cents by which a just interval departs from its 12-TET tempering
   * (`Tuning.justDeviationCents`). */
  static double just_deviation_cents(int semitone_class);

  /** Step index whose frequency is ref_freq(). */
  double ref_step() const noexcept { return table_.refStep; }

  /** Frequency in Hz of ref_step(). */
  double ref_freq() const noexcept { return table_.refFreq; }

  /** Equal divisions of the octave. */
  int divisions() const noexcept { return table_.divisions; }

  /** A copy of the underlying table. */
  TuningTable data() const { return table_; }

  /**
   * Frequency in Hz of a note (`frequencyOf`).
   * @throws InvalidInputError if the note has no octave.
   */
  double frequency_of(const NoteArg& note,
                      const std::optional<TuningTable>& tuning = std::nullopt) const;

  /** Frequency in Hz of a step index (`frequencyOfStep`). */
  double frequency_of_step(double step,
                           const std::optional<TuningTable>& tuning = std::nullopt) const;

  /** The nearest step index to a frequency (`nearestStep`). */
  double nearest_step(double freq, const std::optional<TuningTable>& tuning = std::nullopt) const;

  /** The unrounded step index of a frequency (`stepOf`). */
  double step_of(double freq, const std::optional<TuningTable>& tuning = std::nullopt) const;

  /** Cents a frequency lies above its nearest step (`centsFromNearestStep`). */
  double cents_from_nearest_step(double freq,
                                 const std::optional<TuningTable>& tuning = std::nullopt) const;

  /** Cents spanned by a number of steps (`centsOfSteps`). */
  double cents_of_steps(double steps,
                        const std::optional<TuningTable>& tuning = std::nullopt) const;

  /** Steps spanned by an interval in cents (`stepsOfCents`). */
  double steps_of_cents(double cents,
                        const std::optional<TuningTable>& tuning = std::nullopt) const;

  /** Whether another tuning divides the octave the same way from the same reference. */
  bool equals(const Tuning& other) const noexcept;

  /** The divisions and the reference pitch ("12-EDO (step 69 = 440 Hz)"). */
  std::string to_string() const;

 private:
  explicit Tuning(const TuningTable& table) : table_(table) {}

  TuningTable table_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_TUNING_H_
