/**
 * @file motif.h
 * @brief Public C++ API of ts/src/model/motif.ts: a short melodic cell and the transformations
 *        that make a piece out of one.
 *
 * The cell holds notes and nothing else: the key it was written in is not part of it, and the
 * members that need one are given it.
 */
#ifndef CANTUS_MODEL_MOTIF_H_
#define CANTUS_MODEL_MOTIF_H_

#include <optional>
#include <vector>

#include "cantus/analyze/melody.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/motif.h"
#include "cantus/model/score.h"
#include "cantus/model/timeline.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"

namespace cantus {

/** How a motif is generated (`MotifGenerateOptions`): what MotifOptions asks for. */
struct MotifGenerateOptions {
  MotifGenerateOptions(KeyArg key_, int bars_) : key(std::move(key_)), bars(bars_) {}
  /** The key the line is written in. */
  KeyArg key;
  /** The chord the downbeats spell out, when the line is written over one. */
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

/** A short melodic cell, and the transformations that make a piece out of one (`Motif`). */
class Motif {
 public:
  /**
   * Wrap a plain motif cell (`new Motif`); only the pitch and the timing of each note are kept.
   * @throws InvalidInputError if a note carries a value the transforms cannot hold.
   */
  explicit Motif(const MotifCell& cell);

  /**
   * Generate a seed motif (`Motif.generate`).
   * @throws InvalidInputError if the key or the chord names none, or a dial is outside [0, 1].
   */
  static Motif generate(const MotifGenerateOptions& opts);

  /** Read a run of notes as a motif (`Motif.fromNotes`). */
  static Motif from_notes(const std::vector<NoteEvent>& notes);

  /** Rebuild a motif from its data() (`Motif.fromData`). */
  static Motif from_data(const MotifCell& cell);

  /** Rebuild a motif from its to_json() (`Motif.fromJSON`). */
  static Motif from_json(const MotifCell& cell);

  /** The notes of the cell, in the order the transforms read them (`notes`). */
  const std::vector<NoteEvent>& notes() const noexcept { return cell_.notes; }

  /** Where the cell stops sounding, measured from its own first onset (`totalBeats`). */
  double total_beats() const;

  /** The plain cell (`data`). */
  MotifCell data() const { return cell_; }

  /**
   * The cell put through one of the classical transformations (`transform`).
   * @throws InvalidInputError if a transformed pitch would leave the MIDI range.
   */
  Motif transform(MotifTransform kind, std::optional<double> amount = std::nullopt,
                  const std::optional<KeyArg>& key = std::nullopt) const;

  /**
   * The cell laid across a span and snapped to the harmony under it (`develop`).
   * @throws InvalidInputError if the bar count is not a positive integer.
   */
  Motif develop(const ChordTimeline& timeline, const KeyArg& key, int bars,
                const MeterArg& ts) const;
  /** The same, over a Timeline's harmony. */
  Motif develop(const Timeline& timeline, const KeyArg& key, int bars, const MeterArg& ts) const;

  /** How this motif stands to another, or null when the two stand in none (`relateTo`). */
  Nullable<MotifRelation> relate_to(const Motif& other,
                                    const std::optional<KeyArg>& key = std::nullopt) const;

  /** How alike two lines are, in [0, 1] (`similarityTo`). */
  double similarity_to(const Motif& other) const;

  /** The cell as a score (`toScore`). */
  Score to_score(const ScoreOptions& opts = {}) const;

  /** Whether another motif holds the same notes in the same order (`equals`). */
  bool equals(const Motif& other) const;

  /** The plain cell (`toJSON`). */
  MotifCell to_json() const { return cell_; }

 private:
  MotifCell cell_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_MOTIF_H_
