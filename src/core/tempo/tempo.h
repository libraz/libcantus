/**
 * @file tempo.h
 * @brief Internal entry points of ts/src/core/tempo/index.ts beside the public API.
 */
#ifndef CANTUS_SRC_CORE_TEMPO_TEMPO_H_
#define CANTUS_SRC_CORE_TEMPO_TEMPO_H_

#include "cantus/core/tempo.h"
#include "core/tempo/internal.h"

namespace cantus {

/**
 * A reader that converts many positions against one tempo map (`TempoReader`): the map is
 * validated and indexed once.
 */
class TempoReader {
 public:
  /**
   * Validate and index `map` (`tempoReader`).
   * @throws InvalidInputError if the map is malformed.
   */
  explicit TempoReader(const TempoMap& map);

  /** Elapsed seconds from the map's origin to a beat. */
  double seconds_at(double beat) const;

  /** The beat reached after a number of seconds from the origin. */
  double beat_at(double seconds) const;

 private:
  TempoIndex index_;
};

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_TEMPO_TEMPO_H_
