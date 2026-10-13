/**
 * @file scale.h
 * @brief Public C++ API of ts/src/theory/scale: mode masks, named scales, keys, scale degrees,
 *        key signatures and key relations.
 *
 * A key is three facts: the pitch classes it is built from (KeyScale), the spelled tonic its
 * letter names are anchored on, and the scale form it stands in (KeyVariant). ResolvedKey holds
 * all three; KeyArg accepts every form a key reaches an entry point in.
 */
#ifndef CANTUS_THEORY_SCALE_H_
#define CANTUS_THEORY_SCALE_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"

namespace cantus {

/** Which scale form a key stands in (`KeyVariant`). */
enum class KeyVariant : std::uint8_t { kMajor, kNatural, kHarmonic, kMelodic, kModal };

/** The TS name of a variant ("major", "natural", "harmonic", "melodic", "modal"). */
std::string_view to_string(KeyVariant variant);

/** The variant named `name`, or nullopt. */
std::optional<KeyVariant> parse_key_variant(std::string_view name);

/** Which of the two modes a key signature is read in (`KeyMode`). */
using KeyMode = KeyNameMode;

/** How one key stands to another (`KeyRelation`). */
enum class KeyRelation : std::uint8_t {
  kSame,
  kEnharmonic,
  kRelative,
  kParallel,
  kDominant,
  kSubdominant,
  kRelativeOfDominant,
  kRelativeOfSubdominant,
};

/** The TS name of a relation ("same", ..., "relativeOfSubdominant"). */
std::string_view to_string(KeyRelation relation);

/** The kind of pitch organisation a scale belongs to (`ScaleSystem`). */
enum class ScaleSystem : std::uint8_t { kCommonPractice, kModal, kNonFunctional };

/** The TS name of a system ("common-practice", "modal", "non-functional"). */
std::string_view to_string(ScaleSystem system);

/** The system named `name`, or nullopt. */
std::optional<ScaleSystem> parse_scale_system(std::string_view name);

/** A built key: a key/scale with the tonic and form it is conventionally written in. */
struct SpelledKeyScale {
  int rootPc = 0;
  int modeMask12 = 0;
  /** The tonic the key is conventionally written on. */
  NoteData tonic;
  /** The scale form the mask stands in. */
  KeyVariant variant = KeyVariant::kMajor;

  /** The key/scale alone. */
  KeyScale scale() const { return KeyScale{rootPc, modeMask12}; }
};

/** A key read whole: pitch classes, spelled tonic and scale form (`ResolvedKey`). */
struct ResolvedKey {
  KeyScale scale;
  /** The spelled tonic, without an octave. */
  NoteData tonic;
  KeyVariant variant = KeyVariant::kMajor;
};

/** One of the closely related keys of relatedKeysOf, tagged with its relation. */
struct RelatedKey {
  NoteData tonic;
  KeyScale scale;
  KeyVariant variant = KeyVariant::kMajor;
  KeyRelation relation = KeyRelation::kRelative;
};

/** Key data as a project file holds it: a scale, with its spelling and form when known. */
struct KeyData {
  KeyScale scale;
  /** The spelled tonic, when the caller named one. */
  std::optional<NoteData> tonic;
  /** The scale form, when the key was read under one. */
  std::optional<KeyVariant> variant;
};

/**
 * Anything that names a key (`KeyLike`): a key name, a key/scale, key data, or any value whose
 * `data()` returns key data.
 */
class KeyArg {
 public:
  /** The forms a KeyArg holds. */
  using Value = std::variant<std::string, KeyData>;

  KeyArg(std::string name) : value_(std::move(name)) {}                           // NOLINT
  KeyArg(std::string_view name) : value_(std::string(name)) {}                    // NOLINT
  KeyArg(const char* name) : value_(std::string(name)) {}                         // NOLINT
  KeyArg(KeyScale scale) : value_(KeyData{scale, std::nullopt, std::nullopt}) {}  // NOLINT
  KeyArg(KeyData data) : value_(std::move(data)) {}                               // NOLINT
  KeyArg(const ResolvedKey& key)                                                  // NOLINT
      : value_(KeyData{key.scale, key.tonic, key.variant}) {}
  KeyArg(const SpelledKeyScale& key)  // NOLINT
      : value_(KeyData{key.scale(), key.tonic, key.variant}) {}
  /** A value whose `data()` returns key data. */
  template <class T,
            std::enable_if_t<
                std::is_convertible_v<decltype(std::declval<const T&>().data()), KeyData>, int> = 0>
  KeyArg(const T& value) : value_(KeyData(value.data())) {}  // NOLINT

