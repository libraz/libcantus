/**
 * @file progression.h
 * @brief Public C++ API of ts/src/model/progression.ts: an immutable ordered sequence of chords
 *        sharing an optional key context.
 *
 * The progression key is attached to every member chord, so the members never disagree with the
 * progression about which key spells them.
 */
#ifndef CANTUS_MODEL_PROGRESSION_H_
#define CANTUS_MODEL_PROGRESSION_H_

#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/generate/reharmony.h"
#include "cantus/model/chord.h"
#include "cantus/model/key.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/chordscale.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/voicing.h"

namespace cantus {

class Timeline;

/** The plain form of a Progression (`ProgressionData`). */
struct ProgressionData {
  std::vector<Chord> chords;
  /** The carried key, absent when there is none. */
  std::optional<ResolvedKey> key;
};

/** Options of Progression::analyze(): the chord and cadence options, over the whole progression. */
struct ProgressionAnalyzeOptions : AnalyzeChordOptions {
  /** The chord before the progression, for a progression too short to supply its own. */
  std::optional<ChordArg> approach;
  /** One voicing per chord as Progression::voice() produces them, or the closing pair. */
  std::optional<std::vector<std::vector<double>>> voicing;
};

/** The result of Progression::analyze(). */
struct ProgressionAnalysis {
  std::vector<ChordAnalysis> chords;
  /** The closing cadence; null with fewer than two chords. */
  Nullable<CadenceResult> cadence;
};

/** Options of Progression::cadences(). */
struct ProgressionCadenceOptions {
  /** One voicing per chord, from which each pair takes its own two. */
  std::optional<std::vector<std::vector<double>>> voicing;
  /** Report the cadences each pair came close to forming. */
  std::optional<bool> alternatives;
  /** The chord sounding before the progression began. */
  std::optional<ChordArg> approach;
};

/**
 * An immutable ordered sequence of chords, optionally carrying a Key context shared by its
 * analysis methods (`Progression`).
 */
class Progression {
 public:
  /**
   * Wrap a chord sequence (`new Progression`); the key is attached to every chord.
   * @throws InvalidInputError if the key names no key.
   */
  explicit Progression(const std::vector<ChordValue>& chords,
                       const std::optional<KeyArg>& key = std::nullopt);

  /** Start from a chord sequence (`Progression.of`). */
  static Progression of(const std::vector<ChordValue>& chords,
                        const std::optional<KeyArg>& key = std::nullopt);

  /** A progression of the harmony of chord spans, in order (`Progression.fromSpans`). */
  static Progression from_spans(const std::vector<ChordSpan>& spans,
                                const std::optional<KeyArg>& key = std::nullopt);

  /** Rebuild a progression from its to_json() (`Progression.fromJSON`). */
  static Progression from_json(const ProgressionData& data);

  /** Wrap plain progression data (`Progression.fromData`). */
  static Progression from_data(const ProgressionData& data);

  /** The chord sequence (`chords`). */
  const std::vector<ChordValue>& chords() const noexcept { return chords_; }

  /** The carried key context (`key`). */
  const std::optional<Key>& key() const noexcept { return key_; }

  /** The plain progression data (`data`). */
  ProgressionData data() const { return to_json(); }

  /** The number of chords (`length`). */
  std::size_t length() const noexcept { return chords_.size(); }

  /** The chord at an index, negative from the end, as Array.prototype.at reads it (`at`). */
  std::optional<ChordValue> at(double index) const;

  /** Iterate the chords in order. */
  std::vector<ChordValue>::const_iterator begin() const noexcept { return chords_.begin(); }
  std::vector<ChordValue>::const_iterator end() const noexcept { return chords_.end(); }

  /** Whether another progression holds the same chords in the same order (`equals`). */
  bool equals(const Progression& other) const;

  /** A copy with a chord appended (`add`). */
  Progression add(const ChordValue& chord) const;

  /** A progression of what `fn` returns for each chord, keeping the key (`map`). */
  Progression map(const std::function<ChordValue(const ChordValue&, std::size_t)>& fn) const;

  /** The chords `pred` accepts, keeping the key (`filter`). */
  Progression filter(const std::function<bool(const ChordValue&, std::size_t)>& pred) const;

  /** A stretch, with bounds read as Array.prototype.slice reads them (`slice`). */
  Progression slice(const std::optional<double>& start = std::nullopt,
                    const std::optional<double>& end = std::nullopt) const;

  /** This progression followed by another's chords, keeping this key (`concat`). */
  Progression concat(const Progression& other) const;
  /** This progression followed by more chords. */
  Progression concat(const std::vector<ChordValue>& chords) const;

  /** The position of the first equal chord, or -1 (`indexOf`). */
  int index_of(const ChordValue& chord) const;

  /** A copy carrying another key context (`withKey`). */
  Progression with_key(const KeyArg& key) const;

  /** One ascending voicing per chord, with smooth voice leading (`voice`). */
  std::vector<std::vector<int>> voice(const VoicingOptions& opts = {}) const;

  /** The Roman numeral of each chord (`roman`). */
  std::vector<std::string> roman(const std::optional<KeyArg>& key = std::nullopt,
                                 const ChordToRomanOptions& opts = {}) const;

  /** The harmonic function of each chord (`functions`). */
  std::vector<HarmonicFunction> functions(const std::optional<KeyArg>& key = std::nullopt) const;

  /**
   * Analyze every chord and classify the closing cadence (`analyze`).
   * @throws InvalidInputError if no key is given and none is carried, or the voicing holds
   *   neither one voicing per chord nor the closing pair.
   */
  ProgressionAnalysis analyze(const std::optional<KeyArg>& key = std::nullopt,
                              const ProgressionAnalyzeOptions& opts = {}) const;

  /** One compatible scale per chord, favoring smooth changes (`scales`). */
  std::vector<ScaleChoice> scales() const;

  /** The motion at every chord change, one entry per adjacent pair (`cadences`). */
  std::vector<CadenceResult> cadences(const std::optional<KeyArg>& key = std::nullopt,
                                      const ProgressionCadenceOptions& opts = {}) const;

  /**
   * A copy with one chord replaced by the first substitute of a kind (`substitute`).
   * @throws InvalidInputError if the index names no chord, no key is carried, or the chord has
   *   no substitution of that kind.
   */
  Progression substitute(double index, SubstitutionType type,
                         const SubstituteOptions& opts = {}) const;

  /** The chords on a regular grid (`timeline`). */
  Timeline timeline(double beats_each) const;

  /** Transpose every chord by semitones; a carried key moves with them (`transpose`). */
  Progression transpose(double semitones) const;

  /** Transpose every chord by a spelled interval (`transposeBy`). */
  Progression transpose_by(const IntervalArg& interval) const;

  /**
   * Transpose so the key becomes `target`, which the result carries (`transposeTo`).
   * @throws InvalidInputError if the progression carries no key.
   */
  Progression transpose_to(const KeyArg& target) const;

  /** The chord symbols separated by spaces (`toString`). */
  std::string to_string() const;

  /** The plain progression data (`toJSON`). */
  ProgressionData to_json() const;

 private:
  /** The key an analysis method reads: the explicit one, else the carried one. */
  Key resolve_analysis_key(const std::optional<KeyArg>& key) const;
  /** The carried key as a constructor argument. */
  std::optional<KeyArg> carried_key() const;

  std::vector<ChordValue> chords_;
  std::optional<Key> key_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_PROGRESSION_H_
