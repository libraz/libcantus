// The generation context of ts/src/generate/context/index.ts.

#include "generate/context/context.h"

#include <limits>
#include <string>
#include <utility>
#include <variant>

#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "generate/context/difficulty.h"
#include "generate/context/limits.gen.h"

namespace cantus {

namespace {

/** `Number.MIN_VALUE`, the lowest tempo a context accepts. */

std::optional<double> dial(const std::optional<double>& value, std::string_view name) {
  return value ? std::optional<double>(assert_range(*value, 0, 1, name)) : std::nullopt;
}

}  // namespace

std::optional<InstrumentProfile> ResolvedContext::instrument(std::string_view part) const {
  if (!instruments) {
    return std::nullopt;
  }
  auto found = instruments->find(std::string(part));
  return found == instruments->end() ? std::nullopt
                                     : std::optional<InstrumentProfile>(found->second);
}

Draw ResolvedContext::part(std::string_view name) const {
  SeedPath path{std::string(name), std::string(kVersionSegment),
                static_cast<double>(algorithmVersion)};
  if (rng) {
    return Draw(*rng, std::move(path));
  }
  return Draw(PositionalRng(derive_seed(seed, path)));
}

ResolvedContext resolve_context(const std::optional<GenerationContextInput>& input) {
  GenerationContext ctx;
  if (!input) {
    ctx.seed = CONTEXT_DEFAULT_SEED;
  } else if (const std::uint32_t* seed = std::get_if<std::uint32_t>(&input->value())) {
    ctx.seed = *seed;
  } else {
    ctx = std::get<GenerationContext>(input->value());
  }
  ResolvedContext out;
  out.seed = ctx.seed.value_or(CONTEXT_DEFAULT_SEED);
  Complexity complexity = ctx.complexity.value_or(Complexity{});
  out.rhythmic = dial(complexity.rhythmic, "complexity rhythmic");
  out.harmonic = dial(complexity.harmonic, "complexity harmonic");
  out.ornament = dial(complexity.ornament, "complexity ornament");
  if (complexity.difficulty) {
    out.difficulty = assert_difficulty(*complexity.difficulty);
  }
  if (ctx.bpm) {
    out.bpm = assert_range(*ctx.bpm, kMinValue, 1000, "bpm");
  }
  out.algorithmVersion = resolve_algorithm_version(ctx.algorithmVersion);
  out.rng = ctx.rng;
  out.instruments = ctx.instruments;
  // Validated on the way in: an entry naming a difficulty of 40 would clear every ceiling.
  if (ctx.vocabulary) {
    for (std::size_t index = 0; index < ctx.vocabulary->size(); ++index) {
      out.vocabulary.push_back(
          assert_vocabulary((*ctx.vocabulary)[index], "vocabulary[" + index_text(index) + "]"));
    }
  }
  return out;
}

ResolvedContext resolve_context_with(const std::optional<GenerationContextInput>& input,
                                     const ContextSugar& sugar) {
  ResolvedContext base = resolve_context(input);
  // Validated whether or not it ends up used: the caller cannot see whether the context names it.
  std::optional<double> supplied = dial(sugar.ornament, "complexity ornament");
  if (!base.ornament) {
    base.ornament = supplied;
  }
  return base;
}

}  // namespace cantus
