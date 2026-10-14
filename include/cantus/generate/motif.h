/**
 * @file motif.h
 * @brief Public C++ API of ts/src/generate/motif: short melodic cells, their transformations, and
 *        their development over a chord timeline.
 *
 * A motif note is a NoteEvent: the three fields a cell is written with, and the velocity and
 * articulation that a transform copying a note carries along with it.
 */
#ifndef CANTUS_GENERATE_MOTIF_H_
#define CANTUS_GENERATE_MOTIF_H_

#include <array>
#include <cstdint>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/analyze/timeline.h"
#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"

namespace cantus {

/** The name of a transformation transform_motif() can apply to a cell (`MotifTransform`). */
enum class MotifTransform : std::uint8_t {
  kTransposeDiatonic,
  kTransposeChromatic,
  kInvert,
  kRetrograde,
  kAugment,
  kDiminish,
  kSequence,
};

/** Every motif transformation, in declaration order. */
inline constexpr std::array<MotifTransform, 7> MOTIF_TRANSFORMS = {
    MotifTransform::kTransposeDiatonic,
    MotifTransform::kTransposeChromatic,
    MotifTransform::kInvert,
    MotifTransform::kRetrograde,
    MotifTransform::kAugment,
    MotifTransform::kDiminish,
    MotifTransform::kSequence};

/** The TS name of a transformation ("transposeDiatonic", ...). */
std::string_view to_string(MotifTransform transform);

/** The transformation named `name`, or nullopt. */
std::optional<MotifTransform> parse_motif_transform(std::string_view name);

/** A short melodic cell (`MotifCell`); its notes are note events. */
struct MotifCell {
  std::vector<NoteEvent> notes;
};

/** Melodic contour shape for generate_motif() (`MotifContour`). */
enum class MotifContour : std::uint8_t { kArch, kAscending, kDescending, kWave };

/** The TS name of a contour ("arch", ...). */
std::string_view to_string(MotifContour contour);

/** The contour named `name`, or nullopt. */
std::optional<MotifContour> parse_motif_contour(std::string_view name);

/** Options of generate_motif() (`MotifOptions`). */
struct MotifOptions {
  MotifOptions(KeyArg key_, int bars_) : key(std::move(key_)), bars(bars_) {}

  /** The key the line is written in. */
  KeyArg key;
  /** Chord the downbeats are pulled to, if any. */
  std::optional<ChordArg> chord;
  /** Length of the motif in bars of `ts`. */
  int bars;
  /** Meter the bars are counted in; 4/4 when absent. */
  std::optional<MeterArg> ts;
  /** Melodic contour shape; `arch` when absent. */
  std::optional<MotifContour> contour;
  /** Probability in [0, 1] that a note is nudged by one diatonic step; 0 when absent. */
  std::optional<double> jitter;
  /** The generation context; `{ seed: 0 }` when absent. */
  std::optional<GenerationContextInput> ctx;
};

/**
 * Generate a short seed motif over `bars` (`generateMotif`).
 * @throws InvalidInputError if the bars, the jitter or the context is malformed.
 */
MotifCell generate_motif(const MotifOptions& opts);

/**
 * A cell's notes as note events (`motifToNoteEvents`).
 * @throws InvalidInputError if a note is malformed.
 */
std::vector<NoteEvent> motif_to_note_events(const MotifCell& cell);

/**
 * Apply a transformation to a motif cell (`transformMotif`); the notes come back in time order.
 * `amount` is semitones, degrees or a time factor, by the transformation; `key` makes the
 * diatonic transformations diatonic.
 * @throws InvalidInputError if the cell, the amount or the key is malformed, or a transformed
 *   pitch leaves the MIDI range.
 */
MotifCell transform_motif(const MotifCell& cell, MotifTransform transform,
                          std::optional<double> amount = std::nullopt,
                          const std::optional<KeyArg>& key = std::nullopt);

/**
 * Lay a motif across `bars` and snap it to a chord timeline (`developMotif`).
 * @throws InvalidInputError if the cell, the timeline, the key or the meter is malformed.
 * @throws BudgetExceededError if the tiling would write more notes than the budget allows.
 */
MotifCell develop_motif(const MotifCell& cell, const ChordTimeline& timeline, const KeyArg& key,
                        int bars, const MeterArg& ts);

}  // namespace cantus

#endif  // CANTUS_GENERATE_MOTIF_H_
