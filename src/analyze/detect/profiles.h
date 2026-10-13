/**
 * @file profiles.h
 * @brief Internal helpers of ts/src/analyze/detect/profiles.ts: the key-profile vectors
 * detect_key() correlates a pitch-class distribution against, and the correlation itself. The
 * profile types are declared in cantus/analyze/detect.h.
 */
#ifndef CANTUS_SRC_ANALYZE_DETECT_PROFILES_H_
#define CANTUS_SRC_ANALYZE_DETECT_PROFILES_H_

#include <array>
#include <functional>
#include <optional>
#include <variant>

#include "cantus/analyze/detect.h"

namespace cantus {

/** The profile a key-detection option names: a built-in, or an explicit pair. */
using KeyProfileArg = std::variant<KeyProfileName, KeyProfilePair>;

/**
 * A resolved `profile` option. `pair` is empty for a value that resolves in TS but carries neither
 * vector (a name found on the prototype chain of the profile table), which fails when a vector is
 * first read.
 */
struct ResolvedProfile {
  std::optional<KeyProfilePair> pair;

  /**
   * The pair of vectors, read to score a candidate.
   * @throws js::TypeError if the profile carries none, as reading a vector of it does.
   */
  const KeyProfilePair& get() const;

  /**
   * The pair of vectors, read to derive the profile of a mode.
   * @throws js::TypeError if the profile carries none.
   */
  const KeyProfilePair& for_modes() const;
};

/**
 * Produces the profile when the analysis first resolves it, so a malformed option is reported at
 * the point TS reports it and not before.
 */
using ProfileSource = std::function<ResolvedProfile()>;

/** The source of a typed `profile` option. */
ProfileSource typed_profile_source(const std::optional<KeyProfileArg>& profile);

/** The Krumhansl-Kessler probe-tone profiles (`KRUMHANSL_KESSLER_PROFILE`). */
const KeyProfilePair& krumhansl_kessler_profile();

/** The built-in profile of a name (`NAMED_PROFILES`). */
const KeyProfilePair& named_profile(KeyProfileName name);

/**
 * Resolve the `profile` option of detect_key() to a validated profile pair
 * (`resolveKeyProfile`); absent is the Krumhansl-Kessler default.
 * @throws InvalidInputError if an entry of a custom pair is not finite.
 */
KeyProfilePair resolve_key_profile(const std::optional<KeyProfileArg>& profile);

/**
 * Score one key candidate: the Pearson correlation between a pitch-class distribution and a
 * profile rotated onto the candidate tonic, rounded to a quantum (`profileScore`).
 */
double profile_score(const std::array<double, 12>& dist, const std::array<double, 12>& vector,
                     int tonic);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_DETECT_PROFILES_H_
