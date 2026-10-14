/**
 * @file harmonize.h
 * @brief Internal pieces of ts/src/generate/harmonize/index.ts: harmonizeMelody once its options
 *        have been read, checked and resolved.
 */
#ifndef CANTUS_SRC_GENERATE_HARMONIZE_HARMONIZE_H_
#define CANTUS_SRC_GENERATE_HARMONIZE_HARMONIZE_H_

#include <functional>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/harmonize.h"
#include "cantus/theory/scale.h"
#include "generate/harmonize/internal.h"

namespace cantus {

/** What harmonizeMelody has read of its options by the time it looks for the melody's chords. */
struct HarmonizeRequest {
  HarmonizeRequest(std::vector<NoteEvent> melody_, std::vector<NoteEvent> sounding_, Draw draw_)
      : melody(std::move(melody_)), sounding(std::move(sounding_)), draw(std::move(draw_)) {}

  /** The validated melody, every note. */
  std::vector<NoteEvent> melody;
  /** The notes of `melody` that sound. */
  std::vector<NoteEvent> sounding;
  /** The beats the caller named as phrase ends, finite. */
  std::vector<double> phraseEnds;
  TimeSignature ts;
  /** The key the chords are in, whole. */
  ResolvedKey key;
  HarmonizePlacement placement;
  /** The harmonic dial: the context's, or the named strength's. */
  double harmonic = 0;
  /** The context's sampler for the `harmony` part. */
  Draw draw;
  /** The chord slot length, as `assertRange` reads `opts.harmonicRhythm ?? default`. */
  std::function<double(const TimeSignature&)> harmonicRhythm;
  /** Charges an estimate against the caller's budget. */
  BudgetCharge charge;
};

/** harmonizeMelody from the point its options are read. */
HarmonizeResult harmonize_with(const HarmonizeRequest& request);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_HARMONIZE_HARMONIZE_H_
