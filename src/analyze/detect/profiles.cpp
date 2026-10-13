// Key-profile vectors for detect_key(): ts/src/analyze/detect/profiles.ts.

#include "analyze/detect/profiles.h"

#include <cmath>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

constexpr std::size_t kNameCount = static_cast<std::size_t>(KeyProfileName::kFlat) + 1;

/** One profile as the table writes it. */
struct KeyProfileRow {
  std::array<double, 12> major;
  std::array<double, 12> minor;
};

/** A profile and the name it is addressed by. */
struct NamedKeyProfile {
  std::string_view name;
  KeyProfileRow profile;
};

/** The profile of Krumhansl and Kessler, which is the default (`KRUMHANSL_KESSLER_PROFILE`). */
constexpr KeyProfileRow kKrumhanslKesslerProfile =
#include "analyze/detect/krumhansl_kessler_profile.gen.inc"
    ;

/** Built-in profiles addressable by name (`NAMED_PROFILES`), indexed by KeyProfileName. */
constexpr std::array<NamedKeyProfile, kNameCount> kNamedProfiles = {
#include "analyze/detect/named_profiles.gen.inc"
};
static_assert(!kNamedProfiles.back().name.empty(), "NAMED_PROFILES and KeyProfileName disagree");

KeyProfilePair pair_of(const KeyProfileRow& row) { return KeyProfilePair{row.major, row.minor}; }

/** Reject a vector that cannot be correlated against a distribution (`assertProfileVector`). */
void assert_profile_vector(const std::array<double, 12>& vector, const std::string& name) {
  for (std::size_t index = 0; index < vector.size(); ++index) {
    if (!std::isfinite(vector[index])) {
      throw InvalidInputError(name + "[" + js::to_string(static_cast<double>(index)) +
                              "] must be a finite number");
    }
  }
}

/**
 * Cosine similarity of a distribution with a rotated profile, the fallback used when Pearson
 * correlation is undefined (`normalizedDot`).
 */
double normalized_dot(const std::array<double, 12>& dist, const std::array<double, 12>& vector,
                      int tonic) {
  double dot = 0;
  double dist_squares = 0;
  double profile_squares = 0;
  for (int pc = 0; pc < PROFILE_LENGTH; ++pc) {
    double d = dist[static_cast<std::size_t>(pc)];
    double p = vector[static_cast<std::size_t>((pc - tonic + PROFILE_LENGTH) % PROFILE_LENGTH)];
    dot += d * p;
    dist_squares += d * d;
    profile_squares += p * p;
  }
  double norm = std::sqrt(dist_squares * profile_squares);
  return norm > 0 ? dot / norm : 0;
}

}  // namespace

const KeyProfilePair& krumhansl_kessler_profile() {
  static const KeyProfilePair pair = pair_of(kKrumhanslKesslerProfile);
  return pair;
}

std::string_view to_string(KeyProfileName name) {
  return kNamedProfiles[static_cast<std::size_t>(name)].name;
}

std::optional<KeyProfileName> parse_key_profile_name(std::string_view name) {
  for (std::size_t i = 0; i < kNamedProfiles.size(); ++i) {
    if (kNamedProfiles[i].name == name) {
      return static_cast<KeyProfileName>(i);
    }
  }
  return std::nullopt;
}

const KeyProfilePair& ResolvedProfile::get() const {
  if (!pair) {
    throw js::TypeError("Cannot read properties of undefined (reading '0')");
  }
  return *pair;
}

const KeyProfilePair& ResolvedProfile::for_modes() const {
  if (!pair) {
    throw js::TypeError("parent is not iterable");
  }
  return *pair;
}

ProfileSource typed_profile_source(const std::optional<KeyProfileArg>& profile) {
  return [profile] { return ResolvedProfile{resolve_key_profile(profile)}; };
}

const KeyProfilePair& named_profile(KeyProfileName name) {
  static const std::array<KeyProfilePair, kNameCount> pairs = [] {
    std::array<KeyProfilePair, kNameCount> out;
    for (std::size_t i = 0; i < kNameCount; ++i) {
      out[i] = pair_of(kNamedProfiles[i].profile);
    }
    return out;
  }();
  return pairs[static_cast<std::size_t>(name)];
}

KeyProfilePair resolve_key_profile(const std::optional<KeyProfileArg>& profile) {
  if (!profile) {
    return krumhansl_kessler_profile();
  }
  if (const KeyProfileName* name = std::get_if<KeyProfileName>(&*profile)) {
    return named_profile(*name);
  }
  const KeyProfilePair& pair = std::get<KeyProfilePair>(*profile);
  assert_profile_vector(pair.major, "profile.major");
  assert_profile_vector(pair.minor, "profile.minor");
  return pair;
}

double profile_score(const std::array<double, 12>& dist, const std::array<double, 12>& vector,
                     int tonic) {
  double dist_sum = 0;
  double profile_sum = 0;
  for (int pc = 0; pc < PROFILE_LENGTH; ++pc) {
    dist_sum += dist[static_cast<std::size_t>(pc)];
    profile_sum += vector[static_cast<std::size_t>(pc)];
  }
  double dist_mean = dist_sum / PROFILE_LENGTH;
  double profile_mean = profile_sum / PROFILE_LENGTH;
  double covariance = 0;
  double dist_variance = 0;
  double profile_variance = 0;
  for (int pc = 0; pc < PROFILE_LENGTH; ++pc) {
    double d = dist[static_cast<std::size_t>(pc)] - dist_mean;
    double p = vector[static_cast<std::size_t>((pc - tonic + PROFILE_LENGTH) % PROFILE_LENGTH)] -
               profile_mean;
    covariance += d * p;
    dist_variance += d * d;
    profile_variance += p * p;
  }
  double denominator = std::sqrt(dist_variance * profile_variance);
  double raw = denominator > 0 ? covariance / denominator : normalized_dot(dist, vector, tonic);
  if (!std::isfinite(raw)) {
    return 0;
  }
  double clamped = js::min(1, js::max(-1, raw));
  return js::round(clamped * SCORE_QUANTUM) / SCORE_QUANTUM;
}

}  // namespace cantus
