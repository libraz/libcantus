/**
 * @file voicing.h
 * @brief Public C++ API of ts/src/model/voicing.ts: an immutable voicing.
 */
#ifndef CANTUS_MODEL_VOICING_H_
#define CANTUS_MODEL_VOICING_H_

#include <array>
#include <optional>
#include <string>
#include <vector>

#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/model/note.h"
#include "cantus/theory/counterpoint.h"
#include "cantus/theory/partwriting.h"
#include "cantus/theory/safety.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"
#include "cantus/theory/voicing.h"

namespace cantus {

struct VoicingSafetyQuery;

/** Options of Voicing::independence() (`VoicingIndependenceOptions`). */
struct VoicingIndependenceOptions : VoiceIndependenceOptions {
  /** The key both lines are spelled in; a bare number is read as a sharp-spelled MIDI note when
   * absent. */
  std::optional<KeyArg> key;
};

/**
 * An immutable voicing: the pitches one chord sounds at one moment, lowest voice first
 * (`Voicing`). The order given is kept, so a voice crossing survives to be reported.
 */
class Voicing {
 public:
  /**
   * Wrap a set of sounding pitches (`new Voicing`); the order is kept and doubled pitches stay.
   * @throws InvalidInputError if the set is empty or a pitch is not a MIDI pitch.
   */
  explicit Voicing(const std::vector<double>& pitches);

  /** Wrap a set of sounding pitches (`Voicing.of`). */
  static Voicing of(const std::vector<double>& pitches);

  /**
   * Realize a chord as an explicit tertian voicing in a style (`Voicing.forChord`).
   * @throws InvalidInputError if the voicing would leave MIDI 0..127 or the style leaves no voice.
   */
  static Voicing for_chord(const ChordArg& chord, const StyledVoicingOptions& opts = {});

  /**
   * Realize a chord as one pitch per voice inside the voice ranges (`Voicing.satb`).
   * @param chord_key The key the chord carries, used when `opts.key` is absent.
   * @throws NoSolutionError if no voicing fits the ranges.
   */
  static Voicing satb(const ChordArg& chord, const VoicingOptions& opts = {},
                      const std::optional<KeyArg>& chord_key = std::nullopt);

  /** Wrap a pitch array (`Voicing.fromData`). */
  static Voicing from_data(const std::vector<double>& data);

  /** Rebuild a voicing from its `data()` (`Voicing.fromJSON`). */
  static Voicing from_json(const std::vector<double>& data);

  /** The default four-voice SATB ranges, ascending (`Voicing.satbRanges`). */
  static std::vector<VoiceRange> satb_ranges();

  /** The sounding MIDI pitches, lowest voice first. */
  const std::vector<double>& pitches() const noexcept { return pitches_; }

  /** The lowest and highest sounding pitch (`range`). */
  VoiceRange range() const;

  /** A copy of the underlying pitch array. */
  std::vector<double> data() const { return pitches_; }

  /**
   * Spell the voicing as notes with letters and octaves (`spell`).
   * @throws InvalidInputError if a value names no key or no chord.
   */
  std::vector<Note> spell(const KeyArg& key,
                          const std::optional<ChordArg>& chord = std::nullopt) const;

  /**
   * Voice a chord to follow smoothly from this voicing (`next`).
   * @param chord_key The key the chord carries, used when `opts.key` is absent.
   * @throws NoSolutionError if no voicing fits the ranges.
   */
  Voicing next(const ChordArg& chord, const VoicingOptions& opts = {},
               const std::optional<KeyArg>& chord_key = std::nullopt) const;

  /** The summed absolute motion to another voicing, infinity when the voice counts differ. */
  double cost_to(const Voicing& other) const;

  /** Check the motion from this voicing to another against the four-part rules (`checkTo`). */
  std::vector<PartWritingViolation> check_to(const Voicing& other,
                                             const std::array<ChordArg, 2>& chords,
                                             const KeyArg& key,
                                             const PartWritingOptions& opts = {}) const;

  /** Mark this voicing, read as a counterpoint line, against a cantus firmus (`species`). */
  std::vector<PartWritingViolation> species(const std::vector<NoteArg>& cantus_firmus, int species,
                                            const KeyArg& mode,
                                            const SpeciesOptions& opts = {}) const;

  /** Measure how independent this voicing, read as a line, is from another (`independence`). */
  VoiceIndependenceReport independence(const Voicing& other,
                                       const VoicingIndependenceOptions& opts = {}) const;

  /** Judge a candidate pitch placed against these voices (`safetyOf`). */
  SafetyResult safety_of(int pitch, const VoicingSafetyQuery& query,
                         const EvaluateSafetyOptions& opts = {}) const;

  /** The placeable pitches in a range, chord tones first (`safePitches`). */
  std::vector<double> safe_pitches(const VoicingSafetyQuery& query, double pitch_low,
                                   double pitch_high) const;

  /**
   * The n-th inversion: the lowest voice taken up an octave n times over (`invert`).
   * @throws InvalidInputError if `n` is outside [-128, 128] or a voice would leave MIDI 0..127.
   */
  Voicing invert(int n) const;

  /** Whether another voicing sounds the same pitches in the same order. */
  bool equals(const Voicing& other) const;

  /** The pitches separated by spaces ("60 64 67"). */
  std::string to_string() const;

 private:
  /** The safety context these voices supply, minus the candidate pitch. */
  SafetyContext context(const VoicingSafetyQuery& query) const;

  std::vector<double> pitches_;
};

/**
 * The context a candidate pitch is judged in, with the voices of a voicing standing as the other
 * parts (`VoicingSafetyQuery`).
 */
struct VoicingSafetyQuery {
  SafetyProfile profile = SafetyProfile::kStrict;
  /** The chord sounding under the candidate, or null when none is known. */
  Nullable<ChordArg> chord;
  /** The prevailing key. */
  KeyArg key = KeyArg(KeyScale{});
  /** The voicing these voices moved from, aligned voice for voice. */
  std::optional<Voicing> previous;
  std::optional<int> prevPitch;
  bool strongBeat = false;
  std::optional<int> vocalLow;
  std::optional<int> vocalHigh;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_VOICING_H_
