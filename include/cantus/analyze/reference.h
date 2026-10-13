/**
 * @file reference.h
 * @brief Public C++ API of ts/src/analyze/reference: a structural fingerprint of a piece (form,
 *        phrase shape, harmonic function, rhythm, and how its motifs derive from one another),
 *        and the comparison of two of them dimension by dimension.
 */
#ifndef CANTUS_ANALYZE_REFERENCE_H_
#define CANTUS_ANALYZE_REFERENCE_H_

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/analyze/form.h"
#include "cantus/analyze/functional.h"
#include "cantus/analyze/melody.h"
#include "cantus/analyze/reduction.h"
#include "cantus/analyze/rhythm.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/limits.h"
#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** How a melodic line reads within one phrase (`ReferencePhraseMelody`). */
struct ReferencePhraseMelody {
  /** The phrase's overall shape. */
  MelodicContourShape shape = MelodicContourShape::kStatic;
  /** Lowest pitch sounding in the phrase. */
  int low = 0;
  /** Highest pitch sounding in the phrase. */
  int high = 0;
  /** Duration-weighted mean pitch, truncated to the phrase's span. */
  double mean = 0;
  /** Pitch of the phrase's highest note (the first, when several tie). */
  double peakPitch = 0;
  /** Onset of the phrase's peak note, as a fraction of the phrase's length, in [0, 1]. */
  double peakPosition = 0;
  /** Eight sampled points across the phrase, each the sounding pitch minus the melodic mean. */
  std::vector<double> outline;
  /** Onsets per bar within the phrase. */
  double onsetDensity = 0;
  /** Share of the phrase during which nothing sounds. */
  double restRatio = 0;
};

/** A cadence read at a structural boundary (`ReferenceCadence`). */
struct ReferenceCadence {
  /** Beat the cadence arrives at. */
  double atBeat = 0;
  CadenceType type = CadenceType::kAuthentic;
  /** How strongly the cadence closes the boundary it sits at, in [0, 1]. */
  double weight = 0;
};

/** One phrase: its span, its section, how it cadences, and the content within it. */
struct ReferencePhrase {
  double startBeat = 0;
  double endBeat = 0;
  /** The phrase's length in bars. */
  double bars = 0;
  /** Index into the form's sections of the section the phrase's start beat falls in. */
  Nullable<std::size_t> section;
  /** Confidence of the phrase boundary, in [0, 1]. */
  double confidence = 0;
  /** The cadence the phrase ends on, or null when it closes on none. */
  Nullable<ReferenceCadence> cadence;
  /** The phrase's melodic descriptors, or null when fewer than two notes sound within it. */
  Nullable<ReferencePhraseMelody> melody;
  /** Indices into the melody graph's nodes of every motif statement that starts in the phrase. */
  std::vector<std::size_t> motifNodes;
};

/** The hyperbar grouping the phrase and section boundaries are read against. */
struct ReferenceHypermeter {
  double groupBars = 0;
  double confidence = 0;
};

/** The formal reading of a profiled piece (`ReferenceForm`). */
struct ReferenceForm {
  ReferenceHypermeter hypermeter;
  std::vector<FormSection> sections;
  std::vector<ReferencePhrase> phrases;
};

/** One span of the piece read in a single key (`ReferenceKeyRegion`). */
struct ReferenceKeyRegion {
  double startBeat = 0;
  double endBeat = 0;
  ResolvedKey key;
  /** Confidence of the key reading, in [0, 1]. */
  double confidence = 0;
};

/** One reduced chord, named against the key region it falls in (`ReferenceChord`). */
struct ReferenceChord {
  double startBeat = 0;
  double endBeat = 0;
  /** Index into the harmony's key regions of the region this chord is read against. */
  std::size_t key = 0;
  /** The chord, as a Roman numeral in the region's key. */
  std::string roman;
  HarmonicFunction function = HarmonicFunction::kTonic;
  /** How the chord survived harmonic reduction. */
  ReductionLevel level = ReductionLevel::kStructural;
};

/** The harmonic reading of a profiled piece (`ReferenceHarmony`). */
struct ReferenceHarmony {
  std::vector<ReferenceKeyRegion> keys;
  std::vector<ReferenceChord> chords;
  /** Onset placement of chord changes, read the way a melodic line's onsets are. */
  RhythmAnalysis rhythm;
};

/** The melodic line's pitch range and mean. */
struct ReferenceRegister {
  int low = 0;
  int high = 0;
  double mean = 0;
};

/** One motif, held as the interval and rhythm ratios it repeats under transformation. */
struct ReferenceMotif {
  /** Semitones between consecutive notes of the first statement. */
  std::vector<double> intervals;
  /** Onset-to-onset ratios of the first statement, each gap over the first. */
  std::vector<double> rhythm;
  /** Onset gap between the first two notes of the first statement, in beats. */
  double unitBeats = 0;
  /** Length of the first statement, in beats. */
  double spanBeats = 0;
  /** How many statements of this motif were found. */
  double occurrences = 0;
};

