/**
 * @file random.h
 * @brief Public C++ API of ts/src/core/random: the seeded generator, hierarchical seeds,
 *        position-addressed draws and the algorithm version.
 */
#ifndef CANTUS_CORE_RANDOM_H_
#define CANTUS_CORE_RANDOM_H_

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "cantus/core/limits.h"

namespace cantus {

/** A deterministic PRNG (mulberry32) with the samplers the generators need (`Rng`). */
class Rng {
 public:
  /** A generator whose stream is fixed by `seed` (`createRng`). */
  explicit Rng(std::uint32_t seed) : state_(seed) {}

  /** Next float in [0, 1). */
  double next();

  /**
   * True with probability `p`.
   * @throws InvalidInputError if `p` is outside [0, 1]; no draw is consumed then.
   */
  bool prob(double p);

  /**
   * Integer in the inclusive range [lo, hi].
   * @throws InvalidInputError if `lo` exceeds `hi` or the span is not a safe integer.
   */
  std::int64_t range(std::int64_t lo, std::int64_t hi);

  /**
   * Float in [lo, hi) (`float`).
   * @throws InvalidInputError if `lo` exceeds `hi` or either is not finite.
   */
  double float_(double lo, double hi);

 private:
  std::uint32_t state_;
};

/** Create a seeded PRNG (`createRng`). */
inline Rng create_rng(std::uint32_t seed) { return Rng(seed); }

/** One segment of a seed path: a name or a finite number. */
using SeedSegment = std::variant<std::string, double>;

/** The address of one derivation (`SeedPath`). */
using SeedPath = std::vector<SeedSegment>;

/**
 * Derive a child seed from a root seed and a path (`deriveSeed`).
 * @throws InvalidInputError if a numeric segment is not finite.
 */
std::uint32_t derive_seed(std::uint32_t root, const SeedPath& path = {});

/** A random source addressed by position rather than by call order (`PositionalRng`). */
class PositionalRng {
 public:
  /** A source whose draws are fixed by `seed` (`createPositionalRng`). */
  explicit PositionalRng(std::uint32_t seed) : seed_(seed) {}

  /** The seed. */
  std::uint32_t seed() const noexcept { return seed_; }

  /**
   * The draw belonging to a position: a float in [0, 1) that depends only on the seed and the
   * path.
   * @throws InvalidInputError if a numeric segment is not finite.
   */
  double at(const SeedPath& path) const;

 private:
  std::uint32_t seed_;
};

/** Create a position-addressed random source (`createPositionalRng`). */
inline PositionalRng create_positional_rng(std::uint32_t seed) { return PositionalRng(seed); }

/** A source of positional draws; any function of a path will do (`PositionalRng.at`). */
using PositionalDraw = std::function<double(const SeedPath&)>;

/**
 * Whether the event at a position belongs in the output at a complexity (`includeAt`): the draw
 * at the position is below the complexity.
 * @throws InvalidInputError if `complexity` is outside [0, 1] or the source returns a value
 *   outside [0, 1).
 */
bool include_at(const PositionalDraw& at, double complexity, const SeedPath& path = {});

/** include_at() over a PositionalRng. */
bool include_at(const PositionalRng& rng, double complexity, const SeedPath& path = {});

/**
 * Resolve the algorithm version a request runs under (`resolveAlgorithmVersion`): the current one
 * when unpinned.
 * @throws InvalidInputError if the version is not one this build produces.
 */
std::uint32_t resolve_algorithm_version(std::optional<std::int64_t> requested = std::nullopt);

}  // namespace cantus

#endif  // CANTUS_CORE_RANDOM_H_
