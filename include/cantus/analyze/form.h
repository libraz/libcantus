/**
 * @file form.h
 * @brief Public C++ API of ts/src/analyze/form: the units larger than the chord, as phrases,
 *        hypermeter and sections.
 */
#ifndef CANTUS_ANALYZE_FORM_H_
#define CANTUS_ANALYZE_FORM_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/analyze/timeline.h"
#include "cantus/analyze/voice.h"
#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"

namespace cantus {

/** A bar grouping inferred from the music (`Hypermeter`). */
struct Hypermeter {
  /** Bars per hyperbar. */
  int groupBars = 0;
  /** Absolute beat of each hypermetric downbeat inside the analysed span, in time order. */
  std::vector<double> downbeats;
  /** How much the music supports the grouping, in [0, 1]. */
  double confidence = 0;
  /** Why this grouping was chosen. */
  std::string rationale;
};

/** Options of hypermeter() (`HypermeterOptions`). */
struct HypermeterOptions {
  /** End of the analysed span in beats; defaults to the end of the last note. */
  std::optional<double> totalBeats;
  /** Beats at which cadences arrive, as CadenceHit::atBeat reports them. */
  std::optional<std::vector<double>> cadenceBeats;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/** A reason a phrase boundary was placed where it was (`PhraseSignal`). */
enum class PhraseSignal : std::uint8_t {
  kCadence,
  kRest,
  kLongNote,
  kRepetition,
  kHypermeter,
  kPieceEnd,
};

/** The TS name of a signal ("cadence", "rest", "longNote", "repetition", ...). */
std::string_view to_string(PhraseSignal signal);

/** The signal named `name`, or nullopt. */
std::optional<PhraseSignal> parse_phrase_signal(std::string_view name);

/** One phrase: a span of music closed by a boundary, and the evidence for it (`Phrase`). */
struct Phrase {
  /** First beat of the phrase; negative when it begins in a pickup. */
  double startBeat = 0;
  /** End of the phrase, exclusive. */
  double endBeat = 0;
  /** The cadence closing the phrase, or null when the boundary rests on the melody and metre. */
  Nullable<CadenceHit> cadence;
  /** Why the closing boundary was placed here, strongest evidence first. */
  std::vector<PhraseSignal> signals;
  /** How well evidenced the phrase is, in [0, 1]. */
  double confidence = 0;
  /** How much structural weight the closing cadence carries, in [0, 1]. */
  double structuralWeight = 0;
  /** A short reading of the phrase in words. */
  std::string rationale;
};

/** Options of phrases_from_timeline() (`PhraseOptions`). */
struct PhraseOptions {
  /** A single time signature held across the whole span; defaults to 4/4. */
  std::optional<MeterArg> ts;
  /** The meter as it changes over the span; defaults to 4/4 throughout. */
  std::optional<MeterArg> meters;
  /** Key context for cadence detection; searched for over time when absent. */
  std::optional<KeyContext> key;
  /** End of the analysed span in beats; defaults to the end of the input. */
  std::optional<double> totalBeats;
  /** Length a phrase is expected to run, in beats; defaults to one hyperbar. */
  std::optional<double> expectedPhraseBeats;
  /** Shortest phrase that may be reported, in beats; defaults to one bar. */
  std::optional<double> minPhraseBeats;
  /** Silence at least this long divides phrases; defaults to half a bar. */
  std::optional<double> restBeats;
  /** A note held at least this long closes a phrase; defaults to one bar. */
  std::optional<double> longNoteBeats;
  /** A hypermeter already computed for this piece, to be used instead of inferring one. */
  std::optional<Hypermeter> hypermeter;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/** A cadence ranked by how much of the structure it closes (`StructuralCadence`). */
struct StructuralCadence {
  /** Index of the phrase this cadence closes. */
  std::size_t phraseIndex = 0;
  /** The beat the cadence arrives on. */
  double atBeat = 0;
  /** The beat the phrase it closes ends at. */
  double endBeat = 0;
  CadenceResult cadence;
  /** Structural weight in [0, 1]. */
  double weight = 0;
  /** Why it weighs what it does. */
  std::string rationale;
};

/** A span of music labelled by which earlier span it restates (`FormSection`). */
struct FormSection {
  /** The section's letter, assigned in order of first appearance (A, B, ..., Z, AA, ...). */
  std::string label;
  /** First beat of the section; negative when it opens with a pickup. */
  double startBeat = 0;
  /** End of the section, exclusive. */
  double endBeat = 0;
  /** The section's length in bars. */
  double bars = 0;
  /** Index of the first section carrying this label. */
  std::size_t firstOccurrence = 0;
  /** How alike this section and its first occurrence are, in [0, 1]. */
  double similarity = 0;
  /** How the section came to carry its label. */
  std::string rationale;
};

/** Options of sections_from_notes() (`FormSectionOptions`). */
struct FormSectionOptions {
  /** A single time signature held across the whole span; defaults to 4/4. */
  std::optional<MeterArg> ts;
  /** The meter as it changes over the span; defaults to 4/4 throughout. */
  std::optional<MeterArg> meters;
  /** Length of the unit spans are compared in, in bars; defaults to one hyperbar. */
  std::optional<double> unitBars;
  /** How alike two units must be before the later one restates the earlier, in [0, 1]. */
  std::optional<double> threshold;
  /** End of the analysed span in beats; defaults to the end of the last note. */
  std::optional<double> totalBeats;
  /** Upper bound on the work this call may do. */
  std::optional<double> budget;
};

/**
 * Infer how a piece's bars group into hyperbars (`hypermeter`). Notes that never sound are
 * dropped; `meter` defaults to 4/4 throughout.
 * @throws InvalidInputError if a note or an option is invalid.
 * @throws BudgetExceededError if the work exceeds the budget.
 */
Hypermeter hypermeter(const std::vector<NoteEvent>& notes,
                      const std::optional<MeterArg>& meter = std::nullopt,
                      const HypermeterOptions& opts = {});

/**
 * Split a piece into phrases (`phrasesFromTimeline`): one phrase covering the whole span when it
 * is too short to divide, and none when nothing sounds.
 * @throws InvalidInputError if the timeline, a note or an option is invalid.
 * @throws BudgetExceededError if the work exceeds the budget.
 */
std::vector<Phrase> phrases_from_timeline(const ChordTimeline& timeline,
                                          const std::vector<NoteEvent>& notes,
                                          const PhraseOptions& opts = {});

/** Rank the cadences that close phrases by how much structure they close, heaviest first. */
std::vector<StructuralCadence> structural_cadences(const std::vector<Phrase>& phrases);

/**
 * Recover a piece's sections from what it repeats (`sectionsFromNotes`), in time order.
 * @throws InvalidInputError if a note or an option is invalid.
 * @throws BudgetExceededError if the work exceeds the budget.
 */
std::vector<FormSection> sections_from_notes(const std::vector<NoteEvent>& notes,
                                             const FormSectionOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_ANALYZE_FORM_H_
