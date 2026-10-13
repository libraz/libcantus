/**
 * @file hihat.h
 * @brief Internal pieces of ts/src/generate/drums/hihat.ts: the timekeeping cymbal's level, voice
 *        and accents.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_HIHAT_H_
#define CANTUS_SRC_GENERATE_DRUMS_HIHAT_H_

#include <cstdint>
#include <optional>

#include "cantus/generate/context.h"
#include "generate/drums/internal.h"

namespace cantus {

/** Hi-hat subdivision level (`HiHatLevel`). */
enum class HiHatLevel : std::uint8_t { kQuarter, kEighth, kSixteenth };

/** Hi-hat articulation type (`HiHatType`). */
enum class HiHatType : std::uint8_t { kClosed, kPedal, kOpen, kHalfOpen, kRide };

/** True unless the role suppresses timekeeping cymbals entirely (`shouldPlayHiHat`). */
bool should_play_hi_hat(DrumRole role);

/** Preferred timekeeping instrument for a role (`roleHiHatInstrument`). */
int role_hi_hat_instrument(DrumRole role, bool use_ride);

/** Beats between consecutive strokes at a subdivision (`hiHatStep`). */
double hi_hat_step(HiHatLevel level);

/** The hi-hat subdivision for a section, style, dial and tempo (`getHiHatLevel`). */
HiHatLevel get_hi_hat_level(SectionType section, DrumStyle style, double rhythmic, double bpm,
                            const Draw& draw, std::optional<double> difficulty, double bar);

/** Metric velocity multiplier for a sixteenth within a beat (`hiHatVelocityMultiplier`). */
double hi_hat_velocity_multiplier(int sixteenth, double jitter);

/** Bars between dynamic open hi-hat accents, 0 for none (`openHiHatBarInterval`). */
double open_hi_hat_bar_interval(SectionType section, DrumStyle style);

/** Beat that receives the dynamic open hi-hat within a bar (`openHiHatBeat`). */
double open_hi_hat_beat(SectionType section, const Draw& draw, double bar);

/** Whether the section uses an independent foot hi-hat pulse (`shouldUseFootHiHat`). */
bool should_use_foot_hi_hat(SectionType section, DrumRole role);

/** The hi-hat articulation a section leans on (`sectionHiHatType`). */
HiHatType section_hi_hat_type(SectionType section, DrumRole role);

/** GM note for a hi-hat articulation (`hiHatNote`). */
int hi_hat_note(HiHatType type);

/** Velocity multiplier for a hi-hat articulation (`hiHatTypeVelocityMultiplier`). */
double hi_hat_type_velocity_multiplier(HiHatType type);

/** Whether to accent with an open hi-hat at a beat (`shouldAddOpenHHAccent`). */
bool should_add_open_hh_accent(SectionType section, double beat, double bar, const Draw& draw);

/** Foot hi-hat velocity, drawn for its own position (`footHiHatVelocity`). */
double foot_hi_hat_velocity(const Draw& draw, double bar, double beat);

/** Whether a style writes its open hi-hats off the beat (`usesOffbeatOpenHiHat`). */
bool uses_offbeat_open_hi_hat(DrumStyle style);

/** Chance an off-beat open hi-hat is taken (`offbeatOpenHiHatChance`). */
double offbeat_open_hi_hat_chance(double bpm);

/** Whether the section uses a ride cymbal instead of hi-hats (`shouldUseRideForSection`). */
bool should_use_ride_for_section(SectionType section, DrumStyle style);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_HIHAT_H_
