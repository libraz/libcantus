/**
 * @file chord.h
 * @brief Public C++ API of ts/src/model/chord.ts: an immutable chord carrying an optional key.
 *
 * The TS class is `Chord`; in C++ that name is the plain chord data of cantus/theory/chord.h
 * (the TS `ChordData`), so the class is ChordValue. Its spelling hints are derived from the key
 * on read, so re-attaching a key re-spells the chord; a spelling the caller supplied always wins.
 */
#ifndef CANTUS_MODEL_CHORD_H_
#define CANTUS_MODEL_CHORD_H_

#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "cantus/analyze/detect.h"
#include "cantus/analyze/functional.h"
#include "cantus/core/errors.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/generate/reharmony.h"
#include "cantus/model/key.h"
#include "cantus/model/note.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/chordscale.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"
#include "cantus/theory/voicing.h"

namespace cantus {

class Progression;
struct DetectedChordMatch;

/** A root or slash bass named by a note name or a pitch class (`string | number`). */
using ChordRootArg = std::variant<std::string, double>;

/**
 * An immutable chord: a root pitch class, quality, interval template and optional slash bass,
 * optionally carrying a Key context (`Chord`). The analysis methods use an explicitly passed key
 * first and fall back to the carried one.
 */
class ChordValue {
 public:
  /**
   * Wrap plain chord data (`new Chord`); it is copied.
   * @param key Optional key context for the analysis methods.
   * @throws InvalidInputError if an interval is not finite or the key names no key.
   */
  explicit ChordValue(const Chord& data, const std::optional<KeyArg>& key = std::nullopt);

  /**
   * A chord from a root and quality (`Chord.of`). A named root or bass keeps its spelling.
   * @throws InvalidInputError if a name is not a note or a number is not finite.
   */
  static ChordValue of(const ChordRootArg& root, ChordQuality quality,
                       const std::optional<ChordRootArg>& bass = std::nullopt);

  /** Wrap plain chord data (`Chord.fromData`). */
  static ChordValue from_data(const Chord& data);

  /** Rebuild a chord from its to_json(), without key context (`Chord.fromJSON`). */
  static ChordValue from_json(const Chord& data);

  /**
   * The chord a figured bass names (`Chord.fromFiguredBass`).
   * @throws InvalidInputError if the figures name no chord or the key is not heptatonic.
   */
  static ChordValue from_figured_bass(const NoteArg& bass, std::string_view figures,
                                      const KeyArg& key);

  /**
   * Parse a lead-sheet chord symbol (`Chord.parse`).
   * @throws InvalidInputError if the root or quality is not recognized.
   */
  static ChordValue parse(std::string_view symbol, const NoteNameOptions& opts = {});

  /** parse() reporting failure instead of throwing it (`Chord.tryParse`). */
  static ParseResult<ChordValue> try_parse(std::string_view symbol,
                                           const NoteNameOptions& opts = {});

  /** The chords matching a set of pitches, best first (`Chord.detect`). */
  static std::vector<ChordValue> detect(const std::vector<int>& pitches,
                                        const DetectChordOptions& opts = {});

  /** The chords matching a set of pitches, each with its match record (`Chord.detectMatches`). */
  static std::vector<DetectedChordMatch> detect_matches(const std::vector<int>& pitches,
                                                        const DetectChordOptions& opts = {});

  /** The single best chord of a pitch set, or null (`Chord.detectBest`). */
  static Nullable<ChordValue> detect_best(const std::vector<int>& pitches,
                                          const DetectChordOptions& opts = {});

  /** The root pitch class, 0..11 (`rootPc`). */
  double root_pc() const { return given_.rootPc; }
  /** The chord quality (`quality`). */
  ChordQuality quality() const { return given_.quality; }
  /** The semitone offsets above the root (`intervals`). */
  std::vector<double> intervals() const { return given_.intervals; }
  /** The slash bass pitch class, absent in root position (`bassPc`). */
  std::optional<double> bass_pc() const { return given_.bassPc; }

  /** The plain chord data, with the spellings the carried key derives filled in (`data`). */
  Chord data() const;

  /** The chord read structurally (`spec`). */
  ChordSpec spec() const;

  /** The carried key context (`key`). */
  const std::optional<Key>& key() const noexcept { return key_; }

  /** A copy carrying another key context (`withKey`). */
  ChordValue with_key(const KeyArg& key) const;

  /** The sorted, deduplicated pitch classes, slash bass included (`pitchClasses`). */
  std::vector<int> pitch_classes(const ChordPitchClassOptions& opts = {}) const;

  /** Whether a pitch is one of the chord's tones, ignoring octave (`contains`). */
  bool contains(double pitch) const;

  /** A pitch's role in the chord, or null for a tension or a foreign note (`roleOf`). */
  Nullable<ChordToneRole> role_of(double pitch) const;

  /**
   * The Roman numeral in a key, or in the carried key (`roman`).
   * @throws InvalidInputError if no key is given and none is carried.
   */
  std::string roman(const std::optional<KeyArg>& key = std::nullopt,
                    const ChordToRomanOptions& opts = {}) const;

