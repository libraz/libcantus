// Reference-profile helpers shared beyond the module: ts/src/analyze/reference/internal.ts.

#include "analyze/reference/internal.h"

#include "analyze/adjacency.h"
#include "analyze/rhythm/internal.h"
#include "cantus/core/limits.h"
#include "js/math.h"

namespace cantus {

double weighted_mean(const std::vector<NoteEvent>& notes) {
  double weighted = 0;
  double total = 0;
  for (const NoteEvent& note : notes) {
    weighted += note.pitch * note.durationBeat;
    total += note.durationBeat;
  }
  return total > 0 ? weighted / total : 0;
}

Nullable<ReferencePhraseMelody> phrase_melody(const std::vector<NoteEvent>& line, double start_beat,
                                              double end_beat, double line_mean,
                                              const MeterMap& meters,
                                              std::optional<double> budget) {
  std::vector<NoteEvent> inside;
  for (const NoteEvent& note : line) {
    if (note.startBeat >= start_beat - BEAT_EPS && note.startBeat < end_beat - BEAT_EPS) {
      NoteEvent cut = note;
      cut.durationBeat = js::min(note.startBeat + note.durationBeat, end_beat) - note.startBeat;
      inside.push_back(cut);
    }
  }
  if (inside.size() < 2) {
    return std::nullopt;
  }
  const NoteEvent& first = inside.front();
  double low = first.pitch;
  const NoteEvent* peak = &first;
  for (const NoteEvent& note : inside) {
    low = js::min(low, note.pitch);
    if (note.pitch > peak->pitch) {
      peak = &note;
    }
  }
  double length = end_beat - start_beat;
  ReferencePhraseMelody out;
  for (int k = 0; k < PHRASE_OUTLINE_POINTS; ++k) {
    double at = start_beat + ((k + 0.5) * length) / PHRASE_OUTLINE_POINTS;
    // The note sounding at the sample point, or the last one before it: a rest holds.
    const NoteEvent* held = &first;
    for (const NoteEvent& note : inside) {
      if (note.startBeat > at + BEAT_EPS) {
        break;
      }
      held = &note;
    }
    out.outline.push_back(held->pitch - line_mean);
  }
  RhythmAnalysisOptions rhythm_options;
  rhythm_options.meters = MeterArg(meters);
  rhythm_options.totalBeats = end_beat;
  rhythm_options.budget = budget;
  RhythmAnalysis rhythm = rhythm_over(inside, rhythm_options, start_beat);
  out.shape = melodic_contour(inside).shape;
  out.low = static_cast<int>(low);
  out.high = peak->pitch;
  out.mean = weighted_mean(inside);
  out.peakPitch = peak->pitch;
  out.peakPosition = js::min(1, js::max(0, (peak->startBeat - start_beat) / length));
  out.onsetDensity = rhythm.onsetDensity;
  out.restRatio = rhythm.restRatio;
  return out;
}

}  // namespace cantus
