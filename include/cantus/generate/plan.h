/**
 * @file plan.h
 * @brief Public C++ API of ts/src/generate/plan: a composition plan, what a piece is going to be
 *        before any note is chosen, its validation, its derivation from a reference profile, and
 *        the evaluation of a melody against it.
 *
 * Where a ReferenceProfile records what an existing piece did, a plan records what a new one will
 * do: the same structural dimensions, stated as targets a generator can hit exactly. A plan
 * carries the seed and algorithm version a generator needs to reproduce the piece it describes.
 */
#ifndef CANTUS_GENERATE_PLAN_H_
#define CANTUS_GENERATE_PLAN_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/analyze/melody.h"
#include "cantus/analyze/reference.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/limits.h"
#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** One planned section: a labelled span of the piece (`PlannedSection`). */
struct PlannedSection {
  std::string label;
  /** First beat of the section. */
  double startBeat = 0;
  /** End of the section, exclusive. */
  double endBeat = 0;
};

/** A phrase's targeted pitch range and mean, as absolute MIDI pitches. */
struct PlannedRegister {
  double low = 0;
  double high = 0;
  double mean = 0;
};

/** One planned phrase: its span, its cadence and melodic shape, and the motifs it carries. */
struct PlannedPhrase {
  double startBeat = 0;
  double endBeat = 0;
  /** Index into the plan's sections of the section this phrase's start falls in. */
  Nullable<int> section;
  /** The cadence the phrase is to end on, or null for none. */
  Nullable<CadenceType> cadence;
  MelodicContourShape shape = MelodicContourShape::kStatic;
  /** Onset of the phrase's targeted peak, as a fraction of its length, in [0, 1]. */
  double peakPosition = 0;
  PlannedRegister register_;
  /** Targeted onsets per bar within the phrase. */
  double onsetDensity = 0;
  /** Indices into the plan's motifs of every motif statement placed in this phrase. */
  std::vector<int> motifs;
};

/** One planned chord, placed against one of the plan's keys (`PlannedChord`). */
struct PlannedChord {
  double startBeat = 0;
  double endBeat = 0;
  /** Index into the plan's keys of the key this chord is named against. */
  double key = 0;
  /** The chord, as a Roman numeral in that key. */
  std::string roman;
};

/** One planned motif statement: a root, or a derivation from an earlier statement. */
struct PlannedMotif {
  /** Index into the plan's phrases of the phrase this statement is placed in. */
  int phrase = 0;
  double startBeat = 0;
  double endBeat = 0;
  /** How many notes the statement carries. */
  int notes = 0;
  /** A root's onset-to-onset gaps in beats (`notes - 1` of them), or null to draw them. */
  Nullable<std::vector<double>> rhythm;
  /** Index of the statement this one derives from; null for a root. Always below its own index. */
  Nullable<int> from;
  /** The named transformation from `from`, or null for a root or a variation. */
  Nullable<MotifRelationSummary> relation;
};

/** The rhythmic target a generator's onset placement aims for (`PlannedRhythm`). */
struct PlannedRhythm {
  /** Targeted distribution of onsets across metric levels. */
  std::vector<double> onsetLevels;
  /** Targeted distribution of inter-onset intervals. */
  std::vector<double> interOnsetShares;
  /** Targeted syncopation, in [0, 1]. */
  double syncopation = 0;
};

/** The planned span (`CompositionPlan['span']`). */
struct PlanSpan {
  double startBeat = 0;
  double endBeat = 0;
  double bars = 0;
};

/** What a new piece is going to be (`CompositionPlan`). */
struct CompositionPlan {
  /** Schema version this record is written at; see COMPOSITION_PLAN_VERSION. */
  int planVersion = COMPOSITION_PLAN_VERSION;
  /** The project seed a generator following this plan draws from. */
  double seed = 0;
  /** The algorithm version a generator following this plan runs under. */
  int algorithmVersion = 0;
  /** Keys the piece passes through; index 0 is the home key. */
  std::vector<ResolvedKey> keys;
  /** The piece's meter across the planned span. */
  MeterMap meters;
  PlanSpan span;
  std::vector<PlannedSection> sections;
  std::vector<PlannedPhrase> phrases;
  /** The harmonic progression, as a partition of the span. */
  std::vector<PlannedChord> harmony;
  /** Motifs and how they derive from one another. */
  std::vector<PlannedMotif> motifs;
  PlannedRhythm rhythm;
};

