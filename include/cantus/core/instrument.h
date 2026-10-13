/**
 * @file instrument.h
 * @brief Public C++ API of ts/src/core/instrument: instrument profiles and playability.
 *
 * A profile describes what an instrument physically is (a tuning and a fret count, or the voices
 * each limb reaches); its range is derived from that. playability() reads a passage against a
 * profile and reports what stands in the way without rewriting anything.
 */
#ifndef CANTUS_CORE_INSTRUMENT_H_
#define CANTUS_CORE_INSTRUMENT_H_

#include <array>
#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

#include "cantus/core/types.h"

namespace cantus {

/** Every playing technique a note can carry, in ARTICULATIONS order. */
enum class Articulation : std::uint8_t {
  kAccent,
  kGhost,
  kStaccato,
  kLegato,
  kSlide,
  kHammer,
  kMute,
  kFlam,
  kDrag,
  kRoll,
  kChoke,
  kOpen,
};

/** Every articulation, in declaration order (`ARTICULATIONS`). */
inline constexpr std::array<Articulation, 12> ARTICULATIONS = {
    Articulation::kAccent, Articulation::kGhost,  Articulation::kStaccato, Articulation::kLegato,
    Articulation::kSlide,  Articulation::kHammer, Articulation::kMute,     Articulation::kFlam,
    Articulation::kDrag,   Articulation::kRoll,   Articulation::kChoke,    Articulation::kOpen,
};

/** The TS name of an articulation ("accent", ...). */
std::string_view to_string(Articulation articulation);

/** The articulation named `name`, or nullopt. */
std::optional<Articulation> parse_articulation(std::string_view name);

/** One limb of a percussionist. */
enum class Limb : std::uint8_t { kRightHand, kLeftHand, kRightFoot, kLeftFoot };

/** Every limb, in declaration order (`LIMBS`). */
inline constexpr std::array<Limb, 4> LIMBS = {Limb::kRightHand, Limb::kLeftHand, Limb::kRightFoot,
                                              Limb::kLeftFoot};

/** The TS name of a limb ("rightHand", ...). */
std::string_view to_string(Limb limb);

/** The limb named `name`, or nullopt. */
std::optional<Limb> parse_limb(std::string_view name);

/** A fretted or fretless string instrument (`StringedProfile`). */
struct StringedProfile {
  /** The family discriminator. */
  static constexpr std::string_view kind = "stringed";
  /** Instrument name, for issue messages. */
  std::string name;
  /** Open-string MIDI pitch per string, lowest-sounding string first. */
  std::vector<int> tuning;
  /** Highest fret number; fret 0 is the open string. */
  int frets = 0;
  /** Greatest fret span one hand holds at once. */
  int maxStretch = 0;
  /** Techniques the instrument can produce. */
  std::vector<Articulation> articulations;
  /** Greatest number of notes sounding at once. */
  int polyphony = 0;
  /** The neck has no frets. */
  std::optional<bool> fretless;
};

/** A percussion setup, described by the voices within reach of each limb (`PercussionProfile`). */
struct PercussionProfile {
  /** The family discriminator. */
  static constexpr std::string_view kind = "percussion";
  /** Instrument name, for issue messages. */
  std::string name;
  /** The limbs the player has. */
  std::vector<Limb> limbs;
  /** Limbs that can strike each voice, in preference order, by MIDI note. */
  std::map<int, std::vector<Limb>> reach;
  /** Voices dubbed over the kit on a pass of their own. */
  std::optional<std::vector<int>> overdub;
  /** Techniques the instrument can produce. */
  std::vector<Articulation> articulations;
  /** Greatest number of notes sounding at once. */
  int polyphony = 0;
};

/** An instrument a passage can be checked against (`InstrumentProfile`). */
using InstrumentProfile = std::variant<StringedProfile, PercussionProfile>;

/**
 * Anything that names an instrument (`InstrumentProfileLike`): a profile, or any value whose
 * `data()` returns one (the Instrument class).
 */
class InstrumentProfileArg {
 public:
  InstrumentProfileArg(InstrumentProfile profile) : value_(std::move(profile)) {}  // NOLINT
  InstrumentProfileArg(StringedProfile profile) : value_(std::move(profile)) {}    // NOLINT
  InstrumentProfileArg(PercussionProfile profile) : value_(std::move(profile)) {}  // NOLINT
  /** A value whose `data()` returns a profile. */
  template <class T,
            std::enable_if_t<
                std::is_convertible_v<decltype(std::declval<const T&>().data()), InstrumentProfile>,
                int> = 0>
  InstrumentProfileArg(const T& value) : value_(InstrumentProfile(value.data())) {}  // NOLINT

