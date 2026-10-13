// The recurring cells a melody is built from: ts/src/analyze/melody/motifs.ts.

#include "analyze/melody/motifs.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <string>
#include <unordered_map>

#include "analyze/melody/contour.h"
#include "analyze/melody/internal.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** A group of identical windows, before it is decided whether it is a motif (`WindowGroup`). */
struct WindowGroup {
  std::string signature;
  std::size_t length = 0;
  /** Index of the first note of each window, ascending. */
  std::vector<std::size_t> starts;
};

/** `array.join(',')` of numbers. */
std::string join_numbers(const std::vector<double>& values) {
  std::string out;
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (i > 0) {
      out += ',';
    }
    out += js::to_string(values[i]);
  }
  return out;
}

/**
 * The identity of one window: its intervals and its rhythmic profile (`windowSignature`); nullopt
 * for a window with no usable rhythmic profile.
 */
std::optional<std::string> window_signature(const std::vector<LineNote>& notes) {
  std::optional<std::vector<double>> profile = rhythm_profile(onset_gaps(notes));
  if (!profile) {
    return std::nullopt;
  }
  return js::to_string(static_cast<double>(notes.size())) + "|" +
         join_numbers(intervals_of(notes)) + "|" + join_numbers(*profile);
}

/** Keep the statements that do not overlap, earliest first (`nonOverlapping`). */
std::vector<std::size_t> non_overlapping(const std::vector<std::size_t>& starts,
                                         std::size_t length) {
  std::vector<std::size_t> picked;
  bool any = false;
  double last_end = 0;
  for (std::size_t start : starts) {
    if (!any || static_cast<double>(start) > last_end) {
      picked.push_back(start);
      last_end = static_cast<double>(start + length) - 1;
      any = true;
    }
  }
  return picked;
}

/** Whether every statement of `inner` sits inside one statement of `outer` (`subsumes`). */
bool subsumes(const WindowGroup& outer, const WindowGroup& inner) {
  std::size_t at = 0;
  for (std::size_t start : inner.starts) {
    while (at + 1 < outer.starts.size() && outer.starts[at + 1] <= start) {
      at += 1;
    }
    if (outer.starts.empty()) {
      return false;
    }
    std::size_t from = outer.starts[at];
    if (start < from || start + inner.length > from + outer.length) {
      return false;
    }
  }
  return true;
}

/** List the statement onsets for a rationale without letting it run away (`listBeats`). */
std::string list_beats(const std::vector<MotifOccurrence>& occurrences) {
  std::string shown;
  std::size_t count = std::min<std::size_t>(5, occurrences.size());
  for (std::size_t i = 0; i < count; ++i) {
    if (i > 0) {
      shown += ", ";
    }
    shown += js::to_string(round_to(occurrences[i].startBeat, 3));
  }
  if (occurrences.size() > count) {
    return shown + ", and " + js::to_string(static_cast<double>(occurrences.size() - count)) +
           " more";
  }
  return shown;
}

/** Build the motif a group of identical windows stands for (`motifFromGroup`). */
MotifData motif_from_group(const WindowGroup& group, const std::vector<NoteEvent>& notes) {
  std::vector<LineNote> all = line_of(notes);
  auto slice = [&](std::size_t start) {
    std::size_t stop = std::min<std::size_t>(start + group.length, all.size());
    return std::vector<LineNote>(
        all.begin() + static_cast<std::ptrdiff_t>(std::min<std::size_t>(start, stop)),
        all.begin() + static_cast<std::ptrdiff_t>(stop));
  };
  std::size_t first = group.starts.empty() ? 0 : group.starts[0];
  std::vector<LineNote> prime_line = slice(first);
  std::vector<NoteEvent> prime(
      notes.begin() + static_cast<std::ptrdiff_t>(std::min<std::size_t>(first, notes.size())),
      notes.begin() +
          static_cast<std::ptrdiff_t>(std::min<std::size_t>(first + group.length, notes.size())));
  double prime_pitch = prime_line.empty() ? 0 : prime_line.front().pitch;
  double prime_span = onset_span(prime_line);
  std::vector<MotifOccurrence> occurrences;
  for (std::size_t start : group.starts) {
    std::vector<LineNote> statement = slice(start);
    double span = onset_span(statement);
    MotifOccurrence occurrence;
    occurrence.noteIndex = start;
    occurrence.startBeat = statement.empty() ? 0 : statement.front().startBeat;
    occurrence.endBeat = end_beat_of(statement);
    occurrence.transpose = (statement.empty() ? 0 : statement.front().pitch) - prime_pitch;
    occurrence.timeRatio = prime_span > BEAT_EPS ? span / prime_span : 1;
    occurrences.push_back(occurrence);
  }
  MelodicContourShape shape = contour_of(ordered_notes(prime, "contour notes")).shape;
  bool transposed = std::any_of(occurrences.begin(), occurrences.end(),
                                [](const MotifOccurrence& o) { return o.transpose != 0; });
  bool stretched =
      std::any_of(occurrences.begin(), occurrences.end(),
                  [](const MotifOccurrence& o) { return std::fabs(o.timeRatio - 1) > BEAT_EPS; });
  std::string detail = transposed ? "at more than one pitch level" : "at the same pitch level";
  if (stretched) {
    detail += " and in more than one set of note values";
  }
  MotifData out;
  out.intervals = intervals_of(prime_line);
  out.rhythm = rhythm_profile(onset_gaps(prime_line)).value_or(std::vector<double>{});
  out.rationale = js::to_string(static_cast<double>(group.length)) + "-note " +
                  std::string(to_string(shape)) + " cell stated " +
                  js::to_string(static_cast<double>(occurrences.size())) + " " +
                  (occurrences.size() == 1 ? "time" : "times") + " (beats " +
                  list_beats(occurrences) + "), " + detail;
  out.notes = std::move(prime);
  out.occurrences = std::move(occurrences);
  return out;
}

}  // namespace

