/**
 * @file duration.h
 * @brief Public C++ API of ts/src/model/duration.ts: an immutable written duration.
 */
#ifndef CANTUS_MODEL_DURATION_H_
#define CANTUS_MODEL_DURATION_H_

#include <optional>
#include <string>
#include <vector>

#include "cantus/core/duration.h"

namespace cantus {

/**
 * An immutable written duration: a base note value, its augmentation dots and an optional tuplet
 * ratio (`Duration`).
 */
class Duration {
 public:
  /**
   * Build a duration from its parts (`Duration.of`).
   * @throws InvalidInputError if the dot count or a tuplet side is out of range.
   */
  static Duration of(NoteValue base, int dots = 0, std::optional<Tuplet> tuplet = std::nullopt);

  /**
   * Spell a length in beats as the note value a score would show (`Duration.ofBeats`).
   * @throws InvalidInputError if the length is not positive.
   * @throws NoSolutionError if no single note value spells it.
   */
  static Duration of_beats(double beats, const DurationOptions& options = {});

  /**
   * Spell a length in beats as a chain of tied durations, longest first (`Duration.tieChain`).
   * @throws BudgetExceededError if the chain would be too long.
   */
  static std::vector<Duration> tie_chain(double beats, const DurationOptions& options = {});

  /**
   * Wrap a duration, or a bare base value for an undotted one (`Duration.fromData`).
   * @throws InvalidInputError if the base, the dot count or a tuplet side is out of range.
   */
  static Duration from_data(const DurationArg& data);

  /** Rebuild a duration from its `data()` (`Duration.fromJSON`). */
  static Duration from_json(const DurationArg& data);

  /** The base note value. */
  NoteValue base() const noexcept { return spelled_.base; }

  /** Augmentation dots, 0 when the value carries none. */
  int dots() const noexcept { return spelled_.dots; }

  /** The tuplet ratio, or absent outside a tuplet. */
  std::optional<Tuplet> tuplet() const noexcept { return spelled_.tuplet; }

  /** The written value, the dot count always stated (`spelled`). */
  SpelledDuration spelled() const { return spelled_; }

  /** A copy of the underlying duration, the same value as spelled(). */
  SpelledDuration data() const { return spelled_; }

  /**
   * The length in beats (`beats`).
   * @throws InvalidInputError if the beat unit is not a duration the library reads.
   */
  double beats(const DurationOptions& options = {}) const;

  /** Whether another duration is written identically (base, dots and tuplet). */
  bool equals(const Duration& other) const;

  /** The base value, a dot per augmentation dot and the tuplet ratio ("quarter.", "eighth 3:2"). */
  std::string to_string() const;

 private:
  explicit Duration(const DurationArg& value);

  SpelledDuration spelled_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_DURATION_H_