  /** The Roman numeral with its rationale (`explain`). */
  RomanExplanation explain(const std::optional<KeyArg>& key = std::nullopt,
                           const ExplainRomanOptions& opts = {}) const;

  /** The harmonic function in a key (`function`). */
  HarmonicFunction function(const std::optional<KeyArg>& key = std::nullopt) const;

  /** Function, borrowing, numeral and rationale (`analyze`). */
  ChordAnalysis analyze(const std::optional<KeyArg>& key = std::nullopt,
                        const AnalyzeChordOptions& opts = {}) const;

  /** Whether the chord is borrowed from the parallel mode (`isBorrowed`). */
  bool is_borrowed(const std::optional<KeyArg>& key = std::nullopt) const;

  /** Where a non-diatonic chord comes from, or null (`borrowedSource`). */
  Nullable<BorrowedSource> borrowed_source(const std::optional<KeyArg>& key = std::nullopt) const;

  /** The figures a bass would carry under the chord (`figuredBass`). */
  std::string figured_bass(const std::optional<KeyArg>& key = std::nullopt) const;

  /** The chords that can stand in for this one in a key (`substitutions`). */
  std::vector<Substitution> substitutions(const std::optional<KeyArg>& key = std::nullopt,
                                          const SubstituteOptions& opts = {}) const;

  /** The modal-interchange palette of the key (`modalInterchange`). */
  std::vector<BorrowedChord> modal_interchange(
      const std::optional<KeyArg>& key = std::nullopt) const;

  /** The lead-sheet symbol (`symbol`). */
  std::string symbol(const ChordSymbolOptions& opts = {}) const;

  /** One MIDI pitch per voice, ascending; the carried key reaches the voicer (`voice`). */
  std::vector<int> voice(const VoicingOptions& opts = {}) const;

  /** A single styled voicing (`styledVoicing`). */
  std::vector<int> styled_voicing(const StyledVoicingOptions& opts = {}) const;

  /** The negative-harmony mirror about the key's axis, carrying that key (`negativeHarmony`). */
  ChordValue negative_harmony(const std::optional<KeyArg>& key = std::nullopt) const;

  /** The V7 that tonicizes this chord (`secondaryDominant`). */
  ChordValue secondary_dominant() const;

  /**
   * The n-th inversion; `n` wraps around the template length (`invert`).
   * @throws InvalidInputError if the chord has no intervals.
   */
  ChordValue invert(double n) const;

  /** Transpose by semitones; a carried key moves with the chord (`transpose`). */
  ChordValue transpose(double semitones) const;

  /** Transpose by a spelled interval; a carried key moves with the chord (`transposeBy`). */
  ChordValue transpose_by(const IntervalArg& interval) const;

  /** The named scales that fit over the chord, best first (`scales`). */
  std::vector<ChordScaleMatch> scales() const;

  /** The fitting scales read as playing advice (`scaleReport`). */
  std::vector<ChordScaleReportEntry> scale_report(
      const std::optional<double>& limit = std::nullopt) const;

  /** The available tensions of a scale over the chord (`tensions`). */
  std::vector<int> tensions(std::string_view scale_name,
                            const AvailableTensionsOptions& opts = {}) const;

  /** The avoid notes of a scale over the chord (`avoidNotes`). */
  std::vector<int> avoid_notes(std::string_view scale_name,
                               const AvoidNotesOptions& opts = {}) const;

  /**
   * The chord tones spelled with letter names, root first (`spell`).
   * @throws InvalidInputError if no key is given or carried and the chord has no root spelling.
   */
  std::vector<Note> spell(const std::optional<KeyArg>& key = std::nullopt) const;

  /** A progression of this chord and the others, carrying this chord's key (`progressionTo`). */
  Progression progression_to(const std::vector<ChordValue>& others) const;

  /** The chord placed at a beat (`span`). */
  ChordSpan span(double start_beat) const;

  /** Whether another chord has the same root, quality, intervals and bass (`equals`). */
  bool equals(const ChordValue& other) const;

  /** The chord data with only the spellings the caller supplied (`toJSON`). */
  const Chord& to_json() const noexcept { return given_; }

  /** The chord symbol (`toString`). */
  std::string to_string() const { return symbol(); }

 private:
  /** The read view whose missing spellings are derived from `key`. */
  Chord data_with_key(const std::optional<Key>& key) const;
  /** The key an analysis method reads: the explicit one, else the carried one. */
  Key resolve_analysis_key(const std::optional<KeyArg>& key) const;

  Chord given_;
  std::optional<Key> key_;
};

/** A detected chord beside its match record (`Chord.detectMatches` entries). */
struct DetectedChordMatch {
  ChordValue chord;
  ChordMatch match;
};

/** A chord a modulation can pivot on, with its numeral in both keys (`Key#pivotsTo` entries). */
struct KeyPivot {
  ChordValue chord;
  std::string romanFrom;
  std::string romanTo;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_CHORD_H_
