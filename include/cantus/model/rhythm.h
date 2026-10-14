/**
 * @file rhythm.h
 * @brief Public C++ API of ts/src/model/rhythm.ts: a pattern of onsets over a meter, and the
 *        transformations that reshape one.
 *
 * The transformations are written against a sixteenth grid, so the onsets are converted to it and
 * read back afterwards; durations are re-read from the onsets, each sounding until the next.
 */
#ifndef CANTUS_MODEL_RHYTHM_H_
#define CANTUS_MODEL_RHYTHM_H_

#include <functional>
#include <optional>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/generate/context.h"
#include "cantus/generate/rhythm.h"
#include "cantus/generate/vocabulary.h"
#include "cantus/model/score.h"

namespace cantus {

/** The plain form a Rhythm hands out and is rebuilt from (`RhythmData`). */
struct RhythmData {
  /** The onsets, in time order, measured in quarter-note beats. */
  std::vector<RhythmEvent> events;
  /** The meter the onsets are counted in. */
  TimeSignature ts;
};

/** Which onsets of a pattern count as decoration. */
using RhythmOrnamentTest = std::function<bool(const RhythmEvent&)>;

/** What Rhythm::deform() does to a pattern beyond what the dials say (`RhythmDeformOptions`). */
struct RhythmDeformOptions {
  /** Stretch or compress the pattern before the dials are applied; straight when absent. */
  std::optional<FigureRate> rate;
  /** Which onsets count as decoration, for the ornament dial; empty when absent. */
  RhythmOrnamentTest isOrnament;
};

/** A pattern of onsets over a meter, and the transformations that reshape one (`Rhythm`). */
class Rhythm {
 public:
  /**
   * Wrap plain rhythm data (`new Rhythm`); the onsets are copied and put in time order.
   * @throws InvalidInputError if an onset or the meter carries a value a pattern cannot hold.
   */
  explicit Rhythm(const RhythmData& data);

  /** Generate a pattern over a meter (`Rhythm.generate`); a map is read as its opening one. */
  static Rhythm generate(const MeterArg& ts, const RhythmOptions& opts = {});

  /**
   * Build a pattern from onsets that already exist (`Rhythm.of`).
   * @throws InvalidInputError if the meter names no signature or an onset is invalid.
   */
  static Rhythm of(const std::vector<RhythmEvent>& events, const MeterArg& ts);

  /** Rebuild a pattern from its data() (`Rhythm.fromData`). */
  static Rhythm from_data(const RhythmData& data);

  /** Rebuild a pattern from its to_json() (`Rhythm.fromJSON`). */
  static Rhythm from_json(const RhythmData& data);

  /** The onsets, in time order (`events`). */
  const std::vector<RhythmEvent>& events() const noexcept { return data_.events; }

  /** The meter the onsets are counted in (`ts`). */
  const TimeSignature& ts() const noexcept { return data_.ts; }

  /** Where the pattern stops: the furthest point any onset sounds to (`totalBeats`). */
  double total_beats() const;

  /** The plain data (`data`). */
  RhythmData data() const { return data_; }

  /** The mean number of onsets per bar (`density`). */
  double density() const;

  /**
   * Drop the onsets carrying the least of the metre (`thin`).
   * @throws InvalidInputError if the amount is outside [0, 1].
   */
  Rhythm thin(double amount) const;

  /**
   * Anticipate beats, one sixteenth early (`syncopate`).
   * @throws InvalidInputError if the amount is outside [0, 1].
   */
  Rhythm syncopate(double amount,
                   const std::optional<GenerationContextInput>& ctx = std::nullopt) const;

  /** Compress the pattern to half its length and play it twice (`doubleTime`). */
  Rhythm double_time() const;

  /** Stretch the pattern to twice its length (`halfTime`). */
  Rhythm half_time() const;

  /**
   * Keep as much decoration as the ornament dial asks for (`ornamentBy`).
   * @throws InvalidInputError if the amount is outside [0, 1].
   */
  Rhythm ornament_by(const RhythmOrnamentTest& is_ornament, double amount,
                     const std::optional<GenerationContextInput>& ctx = std::nullopt) const;

  /**
   * Apply the complexity dials to the pattern in one pass (`deform`).
   * @throws InvalidInputError if a dial is outside [0, 1].
   */
  Rhythm deform(const RhythmDeformOptions& opts = {},
                const std::optional<GenerationContextInput>& ctx = std::nullopt) const;

  /** Whether one player can sustain the pattern at the context's tempo (`withinCeiling`). */
  bool within_ceiling(const std::optional<GenerationContextInput>& ctx = std::nullopt) const;

  /**
   * The pattern as sounding notes at one pitch, in its own meter (`toScore`).
   * @throws InvalidInputError if the pitch or the velocity is not an integer in [0, 127].
   */
  Score to_score(int pitch, std::optional<int> velocity = std::nullopt) const;

  /** Whether another pattern holds the same onsets in the same meter (`equals`). */
  bool equals(const Rhythm& other) const;

  /** The plain data (`toJSON`). */
  RhythmData to_json() const { return data_; }

 private:
  RhythmData data_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_RHYTHM_H_