  /** The profile this argument names. */
  const InstrumentProfile& value() const noexcept { return value_; }

 private:
  InstrumentProfile value_;
};

/** A fretting-hand position (`StringFingering`). */
struct StringFingering {
  /** Index into the tuning. */
  std::size_t string = 0;
  /** Fret number; 0 is the open string. */
  int fret = 0;
};

/** The extreme sounding pitches of an instrument, inclusive. */
struct InstrumentRange {
  int low = 0;
  int high = 0;
};

/**
 * Validate an instrument (`toInstrumentProfile`).
 * @throws InvalidInputError if the profile is contradictory.
 */
InstrumentProfile to_instrument_profile(const InstrumentProfileArg& value,
                                        std::string_view name = "instrument");

/** to_instrument_profile() narrowed to the stringed family (`toStringedProfile`). */
StringedProfile to_stringed_profile(const InstrumentProfileArg& value,
                                    std::string_view name = "instrument");

/** Lowest and highest pitch the instrument sounds (`instrumentRange`). */
InstrumentRange instrument_range(const InstrumentProfileArg& profile);

/** Whether the instrument has this pitch at all (`canSound`). */
bool can_sound(const InstrumentProfileArg& profile, int pitch);

/** Every neck position sounding a pitch, lowest string first (`fingeringsFor`). */
std::vector<StringFingering> fingerings_for(const InstrumentProfileArg& profile, int pitch);

/** The nearest octave transposition the instrument sounds, upper on a tie (`foldIntoRange`). */
int fold_into_range(int pitch, const InstrumentProfileArg& profile);

/** Electric bass in standard tuning (`BASS_4_STRING`). */
extern const StringedProfile BASS_4_STRING;
/** Five-string bass with the low B (`BASS_5_STRING`). */
extern const StringedProfile BASS_5_STRING;
/** Six-string guitar in standard tuning (`GUITAR_STANDARD`). */
extern const StringedProfile GUITAR_STANDARD;
/** Six-string guitar in drop D (`GUITAR_DROP_D`). */
extern const StringedProfile GUITAR_DROP_D;

/** What makes a passage hard or impossible on an instrument (`PlayabilityIssueType`). */
enum class PlayabilityIssueType : std::uint8_t {
  kNoteOutOfRange,
  kArticulationUnavailable,
  kStringConflict,
  kStretchTooWide,
  kLimbConflict,
  kPolyphonyExceeded,
  kTooFast,
};

/** The TS name of an issue type ("noteOutOfRange", ...). */
std::string_view to_string(PlayabilityIssueType type);

/** The issue type named `name`, or nullopt. */
std::optional<PlayabilityIssueType> parse_playability_issue_type(std::string_view name);

/** One thing standing between a passage and a performance of it (`PlayabilityIssue`). */
struct PlayabilityIssue {
  PlayabilityIssueType type = PlayabilityIssueType::kNoteOutOfRange;
  /** 1 the note does not exist, 2 the arrangement does not hold, 3 not enough time. */
  int layer = 1;
  /** Indices into the analysed note array, ascending. */
  std::vector<std::size_t> notes;
  /** Where the problem occurs, in quarter-note beats. */
  double startBeat = 0;
  /** True when practice cannot fix it. */
  bool impossible = false;
  std::string message;
};

/** How one note is produced: where it is stopped, or which limb strikes it (`NotePlacement`). */
struct NotePlacement {
  /** Index into the analysed note array. */
  std::size_t note = 0;
  std::optional<StringFingering> fingering;
  std::optional<Limb> limb;
};

/** The verdict on a passage (`PlayabilityReport`). */
struct PlayabilityReport {
  /** Movement per unit time on a 1..5 scale, measured at 120 BPM without a tempo. */
  double difficulty = 1;
  std::vector<PlayabilityIssue> issues;
  std::vector<NotePlacement> placements;
};

/**
 * Judge whether a passage can be played on an instrument, and how hard it is (`playability`).
 * @param bpm Tempo in quarter-note beats per minute; enables the third layer.
 */
PlayabilityReport playability(const std::vector<NoteEvent>& notes,
                              const InstrumentProfileArg& profile,
                              std::optional<double> bpm = std::nullopt);

}  // namespace cantus

#endif  // CANTUS_CORE_INSTRUMENT_H_
