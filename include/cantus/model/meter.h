/**
 * @file meter.h
 * @brief Public C++ API of ts/src/model/meter.ts: an immutable time signature.
 */
#ifndef CANTUS_MODEL_METER_H_
#define CANTUS_MODEL_METER_H_

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/meter.h"

namespace cantus {

/**
 * An immutable time signature: a numerator over a note-value denominator, with the optional
 * grouping of an additive meter (`Meter`).
 */
class Meter {
 public:
  /**
   * Build a meter from its parts (`Meter.of`).
   * @throws InvalidInputError if the numerator or denominator is not a positive integer or the
   *   grouping sums to neither the pulse count nor the numerator.
   */
  static Meter of(int numerator, int denominator,
                  std::optional<std::vector<int>> grouping = std::nullopt);

  /**
   * Parse "4/4", "6/8" or the additive "2+2+3/8" (`Meter.parse`).
   * @throws InvalidInputError if the text names no signature the library accepts.
   */
  static Meter parse(std::string_view text);

  /** parse() reporting failure instead of throwing it (`Meter.tryParse`). */
  static ParseResult<Meter> try_parse(std::string_view text);

  /**
   * Wrap a time signature (`Meter.fromData`).
   * @throws InvalidInputError if the signature is not one the library accepts.
   */
  static Meter from_data(const TimeSignature& data);

  /** Rebuild a meter from its `data()` (`Meter.fromJSON`). */
  static Meter from_json(const TimeSignature& data);

  /** Beats in a bar, counted in denominator units. */
  int numerator() const noexcept { return ts_.numerator; }

  /** The note value one unit is written as. */
  int denominator() const noexcept { return ts_.denominator; }

  /** The felt-beat grouping, or absent when the bar is ungrouped. */
  const std::optional<std::vector<int>>& grouping() const noexcept { return ts_.grouping; }

  /** A copy of the underlying time signature. */
  TimeSignature data() const { return ts_; }

  /** Whether the main pulses each divide into three (`isCompound`). */
  bool is_compound() const;

  /** Length of a bar in quarter-note beats (`beatsPerBar`). */
  double beats_per_bar() const;

  /** Main pulses in a bar (`pulsesPerBar`). */
  int pulses_per_bar() const;

  /** Length of one felt beat in quarter-note beats (`pulseBeats`). */
  double pulse_beats() const;

  /**
   * "n/d", or "a+b+c/d" when a grouping is asked for (`format`).
   * @throws InvalidInputError if the grouping asked for has no signature text.
   */
  std::string format(const FormatTimeSignatureOptions& opts = {}) const;

  /**
   * Metric weight 0..3 of a position (`weightAt`).
   * @throws InvalidInputError if the position is not finite.
   */
  int weight_at(double beat_in_quarters) const;

  /** Whether a position is accented (`isStrongBeat`). */
  bool is_strong_beat(double beat_in_quarters) const;

  /** Bar index and in-bar offset of a position (`barPositionAt`). */
  BarPosition bar_position_at(double beat_in_quarters) const;

  /** "bar.beat" or "bar.beat+fraction", both 1-based (`formatPosition`). */
  std::string format_position(double beat_in_quarters, int decimals = 2) const;

  /** `count` equal durations summing to `total_beats` (`tuplet`). */
  std::vector<double> tuplet(double total_beats, int count) const;

  /** Whether another meter is the same signature, grouping included. */
  bool equals(const Meter& other) const;

  /** The plain signature ("6/8"); format() writes the additive one. */
  std::string to_string() const;

 private:
  explicit Meter(const TimeSignature& ts);

  TimeSignature ts_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_METER_H_
