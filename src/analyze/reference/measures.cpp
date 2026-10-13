// The per-dimension measures two structural readings are compared by:
// ts/src/analyze/reference/measures.ts.

#include "analyze/reference/measures.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <set>
#include <string_view>

#include "analyze/sequence.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "js/math.h"

namespace cantus {

namespace {

/** NAMED_CHORDS: names the Neapolitan and augmented sixths are written with. */
constexpr std::string_view kNamedChordTokens[] =
#include "analyze/reference/named_chords.gen.inc"
    ;

/** PITCH_PRESERVING_KINDS: relation kinds that leave pitch unchanged. */
constexpr std::string_view kPitchPreservingKinds[] =
#include "analyze/reference/pitch_preserving_kinds.gen.inc"
    ;

/** Apply the null rule (`whenBoth`). */
template <class Measure>
Nullable<double> when_both(bool has_a, bool has_b, Measure&& measure) {
  if (!has_a && !has_b) {
    return std::nullopt;
  }
  if (!has_a || !has_b) {
    return 0.0;
  }
  return measure();
}

/** Aligned likeness of two non-empty sequences (`aligned`). */
template <class T, class Cost>
double aligned(const std::vector<T>& a, const std::vector<T>& b, Cost&& cost, double gap = 1) {
  return distance_to_similarity(graded_edit_distance(a, b, cost, gap),
                                static_cast<double>(a.size()), static_cast<double>(b.size()));
}

/** Aligned-sequence likeness, under the null rule on empty sequences (`alignedSimilarity`). */
template <class T, class Cost>
Nullable<double> aligned_similarity(const std::vector<T>& a, const std::vector<T>& b, Cost&& cost,
                                    double gap = 1) {
  return when_both(!a.empty(), !b.empty(), [&] { return aligned(a, b, cost, gap); });
}

/** Sum of the entries of a histogram (`massOf`). */
double mass_of(const std::vector<double>& values) {
  double total = 0;
  for (double value : values) {
    total += value;
  }
  return total;
}

/** Intersection of two histograms of the same bins, each normalised to unit mass. */
double intersection(const std::vector<double>& a, const std::vector<double>& b) {
  double mass_a = mass_of(a);
  double mass_b = mass_of(b);
  double shared = 0;
  for (std::size_t i = 0; i < a.size(); ++i) {
    double y = i < b.size() ? b[i] : 0;
    shared += js::min(a[i] / mass_a, y / mass_b);
  }
  return js::min(1, shared);
}

/** Histogram intersection, under the null rule on massless histograms. */
Nullable<double> distribution_similarity(const std::vector<double>& a,
                                         const std::vector<double>& b) {
  return when_both(mass_of(a) > 0, mass_of(b) > 0, [&] { return intersection(a, b); });
}

/** `min / max` of two non-negative values; 1 when both are 0. */
double ratio(double a, double b) {
  double larger = js::max(a, b);
  return larger == 0 ? 1 : js::min(a, b) / larger;
}

/** Degree token of a numeral with no applied part (`simpleDegreeToken`). */
std::string simple_degree_token(const std::string& roman) {
  for (std::string_view name : kNamedChordTokens) {
    if (roman.compare(0, name.size(), name) == 0) {
      return std::string(name);
    }
  }
  // `/^([b#]*)([IV]+)/i`.
  std::size_t pos = 0;
  while (pos < roman.size() && (roman[pos] == 'b' || roman[pos] == 'B' || roman[pos] == '#')) {
    pos += 1;
  }
  std::size_t numeral_end = pos;
  while (numeral_end < roman.size() &&
         (std::toupper(static_cast<unsigned char>(roman[numeral_end])) == 'I' ||
          std::toupper(static_cast<unsigned char>(roman[numeral_end])) == 'V')) {
    numeral_end += 1;
  }
  if (numeral_end == pos) {
    return roman;
  }
  std::string token = roman.substr(0, pos);
  for (std::size_t i = pos; i < numeral_end; ++i) {
    token += static_cast<char>(std::toupper(static_cast<unsigned char>(roman[i])));
  }
  return token;
}

/** Substitution cost of one chord for another in the progression alignment (`chordCost`). */
double chord_cost(const ProgressionChord& x, const ProgressionChord& y) {
  if (x.roman == y.roman) {
    return 0;
  }
  if (roman_degree_token(x.roman) == roman_degree_token(y.roman)) {
    return SAME_DEGREE_COST;
  }
  return x.function == y.function ? SAME_FUNCTION_COST : 1;
}

/** Beats each function holds across a chord list (`functionMass`). */
std::vector<double> function_mass(const std::vector<TimedFunction>& chords) {
  std::vector<double> mass(harmonic_functions().size(), 0);
  for (const TimedFunction& chord : chords) {
    auto bin = static_cast<std::size_t>(chord.function);
    mass[bin] += js::max(0, chord.endBeat - chord.startBeat);
  }
  return mass;
}

/** A key read relative to the first key of its plan (`KeyToken`). */
struct KeyToken {
  double distance;
  double mask;
};

/** Each key as its tonic's distance above the first key's, with its mode mask. */
std::vector<KeyToken> key_tokens(const std::vector<KeyScale>& keys) {
  double home = keys.empty() ? 0 : keys[0].rootPc;
  std::vector<KeyToken> out;
  for (const KeyScale& key : keys) {
    out.push_back(KeyToken{std::fmod(std::fmod(key.rootPc - home, 12) + 12, 12),
                           static_cast<double>(key.modeMask12)});
  }
  return out;
}

/** A motif cell as notes (`cellNotes`). */
std::vector<NoteEvent> cell_notes(const SurfaceMotif& motif) {
  double low = 0;
  double high = 0;
  double offset = 0;
  for (double interval : motif.intervals) {
    offset += interval;
    low = js::min(low, offset);
    high = js::max(high, offset);
  }
  double pitch = js::min(MIDI_MAX - high, js::max(-low, CELL_START_PITCH));
  double beat = 0;
  std::vector<NoteEvent> notes;
  for (std::size_t i = 0; i <= motif.intervals.size(); ++i) {
    double step = i < motif.rhythm.size() ? motif.rhythm[i] : 1;
    NoteEvent note;
    note.pitch = static_cast<int>(pitch);
    note.startBeat = beat;
    note.durationBeat = i < motif.intervals.size() ? step : 1;
    notes.push_back(note);
    pitch += i < motif.intervals.size() ? motif.intervals[i] : 0;
    beat += step;
  }
  return notes;
}

struct Cell {
  std::vector<NoteEvent> cell;
  double occurrences;
};

/** Occurrence-weighted mean, over `from`'s cells, of each one's best pitch likeness
 * (`bestMatchMean`). */
double best_match_mean(const std::vector<Cell>& from, const std::vector<Cell>& to) {
  double weighted = 0;
  double weight = 0;
  for (const Cell& motif : from) {
    double best = 0;
    for (const Cell& other : to) {
      best = js::max(best, compare_melodies(motif.cell, other.cell).pitchSimilarity);
    }
    weighted += motif.occurrences * best;
    weight += motif.occurrences;
  }
  return weighted / weight;
}

/** The four terms a motif graph is summarised by (`GraphSummary`). */
struct GraphSummary {
  std::vector<double> kinds;
  std::vector<double> families;
  std::vector<double> depths;
  double coverage = 0;
};

/** Share of the span covered by the union of the statements' intervals (`coverageOf`). */
double coverage_of(const MotifGraph& graph, double span_beats) {
  if (!(span_beats > 0) || graph.nodes.empty()) {
    return 0;
  }
  std::vector<std::pair<double, double>> spans;
  for (const MotifGraphNode& node : graph.nodes) {
    spans.emplace_back(node.startBeat, node.endBeat);
  }
  std::stable_sort(spans.begin(), spans.end(), [](const auto& x, const auto& y) {
    double by_start = x.first - y.first;
    return (by_start != 0 && !std::isnan(by_start) ? by_start : x.second - y.second) < 0;
  });
  double covered = 0;
  double run_start = spans[0].first;
  double run_end = spans[0].second;
  for (const auto& [start, end] : spans) {
    if (start > run_end) {
      covered += run_end - run_start;
      run_start = start;
      run_end = end;
    } else {
      run_end = js::max(run_end, end);
    }
  }
  covered += run_end - run_start;
  return js::min(1, covered / span_beats);
}

/** Relation kinds, family sizes, derivation depths and coverage of a graph (`summarise`). */
GraphSummary summarise(const MotifStructure& structure) {
  const MotifGraph& graph = structure.graph;
  const std::size_t kind_count = motif_relation_kinds().size();
  GraphSummary out;
  out.kinds.assign(kind_count + 1, 0);
  std::map<std::size_t, const MotifGraphEdge*> parent_edge;
  for (const MotifGraphEdge& edge : graph.edges) {
    out.kinds[edge.relation ? static_cast<std::size_t>(edge.relation->kind) : kind_count] += 1;
    parent_edge[edge.to] = &edge;
  }
  std::vector<double> depth(graph.nodes.size(), 0);
  std::vector<std::size_t> root(graph.nodes.size());
  for (std::size_t i = 0; i < root.size(); ++i) {
    root[i] = i;
  }
  for (std::size_t node = 0; node < graph.nodes.size(); ++node) {
    auto edge = parent_edge.find(node);
    if (edge == parent_edge.end()) {
      continue;
    }
    bool keeps_pitch = false;
    if (edge->second->relation) {
      std::string_view kind = to_string(edge->second->relation->kind);
      keeps_pitch = std::find(std::begin(kPitchPreservingKinds), std::end(kPitchPreservingKinds),
                              kind) != std::end(kPitchPreservingKinds);
    }
    depth[node] = depth[edge->second->from] + (keeps_pitch ? 0 : 1);
    root[node] = root[edge->second->from];
  }
  std::map<std::size_t, double> family_size;
  for (std::size_t r : root) {
    family_size[r] += 1;
  }
  out.families.assign(static_cast<std::size_t>(FAMILY_SIZE_BINS), 0);
  for (const auto& entry : family_size) {
    out.families[static_cast<std::size_t>(js::min(entry.second, FAMILY_SIZE_BINS)) - 1] += 1;
  }
  out.depths.assign(static_cast<std::size_t>(DEPTH_BINS), 0);
  for (double d : depth) {
    out.depths[static_cast<std::size_t>(js::min(d, DEPTH_BINS - 1))] += 1;
  }
  out.coverage = coverage_of(graph, structure.spanBeats);
  return out;
}

/** Substitution cost between two phrases, either of which may have no melody (`nullableCost`). */
template <class T, class Cost>
double nullable_cost(const Nullable<T>& x, const Nullable<T>& y, Cost&& cost) {
  if (!x || !y) {
    return x.has_value() == y.has_value() ? 0 : 1;
  }
  return cost(*x, *y);
}

/** Aligned likeness of two phrase sequences (`phraseSimilarity`). */
template <class T, class Cost>
Nullable<double> phrase_similarity(const std::vector<Nullable<T>>& a,
                                   const std::vector<Nullable<T>>& b, Cost&& cost) {
  bool has_a = std::any_of(a.begin(), a.end(), [](const Nullable<T>& p) { return p.has_value(); });
  bool has_b = std::any_of(b.begin(), b.end(), [](const Nullable<T>& p) { return p.has_value(); });
  return when_both(has_a, has_b, [&] {
    return aligned(a, b, [&](const Nullable<T>& x, const Nullable<T>& y) {
      return nullable_cost(x, y, cost);
    });
  });
}

/** An outline centred on its own mean and scaled by its phrase's own range (`normalisedOutline`).
 */
std::vector<double> normalised_outline(const ContourPhrase& phrase) {
  double mean = mass_of(phrase.outline) /
                (phrase.outline.empty() ? 1 : static_cast<double>(phrase.outline.size()));
  double range = phrase.high - phrase.low;
  if (range == 0 || std::isnan(range)) {
    range = 1;
  }
  std::vector<double> out;
  for (double point : phrase.outline) {
    out.push_back((point - mean) / range);
  }
  return out;
}

/** Contour substitution cost: mean outline difference, plus a shape mismatch, capped at 1. */
double contour_cost(const ContourPhrase& x, const ContourPhrase& y) {
  std::vector<double> left = normalised_outline(x);
  std::vector<double> right = normalised_outline(y);
  double difference = 0;
  for (std::size_t i = 0; i < left.size(); ++i) {
    difference += std::fabs(left[i] - (i < right.size() ? right[i] : 0));
  }
  double outline_cost =
      js::min(1, difference / (left.empty() ? 1 : static_cast<double>(left.size())));
  return js::min(1, outline_cost + (x.shape == y.shape ? 0 : SHAPE_MISMATCH_COST));
}

}  // namespace

Nullable<double> section_sequence_similarity(const std::vector<std::string>& a,
                                             const std::vector<std::string>& b) {
  return aligned_similarity(
      a, b, [](const std::string& x, const std::string& y) { return x == y ? 0.0 : 1.0; });
}

Nullable<double> phrase_length_similarity(const std::vector<double>& a,
                                          const std::vector<double>& b) {
  return aligned_similarity(a, b, [](double x, double y) {
    double longer = js::max(x, y);
    return longer == 0 ? 0 : js::min(std::fabs(x - y) / longer, 1);
  });
}

std::string roman_degree_token(const std::string& roman) {
  std::size_t slash = roman.find('/');
  if (slash == std::string::npos) {
    return simple_degree_token(roman);
  }
  return simple_degree_token(roman.substr(0, slash)) + "/" +
         simple_degree_token(roman.substr(slash + 1));
}

Nullable<double> progression_similarity(const std::vector<ProgressionChord>& a,
                                        const std::vector<ProgressionChord>& b,
                                        std::optional<double> budget) {
  assert_generation_budget(static_cast<double>(a.size()) * static_cast<double>(b.size()),
                           "reference progression alignment", budget);
  return aligned_similarity(a, b, chord_cost, PROGRESSION_GAP);
}

Nullable<double> function_similarity(const std::vector<TimedFunction>& a,
                                     const std::vector<TimedFunction>& b) {
  return distribution_similarity(function_mass(a), function_mass(b));
}

Nullable<double> cadence_similarity(const std::vector<Nullable<CadenceType>>& a,
                                    const std::vector<Nullable<CadenceType>>& b) {
  return aligned_similarity(
      a, b, [](const Nullable<CadenceType>& x, const Nullable<CadenceType>& y) {
        const std::optional<CadenceType>& left = x;
        const std::optional<CadenceType>& right = y;
        if (left == right) {
          return 0.0;
        }
        bool half_and_phrygian = (left == CadenceType::kHalf && right == CadenceType::kPhrygian) ||
                                 (left == CadenceType::kPhrygian && right == CadenceType::kHalf);
        return half_and_phrygian ? HALF_PHRYGIAN_COST : 1.0;
      });
}

Nullable<double> key_plan_similarity(const std::vector<KeyScale>& a,
                                     const std::vector<KeyScale>& b) {
  return aligned_similarity(key_tokens(a), key_tokens(b), [](const KeyToken& x, const KeyToken& y) {
    if (x.distance != y.distance) {
      return 1.0;
    }
    return x.mask == y.mask ? 0.0 : MODE_CHANGE_COST;
  });
}

Nullable<double> onset_similarity(const RhythmAnalysis& a, const RhythmAnalysis& b) {
  return when_both(a.onsets > 0, b.onsets > 0, [&] {
    double weighted = 0;
    double weight = 0;
    for (const BarPositionProfile& left : a.barPositions) {
      for (const BarPositionProfile& right : b.barPositions) {
        bool shared = left.ts.numerator == right.ts.numerator &&
                      left.ts.denominator == right.ts.denominator && left.onsets > 0 &&
                      right.onsets > 0;
        if (shared) {
          double w = static_cast<double>(left.onsets) + static_cast<double>(right.onsets);
          weighted += w * intersection(left.shares, right.shares);
          weight += w;
        }
      }
    }
    return weight > 0 ? weighted / weight : intersection(a.onsetLevels, b.onsetLevels);
  });
}

Nullable<double> density_similarity(const RhythmAnalysis& a, const RhythmAnalysis& b) {
  return when_both(a.onsets > 0, b.onsets > 0,
                   [&] { return ratio(a.onsetDensity, b.onsetDensity); });
}

Nullable<double> duration_similarity(const RhythmAnalysis& a, const RhythmAnalysis& b) {
  return when_both(a.onsets > 0, b.onsets > 0,
                   [&] { return intersection(a.interOnsetShares, b.interOnsetShares); });
}

Nullable<double> syncopation_similarity(const RhythmAnalysis& a, const RhythmAnalysis& b) {
  return when_both(a.onsets > 0, b.onsets > 0,
                   [&] { return 1 - std::fabs(a.syncopation - b.syncopation); });
}

Nullable<double> surface_similarity(const std::vector<SurfaceMotif>& a,
                                    const std::vector<SurfaceMotif>& b) {
  return when_both(!a.empty(), !b.empty(), [&] {
    std::vector<Cell> left;
    for (const SurfaceMotif& motif : a) {
      left.push_back(Cell{cell_notes(motif), motif.occurrences});
    }
    std::vector<Cell> right;
    for (const SurfaceMotif& motif : b) {
      right.push_back(Cell{cell_notes(motif), motif.occurrences});
    }
    return (best_match_mean(left, right) + best_match_mean(right, left)) / 2;
  });
}

Nullable<double> motif_structure_similarity(const MotifStructure& a, const MotifStructure& b) {
  GraphSummary left = summarise(a);
  GraphSummary right = summarise(b);
  std::vector<double> terms;
  for (const Nullable<double>& term : {distribution_similarity(left.kinds, right.kinds),
                                       distribution_similarity(left.families, right.families),
                                       distribution_similarity(left.depths, right.depths),
                                       when_both(left.coverage > 0, right.coverage > 0, [&] {
                                         return 1 - std::fabs(left.coverage - right.coverage);
                                       })}) {
    if (term) {
      terms.push_back(*term);
    }
  }
  if (terms.empty()) {
    return std::nullopt;
  }
  return mass_of(terms) / static_cast<double>(terms.size());
}

Nullable<double> contour_similarity(const std::vector<Nullable<ContourPhrase>>& a,
                                    const std::vector<Nullable<ContourPhrase>>& b) {
  return phrase_similarity(a, b, contour_cost);
}

Nullable<double> register_similarity(const RegisterPlan& a, const RegisterPlan& b) {
  double mean_a = a.mean ? *a.mean : 0;
  double mean_b = b.mean ? *b.mean : 0;
  return phrase_similarity(
      a.phrases, b.phrases, [&](const RegisterPhrase& x, const RegisterPhrase& y) {
        double offset = std::fabs(x.mean - mean_a - (y.mean - mean_b));
        double range = std::fabs(x.high - x.low - (y.high - y.low));
        double peak = std::fabs(x.peakPosition - y.peakPosition);
        return js::min(1, (offset + range) / REGISTER_SPAN + PEAK_POSITION_WEIGHT * peak);
      });
}

}  // namespace cantus
