// The rhythm generator of ts/src/generate/rhythm/index.ts.

#include "cantus/generate/rhythm.h"

#include <cmath>
#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/meter.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "generate/rhythm/limits.gen.h"
#include "generate/rhythm/rhythm.h"

namespace cantus {

std::vector<NoteEvent> rhythm_to_note_events(const std::vector<RhythmEvent>& events, int pitch,
                                             std::optional<int> velocity) {
  // Both fields are checked here: this builds a note event without going through the guard.
  assert_midi_pitch(pitch, "pitch");
  double checked_velocity = velocity.value_or(RHYTHM_DEFAULT_NOTE_VELOCITY);
  assert_integer(checked_velocity, "velocity", 0, 127);
  std::vector<NoteEvent> out;
  for (std::size_t index = 0; index < events.size(); ++index) {
    const RhythmEvent& event = events[index];
    std::string name = "events[" + index_text(index) + "]";
    assert_range(event.position, -kMaxSafeInteger, kMaxSafeInteger, name + ".position");
    assert_range(event.duration, -kMaxSafeInteger, kMaxSafeInteger, name + ".duration");
    NoteEvent note;
    note.pitch = pitch;
    note.startBeat = event.position;
    note.durationBeat = event.duration;
    note.velocity = static_cast<int>(checked_velocity);
    out.push_back(note);
  }
  return out;
}

double onset_weight_curve(int weight) {
  // The rank is a position on a stated scale, so one off it is refused rather than folded in.
  assert_integer(weight, "weight", 0, 3);
  switch (weight) {
    case 3:
      return 1;
    case 2:
      return 0.8;
    case 1:
      return 0.55;
    default:
      return 0.25;
  }
}

std::vector<RhythmEvent> generate_rhythm(const MeterArg& ts, const RhythmOptions& opts) {
  // The meter is read once, here: the grid is one repeated bar.
  TimeSignature meter = meter_at(0, to_meter_data(ts, "ts"));
  double bars = opts.bars.value_or(RHYTHM_DEFAULT_BARS);
  double subdivision = opts.subdivision.value_or(RHYTHM_DEFAULT_SUBDIVISION);
  ResolvedContext ctx = resolve_context(opts.ctx);
  return generate_rhythm_with(meter, bars, subdivision, ctx);
}

std::vector<RhythmEvent> generate_rhythm_with(const TimeSignature& meter, double bars,
                                              double subdivision, const ResolvedContext& ctx) {
  double density = ctx.rhythmic.value_or(RHYTHM_DEFAULT_DENSITY);

  assert_positive_int(bars, "rhythm bars");
  assert_positive_int(subdivision, "rhythm subdivision");

  double bar_beats = beats_per_bar(meter);
  double span_beats = bar_beats * bars;
  double step = 1 / subdivision;
  double slots_per_bar = std::ceil(bar_beats * subdivision);
  double slot_count = slots_per_bar * bars;
  assert_generation_budget(slot_count, "rhythm grid slots");
  Draw draw = ctx.part("rhythm");

  std::vector<double> positions;
  for (double bar = 0; bar < bars; bar += 1) {
    double bar_start = bar * bar_beats;
    double bar_end = bar_start + bar_beats;
    for (double slot = 0; slot < slots_per_bar; slot += 1) {
      double position = bar_start + slot * step;
      if (position >= bar_end - std::numeric_limits<double>::epsilon()) {
        break;
      }
      // Force every bar's downbeat so the pulse is reliable regardless of seed.
      if (slot == 0) {
        positions.push_back(position);
        continue;
      }
      int weight = metric_weight(position, meter);
      double probability = onset_weight_curve(weight) * density;
      if (draw.prob(probability, {std::string("onset"), bar, slot})) {
        positions.push_back(position);
      }
    }
  }

  std::vector<RhythmEvent> events;
  for (std::size_t i = 0; i < positions.size(); ++i) {
    double position = positions[i];
    double next_position = i + 1 < positions.size() ? positions[i + 1] : span_beats;
    events.push_back(RhythmEvent{position, next_position - position});
  }
  return events;
}

double rhythm_density(const std::vector<RhythmEvent>& events, const MeterArg& ts) {
  // Read before the empty case, so a malformed meter is rejected whichever way the call leaves.
  double bar_beats = beats_per_bar(ts);
  if (events.empty()) {
    return 0;
  }
  const RhythmEvent& last = events.back();
  double span_beats = last.position + last.duration;
  double bars = span_beats / bar_beats;
  return bars > 0 ? static_cast<double>(events.size()) / bars : 0;
}

}  // namespace cantus