std::vector<MotifData> extract_motifs(const std::vector<NoteEvent>& notes,
                                      const ExtractMotifsOptions& opts) {
  auto min_notes = static_cast<std::size_t>(
      assert_integer(opts.minNotes.value_or(MIN_CELL_NOTES), "motif minNotes", 2, 64));
  auto max_notes = static_cast<std::size_t>(
      assert_integer(opts.maxNotes.value_or(MAX_CELL_NOTES), "motif maxNotes", 2, 64));
  if (max_notes < min_notes) {
    throw InvalidInputError("motif maxNotes must be at least minNotes " +
                            js::to_string(static_cast<double>(min_notes)) + "; received " +
                            js::to_string(static_cast<double>(max_notes)));
  }
  double min_occurrences =
      assert_integer(opts.minOccurrences.value_or(MIN_OCCURRENCES), "motif minOccurrences", 2);
  std::vector<NoteEvent> sounding = ordered_notes(notes, "melody notes", opts.budget);
  if (sounding.size() < min_notes) {
    return {};
  }
  assert_generation_budget(static_cast<double>(sounding.size() * (max_notes - min_notes + 1)),
                           "motif windows", opts.budget);

  std::vector<LineNote> line = line_of(sounding);
  std::vector<WindowGroup> groups;
  std::unordered_map<std::string, std::size_t> group_of;
  for (std::size_t length = min_notes; length <= max_notes; ++length) {
    for (std::size_t start = 0; start + length <= sounding.size(); ++start) {
      std::vector<LineNote> window(line.begin() + static_cast<std::ptrdiff_t>(start),
                                   line.begin() + static_cast<std::ptrdiff_t>(start + length));
      std::optional<std::string> signature = window_signature(window);
      if (!signature) {
        continue;
      }
      auto found = group_of.find(*signature);
      if (found == group_of.end()) {
        group_of.emplace(*signature, groups.size());
        groups.push_back(WindowGroup{*signature, length, {start}});
      } else {
        groups[found->second].starts.push_back(start);
      }
    }
  }

  std::vector<WindowGroup> candidates;
  for (const WindowGroup& group : groups) {
    WindowGroup picked{group.signature, group.length, non_overlapping(group.starts, group.length)};
    if (static_cast<double>(picked.starts.size()) >= min_occurrences) {
      candidates.push_back(std::move(picked));
    }
  }
  // Longest first, then most often stated, then earliest; the signature settles any remaining tie
  // so the order never depends on the map's insertion order.
  std::stable_sort(candidates.begin(), candidates.end(),
                   [](const WindowGroup& a, const WindowGroup& b) {
                     if (a.length != b.length) {
                       return a.length > b.length;
                     }
                     if (a.starts.size() != b.starts.size()) {
                       return a.starts.size() > b.starts.size();
                     }
                     if (a.starts[0] != b.starts[0]) {
                       return a.starts[0] < b.starts[0];
                     }
                     return a.signature < b.signature;
                   });

  // A candidate is dropped when a longer motif already kept states it inside every one of its own
  // statements, so the only groups worth asking are the ones whose statements cover the
  // candidate's first onset. The kept groups are indexed by length and first note.
  std::map<std::size_t, std::map<std::size_t, std::size_t>> kept_by_length;
  std::vector<std::size_t> kept;
  double comparisons = 0;
  for (std::size_t index = 0; index < candidates.size(); ++index) {
    const WindowGroup& candidate = candidates[index];
    std::size_t first = candidate.starts[0];
    bool covered = false;
    for (std::size_t length = candidate.length + 1; length <= max_notes && !covered; ++length) {
      auto by_start = kept_by_length.find(length);
      if (by_start == kept_by_length.end()) {
        continue;
      }
      std::size_t reach = length - candidate.length;
      for (std::size_t from = first >= reach ? first - reach : 0; from <= first; ++from) {
        comparisons += 1;
        auto outer = by_start->second.find(from);
        if (outer == by_start->second.end() ||
            candidates[outer->second].starts.size() < candidate.starts.size()) {
          continue;
        }
        comparisons +=
            static_cast<double>(candidates[outer->second].starts.size() + candidate.starts.size());
        if (subsumes(candidates[outer->second], candidate)) {
          covered = true;
          break;
        }
      }
    }
    // Charged as it is spent rather than estimated.
    assert_generation_budget(comparisons, "motif subsumption comparisons", opts.budget);
    if (!covered) {
      kept.push_back(index);
      std::map<std::size_t, std::size_t>& by_start = kept_by_length[candidate.length];
      for (std::size_t start : candidate.starts) {
        by_start[start] = index;
      }
    }
  }
  std::vector<MotifData> out;
  for (std::size_t index : kept) {
    out.push_back(motif_from_group(candidates[index], sounding));
  }
  return out;
}

MotifData motif_of_line(const std::vector<NoteEvent>& ordered) {
  WindowGroup group;
  group.signature = window_signature(line_of(ordered)).value_or("");
  group.length = ordered.size();
  group.starts = {0};
  return motif_from_group(group, ordered);
}

MotifData motif_from_notes(const std::vector<NoteEvent>& notes) {
  return motif_of_line(ordered_notes(notes, "motif notes"));
}

}  // namespace cantus
