/**
 * @file harmony.h
 * @brief Public C++ API of ts/src/theory/harmony: the role a pitch plays within a chord, and how
 *        firmly it is locked to the chord's identity.
 */
#ifndef CANTUS_THEORY_HARMONY_H_
#define CANTUS_THEORY_HARMONY_H_

#include <cstdint>
#include <optional>
#include <string_view>

#include "cantus/theory/chord.h"
#include "cantus/theory/symbol.h"

namespace cantus {

/** Harmonic role a pitch plays within a chord (`HarmonyRole`). */
enum class HarmonyRole : std::uint8_t {
  kRoot,
  kThird,
  kFifth,
  kSixth,
  kSeventh,
  kTension,
  kDoubling,
};

/** The TS name of a role ("root", ..., "seventh", "tension", "doubling"). */
std::string_view to_string(HarmonyRole role);

/** The role named `name`, or nullopt. */
std::optional<HarmonyRole> parse_harmony_role(std::string_view name);

/** How firmly a pitch is locked to the chord's identity (`LockLevel`). */
enum class LockLevel : std::uint8_t {
  /** Moving it produces a different chord. */
  kIdentity,
  /** Moving it flips the chord quality. */
  kQuality,
  /** It moves freely without changing chord identity or quality. */
  kVoicing,
};

/** The TS name of a lock level ("identity", "quality" or "voicing"). */
std::string_view to_string(LockLevel lock);

/** The lock level named `name`, or nullopt. */
std::optional<LockLevel> parse_lock_level(std::string_view name);

/** A pitch's role, lock level and owning chord (`VoicedRole`). */
struct VoicedRole {
  HarmonyRole role = HarmonyRole::kRoot;
  LockLevel lock = LockLevel::kIdentity;
  /** The identifier given by the caller, a double so that a -0 reads back as written. */
  double belongsToChordId = 0;
};

/**
 * Classify a pitch's harmonic role and lock level within a chord (`roleOf`).
 * @throws InvalidInputError if the pitch or the chord id is not finite, or the chord is malformed.
 */
VoicedRole role_of(double pitch, const ChordArg& chord, double chord_id = 0);

}  // namespace cantus

#endif  // CANTUS_THEORY_HARMONY_H_
