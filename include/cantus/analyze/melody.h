/**
 * @file melody.h
 * @brief Public C++ API of ts/src/analyze/melody: melody as a shape rather than a run of notes.
 *
 * A motif is held as an interval contour plus a rhythmic profile, which is what makes a
 * restatement at another pitch level the same motif. Two statements can be compared and the
 * transformation between them named, and phrases that stand in no such relation can still be
 * scored for similarity.
 */
#ifndef CANTUS_ANALYZE_MELODY_H_
#define CANTUS_ANALYZE_MELODY_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Step direction between two consecutive notes (`ContourDirection`). */
enum class ContourDirection : std::uint8_t { kUp, kDown, kSame };

/** The TS name of a direction ("up", "down" or "same"). */
std::string_view to_string(ContourDirection direction);

/** The overall shapes a line can be read as (`MelodicContourShape`). */
enum class MelodicContourShape : std::uint8_t { kArch, kAscending, kDescending, kWave, kStatic };

/** The TS name of a shape ("arch", ..., "static"). */
std::string_view to_string(MelodicContourShape shape);

/** The shape named `name`, or nullopt. */
std::optional<MelodicContourShape> parse_melodic_contour_shape(std::string_view name);

/** Every shape, in the order of MELODIC_CONTOUR_SHAPES. */
std::vector<MelodicContourShape> melodic_contour_shapes();

/** The named transformations relate_motifs() can report (`MotifRelationKind`). */
enum class MotifRelationKind : std::uint8_t {
  kRepetition,
  kTransposition,
  kTonalTransposition,
  kInversion,
  kRetrograde,
  kRetrogradeInversion,
  kAugmentation,
  kDiminution,
};

/** The TS name of a kind ("repetition", ..., "diminution"). */
std::string_view to_string(MotifRelationKind kind);

/** The kind named `name`, or nullopt. */
std::optional<MotifRelationKind> parse_motif_relation_kind(std::string_view name);

/** Every kind, in the order of MOTIF_RELATION_KINDS. */
std::vector<MotifRelationKind> motif_relation_kinds();

/** The abstract shape of a line: its step directions and what they add up to (`MelodicContour`). */
struct MelodicContour {
  /** One direction per adjacent pair of notes, in time order. */
  std::vector<ContourDirection> directions;
  /** What the directions add up to. */
  MelodicContourShape shape = MelodicContourShape::kStatic;
  /** Index of the highest note, the earliest of ties; -1 for a line with no notes. */
  int peakIndex = -1;
  /** Index of the lowest note, the earliest of ties; -1 for a line with no notes. */
  int troughIndex = -1;
  /** Semitone distance from the lowest note to the highest. */
  double range = 0;
  /** Why the line was given that shape. */
  std::string rationale;
};

/** One statement of a motif, addressed in the melody it was found in (`MotifOccurrence`). */
struct MotifOccurrence {
  /** Index of the statement's first note among the sounding notes of the melody. */
  std::size_t noteIndex = 0;
  /** Onset of the statement's first note. */
  double startBeat = 0;
  /** End of the statement's last note, exclusive. */
  double endBeat = 0;
  /** Semitones this statement stands above the motif's first statement. */
  double transpose = 0;
  /** How much this statement is stretched against the motif's first. */
  double timeRatio = 1;
};

/** A recurring melodic cell (`MotifData`). */
struct MotifData {
  /** The first statement, exactly as it sounds in the melody. */
  std::vector<NoteEvent> notes;
  /** Semitones between consecutive notes, the transposition-invariant identity of the cell. */
  std::vector<double> intervals;
  /** Onset-to-onset gaps as multiples of the first gap. */
  std::vector<double> rhythm;
  /** Every statement found, in time order; the first is `notes`. */
  std::vector<MotifOccurrence> occurrences;
  /** Why this counts as a motif. */
  std::string rationale;
};

/**
 * Anything that can be read as a melodic line (`MelodicPhrase`): a motif, or plain note events.
 */
class MelodicPhraseArg {
 public:
  MelodicPhraseArg(std::vector<NoteEvent> notes) : notes_(std::move(notes)) {}  // NOLINT
  MelodicPhraseArg(const MotifData& motif) : notes_(motif.notes) {}             // NOLINT

  /** The notes of the line. */
  const std::vector<NoteEvent>& notes() const noexcept { return notes_; }

 private:
  std::vector<NoteEvent> notes_;
};

