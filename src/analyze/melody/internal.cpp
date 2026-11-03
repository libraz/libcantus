// What every reading of a melody has to agree on first: ts/src/analyze/melody/internal.ts.

#include "analyze/melody/internal.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>

#include "analyze/adjacency.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/event_index/order.h"
#include "js/format.h"
#include "js/math.h"

namespace cantus {

std::vector<LineNote> line_of(const std::vector<NoteEvent>& notes) {
  std::vector<LineNote> out;
  for (const NoteEvent& note : notes) {
    double pitch = static_cast<double>(note.pitch);
    out.push_back(LineNote{pitch, note.startBeat, note.durationBeat, pitch, note.startBeat,
                           note.durationBeat});
  }
  return out;
}

std::vector<std::size_t> ordered_indices(const std::vector<NoteEvent>& notes) {
  std::vector<std::size_t> sounding = sounding_indices(notes);
  std::stable_sort(sounding.begin(), sounding.end(), [&](std::size_t a, std::size_t b) {
    double by_onset = notes[a].startBeat - notes[b].startBeat;
    // `a.startBeat - b.startBeat || a.pitch - b.pitch`
    return js::or_else(by_onset, static_cast<double>(notes[a].pitch) -
                                     static_cast<double>(notes[b].pitch)) < 0;
  });
  std::vector<std::size_t> line;
  for (std::size_t index : sounding) {
    // Sorted low to high within an onset, so the last note to arrive at one is its top voice.
    if (!line.empty() && same_instant(notes[index].startBeat, notes[line.back()].startBeat)) {
      line.back() = index;
      continue;
    }
    line.push_back(index);
  }
  return line;
}

std::vector<NoteEvent> ordered_notes(const std::vector<NoteEvent>& notes, std::string_view name,
                                     std::optional<double> budget) {
  NoteEventAssertOptions options;
  options.allowNonPositiveDuration = true;
  options.budget = budget;
  assert_note_events(notes, name, options);
  std::vector<NoteEvent> out;
  for (std::size_t index : ordered_indices(notes)) {
    out.push_back(notes[index]);
  }
  return out;
}

std::vector<double> intervals_of(const std::vector<LineNote>& notes) {
  std::vector<double> out;
  for (std::size_t i = 1; i < notes.size(); ++i) {
    out.push_back(notes[i].pitch - notes[i - 1].pitch);
  }
  return out;
}

std::vector<double> onset_gaps(const std::vector<LineNote>& notes) {
  std::vector<double> out;
  for (std::size_t i = 1; i < notes.size(); ++i) {
    out.push_back(notes[i].startBeat - notes[i - 1].startBeat);
  }
  return out;
}

std::vector<double> retrograde_gaps(const std::vector<LineNote>& notes) {
  std::vector<double> out;
  for (std::size_t i = notes.size(); i-- > 1;) {
    const LineNote& later = notes[i];
    const LineNote& earlier = notes[i - 1];
    out.push_back(later.startBeat + later.durationBeat -
                  (earlier.startBeat + earlier.durationBeat));
  }
  return out;
}

std::optional<std::vector<double>> rhythm_profile(const std::vector<double>& gaps) {
  double unit = gaps.empty() ? 0 : gaps[0];
  if (!(unit > BEAT_EPS)) {
    if (gaps.empty()) {
      return std::vector<double>{};
    }
    return std::nullopt;
  }
  std::vector<double> out;
  for (double gap : gaps) {
    out.push_back(js::round((gap / unit) * RHYTHM_GRID) / RHYTHM_GRID);
  }
  return out;
}

bool same_numbers(const std::vector<double>& a, const std::vector<double>& b) {
  return std::equal(a.begin(), a.end(), b.begin(), b.end(),
                    [](double x, double y) { return !(std::fabs(x - y) > BEAT_EPS); });
}

double round_to(double value, int digits) {
  double scale = js::pow(10, digits);
  return js::round(value * scale) / scale;
}

double end_beat_of(const std::vector<LineNote>& notes) {
  if (notes.empty()) {
    return 0;
  }
  double end = -std::numeric_limits<double>::infinity();
  for (const LineNote& note : notes) {
    if (note.absent != nullptr) {
      throw js::TypeError(std::string("Cannot read properties of ") + note.absent +
                          " (reading 'startBeat')");
    }
    end = js::max(end, note.rawStartBeat + note.rawDurationBeat);
  }
  return end;
}

double onset_span(const std::vector<LineNote>& notes) {
  if (notes.size() < 2) {
    return 0;
  }
  return notes.back().startBeat - notes.front().startBeat;
}

}  // namespace cantus
