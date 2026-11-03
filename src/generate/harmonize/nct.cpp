// Classifying a melody's ornaments from the melody and the metre alone:
// ts/src/generate/harmonize/nct.ts.

#include "generate/harmonize/nct.h"

#include <array>
#include <cmath>
#include <cstddef>

#include "analyze/limits.gen.h"
#include "cantus/core/validation.h"
#include "cantus/generate/harmonize.h"
#include "core/event_index/order.h"
#include "generate/context/context.h"
#include "generate/harmonize/limits.gen.h"
#include "js/math.h"

namespace cantus {

namespace {

/** MELODY_TONE_ROLES as names, indexed by MelodyToneRole. */
constexpr std::array<std::string_view, static_cast<std::size_t>(MelodyToneRole::kEscape) + 1>
    kRoleNames =
#include "generate/harmonize/melody_tone_roles.gen.inc"
    ;
static_assert(!kRoleNames.back().empty(), "MELODY_TONE_ROLES and MelodyToneRole disagree");

bool is_step(double a, double b) {
  double d = std::abs(a - b);
  return d >= 1 && d <= HARMONIZE_STEP_SEMITONES;
}

bool is_leap(double a, double b) { return std::abs(a - b) > HARMONIZE_STEP_SEMITONES; }

/** Whether both notes move the same way, neither of them repeating a pitch. */
bool same_direction(double prev, double note, double next) {
  return prev != note && next != note && (note - prev > 0) == (next - note > 0);
}

/** Classify one note against the neighbours that immediately frame it. */
MelodyToneRole role_of_note(const NoteEvent* prev_note, const NoteEvent& note,
                            const NoteEvent* next_note, const TimeSignature& ts, double pulse) {
  if (prev_note == nullptr || next_note == nullptr) {
    return MelodyToneRole::kStructural;
  }
  const NoteEvent& prev = *prev_note;
  const NoteEvent& next = *next_note;
  // A note separated from its neighbour by a rest is not led into or out of it, and simultaneous
  // onsets are cluster members rather than melodic neighbours.
  double into_note = std::abs(prev.startBeat + prev.durationBeat - note.startBeat);
  double out_of_note = std::abs(note.startBeat + note.durationBeat - next.startBeat);
  if (into_note > HUMANIZE_ADJACENCY || out_of_note > HUMANIZE_ADJACENCY) {
    return MelodyToneRole::kStructural;
  }

  int weight = metric_weight(snap_to_pulse(note.startBeat, pulse), ts);
  int weight_prev = metric_weight(snap_to_pulse(prev.startBeat, pulse), ts);
  int weight_next = metric_weight(snap_to_pulse(next.startBeat, pulse), ts);
  // Subordinate: no stronger metrically and no longer than either neighbour.
  bool subordinate = weight <= weight_prev && weight <= weight_next &&
                     note.durationBeat <= prev.durationBeat &&
                     note.durationBeat <= next.durationBeat;
  // Leaning: an accented dissonance arrives on a stronger beat than the note it comes from and
  // hands over to a weaker resolution.
  bool leaning = weight > weight_prev && weight >= weight_next;
  double p = prev.pitch;
  double n = note.pitch;
  double x = next.pitch;

  if (leaning && p == n && n - x >= 1 && is_step(n, x)) {
    return MelodyToneRole::kSuspension;
  }
  if (subordinate && is_step(p, n) && is_step(n, x)) {
    if (same_direction(p, n, x)) {
      return MelodyToneRole::kPassing;
    }
    if (p == x) {
      return MelodyToneRole::kNeighbor;
    }
  }
  if (subordinate && n == x && n != p && weight < weight_next) {
    return MelodyToneRole::kAnticipation;
  }
  if (leaning && is_leap(p, n) && is_step(n, x) && !same_direction(p, n, x)) {
    return MelodyToneRole::kAppoggiatura;
  }
  if (subordinate && is_step(p, n) && is_leap(n, x) && !same_direction(p, n, x)) {
    return MelodyToneRole::kEscape;
  }
  return MelodyToneRole::kStructural;
}

}  // namespace

std::string_view to_string(MelodyToneRole role) {
  return kRoleNames[static_cast<std::size_t>(role)];
}

std::optional<MelodyToneRole> parse_melody_tone_role(std::string_view name) {
  return parse_named<MelodyToneRole>(kRoleNames, name);
}

double snap_to_pulse(double beat, double pulse) {
  double snapped = js::round(beat / pulse) * pulse;
  return std::abs(snapped - beat) <= HUMANIZE_ADJACENCY ? snapped : beat;
}

std::vector<ClassifiedMelodyTone> classify_melody_tones(const std::vector<NoteEvent>& melody,
                                                        const MeterArg& ts) {
  TimeSignature meter = meter_at(0, ts);
  NoteEventAssertOptions options;
  options.allowNonPositiveDuration = true;
  assert_note_events(melody, "melody notes", options);
  double pulse = pulse_beats(meter);
  // The sounding notes in onset order, whatever the listing; a silent note stays structural.
  std::vector<std::size_t> sounding_list = sounding_indices(melody);
  std::vector<bool> sounding(melody.size(), false);
  for (std::size_t index : sounding_list) {
    sounding[index] = true;
  }
  std::vector<std::size_t> line;
  for (std::size_t index : canonical_note_order(melody)) {
    if (sounding[index]) {
      line.push_back(index);
    }
  }
  std::vector<MelodyToneRole> roles(melody.size(), MelodyToneRole::kStructural);
  for (std::size_t position = 0; position < line.size(); ++position) {
    const NoteEvent* before = position > 0 ? &melody[line[position - 1]] : nullptr;
    const NoteEvent* after = position + 1 < line.size() ? &melody[line[position + 1]] : nullptr;
    roles[line[position]] = role_of_note(before, melody[line[position]], after, meter, pulse);
  }
  std::vector<ClassifiedMelodyTone> out;
  for (std::size_t index = 0; index < melody.size(); ++index) {
    out.push_back(
        ClassifiedMelodyTone{index, roles[index], roles[index] != MelodyToneRole::kStructural});
  }
  return out;
}

}  // namespace cantus