/** Options of extract_motifs() (`ExtractMotifsOptions`). */
struct ExtractMotifsOptions {
  /** Shortest cell to report, in notes. */
  std::optional<double> minNotes;
  /** Longest cell to report, in notes. */
  std::optional<double> maxNotes;
  /** How many statements a cell needs before it is reported. */
  std::optional<double> minOccurrences;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/** The transformation that turns one motif into another (`MotifRelation`). */
struct MotifRelation {
  MotifRelationKind kind = MotifRelationKind::kRepetition;
  /** Whether the second statement begins where the first ends. */
  bool sequence = false;
  /** Semitones from the first statement's first note to the second's. */
  double semitones = 0;
  /** The same distance named as a spelled interval. */
  SpelledInterval interval;
  /** Scale degrees the second statement stands above the first, when tonal. */
  std::optional<double> degrees;
  /** How much the second statement is stretched against the first. */
  double timeRatio = 1;
  /** Why the pair was given that name. */
  std::string rationale;
};

/** The part of a MotifRelation that names the transformation itself (`MotifRelationSummary`). */
struct MotifRelationSummary {
  MotifRelationKind kind = MotifRelationKind::kRepetition;
  bool sequence = false;
  double semitones = 0;
  std::optional<double> degrees;
  double timeRatio = 1;
};

/** How alike two lines are, and how the answer was reached (`MelodicComparison`). */
struct MelodicComparison {
  /** Overall likeness in [0, 1]. */
  double similarity = 0;
  /** Likeness of the interval sequences alone, in [0, 1]. */
  double pitchSimilarity = 0;
  /** Likeness of the rhythmic profiles alone, in [0, 1]. */
  double rhythmSimilarity = 0;
  /** Why the lines scored what they did. */
  std::string rationale;
};

/** Options of motif_graph() (`MotifGraphOptions`). */
struct MotifGraphOptions {
  /** Key context for the tonal reading relate_motifs() can offer. */
  std::optional<KeyArg> key;
  /** Lower bound on melodic_similarity() for a pair with no named transformation. */
  std::optional<double> variationThreshold;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/** One statement of a motif, as a node of MotifGraph (`MotifGraphNode`). */
struct MotifGraphNode {
  /** Index into the `motifs` array this statement belongs to. */
  std::size_t motif = 0;
  /** Index into that motif's `occurrences`. */
  std::size_t occurrence = 0;
  /** Onset of the statement's first note. */
  double startBeat = 0;
  /** End of the statement's last note, exclusive. */
  double endBeat = 0;
};

/** The derivation drawn from one statement to a later one (`MotifGraphEdge`). */
struct MotifGraphEdge {
  /** Index of the preceding node this statement derives from. */
  std::size_t from = 0;
  /** Index of the derived node. */
  std::size_t to = 0;
  /** The named transformation, or null when none explains the pair. */
  Nullable<MotifRelationSummary> relation;
  /** melodic_similarity() between the two statements. */
  double similarity = 0;
};

/** How a melody's motif statements derive from one another (`MotifGraph`). */
struct MotifGraph {
  /** Every statement of every motif, ordered by `startBeat` then by `motif`. */
  std::vector<MotifGraphNode> nodes;
  /** The derivation drawn to each node from an earlier one, ordered by `to`. */
  std::vector<MotifGraphEdge> edges;
};

/**
 * Read the shape of a line (`melodicContour`).
 * @throws InvalidInputError if the notes are not valid note events.
 */
MelodicContour melodic_contour(const MelodicPhraseArg& notes);

/**
 * Find the cells a melody keeps coming back to, longest first (`extractMotifs`).
 * @throws InvalidInputError if an option is invalid or the notes are not valid note events.
 * @throws BudgetExceededError if the work exceeds the budget.
 */
std::vector<MotifData> extract_motifs(const std::vector<NoteEvent>& notes,
                                      const ExtractMotifsOptions& opts = {});

/** Read a run of notes as a single-statement motif (`motifFromNotes`). */
MotifData motif_from_notes(const std::vector<NoteEvent>& notes);

/** Name how two statements of a motif relate, or null when they stand in none (`relateMotifs`). */
Nullable<MotifRelation> relate_motifs(const MotifData& a, const MotifData& b,
                                      const std::optional<KeyArg>& key = std::nullopt);

/** Compare two lines and say why they scored what they did (`compareMelodies`). */
MelodicComparison compare_melodies(const MelodicPhraseArg& a, const MelodicPhraseArg& b);

/** How alike two lines are, in [0, 1] (`melodicSimilarity`). */
double melodic_similarity(const MelodicPhraseArg& a, const MelodicPhraseArg& b);

/**
 * Read a melody's motif statements as a derivation forest (`motifGraph`).
 * @throws InvalidInputError if an occurrence does not lie on the line.
 */
MotifGraph motif_graph(const std::vector<NoteEvent>& line, const std::vector<MotifData>& motifs,
                       const MotifGraphOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_ANALYZE_MELODY_H_
