// Classifying a melody's ornaments from the melody and the metre alone:
// ts/src/generate/harmonize/nct.ts.

#include "generate/harmonize/nct.h"

#include <cmath>

#include "analyze/limits.gen.h"
#include "cantus/core/validation.h"
#include "cantus/generate/harmonize.h"
#include "generate/harmonize/limits.gen.h"
#include "js/math.h"

namespace cantus {

namespace {

constexpr std::string_view kRoleNames[] = {"structural", "passing",      "neighbor", "appoggiatura",
                                           "suspension", "anticipation", "escape"};

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
MelodyToneRole role_of_note(const std::vector<NoteEvent>& melody, std::size_t index,
                            const TimeSignature& ts, double pulse) {
  if (index == 0 || index + 1 >= melody.size()) {
    return MelodyToneRole::kStructural;
  }
  const NoteEvent& note = melody[index];
  const NoteEvent& prev = melody[index - 1];
  const NoteEvent& next = melody[index + 1];
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
  for (std::size_t index = 0; index < std::size(kRoleNames); ++index) {
    if (kRoleNames[index] == name) {
      return static_cast<MelodyToneRole>(index);
    }
  }
  return std::nullopt;
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
  std::vector<ClassifiedMelodyTone> out;
  for (std::size_t index = 0; index < melody.size(); ++index) {
    MelodyToneRole role = role_of_note(melody, index, meter, pulse);
    out.push_back(ClassifiedMelodyTone{index, role, role != MelodyToneRole::kStructural});
  }
  return out;
}

}  // namespace cantus
