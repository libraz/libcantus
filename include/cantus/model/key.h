/**
 * @file key.h
 * @brief Public C++ API of ts/src/model/key.ts: an immutable key, the factory of key-aware chords.
 *
 * A Key pairs a key/scale with the spelled tonic that anchors its letter names and the scale form
 * it stands in. The members returning chords and progressions name ChordValue and Progression,
 * declared in cantus/model/chord.h and cantus/model/progression.h.
 */
#ifndef CANTUS_MODEL_KEY_H_
#define CANTUS_MODEL_KEY_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/analyze/detect.h"
#include "cantus/analyze/functional.h"
#include "cantus/core/errors.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/model/interval.h"
#include "cantus/model/note.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

class ChordValue;
class Progression;
struct KeyPivot;
struct RelatedKeyEntry;
struct DetectedKeyMatch;

/** The order Key::pitch_classes() lists the scale in. */
enum class PitchClassOrder : std::uint8_t { kDegree, kAscending };

/** The TS name of an order ("degree" or "ascending"). */
std::string_view to_string(PitchClassOrder order);

/** The order named `name`, or nullopt. */
std::optional<PitchClassOrder> parse_pitch_class_order(std::string_view name);

/**
 * An immutable key/scale: a key/scale (root pitch class plus mode mask) paired with a spelled
 * tonic that anchors letter-name spelling and the scale form it stands in (`Key`).
 */
class Key {
 public:
  /**
   * Wrap a key/scale and its spelled tonic (`new Key`).
   * @param variant The scale form; read from the mask when absent.
   * @throws InvalidInputError if the scale is malformed, the tonic does not spell its root, or the
   *   variant does not match the mask.
   */
  Key(const KeyScale& scale, const Note& tonic, std::optional<KeyVariant> variant = std::nullopt);

  /** A major key on a note name (`Key.major`). */
  static Key major(std::string_view root);
  /** A major key on a pitch class, its tonic spelled the way the scale reads best. */
  static Key major(double root);
  /** A natural-minor key on a note name (`Key.minor`). */
  static Key minor(std::string_view root);
  /** A natural-minor key on a pitch class. */
  static Key minor(double root);
  /**
   * A key on a named scale (`Key.named`).
   * @throws InvalidInputError if the name is not a known scale.
   */
  static Key named(std::string_view name, std::string_view root);
  /** A key on a named scale and a root pitch class. */
  static Key named(std::string_view name, double root);

  /**
   * Parse a key name in any supported note-name system (`Key.parse`).
   * @throws InvalidInputError if the text is not a key name.
   */
  static Key parse(std::string_view text, const NoteNameOptions& opts = {});

  /** parse() reporting failure instead of throwing it (`Key.tryParse`). */
  static ParseResult<Key> try_parse(std::string_view text, const NoteNameOptions& opts = {});

  /**
   * The key a key signature denotes (`Key.fromFifths`).
   * @throws InvalidInputError if `fifths` is not an integer in [-12, 12].
   */
  static Key from_fifths(double fifths, KeyMode mode = KeyMode::kMajor);

  /**
   * Wrap any key-shaped value, keeping the spelling it carries (`Key.of`).
   * @param tonic A spelled tonic overriding the one the value carries.
   */
  static Key of(const KeyArg& key, const std::optional<Note>& tonic = std::nullopt);

  /** Rebuild a key from its data() (`Key.fromJSON`). */
  static Key from_json(const ResolvedKey& data);

  /** Wrap plain key data (`Key.fromData`). */
  static Key from_data(const ResolvedKey& data);

  /** The keys a set of pitches fits, best first (`Key.detect`). */
  static std::vector<Key> detect(const std::vector<int>& pitches,
                                 const DetectKeyOptions& opts = {});

  /** The keys a set of pitches fits, each with its score and form (`Key.detectMatches`). */
  static std::vector<DetectedKeyMatch> detect_matches(const std::vector<int>& pitches,
                                                      const DetectKeyOptions& opts = {});

  /** The single best key of a pitch set, or null (`Key.detectBest`). */
  static Nullable<Key> detect_best(const std::vector<int>& pitches,
                                   const DetectKeyOptions& opts = {});

  /** Whether another key has the same tonic pitch class and mode mask. */
  bool equals(const Key& other) const;

  /** The plain key/scale. */
  KeyScale scale() const noexcept { return scale_; }

  /** The spelled tonic. */
  const Note& tonic() const noexcept { return tonic_; }

  /** The tonic pitch class, 0..11 (`rootPc`). */
  int root_pc() const noexcept { return scale_.rootPc; }

  /** Whether the scale has a minor third and no major third (`isMinor`). */
  bool is_minor() const;

  /** The key signature as a signed count of sharps or flats (`fifths`). */
  int fifths() const;

  /** The NAMED_SCALES entry this key's mask is, or absent (`scaleName`). */
  std::optional<std::string_view> scale_name() const;

  /** The plain key data: key/scale, spelled tonic and form (`data`). */
  ResolvedKey data() const;

  /** The scale form (`variant`). */
  KeyVariant variant() const noexcept { return variant_; }

  /** The scale's pitch classes, by degree or ascending (`pitchClasses`). */
  std::vector<int> pitch_classes(PitchClassOrder order = PitchClassOrder::kDegree) const;

  /** The kind of pitch organisation the scale belongs to, or absent (`system`). */
  std::optional<ScaleSystem> system() const;

  /** Whether functional harmony describes the scale (`supportsFunctionalHarmony`). */
  bool supports_functional_harmony() const;

