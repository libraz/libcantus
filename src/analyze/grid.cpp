// Where a slot grid starts: ts/src/analyze/grid.ts, with firstSoundingBeat of
// ts/src/analyze/form/internal.ts.

#include "analyze/grid.h"

#include <cmath>
#include <limits>

#include "analyze/adjacency.h"
#include "js/math.h"

namespace cantus {

double first_sounding_beat(const std::vector<NoteEvent>& notes, double fallback) {
  double first = std::numeric_limits<double>::infinity();
  for (const NoteEvent& note : notes) {
    first = js::min(first, note.startBeat);
  }
  return std::isfinite(first) ? first : fallback;
}

double latest_sounding_end(const std::vector<NoteEvent>& notes, double fallback) {
  if (notes.empty()) {
    return fallback;
  }
  double end = -std::numeric_limits<double>::infinity();
  for (const NoteEvent& note : notes) {
    end = js::max(end, note.startBeat + note.durationBeat);
  }
  return end;
}

GridOrigin grid_origin_of(double first_onset, double slot_beats) {
  // A note a millibeat before the downbeat is playing it rather than anticipating it, and reading
  // it as a pickup would hand the analysis a whole silent slot ahead of the music.
  double start_beat = first_onset < 0 && first_onset > -HUMANIZE_ADJACENCY ? 0 : first_onset;
  // The grid starts where the music does, but a whole number of slots from beat 0.
  return GridOrigin{std::floor(start_beat / slot_beats + BEAT_EPS) * slot_beats, start_beat};
}

GridOrigin grid_for_notes(const std::vector<NoteEvent>& notes, double slot_beats) {
  return grid_origin_of(first_sounding_beat(notes), slot_beats);
}

double bar_grid_start(double first_onset, const MeterArg& meter) {
  return grid_origin_of(first_onset, beats_per_bar_at(first_onset, meter)).startBeat;
}

}  // namespace cantus