/** The melodic reading of a profiled piece (`ReferenceMelody`). */
struct ReferenceMelody {
  /** The line's pitch range and mean, or null when no note sounds (`register`). */
  Nullable<ReferenceRegister> register_;
  /** The line's overall shape, or null when fewer than two notes sound. */
  Nullable<MelodicContourShape> shape;
  std::vector<ReferenceMotif> motifs;
  /** How the motifs' statements derive from one another. */
  MotifGraph graph;
  /** Onset placement of the melodic line. */
  RhythmAnalysis rhythm;
};

/** The analysed span of a profile. */
struct ReferenceSpan {
  double startBeat = 0;
  double endBeat = 0;
  double bars = 0;
};

/** A structural fingerprint of a piece (`ReferenceProfile`). */
struct ReferenceProfile {
  /** Schema version this record is written at; see REFERENCE_PROFILE_VERSION. */
  double profileVersion = REFERENCE_PROFILE_VERSION;
  ReferenceSpan span;
  /** The piece's meter across the analysed span. */
  MeterMap meters;
  ReferenceForm form;
  ReferenceHarmony harmony;
  ReferenceMelody melody;
};

/** Options of analyze_reference() (`ReferenceProfileOptions`). */
struct ReferenceProfileOptions {
  /** A single time signature held across the whole span; defaults to 4/4. */
  std::optional<MeterArg> ts;
  /** The meter as it changes over the span; defaults to 4/4 throughout. */
  std::optional<MeterArg> meters;
  /** The key, when it is already known: one key across the whole span. */
  std::optional<KeyArg> key;
  /** The harmony, given rather than inferred. */
  std::optional<ChordTimeline> timeline;
  /** The melodic line; the top line of the notes by default. */
  std::optional<std::vector<NoteEvent>> melody;
  /** End of the analysed span in beats. */
  std::optional<double> totalBeats;
  /** Upper bound on the work each analysis may do. */
  std::optional<double> budget;
};

/** Options of compare_references() (`ReferenceComparisonOptions`). */
struct ReferenceComparisonOptions {
  /** Upper bound on the cells of the progression alignment. */
  std::optional<double> budget;
};

/** Formal layout likenesses. */
struct FormLikeness {
  Nullable<double> sectionSequenceSimilarity;
  Nullable<double> phraseLengthSimilarity;
};

/** Harmony likenesses. */
struct HarmonyLikeness {
  Nullable<double> progressionSimilarity;
  Nullable<double> functionSimilarity;
  Nullable<double> cadenceSimilarity;
  Nullable<double> keyPlanSimilarity;
  Nullable<double> harmonicRhythmOnsetSimilarity;
  Nullable<double> harmonicRhythmDensitySimilarity;
};

/** Melody likenesses. */
struct MelodyLikeness {
  Nullable<double> surfaceSimilarity;
  Nullable<double> motifStructureSimilarity;
  Nullable<double> contourSimilarity;
  Nullable<double> registerSimilarity;
};

/** Melodic rhythm likenesses. */
struct RhythmLikeness {
  Nullable<double> onsetSimilarity;
  Nullable<double> densitySimilarity;
  Nullable<double> durationSimilarity;
  Nullable<double> syncopationSimilarity;
};

/** How alike two profiled pieces are, one field per aspect (`ReferenceComparison`). */
struct ReferenceComparison {
  FormLikeness form;
  HarmonyLikeness harmony;
  MelodyLikeness melody;
  RhythmLikeness rhythm;
  /** The two most and the two least alike fields, by name. */
  std::string rationale;
};

/**
 * Read a piece's structure into a profile (`analyzeReference`): its form, phrase shapes, harmonic
 * function and rhythm, motif derivations and melodic rhythm, without the notes themselves.
 * @throws InvalidInputError if the notes or an option cannot be read.
 * @throws BudgetExceededError if an analysis would exceed the budget.
 */
ReferenceProfile analyze_reference(const std::vector<NoteEvent>& notes,
                                   const ReferenceProfileOptions& opts = {});

/**
 * Reject a profile that does not hold together (`assertReferenceProfile`): a distribution that no
 * longer sums to 1, an index left dangling, a numeral no reader can parse.
 * @returns The same profile.
 * @throws InvalidInputError naming the path to the field that is wrong.
 */
const ReferenceProfile& assert_reference_profile(const ReferenceProfile& value,
                                                 std::string_view name = "reference profile");

/**
 * Compare two profiled pieces aspect by aspect (`compareReferences`): form, harmony, melody and
 * melodic rhythm.
 * @throws InvalidInputError if either profile cannot be read.
 * @throws BudgetExceededError if the progression alignment would exceed the budget.
 */
ReferenceComparison compare_references(const ReferenceProfile& a, const ReferenceProfile& b,
                                       const ReferenceComparisonOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_ANALYZE_REFERENCE_H_
