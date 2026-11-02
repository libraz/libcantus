/**
 * @file derive.h
 * @brief Internal pieces of ts/src/generate/melody/derive.ts: derived motif statements, a relation
 *        replayed on the statement it derives from at the pitch level that suits its phrase, and
 *        the repair a statement's register-forced notes pass through.
 *
 * A statement is a time-ordered list of absolute-beat notes. A relation's shape goes through
 * transform_motif() alone, so a derivation here and a transformation a caller asks for directly
 * cannot come to disagree.
 */
#ifndef CANTUS_SRC_GENERATE_MELODY_DERIVE_H_
#define CANTUS_SRC_GENERATE_MELODY_DERIVE_H_

#include <functional>
#include <optional>
#include <vector>

#include "cantus/analyze/melody.h"
#include "cantus/core/types.h"
#include "cantus/generate/motif.h"

namespace cantus {

/** One note of a statement (`MotifNote`). */
struct MotifNote {
  double pitch = 0;
  double startBeat = 0;
  double durationBeat = 0;
};

/** What a statement's placement, variation or repair needs to know about the phrase it sits in. */
struct PhraseFrame {
  /** Lowest pitch of the phrase's register. */
  double low = 0;
  /** Highest pitch of the phrase's register. */
  double high = 0;
  /** The pitches a searched note may take at a beat, by its position class. */
  std::function<std::vector<double>(double)> candidatesAt;
  /** The per-note pitch cost of a note sounding at a beat. */
  std::function<std::function<double(double)>(double)> costAt;
  /** The pitch the phrase's target curve asks for at a beat. */
  std::function<double(double)> targetAt;
  /** How many notes of a statement do not fit the plan's harmony, read after `before`. */
  std::function<double(const std::vector<MotifNote>&, const std::vector<MotifNote>&)> misfits;
  /** The phrase's start beat, reported by a failure. */
  double at = 0;
  /** Upper bound every search table is charged against. */
  std::optional<double> budget;
};

/**
 * The pitch levels a relation may be replayed at (`relationLevels`): an octave either way for a
 * pitch-keeping relation, any level but 0 for a transposition, any level for the inversion and
 * retrograde family, and any scale-degree shift but 0 within reach for a tonal transposition.
 */
std::vector<double> relation_levels(MotifRelationKind kind);

/** relation_levels() for chromatic levels between `low` and `high`. */
std::vector<double> relation_levels(MotifRelationKind kind, double low, double high);

/**
 * Replay a relation on a source statement at a pitch level (`replayAt`): the relation's shape is
 * applied, then the result is placed so its first note sounds `level` semitones from the source's
 * first note (every note moved `level` scale degrees in `key` for a tonal transposition) and its
 * first onset falls on `start_beat`.
 */
std::vector<MotifNote> replay_at(const std::vector<MotifNote>& source,
                                 const MotifRelationSummary& relation, double level,
                                 double start_beat, const KeyScale& key);

/** A statement as a motif cell: pitches narrowed to MIDI integers. */
MotifCell to_cell(const std::vector<MotifNote>& notes);

/**
 * replay_at() of one source and relation over many levels: the relation's shape is read on the
 * first replay and kept. Both arguments must outlive the replayer.
 */
class Replayer {
 public:
  Replayer(const std::vector<MotifNote>& source, const MotifRelationSummary& relation)
      : source_(source), relation_(relation) {}

  /** The statement replayed at `level` and `start_beat` (`replayAt`). */
  std::vector<MotifNote> at(double level, double start_beat, const KeyScale& key);

 private:
  const std::vector<MotifNote>& source_;
  const MotifRelationSummary& relation_;
  std::optional<MotifCell> shaped_;
};

/** A statement cut at `end_beat`: notes starting there or later are dropped (`clipStatement`). */
std::vector<MotifNote> clip_statement(const std::vector<MotifNote>& notes, double end_beat);

/**
 * Replace the notes marked `forced` with pitches from their own candidates, holding every other
 * note (`repairStatement`).
 * @throws NoSolutionError if no replacement line exists.
 */
std::vector<MotifNote> repair_statement(const std::vector<MotifNote>& notes,
                                        const std::vector<bool>& forced, const PhraseFrame& frame);

/**
 * Place a derived statement: its source replayed through the relation at the level that suits the
 * phrase best, cut at the statement's end (`placeDerived`).
 * @throws NoSolutionError if the register-forced notes admit no replacement.
 */
std::vector<MotifNote> place_derived(const std::vector<MotifNote>& source,
                                     const MotifRelationSummary& relation, double start_beat,
                                     double end_beat, const KeyScale& key, const PhraseFrame& frame,
                                     const std::vector<MotifNote>& before);

/**
 * Write a variation of a source statement: its rhythm, first and last pitch kept, the notes
 * between searched with a pull toward the source's steps (`varyStatement`).
 * @throws NoSolutionError if no line joins the outer notes.
 */
std::vector<MotifNote> vary_statement(const std::vector<MotifNote>& source, double start_beat,
                                      const PhraseFrame& frame);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_MELODY_DERIVE_H_
