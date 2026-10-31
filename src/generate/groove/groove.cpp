// The humanizer and groove templates of ts/src/generate/groove/index.ts.

#include "generate/groove/groove.h"

#include <cmath>
#include <string>
#include <variant>

#include "cantus/core/errors.h"
#include "cantus/core/meter.h"
#include "cantus/core/validation.h"
#include "cantus/generate/groove.h"
#include "core/validation/validation.h"
#include "generate/groove/limits.gen.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

const TimeSignature kGrooveDefaultTs =
#include "generate/groove/default_ts.gen.inc"
    ;

namespace {

/** The grid slot a beat quantizes to, and the beat it quantizes to. */
struct Quantized {
  double quantizedBeat;
  double slotIndex;
};

/** Quantize a beat position to the nearest grid slot within the bar that contains it. */
Quantized quantize_to_grid(double beat, double bar_beats, double subdivision,
                           double slots_per_bar) {
  double bar_index = std::floor(beat / bar_beats);
  double mod_beat = beat - bar_index * bar_beats;
  double slot_index = js::round(mod_beat * subdivision);
  double effective_bar_index = bar_index;
  // Rounding the last slot in a bar up to the grid step count lands on the next bar's downbeat.
  if (slot_index >= slots_per_bar) {
    slot_index = 0;
    effective_bar_index += 1;
  }
  return Quantized{effective_bar_index * bar_beats + slot_index / subdivision, slot_index};
}

}  // namespace

TimeSignature groove_signature(const MeterData& meter) {
  const MeterMap* map = std::get_if<MeterMap>(&meter);
  if (map == nullptr) {
    return std::get<TimeSignature>(meter);
  }
  TimeSignature opening = meter_at(0, MeterArg(*map));
  for (const MeterChange& change : *map) {
    if (change.ts.numerator != opening.numerator || change.ts.denominator != opening.denominator) {
      throw InvalidInputError("groove time signature must be one signature throughout; received " +
                              js::to_string(change.ts.numerator) + "/" +
                              js::to_string(change.ts.denominator) + " at beat " +
                              js::to_string(change.startBeat) + " in a meter that is " +
                              js::to_string(opening.numerator) + "/" +
                              js::to_string(opening.denominator) + " at beat 0");
    }
  }
  return opening;
}

std::vector<NoteEvent> humanize_with(const std::vector<NoteEvent>& sounding,
                                     const HumanizeRequest& request, const Draw& draw) {
  MeterArg meter(request.ts);
  std::vector<NoteEvent> out;
  for (const NoteEvent& event : sounding) {
    // Addressed by the event rather than by how many events came before it.
    double timing_offset =
        draw.float_(-request.timing, request.timing,
                    {std::string("timing"), event.startBeat, static_cast<double>(event.pitch)});
    // Not clamped at 0: a pickup is written before the downbeat.
    double start_beat = event.startBeat + timing_offset;

    int weight = metric_weight(event.startBeat, meter);
    double accent_boost = (weight / GROOVE_MAX_METRIC_WEIGHT) * request.accent;
    double velocity_offset =
        draw.float_(-request.velocityJitter, request.velocityJitter,
                    {std::string("velocity"), event.startBeat, static_cast<double>(event.pitch)});
    double raw_velocity =
        (event.velocity ? static_cast<double>(*event.velocity) : request.baseVelocity) +
        accent_boost + velocity_offset;
    double velocity =
        js::min(GROOVE_MAX_VELOCITY, js::max(GROOVE_MIN_VELOCITY, js::round(raw_velocity)));

    // The note is copied whole and only the fields this pass owns are written over it.
    NoteEvent note = event;
    note.startBeat = start_beat;
    note.velocity = static_cast<int>(velocity);
    out.push_back(note);
  }
  return out;
}

std::vector<NoteEvent> humanize(const std::vector<NoteEvent>& events, const HumanizeOptions& opts) {
  HumanizeRequest request;
  // The meter is read once, here, and every position below is weighed in the signature in force.
  request.ts = to_meter_data(opts.ts.value_or(MeterArg(kGrooveDefaultTs)), "ts");
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  assert_note_events(events, "humanize events", note_options);
  std::vector<NoteEvent> sounding = drop_silent_notes(events);
  request.timing = opts.timing.value_or(GROOVE_DEFAULT_TIMING);
  request.velocityJitter = opts.velocity.value_or(GROOVE_DEFAULT_VELOCITY_JITTER);
  request.accent = opts.accent.value_or(GROOVE_DEFAULT_ACCENT);
  request.baseVelocity = opts.baseVelocity.value_or(GROOVE_DEFAULT_BASE_VELOCITY);
  assert_range(request.timing, 0, kMaxSafeInteger, "humanize timing");
  assert_range(request.velocityJitter, 0, 127, "humanize velocity jitter");
  assert_range(request.accent, 0, 127, "humanize accent");
  assert_range(request.baseVelocity, 0, 127, "humanize base velocity");
  ResolvedContext ctx = resolve_context(opts.ctx);
  Draw draw = ctx.part(opts.part.value_or("humanize"));
  return humanize_with(sounding, request, draw);
}

