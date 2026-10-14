/**
 * @file interval.h
 * @brief Public C++ API of ts/src/model/interval.ts: an immutable spelled interval.
 */
#ifndef CANTUS_MODEL_INTERVAL_H_
#define CANTUS_MODEL_INTERVAL_H_

#include <string>
#include <string_view>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"

namespace cantus {

class Note;

/**
 * An immutable spelled interval: a diatonic number, a quality label and a signed semitone span
 * (`Interval`). Every operation returns a new instance.
 */
class Interval {
 public:
  /** The spelled interval between two notes (`Interval.between`). */
  static Interval between(const Note& a, const Note& b);

  /**
   * Build an interval from explicit components (`Interval.of`).
   * @throws InvalidInputError if the three components do not describe the same interval.
   */
  static Interval of(int number, std::string_view quality, double semitones);

  /**
   * Wrap interval data (`Interval.fromData`); the direction is read the way
   * to_spelled_interval() reads it.
   * @throws InvalidInputError if the number, quality and span do not describe the same interval.
   */
  static Interval from_data(const IntervalArg& data);

  /** Rebuild an interval from its `data()` (`Interval.fromJSON`). */
  static Interval from_json(const IntervalArg& data);

  /**
   * Parse a name such as "P5", "AA4" or "-m3" (`Interval.parse`).
   * @throws InvalidInputError if the name is not a quality label followed by a number.
   */
  static Interval parse(std::string_view name);

  /** parse() reporting failure instead of throwing it (`Interval.tryParse`). */
  static ParseResult<Interval> try_parse(std::string_view name);

  /** Diatonic size: 1 = unison, 2 = second, 8 = octave, and beyond. */
  int number() const noexcept { return number_; }

  /** Quality label: 'P', 'M', 'm', or repeated 'A' / 'd'. */
  const std::string& quality() const noexcept { return quality_; }

  /** Signed semitone span. */
  double semitones() const noexcept { return semitones_; }

  /** Whether the interval moves downward (`isDescending`). */
  bool is_descending() const noexcept { return descending_; }

  /** The name, prefixed with '-' when descending; the grammar parse() reads. */
  std::string name() const;

  /** The plain interval data, `descending` always stated. */
  SpelledInterval data() const;

  /**
   * The complement that completes the octave, always ascending (`invert`).
   * @throws InvalidInputError for an augmented octave.
   */
  Interval invert() const;

  /** The same interval taken in the opposite direction (`negate`). */
  Interval negate() const;

  /** Whether the interval is consonant; the perfect fourth is not when `two_voice` (`isConsonant`).
   */
  bool is_consonant(bool two_voice = true) const;

  /** Whether another interval is spelled identically, enharmonic equivalents excluded. */
  bool equals(const Interval& other) const;

  /** The name (`toString`). */
  std::string to_string() const { return name(); }

 private:
  Interval(int number, std::string quality, double semitones, bool descending);

  int number_;
  std::string quality_;
  double semitones_;
  bool descending_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_INTERVAL_H_