/**
 * Reject a value that is not a composition plan (`assertCompositionPlan`); a violation names the
 * path to the field that is wrong.
 * @throws InvalidInputError if the plan is malformed.
 */
const CompositionPlan& assert_composition_plan(const CompositionPlan& plan,
                                               std::string_view name = "composition plan");

/**
 * Read a plan's harmony as a chord timeline spanning the plan (`planTimeline`).
 * @throws InvalidInputError if the plan is not valid.
 */
ChordTimeline plan_timeline(const CompositionPlan& plan);

/** How much of each structural dimension of a reference a derived plan keeps (`PreserveWeights`).
 */
struct PreserveWeights {
  /** Section labels; 1 when absent. */
  std::optional<double> form;
  /** Phrase lengths. */
  std::optional<double> phraseLengths;
  /** Structural chords. */
  std::optional<double> harmonicFunction;
  /** Where the chords change. */
  std::optional<double> harmonicRhythm;
  /** Motif derivations. */
  std::optional<double> motifRelations;
  /** Phrase contour, peak and register. */
  std::optional<double> registerShape;
  /** Each root's onset gaps and the onset placement. */
  std::optional<double> rhythm;
};

/** The melody range a plan's phrase registers are mapped onto. */
struct PlanRegisterRange {
  int low = 0;
  int high = 0;
};

/** Options of derive_composition_plan() (`CompositionPlanOptions`). */
struct CompositionPlanOptions {
  /** The home key of the plan; the reference's own when absent. */
  std::optional<KeyArg> key;
  /** The melody range the phrase registers are mapped onto; the reference's when absent. */
  std::optional<PlanRegisterRange> register_;
  /** How much of each dimension of the reference to keep. */
  std::optional<PreserveWeights> preserve;
  /** The seed and algorithm version the plan records; a supplied `rng` is refused. */
  std::optional<GenerationContextInput> ctx;
  /** Upper bound on the motif selection. */
  std::optional<double> budget;
};

/**
 * Derive a composition plan from a reference profile (`deriveCompositionPlan`).
 * @throws InvalidInputError if the reference is not a valid profile or carries no melody onsets,
 *   an option is out of range, or the context carries an `rng`.
 * @throws BudgetExceededError if the motif selection would exceed the budget.
 */
CompositionPlan derive_composition_plan(const ReferenceProfile& reference,
                                        const CompositionPlanOptions& opts = {});

/** What kind of departure a violation is (`CompositionViolation['kind']`). */
enum class ViolationKind : std::uint8_t {
  kSpan,
  kPhraseBoundary,
  kCadence,
  kHarmony,
  kMotifDerivation,
  kMotifDisplaced,
  kRegister,
  kPeakPosition,
};

/** The TS name of a violation kind ("span", ...). */
std::string_view to_string(ViolationKind kind);

/** Whether a violation rules the candidate out, or only flags it. */
enum class ViolationSeverity : std::uint8_t { kError, kWarning };

/** The TS name of a severity ("error" or "warning"). */
std::string_view to_string(ViolationSeverity severity);

/** One way a candidate melody departs from its plan (`CompositionViolation`). */
struct CompositionViolation {
  ViolationKind kind = ViolationKind::kSpan;
  ViolationSeverity severity = ViolationSeverity::kError;
  /** Where in the candidate this was found. */
  double atBeat = 0;
  /** What the plan called for. */
  std::string expected;
  /** What the candidate did instead. */
  std::string actual;
  /** Why this counts as a departure. */
  std::string rationale;
};

/** Likeness of the candidate to the plan, one field per dimension. */
struct CompositionFit {
  Nullable<double> contour;
  Nullable<double> register_;
  Nullable<double> onset;
  Nullable<double> duration;
  Nullable<double> syncopation;
  Nullable<double> density;
};

/** How a candidate melody measures up against its plan (`CompositionEvaluation`). */
struct CompositionEvaluation {
  std::vector<CompositionViolation> violations;
  CompositionFit fit;
};

/** Options of evaluate_composition() (`EvaluateCompositionOptions`). */
struct EvaluateCompositionOptions {
  /** Upper bound on the work each analysis may do. */
  std::optional<double> budget;
};

/**
 * Check a candidate melody against the plan it was written for (`evaluateComposition`).
 * @throws InvalidInputError if the plan or the melody cannot be read.
 * @throws BudgetExceededError if an analysis would exceed the budget.
 */
CompositionEvaluation evaluate_composition(const std::vector<NoteEvent>& melody,
                                           const CompositionPlan& plan,
                                           const EvaluateCompositionOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_GENERATE_PLAN_H_
