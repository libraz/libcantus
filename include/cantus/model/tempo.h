/**
 * @file tempo.h
 * @brief Public C++ API of ts/src/model/tempo.ts: an immutable constant tempo.
 */
#ifndef CANTUS_MODEL_TEMPO_H_
#define CANTUS_MODEL_TEMPO_H_

#include <string>

namespace cantus {

/** A constant tempo as plain data (`TempoData`). */
struct TempoData {
  /** Quarter-note beats per minute. */
  double bpm = 0;
};

/**
 * An immutable constant tempo in quarter-note beats per minute, with the conversions it settles
 * between beats, seconds and ticks (`Tempo`).
 */
class Tempo {
 public:
  /**
   * Build a tempo from a marking (`Tempo.of`).
   * @throws InvalidInputError if the marking is outside 0.1..1000.
   */
  static Tempo of(double bpm);

  /** Wrap a tempo value (`Tempo.fromData`). */
  static Tempo from_data(const TempoData& data);

  /** Rebuild a tempo from its `data()` (`Tempo.fromJSON`). */
  static Tempo from_json(const TempoData& data);

  /** Quarter-note beats per minute. */
  double bpm() const noexcept { return bpm_; }

  /** A copy of the underlying tempo value. */
  TempoData data() const { return TempoData{bpm_}; }

  /**
   * Seconds from the downbeat to a position, negative before it (`secondsAt`).
   * @throws InvalidInputError if the position is not finite.
   */
  double seconds_at(double beat) const;

  /** The position reached after a number of seconds (`beatAtSeconds`). */
  double beat_at_seconds(double seconds) const;

  /**
   * Seconds a span of beats lasts (`secondsOf`).
   * @throws InvalidInputError if the length is negative or not finite.
   */
  double seconds_of(double length_beats) const;

  /**
   * Beats to MIDI ticks, rounded to the nearest tick (`ticksAt`).
   * @throws InvalidInputError if the position is not finite or `ppq` is not positive.
   */
  double ticks_at(double beat, int ppq) const;

  /**
   * MIDI ticks to beats (`beatAtTicks`).
   * @throws InvalidInputError if `ticks` is not an integer or `ppq` is not positive.
   */
  double beat_at_ticks(double ticks, int ppq) const;

  /** Whether another tempo carries the same marking. */
  bool equals(const Tempo& other) const noexcept { return bpm_ == other.bpm_; }

  /** The marking ("120 bpm"). */
  std::string to_string() const;

 private:
  explicit Tempo(double bpm);

  double bpm_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_TEMPO_H_
