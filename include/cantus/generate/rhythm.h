/**
 * @file rhythm.h
 * @brief Public C++ API of ts/src/generate/rhythm: deterministic rhythm over a metric grid.
 *
 * generate_rhythm() builds a fixed-resolution grid across one or more bars of a meter and decides,
 * per grid slot, whether it becomes an onset. The probability follows the metric-accent hierarchy,
 * so downbeats and secondary pulses are favoured over weak off-pulse subdivisions. Positions and
 * durations are measured in quarter-note beats.
 */
#ifndef CANTUS_GENERATE_RHYTHM_H_
#define CANTUS_GENERATE_RHYTHM_H_

#include <optional>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"

namespace cantus {

/** A single rhythmic note: an onset position and how long it sounds (`RhythmEvent`). */
struct RhythmEvent {
  /** Onset position in quarter-note beats, absolute from the start of the span. */
  double position = 0;
  /** Duration in quarter-note beats, extending to the next onset. */
  double duration = 0;
};

/**
 * Turn rhythm events into note events at a fixed pitch (`rhythmToNoteEvents`). The velocity is
 * 96 when absent.
 * @throws InvalidInputError if the pitch or the velocity is not a whole MIDI value in [0, 127], or
 *   an event's position or duration is not finite.
 */
std::vector<NoteEvent> rhythm_to_note_events(const std::vector<RhythmEvent>& events, int pitch,
                                             std::optional<int> velocity = std::nullopt);

/** Options of generate_rhythm() (`RhythmOptions`). */
struct RhythmOptions {
  /** Number of bars to generate; 1 when absent. */
  std::optional<int> bars;
  /** Grid steps per quarter-note beat; 2 (an eighth-note grid) when absent. */
  std::optional<int> subdivision;
  /** The generation context; its `complexity.rhythmic` is the onset density (0.5 when absent). */
  std::optional<GenerationContextInput> ctx;
};

/**
 * The base onset probability of a metric weight, 0 (off-pulse) to 3 (downbeat)
 * (`onsetWeightCurve`).
 * @throws InvalidInputError if the weight is not an integer in [0, 3].
 */
double onset_weight_curve(int weight);

/**
 * Generate a deterministic rhythmic pattern over `bars` bars of a meter (`generateRhythm`). Every
 * bar's downbeat is an onset; each event lasts to the next onset, the last to the end of the span.
 * @throws InvalidInputError if the meter, the bars, the subdivision or the context is malformed.
 * @throws BudgetExceededError if the grid has more slots than the generation budget allows.
 */
std::vector<RhythmEvent> generate_rhythm(const MeterArg& ts, const RhythmOptions& opts = {});

/**
 * The mean number of onsets per bar of a generated pattern (`rhythmDensity`).
 * @throws InvalidInputError if the meter is malformed.
 */
double rhythm_density(const std::vector<RhythmEvent>& events, const MeterArg& ts);

}  // namespace cantus

#endif  // CANTUS_GENERATE_RHYTHM_H_