  /** The relative key (`relative`). */
  Key relative() const;
  /** The parallel key, on the same tonic spelling (`parallel`). */
  Key parallel() const;
  /** The key a fifth above (`dominantKey`). */
  Key dominant_key() const;
  /** The key a fifth below (`subdominantKey`). */
  Key subdominant_key() const;
  /** The same sounding key written the other way round the circle, or null (`enharmonic`). */
  Nullable<Key> enharmonic() const;
  /** The six closely related keys, each tagged with its relation (`relatedKeys`). */
  std::vector<RelatedKeyEntry> related_keys() const;
  /** How another key stands to this one, or null (`relationTo`). */
  Nullable<KeyRelation> relation_to(const Key& other) const;

  /** The chords a modulation into another key can pivot on (`pivotsTo`). */
  std::vector<KeyPivot> pivots_to(const KeyArg& other) const;

  /**
   * A 1-based scale degree (`degree`).
   * @throws InvalidInputError if `n` is not an integer within the scale's degrees.
   */
  Note degree(double n) const;

  /** The key rooted on one of this key's degrees (`keyOnDegree`). */
  Key key_on_degree(double n, const std::optional<KeyMode>& mode = std::nullopt) const;

  /** The key on whose degree `n` this key's tonic sits (`keyHavingTonicAsDegree`). */
  Key key_having_tonic_as_degree(double n, const std::optional<KeyMode>& mode = std::nullopt) const;

  /** Transpose by a spelled interval, keeping the spelling it names (`transposeBy`). */
  Key transpose_by(const IntervalArg& interval) const;

  /** The spelled interval from this key's tonic to another's (`intervalTo`). */
  Interval interval_to(const Key& other) const;

  /** Transpose by semitones, respelled to the key it would be written as (`transpose`). */
  Key transpose(double semitones) const;

  /** The key a transposing instrument's part is written in (`forInstrument`). */
  Key for_instrument(const IntervalArg& instrument) const;

  /** The spelled scale, one note per degree (`notes`). */
  std::vector<Note> notes() const;
  /** Alias of notes() (`spell`). */
  std::vector<Note> spell() const { return notes(); }
  /** The spelled scale as names (`noteNames`). */
  std::vector<std::string> note_names(const NoteNameOptions& opts = {}) const;

  /** Spell pitch classes the way this key writes them (`spellPitchClasses`). */
  std::vector<Note> spell_pitch_classes(const std::vector<double>& pcs,
                                        const std::optional<NoteArg>& tonic = std::nullopt) const;

  /** A chord on a scale degree carrying this key (`chord`). */
  ChordValue chord(double degree, const std::optional<ChordQuality>& quality = std::nullopt) const;
  /** The diatonic triad on a degree carrying this key (`diatonicTriad`). */
  ChordValue diatonic_triad(double degree) const;
  /** The diatonic seventh chord on a degree carrying this key (`diatonicSeventh`). */
  ChordValue diatonic_seventh(double degree) const;
  /** The chord a Roman numeral denotes in this key (`roman`). */
  ChordValue roman(std::string_view text) const;
  /** The augmented sixth chord of a kind, built in this key (`augmentedSixth`). */
  ChordValue augmented_sixth(AugmentedSixthKind kind) const;
  /** A progression from Roman numerals in this key (`progression`). */
  Progression progression(const std::vector<std::string>& romans) const;

  /** Whether a pitch's class is a scale tone (`contains`). */
  bool contains(double pitch) const;
  /** Whether a note's pitch class is a scale tone. */
  bool contains(const Note& note) const;

  /** The nearest in-scale MIDI pitch; a tie goes down (`nearestTone`). */
  double nearest_tone(double pitch) const;

  /** The 1-based degree a pitch sits on, or null when it is no scale tone (`degreeOf`). */
  Nullable<int> degree_of(double pitch) const;

  /** The plain key data (`toJSON`). */
  ResolvedKey to_json() const { return data(); }

  /** The key's name, e.g. "C major" or "D dorian" (`toString`). */
  std::string to_string(const NoteNameOptions& opts = {}) const;

 private:
  /** A key the theory layer spelled, its tonic kept as given. */
  static Key from_spelled(const ResolvedKey& spelled);
  /** A plain major or minor key on a derived tonic, held to the signatures keys are written in. */
  static Key mode_on(KeyMode mode, const Note& tonic);
  /** This key respelled to the enharmonic key it would be written as, or itself. */
  Key as_written() const;
  /** The mode a scale degree implies, read off its diatonic triad. */
  KeyMode mode_of_degree(double n) const;

  KeyScale scale_;
  Note tonic_;
  KeyVariant variant_;
};

/** One of the closely related keys of Key::related_keys(). */
struct RelatedKeyEntry {
  KeyRelation relation = KeyRelation::kRelative;
  Key key;
};

/** A detected key with the score and scale form that produced it (`DetectedKeyMatch`). */
struct DetectedKeyMatch {
  Key key;
  KeyNameMode mode = KeyNameMode::kMajor;
  KeyVariant variant = KeyVariant::kMajor;
  std::string scaleName;
  double fit = 0;
  double score = 0;
  std::optional<std::string> rationale;
  std::optional<std::vector<RejectedCandidate>> alternatives;
};

/** A detection match with its key wrapped as a Key (`detectedKeyMatch`). */
DetectedKeyMatch detected_key_match(const KeyMatch& match);

/**
 * Resolve any key-shaped value to a Key, keeping the spelling it carries (`toKey`).
 * @throws InvalidInputError if the value names no key.
 */
Key to_key(const KeyArg& value);

/** The plain key data carrying a key's identity (`keyIdentity`). */
ResolvedKey key_identity(const Key& key);

}  // namespace cantus

#endif  // CANTUS_MODEL_KEY_H_
