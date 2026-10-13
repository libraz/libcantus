/**
 * @file drums.h
 * @brief Public C++ API of ts/src/generate/drums: the groove generator, the drum pattern and fill
 *        dictionaries, and the kit they are written for.
 *
 * generate_drums() writes a whole performance from a style, a section and the context's dials;
 * place_drum_pattern() lays genre figures from the pattern dictionary bar by bar. Every voice is a
 * General MIDI percussion note, named by DrumVoice.
 */
#ifndef CANTUS_GENERATE_DRUMS_H_
#define CANTUS_GENERATE_DRUMS_H_

#include <any>
#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/limits.h"
#include "cantus/core/meter.h"
#include "cantus/generate/context.h"
#include "cantus/generate/vocabulary.h"

namespace cantus {

/** The public section names, in PUBLIC_SECTIONS order (`Section`). */
enum class Section : std::uint8_t { kIntro, kVerse, kPrechorus, kChorus, kBridge, kOutro };

/** Every public section, in declaration order (`PUBLIC_SECTIONS`). */
inline constexpr std::array<Section, 6> PUBLIC_SECTIONS = {Section::kIntro,     Section::kVerse,
                                                           Section::kPrechorus, Section::kChorus,
                                                           Section::kBridge,    Section::kOutro};

/** The TS name of a section ("intro", ...). */
std::string_view to_string(Section section);

/** The section named `name`, or nullopt. */
std::optional<Section> parse_section(std::string_view name);

/** The internal drum styles a groove style selects (`DrumStyle`). */
enum class DrumStyle : std::uint8_t {
  kSparse,
  kStandard,
  kFourOnFloor,
  kUpbeat,
  kRock,
  kSynth,
  kTrap,
  kLatin,
};

/** The TS name of a drum style ("sparse", ...). */
std::string_view to_string(DrumStyle style);

/** The drum style named `name`, or nullopt. */
std::optional<DrumStyle> parse_drum_style(std::string_view name);

/** Groove feel: the swing/straight rhythmic character, in DRUM_FEELS order (`GrooveFeel`). */
enum class GrooveFeel : std::uint8_t { kStraight, kSwing, kShuffle };

/** The TS name of a feel ("straight", ...). */
std::string_view to_string(GrooveFeel feel);

/** The feel named `name`, or nullopt. */
std::optional<GrooveFeel> parse_groove_feel(std::string_view name);

/** The public groove styles, in GROOVE_STYLES order (`GrooveStyle`). */
enum class GrooveStyle : std::uint8_t {
  kStandard,
  kFunk,
  kShuffle,
  kBossa,
  kTrap,
  kHalftime,
  kBreakbeat,
  kHouse,
  kSynthpop,
};

/** The TS name of a groove style ("standard", ...). */
std::string_view to_string(GrooveStyle style);

/** The groove style named `name`, or nullopt. */
std::optional<GrooveStyle> parse_groove_style(std::string_view name);

/** Voicing roles gating which voices are present, in DRUM_ROLES order (`DrumRole`). */
enum class DrumRole : std::uint8_t { kFull, kAmbient, kMinimal, kFxOnly };

/** The TS name of a role ("full", ...). */
std::string_view to_string(DrumRole role);

/** The role named `name`, or nullopt. */
std::optional<DrumRole> parse_drum_role(std::string_view name);

/** The percussion voices the generators emit, in DRUM_NOTES order (`DrumVoice`). */
enum class DrumVoice : std::uint8_t {
  kKick,
  kSnare,
  kSideStick,
  kHandClap,
  kClosedHiHat,
  kPedalHiHat,
  kOpenHiHat,
  kCrash,
  kRide,
  kTambourine,
  kHighTom,
  kMidTom,
  kLowTom,
  kShaker,
};

/** Every voice, in DRUM_NOTES order. */
inline constexpr std::array<DrumVoice, 14> DRUM_VOICES = {
    DrumVoice::kKick,        DrumVoice::kSnare,      DrumVoice::kSideStick, DrumVoice::kHandClap,
    DrumVoice::kClosedHiHat, DrumVoice::kPedalHiHat, DrumVoice::kOpenHiHat, DrumVoice::kCrash,
    DrumVoice::kRide,        DrumVoice::kTambourine, DrumVoice::kHighTom,   DrumVoice::kMidTom,
    DrumVoice::kLowTom,      DrumVoice::kShaker,
};

/** The TS name of a voice ("kick", ...): a key of DRUM_NOTES. */
std::string_view to_string(DrumVoice voice);

/** The voice named `name`, or nullopt. */
std::optional<DrumVoice> parse_drum_voice(std::string_view name);

/** The General MIDI note number a voice is written as (`DRUM_NOTES[voice]`). */
int drum_note(DrumVoice voice);

/**
 * The voice a percussion note number names (`drumVoiceOf`); absent for a note no generator emits.
 * @throws InvalidInputError if `pitch` is not a MIDI pitch.
 */
std::optional<DrumVoice> drum_voice_of(int pitch);

/** A single percussion onset (`DrumHit`). */
struct DrumHit {
  /** General MIDI note number. */
  int pitch = 0;
  double startBeat = 0;
  double durationBeat = 0;
  double velocity = 0;
  /** How the stroke is played, when it is more than a plain hit. */
  std::optional<Articulation> articulation;
};

/** One stroke of a pattern, on the bar's sixteenth grid (`DrumStroke`). */
struct DrumStroke {
  DrumVoice voice = DrumVoice::kKick;
  /** Sixteenth index from the start of the figure. */
  double step = 0;
  /** Loudness as a factor of the passage's base velocity. */
  double velocity = 0;
  /** Sounding length in quarter-note beats; one sixteenth when absent. */
  std::optional<double> duration;
  std::optional<Articulation> articulation;
  /** Which limb plays the stroke, where the figure depends on it. */
  std::optional<Limb> limb;
};

/** A bar-long drum figure (`DrumPattern`). */
struct DrumPattern {
  /** Sixteenth steps in the figure; a 4/4 bar is sixteen. */
  double steps = 0;
  std::vector<DrumStroke> strokes;
};

/** A drum figure with the conditions it fits (`DrumVocabulary`). */
using DrumVocabulary = Vocabulary<DrumPattern>;

/** The built-in drum patterns, in declaration order (`DRUM_PATTERNS`). */
extern const std::vector<DrumVocabulary> DRUM_PATTERNS;

/** Whether a mixed dictionary's material is a drum pattern (`isDrumPattern`). */
bool is_drum_pattern(const std::any& material);

/** Options of place_drum_pattern() (`DrumPatternOptions`). */
struct DrumPatternOptions {
  /** Number of bars to generate. */
  int bars = 0;
  /** The genre whose figures may be used. */
  Genre genre = Genre::kPop;
  /** Section the pattern plays in, matched against each entry's own sections. */
  std::optional<Section> section;
  /** Time signature; 4/4 when absent. */
  std::optional<MeterArg> ts;
  /** The generation context; `{ seed: 0, bpm: 120 }` when absent. */
  std::optional<GenerationContextInput> ctx;
  /** Play the figure at half or double its written rate; straight when absent. */
  std::optional<FigureRate> rate;
  /** The swing the figure is played with; straight when absent. */
  std::optional<GrooveFeel> feel;
  /** Base velocity the figure's own factors are read against; 100 when absent. */
  std::optional<double> velocity;
  /** Maximum number of onsets that may be written; DEFAULT_GENERATION_BUDGET when absent. */
  std::optional<double> budget;
};

/**
 * Generate a genre-characteristic groove from the pattern dictionary (`placeDrumPattern`).
 * @throws InvalidInputError if the bar count, tempo, velocity or meter is invalid.
 * @throws BudgetExceededError if the bars could write more onsets than the budget allows.
 */
std::vector<DrumHit> place_drum_pattern(const DrumPatternOptions& opts);

/** The thirteen fill archetypes, in FILL_TYPES order (`FillType`). */
enum class FillType : std::uint8_t {
  kSnareRoll,
  kTomDescend,
  kTomAscend,
  kSnareTomCombo,
  kSimpleCrash,
  kLinearFill,
  kGhostToAccent,
  kBdSnareAlternate,
  kHiHatChoke,
  kTomShuffle,
  kBreakdownFill,
  kFlamsAndDrags,
  kHalfTimeFill,
};

/** Every fill archetype, in declaration order (`FILL_TYPES`). */
inline constexpr std::array<FillType, 13> FILL_TYPES = {
    FillType::kSnareRoll,     FillType::kTomDescend,       FillType::kTomAscend,
    FillType::kSnareTomCombo, FillType::kSimpleCrash,      FillType::kLinearFill,
    FillType::kGhostToAccent, FillType::kBdSnareAlternate, FillType::kHiHatChoke,
    FillType::kTomShuffle,    FillType::kBreakdownFill,    FillType::kFlamsAndDrags,
    FillType::kHalfTimeFill,
};

/** The TS name of a fill archetype ("snareRoll", ...). */
std::string_view to_string(FillType type);

/** The fill archetype named `name`, or nullopt. */
std::optional<FillType> parse_fill_type(std::string_view name);

/** The base a fill stroke's velocity is read against (`FillVelocity.base`). */
enum class FillVelocityBase : std::uint8_t { kFill, kAccent };

/** The TS name of a velocity base ("fill", "accent"). */
std::string_view to_string(FillVelocityBase base);

/** The velocity base named `name`, or nullopt. */
std::optional<FillVelocityBase> parse_fill_velocity_base(std::string_view name);

/** How loud one stroke of a fill is (`FillVelocity`). */
struct FillVelocity {
  FillVelocityBase base = FillVelocityBase::kFill;
  /** Factor on the base, for a crescendo or a ghosted stroke. */
  std::optional<double> scale;
  /** Fixed offset in MIDI velocity. */
  std::optional<double> offset;
};

/** One stroke of a fill, positioned within the beat it belongs to (`FillStroke`). */
struct FillStroke {
  /** General MIDI note number of the voice struck. */
  int voice = 0;
  /** Offset from the start of the beat, in quarter-note beats. */
  double offset = 0;
  /** Sounding length, in quarter-note beats. */
  double duration = 0;
  FillVelocity velocity;
  std::optional<Articulation> articulation;
};

/** A fill archetype: what each beat of the fill bar plays (`FillArchetype`). */
struct FillArchetype {
  /** Strokes per beat of the bar. */
  std::vector<std::vector<FillStroke>> atBeat;
  /** Whether the archetype stops where its own strokes stop instead of holding its last beat. */
  std::optional<bool> boundToBar;
};

/** The built-in fill archetypes, indexed by FillType (`FILL_ARCHETYPES`). */
extern const std::array<FillArchetype, FILL_TYPES.size()> FILL_ARCHETYPES;

/** Whether a mixed dictionary's material is a fill archetype (`isFillArchetype`). */
bool is_fill_archetype(const std::any& material);

/** One onset of a kick figure (`KickSlot`). */
struct KickSlot {
  /** Sixteenth index within the bar, 0..15. */
  int step = 0;
  /** Chance the slot is taken before the dial leans on it; absent means always. */
  std::optional<double> probability;
  /** Draw address for the slot. */
  std::optional<std::string> slot;
  /** Restrict the slot to bars of one parity. */
  std::optional<int> barParity;
  /** Sections the slot is added in; absent means every section. */
  std::optional<std::vector<Section>> sections;
};

/** A style's kick figure (`KickFigure`). */
using KickFigure = std::vector<KickSlot>;

/** Kick presence across the sixteen sixteenth slots of a bar (`KickPattern`). */
using KickPattern = std::vector<bool>;

/** The kick dictionary, in declaration order (`KICK_FIGURES`). */
extern const std::vector<std::pair<DrumStyle, KickFigure>> KICK_FIGURES;

/** A drum kit played with four limbs, covering every voice the generators emit (`DRUM_KIT`). */
extern const PercussionProfile DRUM_KIT;

/** A Euclidean (Bjorklund) kick pattern (`EuclideanKick`). */
struct EuclideanKick {
  /** Number of kick onsets, clamped to [0, steps]. */
  std::int64_t pulses = 0;
  /** Total steps in the bar (1..16); 16 when absent. */
  std::optional<int> steps;
  /** Steps to rotate the onsets toward later positions; 0 when absent. */
  std::optional<std::int64_t> rotation;
};

/** Options of generate_drums() (`DrumsOptions`). */
struct DrumsOptions {
  /** Number of bars to generate. */
  int bars = 0;
  GrooveStyle style = GrooveStyle::kStandard;
  Section section = Section::kVerse;
  /** Time signature; only 4/4 is accepted. */
  std::optional<MeterArg> ts;
  /** Replace the final bar with a fill. */
  std::optional<bool> fills;
  /** The swing the groove is played with; the style's own when absent. */
  std::optional<GrooveFeel> feel;
  /** Voicing role; full when absent. */
  std::optional<DrumRole> role;
  /** The generation context. */
  std::optional<GenerationContextInput> ctx;
  /** Section the final-bar fill leads into; `section` when absent. */
  std::optional<Section> nextSection;
  /** A Euclidean kick in place of the style's kick pattern. */
  std::optional<EuclideanKick> euclideanKick;
  /** Maximum number of onsets that may be written; DEFAULT_GENERATION_BUDGET when absent. */
  std::optional<double> budget;
};

/**
 * Generate a drum performance as a flat list of onsets, in onset order with ties broken by pitch
 * (`generateDrums`).
 * @throws InvalidInputError if an option is malformed or the meter is not 4/4 throughout.
 * @throws BudgetExceededError if the bars could write more onsets than the budget allows.
 */
std::vector<DrumHit> generate_drums(const DrumsOptions& opts);

}  // namespace cantus

#endif  // CANTUS_GENERATE_DRUMS_H_
