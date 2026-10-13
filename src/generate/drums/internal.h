/**
 * @file internal.h
 * @brief Internal pieces of ts/src/generate/drums/internal.ts: General MIDI notes, the internal
 *        section and style mappings, and the velocity helpers every drum voice shares.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_INTERNAL_H_
#define CANTUS_SRC_GENERATE_DRUMS_INTERNAL_H_

#include <array>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/generate/drums.h"
#include "generate/drums/limits.gen.h"

namespace cantus {

/**
 * An optional list field of a generated row: `std::nullopt`, or the braced elements.
 * std::optional cannot take the braced form inside a generated initializer.
 */
template <class T>
struct GeneratedList {
  GeneratedList(std::nullopt_t) {}                                                 // NOLINT
  GeneratedList(std::initializer_list<T> items) : value(std::vector<T>(items)) {}  // NOLINT
  std::optional<std::vector<T>> value;
};

/** General MIDI percussion note numbers used across the drum engine (`GM`). */
struct GeneralMidiNotes {
  int BD;
  int SD;
  int SIDESTICK;
  int HANDCLAP;
  int CHH;
  int FHH;
  int OHH;
  int CRASH;
  int RIDE;
  int TAMBOURINE;
  int TOM_H;
  int TOM_M;
  int TOM_L;
  int SHAKER;
};

/** `GM`. */
inline constexpr GeneralMidiNotes kGm =
#include "generate/drums/gm.gen.inc"
    ;

/** DRUM_FEELS as names, indexed by GrooveFeel. */
inline constexpr std::array<std::string_view, static_cast<std::size_t>(GrooveFeel::kShuffle) + 1>
    kFeelNames =
#include "generate/drums/drum_feels.gen.inc"
    ;
static_assert(!kFeelNames.back().empty(), "DRUM_FEELS and GrooveFeel disagree");

/** GROOVE_STYLES as names, indexed by GrooveStyle. */
inline constexpr std::array<std::string_view, static_cast<std::size_t>(GrooveStyle::kSynthpop) + 1>
    kGrooveStyleNames =
#include "generate/drums/groove_styles.gen.inc"
    ;
static_assert(!kGrooveStyleNames.back().empty(), "GROOVE_STYLES and GrooveStyle disagree");

/** DRUM_ROLES as names, indexed by DrumRole. */
inline constexpr std::array<std::string_view, static_cast<std::size_t>(DrumRole::kFxOnly) + 1>
    kDrumRoleNames =
#include "generate/drums/drum_roles.gen.inc"
    ;
static_assert(!kDrumRoleNames.back().empty(), "DRUM_ROLES and DrumRole disagree");

/** PUBLIC_SECTIONS as names, indexed by Section. */
inline constexpr std::array<std::string_view, PUBLIC_SECTIONS.size()> kSectionNames =
#include "generate/drums/public_sections.gen.inc"
    ;
static_assert(!kSectionNames.back().empty(), "PUBLIC_SECTIONS and Section disagree");

/** The names of each list, for assert_one_of(). */
std::vector<std::string_view> feel_names();
std::vector<std::string_view> groove_style_names();
std::vector<std::string_view> drum_role_names();
std::vector<std::string_view> section_names();

/** The reduced section set the engine reasons about (`SectionType`). */
enum class SectionType : std::uint8_t { kIntro, kA, kB, kChorus, kBridge, kOutro };

/** Section energy level, used to shape fills (`SectionEnergy`). */
enum class SectionEnergy : std::uint8_t { kLow, kMedium, kHigh, kPeak };

/** Ghost-note mood category for the density table (`MoodCategory`). */
enum class MoodCategory : std::uint8_t { kCalm = 0, kStandard = 1, kEnergetic = 2 };

/** Percussion mood category for the activation table (`PercMoodCategory`). */
enum class PercMoodCategory : std::uint8_t {
  kCalm = 0,
  kStandard = 1,
  kEnergetic = 2,
  kIdol = 3,
  kRockDark = 4,
};

/** Resolved internal parameters for a public groove style (`StyleMapping`). */
struct StyleMapping {
  DrumStyle style;
  GrooveFeel feel;
  bool ghostBoost;
  bool snareBeat3;
};

/** The beats of a bar that carry the backbeat, zero-based (`backbeatBeats`). */
std::vector<double> backbeat_beats(bool snare_beat3, double bar_beats = FOUR_FOUR_BEATS);

/** The internal style and feel a public groove style selects (`mapStyle`). */
StyleMapping map_style(GrooveStyle style);

/** The internal section a public section maps to (`mapSection`). */
SectionType map_section(Section section);

/** How loudly the backing sits, as a factor on the section's density (`backingScale`). */
double backing_scale(double rhythmic);

/** A probability leaned on by the rhythmic dial (`leanedBy`). */
double leaned_by(double probability, double rhythmic);

/** Swing amount implied by a groove feel (`feelSwingAmount`). */
double feel_swing_amount(GrooveFeel feel);

/** Ghost-note mood category derived from the internal style (`ghostMoodCategory`). */
MoodCategory ghost_mood_category(DrumStyle style);

/** Percussion mood category derived from the internal style (`percMoodCategory`). */
PercMoodCategory perc_mood_category(DrumStyle style);

/** Zero-based section index shared by the ghost and percussion tables (`sectionIndex`). */
int section_index(SectionType section);

/** Section energy used to size fills (`sectionEnergy`). */
SectionEnergy section_energy(SectionType section);

/** Section velocity multiplier applied to the base drum velocity. */
double section_velocity_multiplier(SectionType section);

/** Section density multiplier before backing-density scaling. */
double section_density_multiplier(SectionType section);

/** Base drum velocity for a section beat, downbeats accented (`calculateVelocity`). */
double calculate_velocity(SectionType section, double beat);

/** Round and clamp a velocity into the valid MIDI range (`clampVel`). */
double clamp_vel(double velocity);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_INTERNAL_H_