  /** The form this argument holds. */
  const Value& value() const noexcept { return value_; }

 private:
  Value value_;
};

/** Where a pitch sits on a key's ladder of scale tones (`ScaleLadderPosition`). */
struct ScaleLadderPosition {
  /** Scale tones from the tonic, continuing across octaves; negative below octave 0. */
  double rung = 0;
  /** Semitones the pitch sounds above that rung. */
  double offset = 0;
};

/** A scale name and its mask: one entry of NAMED_SCALES or WORLD_SCALES. */
struct NamedScaleMask {
  std::string_view name;
  int mask = 0;
};

/** An alternative scale name and the canonical name it resolves to. */
struct ScaleAlias {
  std::string_view alias;
  std::string_view name;
};

/** A built-in scale name and the system it belongs to. */
struct ScaleSystemEntry {
  std::string_view name;
  ScaleSystem system = ScaleSystem::kCommonPractice;
};

/** The Western and jazz scales scale_by_name() resolves, in declaration order (`NAMED_SCALES`). */
extern const std::vector<NamedScaleMask> NAMED_SCALES;

/** Scales of traditions outside Western common practice (`WORLD_SCALES`). */
extern const std::vector<NamedScaleMask> WORLD_SCALES;

/** Alternative names of built-in scales (`SCALE_ALIASES`). */
extern const std::vector<ScaleAlias> SCALE_ALIASES;

/** The system each built-in scale name belongs to (`SCALE_SYSTEMS`). */
extern const std::vector<ScaleSystemEntry> SCALE_SYSTEMS;

/**
 * Build a 12-bit mode mask from semitone offsets above the root; bit 0 is always set
 * (`maskFromOffsets`).
 * @throws InvalidInputError if an offset is not an integer.
 */
int mask_from_offsets(const std::vector<double>& offsets);

/**
 * Require a twelve-bit mode mask (`assertModeMask`).
 * @throws InvalidInputError if it is not an integer in [1, CHROMATIC_MASK].
 */
int assert_mode_mask(double mode_mask12, std::string_view name = "modeMask12");

/** The canonical name a scale name or alias stands for, or nullopt (`resolveScaleName`). */
std::optional<std::string_view> resolve_scale_name(std::string_view name);

/** The mask of a named scale or alias, or nullopt (`namedScaleMask`). */
std::optional<int> named_scale_mask(std::string_view name);

/**
 * The mask of a named scale (`requireScaleMask`).
 * @throws InvalidInputError "Unknown <label>: <name>" for a name no built-in scale has.
 */
int require_scale_mask(std::string_view name, std::string_view label = "scale");

/** The form a mask stands in; modal when it is none of the four (`variantOfMask`). */
KeyVariant variant_of_mask(int mode_mask12);

/**
 * Refuse a scale form the mask does not hold (`assertKeyVariant`).
 * @throws InvalidInputError if the mask is not one or does not match the variant.
 */
void assert_key_variant(KeyVariant variant, int mode_mask12);

/**
 * Resolve any key-shaped value to a validated key/scale, root reduced to a pitch class
 * (`toKeyScale`).
 * @throws InvalidInputError if it names no key or its mask is malformed.
 */
KeyScale to_key_scale(const KeyArg& value);

/** Read a key name to the whole key it denotes, reporting failure (`tryResolveKeyName`). */
ParseResult<ResolvedKey> try_resolve_key_name(std::string_view text,
                                              const NoteNameOptions& opts = {});

/**
 * Resolve any key-shaped value to the whole key it names (`resolveKey`).
 * @throws InvalidInputError if it names no key, or its tonic or form contradicts its scale.
 */
ResolvedKey resolve_key(const KeyArg& value);

/** The pitch classes of a key, its spelling and form dropped (`scaleOf`). */
KeyScale scale_of(const ResolvedKey& key);

/** The major key on a root pitch class, spelled (`majorKey`). */
SpelledKeyScale major_key(double root_pc);

/** The natural-minor key on a root pitch class, spelled (`minorKey`). */
SpelledKeyScale minor_key(double root_pc);

/**
 * A named scale on a root pitch class, spelled (`scaleByName`).
 * @throws InvalidInputError if the name is not a built-in scale.
 */
SpelledKeyScale scale_by_name(std::string_view name, double root_pc);

/** Whether a pitch's class belongs to the key's scale (`isScaleTone`). */
bool is_scale_tone(double pitch, const KeyArg& key);

/** The nearest MIDI pitch in the scale; a tie goes down (`nearestScaleTone`). */
double nearest_scale_tone(double pitch, const KeyArg& key);

/** Where a pitch sits on the key's ladder of scale tones (`scaleLadderPosition`). */
ScaleLadderPosition scale_ladder_position(double pitch, const KeyArg& key);

/** The pitch a rung of the key's ladder stands for (`scaleLadderPitch`). */
double scale_ladder_pitch(double rung, const KeyArg& key);

/** Shift a pitch by scale degrees, keeping its offset above the rung (`shiftByScaleDegrees`). */
double shift_by_scale_degrees(double pitch, double degrees, const KeyArg& key);

/** The 1-based scale degree of a pitch, or -1 when it is not in the scale (`pitchToScaleDegree`).
 */
int pitch_to_scale_degree(double pitch, const KeyArg& key);

/** The scale's pitch classes, ascending (`diatonicPitchClasses`). */
std::vector<int> diatonic_pitch_classes(const KeyArg& key);

/** The scale's pitch classes in scale-degree order, root first (`scaleTonesInDegreeOrder`). */
std::vector<int> scale_tones_in_degree_order(const KeyArg& key);

/** Whether a key is written with a key signature of its own (`isSignatureKey`). */
bool is_signature_key(const KeyScale& key);

/** The signed count of sharps (positive) or flats of a key's signature (`keySignatureFifths`). */
int key_signature_fifths(const NoteArg& tonic, const KeyArg& key);

/**
 * The key a signature denotes, in the given mode (`keyFromFifths`).
 * @throws InvalidInputError if `fifths` is not an integer in [-MAX_FIFTHS, MAX_FIFTHS].
 */
ResolvedKey key_from_fifths(double fifths, KeyMode mode = KeyMode::kMajor);

/** The conventional tonic spelling of a key, paired with the key verbatim (`spelledKeyOf`). */
ResolvedKey spelled_key_of(const KeyScale& key);

/** The relative key (`relativeKeyOf`). */
ResolvedKey relative_key_of(const NoteArg& tonic, const KeyArg& key);

/** The parallel key, on the same tonic spelling (`parallelKeyOf`). */
ResolvedKey parallel_key_of(const NoteArg& tonic, const KeyArg& key);

/** The key a fifth above, in the mode the key's third names (`dominantKeyOf`). */
ResolvedKey dominant_key_of(const NoteArg& tonic, const KeyArg& key);

/** The key a fifth below, in the mode the key's third names (`subdominantKeyOf`). */
ResolvedKey subdominant_key_of(const NoteArg& tonic, const KeyArg& key);

/** The same sounding key written the other way round the circle, or null (`enharmonicKeyOf`). */
Nullable<ResolvedKey> enharmonic_key_of(const NoteArg& tonic, const KeyArg& key);

/** The six closely related keys, each tagged with its relation (`relatedKeysOf`). */
std::vector<RelatedKey> related_keys_of(const NoteArg& tonic, const KeyArg& key);

/** How the second key stands to the first, or null (`keyRelationBetween`). */
Nullable<KeyRelation> key_relation_between(const ResolvedKey& a, const ResolvedKey& b);

/**
 * The system a scale name or alias belongs to (`scaleSystemOf`).
 * @throws InvalidInputError if the name is no built-in scale.
 */
ScaleSystem scale_system_of(std::string_view name);

/** The system of a key/scale, read from its mask; nullopt for a mask no built-in scale has. */
std::optional<ScaleSystem> scale_system_of(const KeyScale& scale);

/** Whether functional harmony describes a named scale (`supportsFunctionalHarmony`). */
bool supports_functional_harmony(std::string_view name);

/** Whether functional harmony describes a key/scale, read from its mask. */
bool supports_functional_harmony(const KeyScale& scale);

}  // namespace cantus

#endif  // CANTUS_THEORY_SCALE_H_