GrooveTemplate extract_groove_template(const std::vector<NoteEvent>& events, const MeterArg& ts,
                                       std::optional<int> subdivision) {
  TimeSignature meter = groove_signature(to_meter_data(ts, "ts"));
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  assert_note_events(events, "groove source events", note_options);
  double grid = subdivision.value_or(GROOVE_DEFAULT_SUBDIVISION);
  assert_positive_int(grid, "groove subdivision");
  double bar_beats = beats_per_bar(meter);
  double slots_per_bar = std::ceil(bar_beats * grid);
  assert_positive_int(slots_per_bar, "groove template slots");
  assert_generation_budget(slots_per_bar, "groove template slots");
  std::size_t count = static_cast<std::size_t>(slots_per_bar);
  std::vector<double> offset_sums(count, 0);
  std::vector<double> velocity_sums(count, 0);
  std::vector<double> counts(count, 0);
  std::vector<double> velocity_counts(count, 0);

  for (const NoteEvent& event : drop_silent_notes(events)) {
    Quantized q = quantize_to_grid(event.startBeat, bar_beats, grid, slots_per_bar);
    std::size_t slot = static_cast<std::size_t>(q.slotIndex);
    offset_sums[slot] = offset_sums[slot] + (event.startBeat - q.quantizedBeat);
    counts[slot] = counts[slot] + 1;
    // Only events that carry a velocity contribute to the velocity average.
    if (event.velocity) {
      velocity_sums[slot] = velocity_sums[slot] + *event.velocity;
      velocity_counts[slot] = velocity_counts[slot] + 1;
    }
  }

  GrooveTemplate out;
  out.subdivision = static_cast<int>(grid);
  out.slotsPerBar = static_cast<int>(slots_per_bar);
  for (std::size_t i = 0; i < count; ++i) {
    if (counts[i] == 0) {
      out.slots.push_back(GrooveSlot{0, Nullable<double>()});
      continue;
    }
    out.slots.push_back(GrooveSlot{offset_sums[i] / counts[i],
                                   velocity_counts[i] > 0
                                       ? Nullable<double>(velocity_sums[i] / velocity_counts[i])
                                       : Nullable<double>()});
  }
  out.ts = meter;
  return out;
}

std::vector<GroovedNote> groove_notes(const std::vector<NoteEvent>& sounding,
                                      const GrooveTemplate& groove_template,
                                      const TimeSignature& meter) {
  double bar_beats = beats_per_bar(meter);
  std::vector<GroovedNote> out;
  for (const NoteEvent& event : sounding) {
    Quantized q = quantize_to_grid(event.startBeat, bar_beats, groove_template.subdivision,
                                   groove_template.slotsPerBar);
    const GrooveSlot& slot = groove_template.slots[static_cast<std::size_t>(q.slotIndex)];
    // A slot that lays back or pushes ahead of the beat moves the note it lands on.
    GroovedNote note;
    note.startBeat = q.quantizedBeat + slot.timingOffset;
    if (slot.velocity) {
      note.velocity = js::round(*slot.velocity);
    }
    out.push_back(note);
  }
  return out;
}

std::vector<NoteEvent> apply_groove_template(const std::vector<NoteEvent>& events,
                                             const GrooveTemplate& groove_template,
                                             const MeterArg& ts) {
  TimeSignature meter = groove_signature(to_meter_data(ts, "ts"));
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  assert_note_events(events, "groove target events", note_options);
  assert_positive_int(groove_template.subdivision, "template subdivision");
  assert_positive_int(groove_template.slotsPerBar, "template slotsPerBar");
  assert_generation_budget(static_cast<double>(groove_template.slots.size()), "template slots");
  if (static_cast<double>(groove_template.slots.size()) != groove_template.slotsPerBar) {
    throw InvalidInputError("template slots length must equal slotsPerBar");
  }
  if (groove_template.ts && (groove_template.ts->numerator != meter.numerator ||
                             groove_template.ts->denominator != meter.denominator)) {
    throw InvalidInputError("Groove template meter " + format_time_signature(*groove_template.ts) +
                            " does not match apply-time meter " + format_time_signature(meter));
  }
  double bar_beats = beats_per_bar(meter);
  // `slotsPerBar` is what the grid is read through, so it has to be what this bar holds.
  double expected_slots = std::ceil(bar_beats * groove_template.subdivision);
  if (groove_template.slotsPerBar != expected_slots) {
    throw InvalidInputError("Groove template slotsPerBar " +
                            js::to_string(groove_template.slotsPerBar) + " does not match " +
                            js::to_string(expected_slots) + " slots per bar of " +
                            format_time_signature(meter) + " at subdivision " +
                            js::to_string(groove_template.subdivision));
  }
  // What the slots carry is checked before any of it goes onto a note.
  for (std::size_t index = 0; index < groove_template.slots.size(); ++index) {
    const GrooveSlot& slot = groove_template.slots[index];
    assert_finite_number(slot.timingOffset,
                         "template slots[" + index_text(index) + "].timingOffset");
    if (slot.velocity) {
      assert_range(*slot.velocity, 0, 127, "template slots[" + index_text(index) + "].velocity");
    }
  }
  std::vector<NoteEvent> sounding = drop_silent_notes(events);
  std::vector<GroovedNote> grooved = groove_notes(sounding, groove_template, meter);
  std::vector<NoteEvent> out;
  for (std::size_t i = 0; i < sounding.size(); ++i) {
    NoteEvent note = sounding[i];
    note.startBeat = grooved[i].startBeat;
    if (grooved[i].velocity) {
      note.velocity = static_cast<int>(*grooved[i].velocity);
    }
    out.push_back(note);
  }
  return out;
}

}  // namespace cantus
