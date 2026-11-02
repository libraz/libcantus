// The spans the harmony may change on: ts/src/generate/harmonize/segments.ts.

#include "generate/harmonize/segments.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include "cantus/core/limits.h"
#include "generate/harmonize/limits.gen.h"
#include "generate/harmonize/nct.h"
#include "js/math.h"
#include "js/sort.h"

namespace cantus {

std::vector<double> grid_bounds(double segment_start, double hr, double grid_count,
                                const std::vector<double>& ends) {
  std::vector<double> bounds;
  for (double s = 0; s <= grid_count; s += 1) {
    bounds.push_back(segment_start + s * hr);
  }
  double last = segment_start + grid_count * hr;
  for (double end : ends) {
    if (end > segment_start + BEAT_EPS && end < last - BEAT_EPS) {
      bounds.push_back(end);
    }
  }
  js::array_sort(bounds, [](double a, double b) { return a - b; });
  std::vector<double> out;
  for (std::size_t index = 0; index < bounds.size(); ++index) {
    if (index == 0 || bounds[index] - bounds[index - 1] > BEAT_EPS) {
      out.push_back(bounds[index]);
    }
  }
  return out;
}

std::set<std::size_t> closing_note_indices(const std::vector<MelodySpan>& spans,
                                           const std::vector<double>& ends) {
  std::set<std::size_t> closing;
  for (double end : ends) {
    bool found = false;
    std::size_t index = 0;
    double start = -std::numeric_limits<double>::infinity();
    for (std::size_t i = 0; i < spans.size(); ++i) {
      if (spans[i].startBeat < end - BEAT_EPS && spans[i].startBeat >= start) {
        start = spans[i].startBeat;
        index = i;
        found = true;
      }
    }
    if (found) {
      closing.insert(index);
    }
  }
  return closing;
}

std::size_t segment_index_at(const std::vector<double>& bounds, double beat) {
  std::ptrdiff_t low = 0;
  std::ptrdiff_t high = static_cast<std::ptrdiff_t>(bounds.size()) - 2;
  std::size_t found = 0;
  while (low <= high) {
    std::ptrdiff_t mid = (low + high) >> 1;
    if (bounds[static_cast<std::size_t>(mid)] <= beat) {
      found = static_cast<std::size_t>(mid);
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

std::vector<ChordSpan> merge_repeats(const std::vector<ChordSpan>& spans) {
  std::vector<ChordSpan> merged;
  for (const ChordSpan& span : spans) {
    if (!merged.empty()) {
      const ChordSpan& prev = merged.back();
      if (prev.rootPc == span.rootPc && prev.quality == span.quality &&
          prev.degree == span.degree && prev.secondaryDominant == span.secondaryDominant) {
        continue;
      }
    }
    merged.push_back(span);
  }
  return merged;
}

PhraseEndSegments phrase_end_segments(const std::vector<Segment>& segments,
                                      const std::vector<double>& ends) {
  PhraseEndSegments out;
  if (!segments.empty()) {
    out.closing.insert(segments.size() - 1);
  }
  for (double end : ends) {
    // The phrase closes in the last segment beginning before that beat.
    bool found = false;
    std::size_t index = 0;
    for (std::size_t s = 0; s < segments.size(); ++s) {
      if (segments[s].startBeat < end - BEAT_EPS) {
        index = s;
        found = true;
      }
    }
    if (found) {
      out.closing.insert(index);
      out.named.insert(index);
    }
  }
  return out;
}

BuiltSegments build_segments(const std::vector<MelodySpan>& spans,
                             const std::vector<NoteEvent>& melody, const TimeSignature& ts,
                             const HarmonicGrid& grid, const std::vector<double>& phrase_ends,
                             const BudgetCharge& charge) {
  double melody_start = grid.start;
  double melody_end = grid.end;
  double hr = grid.harmonicRhythm;
  double segment_start = std::floor(melody_start / hr) * hr;
  double grid_count = js::max(1.0, std::ceil((melody_end - segment_start) / hr));
  charge(grid_count, "harmonic segments");
  // Only a beat inside the melody names a close inside it.
  std::vector<double> inner_ends;
  for (double end : phrase_ends) {
    if (end > segment_start + BEAT_EPS && end < melody_end - BEAT_EPS) {
      inner_ends.push_back(end);
    }
  }
  // The grid the search may change chords on: the harmonic rhythm, divided again at every beat the
  // caller named as a phrase end.
  std::vector<double> bounds = grid_bounds(segment_start, hr, grid_count, inner_ends);
  std::size_t seg_count = bounds.size() - 1;
  charge(static_cast<double>(seg_count), "harmonic segments");
  std::vector<Segment> segments;
  for (std::size_t s = 0; s < seg_count; ++s) {
    Segment segment;
    segment.startBeat = bounds[s];
    segment.endBeat = bounds[s + 1];
    segment.beats = segment.endBeat - segment.startBeat;
    segments.push_back(std::move(segment));
  }
  // Associate each note only with the windows it actually spans.
  double memberships = 0;
  for (std::size_t index = 0; index < spans.size(); ++index) {
    std::size_t first = segment_index_at(bounds, spans[index].startBeat);
    std::size_t last_exclusive = first;
    while (last_exclusive < seg_count &&
           bounds[last_exclusive] < spans[index].endBeat - std::numeric_limits<double>::epsilon()) {
      last_exclusive += 1;
    }
    memberships += js::max(0.0, static_cast<double>(last_exclusive) - static_cast<double>(first));
    charge(memberships, "note-to-segment memberships");
    for (std::size_t segment = first; segment < last_exclusive; ++segment) {
      segments[segment].noteIndices.push_back(index);
    }
  }

  // Classify the ornaments before any chord exists, and keep only the structural tones in each
  // slot's emission term.
  std::vector<ClassifiedMelodyTone> tones = classify_melody_tones(melody, ts);
  // The closes the caller named are structural, as the melody's own last note is.
  std::set<std::size_t> phrase_closing_notes = closing_note_indices(spans, inner_ends);
  for (Segment& segment : segments) {
    std::vector<std::size_t> structural;
    for (std::size_t idx : segment.noteIndices) {
      if (idx >= tones.size() || !tones[idx].ornamental || phrase_closing_notes.count(idx) > 0) {
        structural.push_back(idx);
      }
    }
    const std::vector<std::size_t>& cost_indices =
        !structural.empty() ? structural : segment.noteIndices;
    double closing_start = -std::numeric_limits<double>::infinity();
    for (std::size_t index : cost_indices) {
      if (index >= spans.size()) {
        continue;
      }
      const MelodySpan& span = spans[index];
      double overlap_start = js::max(span.startBeat, segment.startBeat);
      double overlap = js::min(span.endBeat, segment.endBeat) - overlap_start;
      if (overlap <= 0) {
        continue;
      }
      double weight = js::max(HARMONIZE_MIN_NOTE_WEIGHT, overlap);
      segment.costNotes.push_back(CostNote{index, weight, is_strong_beat(overlap_start, ts)});
      segment.weight += weight;
      // The tone a phrase closes on is the last one to start.
      if (span.startBeat >= closing_start) {
        closing_start = span.startBeat;
        segment.closingIndex = index;
      }
    }
  }
  return BuiltSegments{std::move(segments), std::move(inner_ends), std::move(bounds),
                       segment_start};
}

}  // namespace cantus
