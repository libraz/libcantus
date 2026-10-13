/**
 * @file context.h
 * @brief Public C++ API of ts/src/generate/context: the generation context every generator
 *        resolves, the position-addressed samplers it draws from, and the difficulty ceiling.
 *
 * A context names the seed, the complexity dials, the tempo and the instruments once; each part
 * derives its own randomness from the project seed through ResolvedContext::part(), so changing
 * one part never redraws another. Every Draw method is a pure function of the source and the path.
 */
#ifndef CANTUS_GENERATE_CONTEXT_H_
#define CANTUS_GENERATE_CONTEXT_H_

#include <any>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/limits.h"
#include "cantus/core/random.h"
#include "cantus/generate/vocabulary.h"

namespace cantus {

/**
 * Whether a player at this ceiling keeps up a stream of strokes on one voice (`sustainsStrokes`).
 * True whenever the ceiling or the tempo is absent.
 * @throws InvalidInputError if the ceiling is outside [1, 5] or the tempo or the gap is not finite.
 */
bool sustains_strokes(double step_beats, std::optional<double> bpm,
                      std::optional<double> difficulty);

/**
 * Whether the fretting hand covers a leap of `semitones` in `step_beats` (`sustainsShift`). True
 * whenever the ceiling or the tempo is absent.
 * @throws InvalidInputError if the ceiling is outside [1, 5] or a number is not finite.
 */
bool sustains_shift(double semitones, double step_beats, std::optional<double> bpm,
                    std::optional<double> difficulty);

/**
 * The samplers of one namespace of a positional source (`Draw`, built as `drawsFrom` builds it):
 * every draw is addressed by `prefix` followed by the path it is asked for.
 */
class Draw {
 public:
  /** Samplers over `source`, addressed under `prefix` (`drawsFrom(rng, ...prefix)`). */
  explicit Draw(PositionalDraw source, SeedPath prefix = {});

  /** Samplers over a PositionalRng. */
  explicit Draw(const PositionalRng& rng, SeedPath prefix = {});

  /**
   * The raw draw at a position: a float in [0, 1).
   * @throws InvalidInputError if the source returns a value outside [0, 1).
   */
  double at(const SeedPath& path = {}) const;

  /**
   * Whether an event of probability `p` happens at a position (`includeAt`).
   * @throws InvalidInputError if `p` is outside [0, 1] or the source misbehaves.
   */
  bool prob(double p, const SeedPath& path = {}) const;

  /**
   * An integer in the inclusive range [lo, hi] at a position.
   * @throws InvalidInputError if `lo` exceeds `hi` or the span is not a safe integer.
   */
  std::int64_t range(std::int64_t lo, std::int64_t hi, const SeedPath& path = {}) const;

  /**
   * A float in [lo, hi) at a position (`float`).
   * @throws InvalidInputError if a bound or the span is not finite, or `lo` exceeds `hi`.
   */
  double float_(double lo, double hi, const SeedPath& path = {}) const;

  /** The source every draw goes to. */
  const PositionalDraw& source() const noexcept { return source_; }

  /** The path segments prepended to every draw. */
  const SeedPath& prefix() const noexcept { return prefix_; }

 private:
  SeedPath under_prefix(const SeedPath& path) const;

  PositionalDraw source_;
  SeedPath prefix_;
};

/** How involved the generated music should be, on axes that do not imply one another. */
struct Complexity {
  /** Subdivision and syncopation, in [0, 1]. */
  std::optional<double> rhythmic;
  /** Tension, substitution and passing chords, in [0, 1]. */
  std::optional<double> harmonic;
  /** Ghosts, flams and decoration, in [0, 1]. */
  std::optional<double> ornament;
  /** The hardest the result may be to play, from 1 to 5; a ceiling, not a strength. */
  std::optional<double> difficulty;
};

/** Everything a generator needs that is not about the notes themselves (`GenerationContext`). */
struct GenerationContext {
  /** The project seed; 0 when absent. */
  std::optional<std::uint32_t> seed;
  /** The dials. */
  std::optional<Complexity> complexity;
  /** Draw from this source instead of one derived from `seed`. */
  std::optional<PositionalDraw> rng;
  /** The instruments the parts are written for, keyed by part name. */
  std::optional<std::map<std::string, InstrumentProfile>> instruments;
  /** Tempo in quarter-note beats per minute. */
  std::optional<double> bpm;
  /** The algorithm version to generate under; this build's when absent. */
  std::optional<std::int64_t> algorithmVersion;
  /** Figures this piece may draw on, for every part in one list; each generator takes its own. */
  std::optional<std::vector<Vocabulary<std::any>>> vocabulary;
};

/** A context, or just the seed for one (`GenerationContextInput`). */
class GenerationContextInput {
 public:
  /** A bare seed: sugar for `{ seed }`. */
  GenerationContextInput(std::uint32_t seed) : value_(seed) {}  // NOLINT
  /** A whole context. */
  GenerationContextInput(GenerationContext context)  // NOLINT
      : value_(std::move(context)) {}

  /** The form this input holds. */
  const std::variant<std::uint32_t, GenerationContext>& value() const noexcept { return value_; }

 private:
  std::variant<std::uint32_t, GenerationContext> value_;
};

/** A context with everything resolved (`ResolvedContext`). */
struct ResolvedContext {
  std::uint32_t seed = 0;
  /** Requested rhythmic density, absent when the caller named none. */
  std::optional<double> rhythmic;
  /** Requested harmonic richness, absent when the caller named none. */
  std::optional<double> harmonic;
  /** Requested ornament density, absent when the caller named none. */
  std::optional<double> ornament;
  /** The difficulty ceiling, absent for no ceiling. */
  std::optional<double> difficulty;
  /** Tempo in BPM, absent when the caller named none. */
  std::optional<double> bpm;
  /** The resolved algorithm version. */
  std::uint32_t algorithmVersion = 0;
  /** The figures the caller brought, validated; empty when it brought none. */
  std::vector<Vocabulary<std::any>> vocabulary;
  /** The instruments the caller named, as given. */
  std::optional<std::map<std::string, InstrumentProfile>> instruments;
  /** The source the caller supplied, as given. */
  std::optional<PositionalDraw> rng;

  /** The profile written for a part, if one was named for it. */
  std::optional<InstrumentProfile> instrument(std::string_view part) const;

  /** The position-addressed samplers for a part. */
  Draw part(std::string_view name) const;
};

/**
 * Resolve a context, or a bare seed, into the form the generators use (`resolveContext`).
 * @throws InvalidInputError if a dial is out of range, the tempo is not positive, the algorithm
 *   version is unknown, or a vocabulary entry is malformed.
 */
ResolvedContext resolve_context(const std::optional<GenerationContextInput>& input = std::nullopt);

}  // namespace cantus

#endif  // CANTUS_GENERATE_CONTEXT_H_
