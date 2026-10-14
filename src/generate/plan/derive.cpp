// Deriving a composition plan from a reference profile: ts/src/generate/plan/derive.ts.

#include "generate/plan/derive.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <string>

#include "cantus/analyze/functional.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "generate/plan/limits.gen.h"
#include "js/math.h"
#include "js/number.h"
#include "js/sort.h"
#include "theory/chord/chord.h"

namespace cantus {

namespace {

constexpr std::string_view kPreserveAspects[] =
#include "generate/plan/preserve_aspects.gen.inc"
    ;

/** A generated FUNCTION_DEGREES row: the function's name and the degrees that may stand for it. */
struct FunctionDegreesRow {
  std::string_view function;
  std::vector<int> degrees;
};

const std::vector<FunctionDegreesRow> kFunctionDegrees =
#include "generate/plan/function_degrees.gen.inc"
    ;

constexpr double kNeutralOnsetLevels[] =
#include "generate/plan/neutral_onset_levels.gen.inc"
    ;

/** A phrase span in the plan, and the reference phrase it was laid from. */
struct PhraseSpan {
  double startBeat = 0;
  double endBeat = 0;
  /** Index of the reference phrase, or -1 when the reference has none. */
  int source = 0;
  Nullable<CadenceType> cadence;
};

double mod12(double value) { return std::fmod(std::fmod(value, 12) + 12, 12); }

double lerp(double weight, double reference, double neutral) {
  return weight * reference + (1 - weight) * neutral;
}

/** The beat of `boundaries` nearest to `beat`, the earlier on a tie; `beat` itself when none. */
double nearest_boundary(double beat, const std::vector<double>& boundaries) {
  double best = beat;
  double best_distance = std::numeric_limits<double>::infinity();
  for (double boundary : boundaries) {
    double distance = std::abs(boundary - beat);
    if (distance < best_distance - BEAT_EPS) {
      best = boundary;
      best_distance = distance;
    }
  }
  return best;
}

/** The plan's keys: the reference's key regions, each moved by the interval to the requested one.
 */
std::vector<ResolvedKey> planned_keys(const ReferenceProfile& profile,
                                      const std::function<ResolvedKey()>& requested) {
  std::vector<ResolvedKey> regions;
  for (const ReferenceKeyRegion& region : profile.harmony.keys) {
    regions.push_back(region.key);
  }
  if (!requested) {
    return regions;
  }
  const ResolvedKey& home = regions.front();
  ResolvedKey target = requested();
  if (target.variant != home.variant || target.scale.modeMask12 != home.scale.modeMask12) {
    throw InvalidInputError(
        "opts.key must be in the same mode as the reference's home key; a key change moves the "
        "tonic only");
  }
  SpelledInterval step =
      spelled_interval(NoteData{home.tonic.letter, home.tonic.alter, std::nullopt},
                       NoteData{target.tonic.letter, target.tonic.alter, std::nullopt});
  std::vector<ResolvedKey> moved;
  for (const ResolvedKey& key : regions) {
    ResolvedKey out;
    out.scale =
        KeyScale{static_cast<int>(mod12(key.scale.rootPc + step.semitones)), key.scale.modeMask12};
    out.tonic = transpose_by_interval(NoteData{key.tonic.letter, key.tonic.alter, std::nullopt},
                                      IntervalArg(step));
    out.variant = key.variant;
    moved.push_back(std::move(out));
  }
  moved[0] = target;
  return moved;
}

/** Section labels, each replaced one taking its neighbour's label; boundaries snap to phrases. */
std::vector<PlannedSection> planned_sections(const ReferenceProfile& profile, double weight,
                                             const Draw& draw) {
  const std::vector<FormSection>& sections = profile.form.sections;
  std::vector<double> boundaries{profile.span.startBeat, profile.span.endBeat};
  for (const ReferencePhrase& phrase : profile.form.phrases) {
    boundaries.push_back(phrase.startBeat);
    boundaries.push_back(phrase.endBeat);
  }
  js::array_sort(boundaries, [](double a, double b) { return a - b; });
  std::vector<PlannedSection> planned;
  for (std::size_t index = 0; index < sections.size(); ++index) {
    const FormSection& section = sections[index];
    bool keep =
        sections.size() < 2 || draw.prob(weight, {std::string("form"), static_cast<double>(index)});
    std::ptrdiff_t neighbour = index + 1 < sections.size() ? static_cast<std::ptrdiff_t>(index) + 1
                                                           : static_cast<std::ptrdiff_t>(index) - 1;
    double start_beat = nearest_boundary(section.startBeat, boundaries);
    double end_beat = nearest_boundary(section.endBeat, boundaries);
    if (end_beat - start_beat > BEAT_EPS) {
      PlannedSection out;
      out.label = keep ? section.label
                       : (neighbour >= 0 && static_cast<std::size_t>(neighbour) < sections.size()
                              ? sections[static_cast<std::size_t>(neighbour)].label
                              : section.label);
      out.startBeat = start_beat;
      out.endBeat = end_beat;
      planned.push_back(std::move(out));
    }
  }
  return planned;
}

/** The beat reached by advancing `bars` bars from `start_beat`, bar by bar under the meter map. */
double beat_after_bars(double start_beat, double bars, const MeterMap& meters) {
  double beat = start_beat;
  double left = bars;
  while (left > BEAT_EPS) {
    double step = js::min(1.0, left);
    beat += step * beats_per_bar_at(beat, meters);
    left -= step;
  }
  return beat;
}

/** Bar count of `[start_beat, end_beat)`, bar by bar under the meter map. */
double bars_between(double start_beat, double end_beat, const MeterMap& meters) {
  double beat = start_beat;
  double bars = 0;
  while (beat < end_beat - BEAT_EPS) {
    double bar_beats = beats_per_bar_at(beat, meters);
    double step = js::min(bar_start_beat(beat, meters) + bar_beats, end_beat) - beat;
    bars += step / bar_beats;
    beat += step;
  }
  return bars;
}

/** The span cut at every section boundary. */
std::vector<std::pair<double, double>> span_segments(const ReferenceProfile& profile,
                                                     const std::vector<PlannedSection>& sections) {
  double start_beat = profile.span.startBeat;
  double end_beat = profile.span.endBeat;
  std::vector<double> cuts{start_beat, end_beat};
  for (const PlannedSection& section : sections) {
    for (double beat : {section.startBeat, section.endBeat}) {
      if (beat > start_beat + BEAT_EPS && beat < end_beat - BEAT_EPS) {
        cuts.push_back(beat);
      }
    }
  }
  js::array_sort(cuts, [](double a, double b) { return a - b; });
  std::vector<std::pair<double, double>> segments;
  for (std::size_t index = 1; index < cuts.size(); ++index) {
    double from = cuts[index - 1];
    double to = cuts[index];
    if (to - from > BEAT_EPS) {
      segments.emplace_back(from, to);
    }
  }
  return segments;
}

/** Lay out phrase spans so they tile the span with every section opening at least one phrase. */
std::vector<PhraseSpan> planned_phrase_spans(const ReferenceProfile& profile,
                                             const std::vector<PlannedSection>& sections,
                                             double weight, const Draw& draw) {
  std::vector<std::pair<double, double>> segments = span_segments(profile, sections);
  std::vector<PhraseSpan> pieces;
  for (std::size_t source = 0; source < profile.form.phrases.size(); ++source) {
    const ReferencePhrase& phrase = profile.form.phrases[source];
    PhraseSpan piece;
    piece.startBeat = phrase.startBeat;
    piece.endBeat = phrase.endBeat;
    piece.source = static_cast<int>(source);
    if (phrase.cadence) {
      piece.cadence = phrase.cadence->type;
    }
    pieces.push_back(piece);
  }
  std::vector<bool> replaced;
  for (std::size_t index = 0; index < pieces.size(); ++index) {
    replaced.push_back(
        !draw.prob(weight, {std::string("phraseLengths"), static_cast<double>(index)}));
  }
  std::vector<PhraseSpan> spans;
  for (const auto& [segment_start, segment_end] : segments) {
    std::vector<std::size_t> members;
    for (std::size_t index = 0; index < pieces.size(); ++index) {
      if (pieces[index].startBeat >= segment_start - BEAT_EPS &&
          pieces[index].startBeat < segment_end - BEAT_EPS) {
        members.push_back(index);
      }
    }
    std::vector<PhraseSpan> laid;
    double cursor = segment_start;
    for (std::size_t index : members) {
      const PhraseSpan& piece = pieces[index];
      std::vector<double> lengths;
      if (replaced[index]) {
        double bars = bars_between(piece.startBeat, piece.endBeat, profile.meters);
        double rounded = js::pow(2, js::round(js::log2(bars)));
        bool overflows = beat_after_bars(cursor, rounded, profile.meters) > segment_end + BEAT_EPS;
        double part_start = cursor;
        std::vector<double> parts = overflows ? std::vector<double>{rounded / 2, rounded / 2}
                                              : std::vector<double>{rounded};
        for (double part : parts) {
          double part_end = beat_after_bars(part_start, part, profile.meters);
          lengths.push_back(part_end - part_start);
          part_start = part_end;
        }
      } else {
        lengths.push_back(piece.endBeat - piece.startBeat);
      }
      for (std::size_t part = 0; part < lengths.size(); ++part) {
        if (cursor >= segment_end - BEAT_EPS) {
          continue;
        }
        double end = cursor + lengths[part];
        PhraseSpan span;
        span.startBeat = cursor;
        span.endBeat = js::min(end, segment_end);
        span.source = piece.source;
        if (part == lengths.size() - 1) {
          span.cadence = piece.cadence;
        }
        laid.push_back(span);
        cursor = end;
      }
    }
    if (!laid.empty()) {
      laid.back().endBeat = segment_end;
    } else {
      PhraseSpan span;
      span.startBeat = segment_start;
      span.endBeat = segment_end;
      span.source = !spans.empty() ? spans.back().source : (!profile.form.phrases.empty() ? 0 : -1);
      laid.push_back(span);
    }
    spans.insert(spans.end(), laid.begin(), laid.end());
  }
  return spans;
}

/** Index of the section whose span holds a beat, or null. */
Nullable<int> section_at(const std::vector<PlannedSection>& sections, double beat) {
  for (std::size_t index = 0; index < sections.size(); ++index) {
    if (beat >= sections[index].startBeat - BEAT_EPS && beat < sections[index].endBeat - BEAT_EPS) {
      return static_cast<int>(index);
    }
  }
  return std::nullopt;
}

/** Index of the phrase that holds `[start_beat, end_beat)` whole, or -1. */
int phrase_holding(const std::vector<PlannedPhrase>& phrases, double start_beat, double end_beat) {
  for (std::size_t index = 0; index < phrases.size(); ++index) {
    if (start_beat >= phrases[index].startBeat - BEAT_EPS &&
        end_beat <= phrases[index].endBeat + BEAT_EPS) {
      return static_cast<int>(index);
    }
  }
  return -1;
}

/** A motif graph node that fits inside one plan phrase. */
struct MotifCandidate {
  int node = 0;
  int phrase = 0;
  double startBeat = 0;
  double endBeat = 0;
  double notes = 0;
};

/** A schedule's standing: notes covered, statements opening off a strong beat (negated),
 * statements. */
using Cover = std::array<double, 3>;

/** Whether cover `a` ranks above cover `b`, comparing field by field. */
bool better(const Cover& a, const Cover& b) {
  for (std::size_t field = 0; field < a.size(); ++field) {
    if (a[field] != b[field]) {
      return a[field] > b[field];
    }
  }
  return false;
}

/** The non-overlapping candidates chosen by weighted interval scheduling. */
std::vector<MotifCandidate> schedule_motifs(const std::vector<MotifCandidate>& candidates,
                                            const MeterMap& meters) {
  std::vector<MotifCandidate> order = candidates;
  std::stable_sort(order.begin(), order.end(),
                   [](const MotifCandidate& a, const MotifCandidate& b) {
                     double by_start = a.startBeat - b.startBeat;
                     return by_start != 0 ? by_start < 0 : a.node < b.node;
                   });
  std::size_t count = order.size();
  // First candidate at or after position `from` starting no earlier than `beat`.
  auto first_from = [&](std::size_t from, double beat) {
    std::size_t low = from;
    std::size_t high = count;
    while (low < high) {
      std::size_t mid = (low + high) >> 1;
      if (order[mid].startBeat < beat - BEAT_EPS) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  };
  std::vector<std::size_t> next;
  std::vector<Cover> own;
  for (std::size_t index = 0; index < count; ++index) {
    next.push_back(first_from(index + 1, order[index].endBeat));
    own.push_back(Cover{
        order[index].notes,
        metric_weight(order[index].startBeat, meters) < PLAN_DERIVE_STRONG_WEIGHT ? -1.0 : 0.0, 1});
  }
  std::vector<Cover> best(count + 1, Cover{0, 0, 0});
  auto taking = [&](std::size_t index) {
    const Cover& rest = best[next[index]];
    const Cover& mine = own[index];
    return Cover{mine[0] + rest[0], mine[1] + rest[1], mine[2] + rest[2]};
  };
  for (std::size_t index = count; index > 0; --index) {
    Cover taken = taking(index - 1);
    const Cover& skipped = best[index];
    best[index - 1] = better(taken, skipped) ? taken : skipped;
  }
  std::vector<MotifCandidate> chosen;
  std::size_t index = 0;
  while (index < count) {
    if (!better(best[index], taking(index))) {
      chosen.push_back(order[index]);
      index = next[index];
    } else {
      index += 1;
    }
  }
  std::stable_sort(
      chosen.begin(), chosen.end(),
      [](const MotifCandidate& a, const MotifCandidate& b) { return a.node < b.node; });
  return chosen;
}

/** The derivation a selected node takes from its nearest selected ancestor. */
struct Derivation {
  Nullable<int> from;
  Nullable<MotifRelationSummary> relation;
};

Derivation selected_derivation(const MotifGraph& graph,
                               const std::map<std::size_t, const MotifGraphEdge*>& parent_edge,
                               const std::map<std::size_t, int>& selected_at, std::size_t node) {
  bool plain = true;
  double semitones = 0;
  int steps = 0;
  auto found = parent_edge.find(node);
  const MotifGraphEdge* edge = found != parent_edge.end() ? found->second : nullptr;
  while (edge != nullptr) {
    const Nullable<MotifRelationSummary>& relation = edge->relation;
    steps += 1;
    plain = plain && relation &&
            (relation->kind == MotifRelationKind::kRepetition ||
             (relation->kind == MotifRelationKind::kTransposition &&
              std::abs(relation->timeRatio - 1) <= BEAT_EPS));
    semitones += relation ? relation->semitones : 0;
    auto from = selected_at.find(edge->from);
    if (from != selected_at.end()) {
      if (steps == 1) {
        Derivation out;
        out.from = from->second;
        if (relation) {
          out.relation = *relation;
        }
        return out;
      }
      if (!plain) {
        return Derivation{};
      }
      double node_start = node < graph.nodes.size() ? graph.nodes[node].startBeat : 0;
      double from_end = edge->from < graph.nodes.size() ? graph.nodes[edge->from].endBeat : 0;
      double gap = node_start - from_end;
      MotifRelationSummary composed;
      composed.kind =
          semitones == 0 ? MotifRelationKind::kRepetition : MotifRelationKind::kTransposition;
      composed.sequence = gap >= -HUMANIZE_ADJACENCY && gap <= HUMANIZE_ADJACENCY;
      composed.semitones = semitones;
      composed.timeRatio = 1;
      Derivation out;
      out.from = from->second;
      out.relation = composed;
      return out;
    }
    auto up = parent_edge.find(edge->from);
    edge = up != parent_edge.end() ? up->second : nullptr;
  }
  return Derivation{};
}

/** Candidate numerals for a structural chord of a function; null for a key with no triads. */
std::optional<std::vector<std::string>> function_candidates(HarmonicFunction function,
                                                            const ResolvedKey& key) {
  if (scale_tones_in_degree_order(key).size() !=
      static_cast<std::size_t>(PLAN_HEPTATONIC_DEGREES)) {
    return std::nullopt;
  }
  std::vector<std::string> out;
  for (const FunctionDegreesRow& row : kFunctionDegrees) {
    if (row.function == to_string(function)) {
      for (int degree : row.degrees) {
        out.push_back(chord_to_roman(diatonic_triad(degree, KeyArg(key)), KeyArg(key)));
      }
    }
  }
  return out;
}

/** The plan's harmony: structural numerals kept or replaced by function, chord changes snapped. */
std::vector<PlannedChord> planned_harmony(const ReferenceProfile& profile,
                                          const std::vector<ResolvedKey>& keys,
                                          const DeriveRequest& request, const Draw& draw) {
  const ResolvedWeights& preserve = request.preserve;
  const std::vector<ReferenceChord>& chords = profile.harmony.chords;
  std::vector<std::string> romans;
  for (std::size_t index = 0; index < chords.size(); ++index) {
    const ReferenceChord& chord = chords[index];
    if (chord.level != ReductionLevel::kStructural ||
        draw.prob(preserve.harmonicFunction,
                  {std::string("harmonicFunction"), static_cast<double>(index)})) {
      romans.push_back(chord.roman);
      continue;
    }
    std::optional<std::vector<std::string>> candidates =
        function_candidates(chord.function, keys[chord.key]);
    if (!candidates) {
      romans.push_back(chord.roman);
      continue;
    }
    std::int64_t pick = draw.range(
        0, static_cast<std::int64_t>(candidates->size()) - 1,
        {std::string("harmonicFunction"), static_cast<double>(index), std::string("pick")});
    romans.push_back((*candidates)[static_cast<std::size_t>(pick)]);
  }
  std::vector<double> starts;
  for (std::size_t index = 0; index < chords.size(); ++index) {
    bool keep = index == 0 || draw.prob(preserve.harmonicRhythm, {std::string("harmonicRhythm"),
                                                                  static_cast<double>(index)});
    double start =
        keep ? chords[index].startBeat : bar_start_beat(chords[index].startBeat, profile.meters);
    starts.push_back(index == 0 ? start : js::max(start, starts[index - 1]));
  }
  std::vector<PlannedChord> planned;
  for (std::size_t index = 0; index < chords.size(); ++index) {
    double end_beat = chords[index].endBeat;
    if (index + 1 < chords.size()) {
      double next_start = starts[index + 1];
      end_beat = std::abs(chords[index].endBeat - chords[index + 1].startBeat) <= BEAT_EPS
                     ? next_start
                     : js::min(chords[index].endBeat, next_start);
    }
    double start_beat = starts[index];
    if (end_beat - start_beat > BEAT_EPS) {
      PlannedChord out;
      out.startBeat = start_beat;
      out.endBeat = end_beat;
      out.key = request.chordKeys.empty() ? static_cast<double>(chords[index].key)
                                          : request.chordKeys[index];
      out.roman = romans[index];
      planned.push_back(std::move(out));
    }
  }
  return planned;
}

/** The plan's onset target: levels and syncopation interpolated, IOI shares kept. */
PlannedRhythm planned_rhythm(const ReferenceProfile& profile, double weight) {
  const RhythmAnalysis& reference = profile.melody.rhythm;
  PlannedRhythm out;
  for (std::size_t level = 0; level < reference.onsetLevels.size(); ++level) {
    out.onsetLevels.push_back(
        lerp(weight, reference.onsetLevels[level], kNeutralOnsetLevels[level]));
  }
  out.interOnsetShares = reference.interOnsetShares;
  out.syncopation = lerp(weight, reference.syncopation, 0);
  return out;
}

}  // namespace

std::vector<std::string_view> preserve_aspects() {
  return std::vector<std::string_view>(std::begin(kPreserveAspects), std::end(kPreserveAspects));
}

const std::optional<double>* preserve_weight(const PreserveWeights& weights,
                                             std::string_view aspect) {
  if (aspect == "form") return &weights.form;
  if (aspect == "phraseLengths") return &weights.phraseLengths;
  if (aspect == "harmonicFunction") return &weights.harmonicFunction;
  if (aspect == "harmonicRhythm") return &weights.harmonicRhythm;
  if (aspect == "motifRelations") return &weights.motifRelations;
  if (aspect == "registerShape") return &weights.registerShape;
  if (aspect == "rhythm") return &weights.rhythm;
  return nullptr;
}

double* preserve_slot(ResolvedWeights& weights, std::string_view aspect) {
  if (aspect == "form") return &weights.form;
  if (aspect == "phraseLengths") return &weights.phraseLengths;
  if (aspect == "harmonicFunction") return &weights.harmonicFunction;
  if (aspect == "harmonicRhythm") return &weights.harmonicRhythm;
  if (aspect == "motifRelations") return &weights.motifRelations;
  if (aspect == "registerShape") return &weights.registerShape;
  if (aspect == "rhythm") return &weights.rhythm;
  return nullptr;
}

CompositionPlan derive_composition_plan_with(const ReferenceProfile& profile,
                                             const DeriveRequest& request,
                                             const ResolvedContext& ctx) {
  const ResolvedWeights& preserve = request.preserve;
  Draw draw = ctx.part("plan");

  const Nullable<ReferenceRegister>& melody_register = profile.melody.register_;
  if (profile.melody.rhythm.onsets == 0 || !melody_register) {
    throw InvalidInputError("reference must carry melody onsets to derive a plan from");
  }
  std::vector<ResolvedKey> keys = planned_keys(profile, request.requestedKey);
  double home_shift =
      mod12(keys[0].scale.rootPc -
            (profile.harmony.keys.empty() ? 0.0 : profile.harmony.keys.front().key.scale.rootPc));
  double shift = home_shift >= 6 ? home_shift - 12 : home_shift;
  double source_low = melody_register->low + shift;
  double source_high = melody_register->high + shift;
  if (source_low < 0 || source_high > 127) {
    throw InvalidInputError(
        "the reference melody range moved to the new key leaves the MIDI range; received " +
        js::to_string(source_low) + ".." + js::to_string(source_high));
  }
  double target_low = request.requestedRegister ? request.requestedRegister->low : source_low;
  double target_high = request.requestedRegister ? request.requestedRegister->high : source_high;
  double scale =
      source_high == source_low ? 0 : (target_high - target_low) / (source_high - source_low);
  double offset =
      source_high == source_low ? (target_low + target_high) / 2 : target_low - source_low * scale;
  auto map_pitch = [&](double pitch) { return (pitch + shift) * scale + offset; };
  PlannedRegister neutral{target_low, target_high, (target_low + target_high) / 2};

  std::vector<PlannedSection> sections = planned_sections(profile, preserve.form, draw);
  double shape_weight = preserve.registerShape;
  std::vector<PhraseSpan> spans =
      planned_phrase_spans(profile, sections, preserve.phraseLengths, draw);
  std::vector<PlannedPhrase> phrases;
  for (const PhraseSpan& span : spans) {
    const ReferencePhraseMelody* melody =
        span.source >= 0 && profile.form.phrases[static_cast<std::size_t>(span.source)].melody
            ? &*profile.form.phrases[static_cast<std::size_t>(span.source)].melody
            : nullptr;
    PlannedRegister range = neutral;
    if (melody != nullptr) {
      range.low = js::round(lerp(shape_weight, map_pitch(melody->low), neutral.low));
      range.high = js::round(lerp(shape_weight, map_pitch(melody->high), neutral.high));
      range.mean = lerp(shape_weight, map_pitch(melody->mean), neutral.mean);
    }
    PlannedPhrase phrase;
    phrase.startBeat = span.startBeat;
    phrase.endBeat = span.endBeat;
    phrase.section = section_at(sections, span.startBeat);
    phrase.cadence = span.cadence;
    phrase.shape = melody != nullptr && shape_weight >= PLAN_SHAPE_KEEP_THRESHOLD
                       ? melody->shape
                       : MelodicContourShape::kArch;
    phrase.peakPosition = melody != nullptr
                              ? lerp(shape_weight, melody->peakPosition, PLAN_NEUTRAL_PEAK_POSITION)
                              : PLAN_NEUTRAL_PEAK_POSITION;
    phrase.register_ = range;
    phrase.onsetDensity =
        melody != nullptr ? melody->onsetDensity : profile.melody.rhythm.onsetDensity;
    phrases.push_back(std::move(phrase));
  }

  const MotifGraph& graph = profile.melody.graph;
  auto note_count = [&](std::size_t node) {
    if (node >= graph.nodes.size() || graph.nodes[node].motif >= profile.melody.motifs.size()) {
      return 1.0;
    }
    return static_cast<double>(profile.melody.motifs[graph.nodes[node].motif].intervals.size()) + 1;
  };
  request.chargeMotifSelection(static_cast<double>(graph.nodes.size() * phrases.size()));
  std::vector<MotifCandidate> candidates;
  for (std::size_t index = 0; index < graph.nodes.size(); ++index) {
    const MotifGraphNode& node = graph.nodes[index];
    int phrase = phrase_holding(phrases, node.startBeat, node.endBeat);
    if (phrase >= 0) {
      candidates.push_back(MotifCandidate{static_cast<int>(index), phrase, node.startBeat,
                                          node.endBeat, note_count(index)});
    }
  }
  std::vector<MotifCandidate> selected = schedule_motifs(candidates, profile.meters);
  std::map<std::size_t, int> selected_at;
  for (std::size_t index = 0; index < selected.size(); ++index) {
    selected_at[static_cast<std::size_t>(selected[index].node)] = static_cast<int>(index);
  }
  std::map<std::size_t, const MotifGraphEdge*> parent_edge;
  for (const MotifGraphEdge& edge : graph.edges) {
    parent_edge[edge.to] = &edge;
  }
  std::vector<PlannedMotif> motifs;
  for (std::size_t index = 0; index < selected.size(); ++index) {
    const MotifCandidate& candidate = selected[index];
    Derivation derivation = selected_derivation(graph, parent_edge, selected_at,
                                                static_cast<std::size_t>(candidate.node));
    bool keep_relation = draw.prob(preserve.motifRelations,
                                   {std::string("motifRelations"), static_cast<double>(index)});
    bool keep_rhythm = !derivation.from && draw.prob(preserve.rhythm, {std::string("rhythm"),
                                                                       static_cast<double>(index)});
    const ReferenceMotif* cell = nullptr;
    std::size_t node_index = static_cast<std::size_t>(candidate.node);
    if (node_index < graph.nodes.size() &&
        graph.nodes[node_index].motif < profile.melody.motifs.size()) {
      cell = &profile.melody.motifs[graph.nodes[node_index].motif];
    }
    phrases[static_cast<std::size_t>(candidate.phrase)].motifs.push_back(static_cast<int>(index));
    PlannedMotif motif;
    motif.phrase = candidate.phrase;
    motif.startBeat = candidate.startBeat;
    motif.endBeat = candidate.endBeat;
    motif.notes = static_cast<int>(candidate.notes);
    if (keep_rhythm && cell != nullptr) {
      std::vector<double> gaps;
      for (double ratio : cell->rhythm) {
        gaps.push_back(ratio * cell->unitBeats);
      }
      motif.rhythm = std::move(gaps);
    }
    motif.from = derivation.from;
    if (keep_relation) {
      motif.relation = derivation.relation;
    }
    motifs.push_back(std::move(motif));
  }

  CompositionPlan plan;
  plan.planVersion = COMPOSITION_PLAN_VERSION;
  plan.seed = ctx.seed;
  plan.algorithmVersion = static_cast<int>(ctx.algorithmVersion);
  plan.keys = keys;
  plan.meters = profile.meters;
  plan.span = PlanSpan{profile.span.startBeat, profile.span.endBeat, profile.span.bars};
  plan.sections = std::move(sections);
  plan.phrases = std::move(phrases);
  plan.harmony = planned_harmony(profile, keys, request, draw);
  plan.motifs = std::move(motifs);
  plan.rhythm = planned_rhythm(profile, preserve.rhythm);
  return plan;
}

CompositionPlan derive_composition_plan(const ReferenceProfile& reference,
                                        const CompositionPlanOptions& opts) {
  const ReferenceProfile& profile = assert_reference_profile(reference, "reference");
  DeriveRequest request;
  if (opts.preserve) {
    ResolvedWeights* weights = &request.preserve;
    for (std::string_view aspect : preserve_aspects()) {
      const std::optional<double>* given = preserve_weight(*opts.preserve, aspect);
      double* slot = preserve_slot(*weights, aspect);
      *slot = given->has_value()
                  ? assert_range(**given, 0, 1, "opts.preserve." + std::string(aspect))
                  : 1.0;
    }
  }
  if (opts.register_) {
    double low = assert_midi_pitch(opts.register_->low, "opts.register.low");
    double high = assert_midi_pitch(opts.register_->high, "opts.register.high");
    if (low > high) {
      throw InvalidInputError("opts.register.low must not exceed opts.register.high; received " +
                              js::to_string(low) + " > " + js::to_string(high));
    }
    request.requestedRegister = PlanRegisterRange{static_cast<int>(low), static_cast<int>(high)};
  }
  if (opts.ctx) {
    if (const GenerationContext* given = std::get_if<GenerationContext>(&opts.ctx->value());
        given != nullptr && given->rng) {
      throw InvalidInputError(
          "opts.ctx.rng is not accepted: a composition plan records its seed, not a source");
    }
  }
  ResolvedContext ctx = resolve_context(opts.ctx);
  if (opts.key) {
    KeyArg key = *opts.key;
    request.requestedKey = [key]() { return resolve_key(key); };
  }
  std::optional<double> budget = opts.budget;
  request.chargeMotifSelection = [budget](double cells) {
    assert_generation_budget(cells, "plan motif selection", budget);
  };
  return derive_composition_plan_with(profile, request, ctx);
}

}  // namespace cantus
