// The imitative entries of ts/src/generate/countermelody/imitation.ts.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>
#include <optional>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/generate/countermelody.h"
#include "cantus/theory/scale.h"
#include "core/validation/validation.h"
#include "generate/context/context.h"
#include "generate/countermelody/countermelody.h"
#include "generate/drums/internal.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** IMITATION_ANSWERS as names, indexed by ImitationAnswer. */
constexpr std::array<std::string_view, IMITATION_ANSWERS.size()> kAnswerNames =
#include "generate/countermelody/imitation_answers.gen.inc"
    ;
static_assert(!kAnswerNames.back().empty(), "IMITATION_ANSWERS and ImitationAnswer disagree");

/** How many scale degrees a spelled interval spans, signed by its direction. */
double degrees_of(const SpelledInterval& interval) {
  return (interval.number - 1) * (interval.descending ? -1.0 : 1.0);
}

/** Reject a pitch the transposition has pushed off the keyboard. */
double assert_playable(double pitch) {
  if (!is_midi_pitch(pitch)) {
    throw InvalidInputError("imitated pitch " + js::to_string(pitch) +
                            " is outside the MIDI range 0..127");
  }
  return pitch;
}

}  // namespace

std::string_view to_string(ImitationAnswer answer) {
  return kAnswerNames[static_cast<std::size_t>(answer)];
}

std::vector<std::string_view> imitation_answer_names() { return names_of(kAnswerNames); }

std::optional<ImitationAnswer> parse_imitation_answer(std::string_view name) {
  return parse_named<ImitationAnswer>(kAnswerNames, name);
}

std::vector<std::size_t> imitation_subject(const std::vector<NoteEvent>& sounding, double from,
                                           double to) {
  std::vector<std::size_t> subject;
  for (std::size_t index = 0; index < sounding.size(); ++index) {
    if (sounding[index].startBeat >= from && sounding[index].startBeat < to) {
      subject.push_back(index);
    }
  }
  std::stable_sort(subject.begin(), subject.end(), [&sounding](std::size_t a, std::size_t b) {
    return sounding[a].startBeat < sounding[b].startBeat;
  });
  return subject;
}

std::vector<NoteEvent> imitation_answers(const std::vector<NoteEvent>& sounding,
                                         const std::vector<std::size_t>& subject,
                                         const ImitationPlan& plan) {
  std::vector<NoteEvent> out;
  if (subject.empty()) {
    return out;
  }
  double origin = sounding[subject.front()].startBeat;
  double pivot = sounding[subject.front()].pitch;
  double shift = plan.atBeat - origin;
  double degrees = degrees_of(plan.interval);
  // Every note is mirrored about the same pivot, so its rung is read once.
  std::optional<ScaleLadderPosition> axis;
  if (plan.invert && plan.tonal) {
    axis = scale_ladder_position(pivot, plan.key);
  }
  for (std::size_t index : subject) {
    const NoteEvent& note = sounding[index];
    double pitch = note.pitch;
    // A tonal answer counts along the key's ladder of scale tones.
    double offset = 0;
    if (plan.invert) {
      if (axis) {
        // Mirroring reflects the rung, and the offset with it, each note read relative to the
        // pivot's own offset so that a chromatic pivot mirrors onto itself.
        ScaleLadderPosition here = scale_ladder_position(pitch - axis->offset, plan.key);
        pitch = scale_ladder_pitch(2 * axis->rung - here.rung, plan.key);
        offset = axis->offset - here.offset;
      } else {
        pitch = 2 * pivot - pitch;
      }
    }
    pitch = plan.tonal ? shift_by_scale_degrees(pitch, degrees, plan.key) + offset
                       : pitch + js::round(plan.interval.semitones);
    NoteEvent answer = note;
    answer.pitch = static_cast<int>(assert_playable(pitch));
    answer.startBeat = note.startBeat + shift;
    if (note.velocity) {
      answer.velocity = static_cast<int>(clamp_velocity(*note.velocity * plan.velocityScale));
    }
    out.push_back(answer);
  }
  return out;
}

std::vector<NoteEvent> imitate(const std::vector<NoteEvent>& lead, const ImitationOptions& opts) {
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  assert_note_events(lead, "imitate lead", note_options);
  ImitationPlan plan;
  // Onsets are unbounded below library-wide, because a pickup sounds before the downbeat.
  plan.atBeat = assert_finite_number(opts.atBeat, "atBeat");
  plan.interval = to_spelled_interval(opts.interval);
  // The key is read into its plain form once, here at the boundary.
  plan.key = to_key_scale(opts.key);
  plan.from = opts.from.value_or(-std::numeric_limits<double>::infinity());
  plan.to = opts.to.value_or(std::numeric_limits<double>::infinity());
  if (opts.from) {
    assert_finite_number(*opts.from, "from");
  }
  if (opts.to) {
    assert_finite_number(*opts.to, "to");
  }
  if (plan.from > plan.to) {
    throw InvalidInputError("imitate needs from <= to; received " + js::to_string(plan.from) +
                            " > " + js::to_string(plan.to));
  }
  plan.velocityScale = opts.velocityScale.value_or(1);
  assert_finite_number(plan.velocityScale, "velocityScale");
  plan.tonal = opts.answer.value_or(ImitationAnswer::kReal) == ImitationAnswer::kTonal;
  plan.invert = opts.invert.value_or(false);
  // Zero-length artefacts never sound; dropping them keeps the answer passable to any entry point.
  std::vector<NoteEvent> sounding = drop_silent_notes(lead);
  return imitation_answers(sounding, imitation_subject(sounding, plan.from, plan.to), plan);
}

}  // namespace cantus
