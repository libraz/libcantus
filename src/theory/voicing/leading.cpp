// Voice leading from an existing voicing: ts/src/theory/voicing/leading.ts.

#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "theory/voicing/internal.h"
#include "theory/voicing/satb.h"

namespace cantus {

namespace {

/** Read a voicing as one: every voice holds a finite pitch (`assertVoicing`). */
void assert_voicing(const std::vector<double>& pitches, std::string_view name) {
  for (std::size_t index = 0; index < pitches.size(); ++index) {
    assert_finite_number(pitches[index], std::string(name) + "[" + index_text(index) + "]");
  }
}

}  // namespace

double voice_leading_cost(const std::vector<double>& from, const std::vector<double>& to) {
  assert_voicing(from, "from");
  assert_voicing(to, "to");
  if (from.size() != to.size()) {
    return std::numeric_limits<double>::infinity();
  }
  return leading_cost(from.data(), 0, to.data(), 0, from.size());
}

std::vector<int> next_voicing(const std::vector<double>& current, const ChordArg& chord,
                              const VoicingOptions& opts) {
  assert_voicing(current, "current");
  Chord data = to_chord_data(chord);
  bool derived = !opts.ranges && !opts.voices;
  if (derived && current.empty()) {
    // The ranges are read off `current`, so an empty voicing would describe a zero-voice chord.
    throw InvalidInputError("current must contain at least one pitch");
  }
  // Both branches end in the same resolver, so the voice-count budget and the range checks apply
  // wherever the ranges came from.
  VoicingOptions resolving = opts;
  if (derived) {
    std::vector<VoiceRange> windows;
    for (double pitch : current) {
      // Window one octave around each current pitch, clamped to MIDI 0..127.
      double centre = js::min(127, js::max(0, pitch));
      windows.push_back(VoiceRange{js::max(0, centre - 12), js::min(127, centre + 12)});
    }
    resolving = VoicingOptions{};
    resolving.ranges = std::move(windows);
  }
  std::vector<VoiceRange> ranges = resolve_ranges(resolving);
  if (current.size() < ranges.size()) {
    throw InvalidInputError("current has " + js::to_string(current.size()) +
                            " voices but the requested ranges require " +
                            js::to_string(ranges.size()));
  }
  // Thinning an existing texture keeps the outer voices and selects evenly spaced inner voices.
  std::vector<double> source;
  if (current.size() == ranges.size()) {
    source = current;
  } else if (ranges.size() == 1) {
    source.push_back(current[0]);
  } else {
    for (std::size_t index = 0; index < ranges.size(); ++index) {
      double source_index = js::round((static_cast<double>(index) * (current.size() - 1)) /
                                      static_cast<double>(ranges.size() - 1));
      source.push_back(current[static_cast<std::size_t>(source_index)]);
    }
  }
  double max_spacing = resolve_max_spacing(opts);
  VoicingCandidates candidates;
  enumerate_voicings(data, ranges, max_spacing,
                     resolve_max_candidates(opts).value_or(DEFAULT_MAX_CANDIDATES), candidates);
  std::optional<ResolvedKey> key = resolved_key_of(opts);
  // The chord the current voicing came from is optional; the move is otherwise scored exactly as
  // one step of a progression is.
  MoveScoring scoring = move_scoring(resolve_previous_chord(opts), data, key);
  long best_offset = -1;
  double best_score = std::numeric_limits<double>::infinity();
  for (std::size_t candidate = 0; candidate < candidates.count; ++candidate) {
    std::size_t offset = candidate * candidates.voices;
    double score =
        move_score(scoring, source.data(), 0, candidates.pitches.data(), offset, candidates.voices);
    if (score < best_score) {
      best_score = score;
      best_offset = static_cast<long>(offset);
    }
  }
  if (best_offset < 0) {
    throw NoSolutionError("no voicing satisfies the given ranges");
  }
  std::vector<int> out;
  for (std::size_t voice = 0; voice < candidates.voices; ++voice) {
    out.push_back(
        static_cast<int>(candidates.pitches[static_cast<std::size_t>(best_offset) + voice]));
  }
  return out;
}

}  // namespace cantus
