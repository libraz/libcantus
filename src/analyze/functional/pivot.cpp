// Pivot chords, the common ground two keys share for a modulation:
// ts/src/analyze/functional/pivot.ts.

#include "analyze/functional/pivot.h"

#include <optional>
#include <utility>

#include "analyze/functional/roman.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

/** The diatonic triad on a scale degree, or nullopt where the scale stacks none (`stackedTriad`).
 */
std::optional<Chord> stacked_triad(int degree, const ResolvedKey& key) {
  try {
    return diatonic_triad(degree, key);
  } catch (const InvalidInputError&) {
    return std::nullopt;
  }
}

}  // namespace

std::vector<PivotChord> pivots_between(const ResolvedKey& from, const ResolvedKey& to) {
  // Testing the degree count keeps a key with no diatonic triads an empty result.
  if (static_cast<int>(scale_tones_in_degree_order(from.scale).size()) != HEPTATONIC_DEGREES) {
    return {};
  }
  std::vector<PivotChord> pivots;
  std::vector<std::pair<double, ChordQuality>> seen;
  for (int degree = 1; degree <= HEPTATONIC_DEGREES; ++degree) {
    std::optional<Chord> chord = stacked_triad(degree, from);
    if (!chord || !is_diatonic_chord(*chord, to.scale)) {
      continue;
    }
    // Candidates are identified by sonority, so a scale whose degrees repeat a triad offers that
    // pivot once.
    std::pair<double, ChordQuality> identity{chord->rootPc, chord->quality};
    bool repeated = false;
    for (const auto& prior : seen) {
      repeated = repeated || prior == identity;
    }
    if (repeated) {
      continue;
    }
    seen.push_back(identity);
    PivotChord pivot;
    pivot.romanFrom = render_roman(*chord, from, {}).roman;
    pivot.romanTo = render_roman(*chord, to, {}).roman;
    pivot.chord = std::move(*chord);
    pivots.push_back(std::move(pivot));
  }
  return pivots;
}

std::vector<PivotChord> pivot_chords(const KeyArg& from, const KeyArg& to) {
  ResolvedKey from_key = resolve_key(from);
  return pivots_between(from_key, resolve_key(to));
}

}  // namespace cantus
