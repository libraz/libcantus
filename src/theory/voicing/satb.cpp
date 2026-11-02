// Realize chords as SATB-style voicings: ts/src/theory/voicing/satb.ts.

#include "theory/voicing/satb.h"

#include <cmath>
#include <iterator>
#include <limits>
#include <string>
#include <utility>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "cantus/theory/spelling.h"
#include "cantus/theory/symbol.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "theory/voicing/internal.h"

namespace cantus {

namespace {

constexpr VoiceRange kSatbRangeRows[] =
#include "theory/voicing/satb_ranges.gen.inc"
    ;

std::vector<VoiceRange> satb_ranges() {
  return std::vector<VoiceRange>(std::begin(kSatbRangeRows), std::end(kSatbRangeRows));
}

/** How far a candidate sits from the middle of each voice's range, summed (`centeringPenalty`). */
double centering_penalty(const std::vector<VoiceRange>& ranges, const double* pitches,
                         std::size_t offset, std::size_t voices) {
  double penalty = 0;
  for (std::size_t voice = 0; voice < voices; ++voice) {
    const VoiceRange& range = ranges[voice];
    penalty += std::fabs(pitches[offset + voice] - (range.min + range.max) / 2);
  }
  return penalty;
}

/** The index of the lowest-scoring candidate of a buffer scored by `score`, or -1. */
template <class Score>
long best_candidate(const VoicingCandidates& candidates, Score&& score) {
  long best_offset = -1;
  double best_score = std::numeric_limits<double>::infinity();
  for (std::size_t index = 0; index < candidates.count; ++index) {
    std::size_t offset = index * candidates.voices;
    double value = score(offset);
    if (value < best_score) {
      best_score = value;
      best_offset = static_cast<long>(offset);
    }
  }
  return best_offset;
}

std::vector<int> voicing_at(const VoicingCandidates& candidates, long offset) {
  std::vector<int> out;
  for (std::size_t voice = 0; voice < candidates.voices; ++voice) {
    out.push_back(static_cast<int>(candidates.pitches[static_cast<std::size_t>(offset) + voice]));
  }
  return out;
}

/** The unsatisfiable-constraints error for one chord of a progression (`noSolutionAt`). */
NoSolutionError no_solution_at(std::size_t index, const Chord& chord) {
  return NoSolutionError("no voicing satisfies the given ranges for " +
                             format_chord_symbol(ChordArg(chord)) + " at index " +
                             index_text(index),
                         index);
}

/** Run one chord's enumeration, re-raising an unsatisfiable failure with the chord it happened on
 * (`locate`). */
void enumerate_at(std::size_t index, const Chord& chord, const std::vector<VoiceRange>& ranges,
                  double max_spacing, double max_candidates, VoicingCandidates& into) {
  try {
    enumerate_voicings(chord, ranges, max_spacing, max_candidates, into);
  } catch (const NoSolutionError&) {
    throw no_solution_at(index, chord);
  }
}

/** The chord after the one being voiced: its candidates, and how a move onto it scores. */
struct Lookahead {
  VoicingCandidates* candidates;
  MoveScoring scoring;
};

/** The violation weight a candidate commits the next chord to (`successorWeight`). */
double successor_weight(const Lookahead& next, const double* cur, std::size_t cur_offset,
                        std::size_t voices) {
  const VoicingCandidates& candidates = *next.candidates;
  const double* pitches = candidates.pitches.data();
  double best_score = std::numeric_limits<double>::infinity();
  double best_weight = 0;
  for (std::size_t candidate = 0; candidate < candidates.count; ++candidate) {
    std::size_t offset = candidate * voices;
    double weight = violation_weight(next.scoring, cur, cur_offset, pitches, offset, voices);
    double structure = structural_penalty(next.scoring.structure, pitches, offset, voices);
    double distance = leading_cost(cur, cur_offset, pitches, offset, voices);
    double score = weight + structure + distance;
    if (score < best_score) {
      best_score = score;
      best_weight = weight;
    }
  }
  return best_weight;
}

}  // namespace

const std::vector<VoiceRange> SATB_RANGES = satb_ranges();

std::string_view to_string(VoicingStyle style) {
  switch (style) {
    case VoicingStyle::kClose:
      return "close";
    case VoicingStyle::kDrop2:
      return "drop2";
    case VoicingStyle::kDrop3:
      return "drop3";
    case VoicingStyle::kShell:
      return "shell";
    case VoicingStyle::kRootless:
      return "rootless";
  }
  return {};
}

/** Every voicing style, in the order the TS union names them. */
constexpr VoicingStyle kVoicingStyles[] = {VoicingStyle::kClose, VoicingStyle::kDrop2,
                                           VoicingStyle::kDrop3, VoicingStyle::kShell,
                                           VoicingStyle::kRootless};

std::optional<VoicingStyle> parse_voicing_style(std::string_view name) {
  for (VoicingStyle style : kVoicingStyles) {
    if (to_string(style) == name) {
      return style;
    }
  }
  return std::nullopt;
}

std::vector<std::string_view> voicing_style_names() {
  std::vector<std::string_view> names;
  for (VoicingStyle style : kVoicingStyles) {
    names.push_back(to_string(style));
  }
  return names;
}

std::vector<VoiceRange> resolve_ranges(const VoicingOptions& opts) {
  if (opts.ranges) {
    const std::vector<VoiceRange>& given = *opts.ranges;
    if (given.empty()) {
      throw InvalidInputError("ranges must contain at least one voice range");
    }
    assert_generation_budget(static_cast<double>(given.size()), "voice ranges", 128);
    std::vector<VoiceRange> out;
    for (std::size_t index = 0; index < given.size(); ++index) {
      const VoiceRange& range = given[index];
      std::string label = "ranges[" + index_text(index) + "]";
      assert_finite_number(range.min, label + ".min");
      assert_finite_number(range.max, label + ".max");
      if (range.min > range.max) {
        throw InvalidInputError(label + ".min must not exceed max");
      }
      assert_generation_budget(std::floor(range.max) - std::ceil(range.min) + 1, label + " span",
                               4096);
      out.push_back(range);
    }
    return out;
  }
  double voices = opts.voices.value_or(4);
  assert_positive_int(voices, "voices", 128);
  if (voices == 4) {
    return SATB_RANGES;
  }
  if (voices == 1) {
    return {VoiceRange{DERIVED_LOW, DERIVED_HIGH}};
  }
  std::vector<VoiceRange> ranges;
  for (int i = 0; i < voices; ++i) {
    double min =
        js::round(DERIVED_LOW + (i * (DERIVED_HIGH - DERIVED_SPAN - DERIVED_LOW)) / (voices - 1));
    ranges.push_back(VoiceRange{min, min + DERIVED_SPAN});
  }
  return ranges;
}

double resolve_max_spacing(const VoicingOptions& opts) {
  double max_spacing = opts.maxSpacing.value_or(DEFAULT_MAX_SPACING);
  assert_finite_number(max_spacing, "maxSpacing");
  if (max_spacing < 0) {
    throw InvalidInputError("maxSpacing must be non-negative");
  }
  return max_spacing;
}

std::optional<ResolvedKey> resolved_key_of(const VoicingOptions& opts) {
  if (!opts.key) {
    return std::nullopt;
  }
  return resolve_key(*opts.key);
}

std::optional<Chord> resolve_previous_chord(const VoicingOptions& opts) {
  if (!opts.previousChord) {
    return std::nullopt;
  }
  return to_chord_data(*opts.previousChord);
}

std::optional<double> resolve_max_candidates(const VoicingOptions& opts) {
  if (!opts.maxCandidates) {
    return std::nullopt;
  }
  assert_positive_int(*opts.maxCandidates, "maxCandidates", 1000000);
  return opts.maxCandidates;
}

std::vector<int> voice_chord(const ChordArg& chord, const VoicingOptions& opts) {
  Chord data = to_chord_data(chord);
  std::vector<VoiceRange> ranges = resolve_ranges(opts);
  double max_spacing = resolve_max_spacing(opts);
  VoicingCandidates candidates;
  enumerate_voicings(data, ranges, max_spacing,
                     resolve_max_candidates(opts).value_or(DEFAULT_MAX_CANDIDATES), candidates);
  StructuralTables structure = move_scoring(std::nullopt, data, resolved_key_of(opts)).structure;
  long best = best_candidate(candidates, [&](std::size_t offset) {
    return structural_penalty(structure, candidates.pitches.data(), offset, candidates.voices) +
           centering_penalty(ranges, candidates.pitches.data(), offset, candidates.voices);
  });
  if (best < 0) {
    throw NoSolutionError("no voicing satisfies the given ranges for " +
                          format_chord_symbol(chord));
  }
  return voicing_at(candidates, best);
}

std::vector<std::vector<int>> voice_progression(const std::vector<ChordArg>& chords,
                                                const VoicingOptions& opts) {
  assert_generation_budget(static_cast<double>(chords.size()), "voiced progression chords",
                           opts.budget);
  std::vector<Chord> data;
  for (const ChordArg& chord : chords) {
    data.push_back(to_chord_data(chord));
  }
  std::optional<ResolvedKey> key = resolved_key_of(opts);
  std::vector<VoiceRange> ranges = resolve_ranges(opts);
  double max_spacing = resolve_max_spacing(opts);
  double max_candidates = resolve_max_candidates(opts).value_or(DEFAULT_MAX_CANDIDATES);
  std::vector<std::vector<int>> result;
  if (data.empty()) {
    return result;
  }
  // Two candidate buffers serve the whole progression: the chord being voiced and the one looked
  // ahead to; each step hands its lookahead buffer on as the next step's own.
  VoicingCandidates current_buffer;
  VoicingCandidates spare_buffer;
  VoicingCandidates* current = &current_buffer;
  VoicingCandidates* spare = &spare_buffer;
  enumerate_at(0, data[0], ranges, max_spacing, max_candidates, *current);
  // The scoring of a move onto the chord being voiced is the one its predecessor built to look
  // ahead with, so it is carried forward.
  MoveScoring scoring = move_scoring(std::nullopt, data[0], key);
  std::vector<double> prev;
  for (std::size_t index = 0; index < data.size(); ++index) {
    const Chord& chord = data[index];
    std::optional<Lookahead> lookahead;
    if (index + 1 < data.size()) {
      const Chord& next_chord = data[index + 1];
      enumerate_at(index + 1, next_chord, ranges, max_spacing, max_candidates, *spare);
      std::optional<Chord> after;
      if (index + 2 < data.size()) {
        after = data[index + 2];
      }
      const SpellingTable* chord_spelling = scoring.spelling ? &scoring.spelling->to : nullptr;
      lookahead = Lookahead{spare, move_scoring(chord, next_chord, key, after, chord_spelling)};
    }
    const double* pitches = current->pitches.data();
    std::size_t voices = current->voices;
    std::size_t count = current->count;
    // The lookahead is dropped wherever the pairs would outgrow the bounded per-chord search, for
    // the whole chord, so no candidate is judged on terms the others were not.
    const Lookahead* weighed =
        lookahead &&
                static_cast<double>(count) * static_cast<double>(lookahead->candidates->count) <=
                    MAX_LOOKAHEAD_PAIRS
            ? &*lookahead
            : nullptr;
    long best_offset = -1;
    double best_score = std::numeric_limits<double>::infinity();
    for (std::size_t candidate = 0; candidate < count; ++candidate) {
      std::size_t offset = candidate * voices;
      double score = prev.empty() ? structural_penalty(scoring.structure, pitches, offset, voices) +
                                        centering_penalty(ranges, pitches, offset, voices)
                                  : move_score(scoring, prev.data(), 0, pitches, offset, voices);
      if (weighed != nullptr) {
        score += successor_weight(*weighed, pitches, offset, voices);
      }
      if (score < best_score) {
        best_score = score;
        best_offset = static_cast<long>(offset);
      }
    }
    if (best_offset < 0) {
      throw no_solution_at(index, chord);
    }
    std::vector<int> best = voicing_at(*current, best_offset);
    prev.assign(best.begin(), best.end());
    result.push_back(std::move(best));
    if (lookahead) {
      scoring = std::move(lookahead->scoring);
      std::swap(current, spare);
    }
  }
  return result;
}

}  // namespace cantus
