/**
 * @file measures.h
 * @brief Internal measures of ts/src/analyze/reference/measures.ts: the per-dimension likenesses
 *        two structural readings are compared by. Each takes the plain parts of a reading it
 *        needs rather than a whole profile, answers in [0, 1], is symmetric in its arguments,
 *        and answers null only when neither side has anything to measure.
 */
#ifndef CANTUS_SRC_ANALYZE_REFERENCE_MEASURES_H_
#define CANTUS_SRC_ANALYZE_REFERENCE_MEASURES_H_

#include <optional>
#include <string>
#include <vector>

#include "cantus/analyze/reference.h"

namespace cantus {

/** Likeness of two section-label sequences (`sectionSequenceSimilarity`). */
Nullable<double> section_sequence_similarity(const std::vector<std::string>& a,
                                             const std::vector<std::string>& b);

/** Likeness of two phrase-length sequences, in bars (`phraseLengthSimilarity`). */
Nullable<double> phrase_length_similarity(const std::vector<double>& a,
                                          const std::vector<double>& b);

/** The degree a Roman numeral stands on, with its quality and inversion dropped. */
std::string roman_degree_token(const std::string& roman);

/** The part of a reduced chord the progression alignment reads (`ProgressionChord`). */
struct ProgressionChord {
  std::string roman;
  HarmonicFunction function = HarmonicFunction::kTonic;
};

/**
 * Likeness of two structural progressions (`progressionSimilarity`).
 * @throws BudgetExceededError if the alignment would exceed the budget.
 */
Nullable<double> progression_similarity(const std::vector<ProgressionChord>& a,
                                        const std::vector<ProgressionChord>& b,
                                        std::optional<double> budget);

/** The part of a reduced chord the function distribution reads (`TimedFunction`). */
struct TimedFunction {
  double startBeat = 0;
  double endBeat = 0;
  HarmonicFunction function = HarmonicFunction::kTonic;
};

/** Likeness of how long two readings hold each harmonic function. */
Nullable<double> function_similarity(const std::vector<TimedFunction>& a,
                                     const std::vector<TimedFunction>& b);

/** Likeness of two cadence sequences, one entry per phrase (`cadenceSimilarity`). */
Nullable<double> cadence_similarity(const std::vector<Nullable<CadenceType>>& a,
                                    const std::vector<Nullable<CadenceType>>& b);

/** Likeness of two key plans, read relative to each plan's first key (`keyPlanSimilarity`). */
Nullable<double> key_plan_similarity(const std::vector<KeyScale>& a,
                                     const std::vector<KeyScale>& b);

/** Likeness of where two rhythms place their onsets (`onsetSimilarity`). */
Nullable<double> onset_similarity(const RhythmAnalysis& a, const RhythmAnalysis& b);

/** Likeness of two onset densities (`densitySimilarity`). */
Nullable<double> density_similarity(const RhythmAnalysis& a, const RhythmAnalysis& b);

/** Likeness of two inter-onset-interval distributions (`durationSimilarity`). */
Nullable<double> duration_similarity(const RhythmAnalysis& a, const RhythmAnalysis& b);

/** Likeness of two syncopation figures (`syncopationSimilarity`). */
Nullable<double> syncopation_similarity(const RhythmAnalysis& a, const RhythmAnalysis& b);

/** The part of a motif the surface measure reads (`SurfaceMotif`). */
struct SurfaceMotif {
  std::vector<double> intervals;
  std::vector<double> rhythm;
  double occurrences = 0;
};

/** Likeness of two motif vocabularies' interval content (`surfaceSimilarity`). */
Nullable<double> surface_similarity(const std::vector<SurfaceMotif>& a,
                                    const std::vector<SurfaceMotif>& b);

/** The part of a reading the motif-structure measure reads (`MotifStructure`). */
struct MotifStructure {
  /** The derivation forest over motif statements. */
  MotifGraph graph;
  /** Length of the span the statements are read over, in beats. */
  double spanBeats = 0;
};

/** Likeness of how two readings' motifs derive from one another. */
Nullable<double> motif_structure_similarity(const MotifStructure& a, const MotifStructure& b);

/** The part of a phrase's melody the contour measure reads (`ContourPhrase`). */
struct ContourPhrase {
  MelodicContourShape shape = MelodicContourShape::kStatic;
  double low = 0;
  double high = 0;
  std::vector<double> outline;
};

/** Likeness of two phrase-by-phrase contour sequences (`contourSimilarity`). */
Nullable<double> contour_similarity(const std::vector<Nullable<ContourPhrase>>& a,
                                    const std::vector<Nullable<ContourPhrase>>& b);

/** The part of a phrase's melody the register measure reads (`RegisterPhrase`). */
struct RegisterPhrase {
  double low = 0;
  double high = 0;
  double mean = 0;
  double peakPosition = 0;
};

/** One reading's phrase registers and the piece's overall melodic mean (`RegisterPlan`). */
struct RegisterPlan {
  std::vector<Nullable<RegisterPhrase>> phrases;
  Nullable<double> mean;
};

/** Likeness of two phrase-by-phrase register sequences (`registerSimilarity`). */
Nullable<double> register_similarity(const RegisterPlan& a, const RegisterPlan& b);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_REFERENCE_MEASURES_H_
