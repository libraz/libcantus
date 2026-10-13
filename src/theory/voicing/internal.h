/**
 * @file internal.h
 * @brief Internal helpers of ts/src/theory/voicing/internal.ts: the candidate enumeration and the
 *        scoring the voicing entry points share.
 *
 * Candidates are held flat: voice `v` of candidate `i` sits at `pitches[i * voices + v]`. Scoring
 * functions read two voicings from pointers and offsets, so a candidate buffer, a previous voicing
 * and a caller's raw pitches are all read the same way.
 */
#ifndef CANTUS_SRC_THEORY_VOICING_INTERNAL_H_
#define CANTUS_SRC_THEORY_VOICING_INTERNAL_H_

#include <array>
#include <cstddef>
#include <optional>
#include <vector>

#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/voicing.h"
#include "theory/voicing/limits.gen.h"
#include "theory/voicing/tendency.h"

namespace cantus {

/** Candidate voicings of one chord, held flat (`VoicingCandidates`). */
struct VoicingCandidates {
  /** The candidate pitches, valid up to `count * voices`. */
  std::vector<double> pitches;
  /** How many candidates the last enumeration wrote. */
  std::size_t count = 0;
  /** Voices per candidate, the stride of `pitches`. */
  std::size_t voices = 0;
};

/**
 * Enumerate candidate voicings for a chord into `into`: the bass takes the chord's bass (or root)
 * pitch class at each available octave, and each upper voice any chord pitch class within its
 * range, pruned of crossings and over-wide spacing (`enumerateVoicings`).
 * @throws NoSolutionError if any voice's range contains no pitch of any chord tone.
 */
void enumerate_voicings(const Chord& chord, const std::vector<VoiceRange>& ranges,
                        double max_spacing, double max_candidates, VoicingCandidates& into);

/** The per-chord tables structural_penalty() reads (`StructuralTables`). */
struct StructuralTables {
  /** The chord's pitch classes, ascending. */
  std::vector<int> tones;
  /** Penalty for the tone at the same index of `tones` being absent. */
  std::vector<double> missing;
  /** Penalty per extra copy of each pitch class 0-11. */
  std::array<double, 12> doubling{};
};

/** Build the structural tables for one chord (`structuralTables`). */
StructuralTables structural_tables(const Chord& chord, const std::optional<KeyScale>& key);

/** Structural quality penalty of the candidate at `offset` in `pitches` (`structuralPenalty`). */
double structural_penalty(const StructuralTables& tables, const double* pitches, std::size_t offset,
                          std::size_t voices);

/** The per-chord-pair tables resolution_violations() reads (`ResolutionTables`). */
struct ResolutionTables {
  /** The leaving chord's seventh, or -1 when it has none. */
  int seventhPc = -1;
  /** The key's leading tone, or -1 without a key and where it does not function as one. */
  int leadingTonePc = -1;
  /** The key's tonic, or -1 without a key. */
  int tonicPc = -1;
  /** Whether the arriving chord contains each pitch class 0-11. */
  std::array<bool, 12> nextHas{};
  /** The arriving chord, which names the fifth a leading tone may fall to. */
  Chord nextChord;
};

/** Build the resolution tables for one chord-to-chord move (`resolutionTables`). */
ResolutionTables resolution_tables(const Chord& prev_chord, const Chord& next_chord,
                                   const std::optional<KeyScale>& key);

/** The spelling of the chord left and of the chord reached (`MelodicSpelling`). */
struct MelodicSpelling {
  SpellingTable from;
  SpellingTable to;
};

/** Count the tendency tones that fail to resolve between two voicings
 * (`resolutionViolations`). */
int resolution_violations(const ResolutionTables& tables,
                          const std::optional<MelodicSpelling>& spelling, const double* prev,
                          std::size_t prev_offset, const double* cur, std::size_t cur_offset,
                          std::size_t voices);

/** The summed absolute semitone motion between two voicings (`leadingCost`). */
double leading_cost(const double* prev, std::size_t prev_offset, const double* cur,
                    std::size_t cur_offset, std::size_t voices);

/** What the cross-relation rule reads besides the voicings (`CrossRelationTables`). */
struct CrossRelationTables {
  Chord fromChord;
  Chord toChord;
  /** The chord after the one reached, where the caller knows it. */
  std::optional<Chord> afterChord;
  KeyScale key;
};

/** Everything a move onto one chord is scored against (`MoveScoring`). */
struct MoveScoring {
  /** The arriving chord's structural tables. */
  StructuralTables structure;
  /** The tendency-tone tables, absent when no chord is being left. */
  std::optional<ResolutionTables> resolution;
  /** How both chords are written, absent when no key names the letters. */
  std::optional<MelodicSpelling> spelling;
  /** What the cross-relation rule reads, absent without a chord being left or a key. */
  std::optional<CrossRelationTables> crossRelation;
};

/** Build the scoring context of a move onto `chord` (`moveScoring`). */
MoveScoring move_scoring(const std::optional<Chord>& prev_chord, const Chord& chord,
                         const std::optional<ResolvedKey>& key,
                         const std::optional<Chord>& next_chord = std::nullopt);

/** The rule-violation weight of one move (`violationWeight`). */
double violation_weight(const MoveScoring& scoring, const double* prev, std::size_t prev_offset,
                        const double* cur, std::size_t cur_offset, std::size_t voices);

/** The whole score of one move: violations, structure, and the distance travelled
 * (`moveScore`). */
double move_score(const MoveScoring& scoring, const double* prev, std::size_t prev_offset,
                  const double* cur, std::size_t cur_offset, std::size_t voices);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_VOICING_INTERNAL_H_
