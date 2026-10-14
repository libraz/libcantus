// The imitative entries of ts/src/generate/countermelody/imitation.ts.

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/generate/countermelody.h"
#include "cantus/theory/scale.h"
#include "core/validation/validation.h"
#include "generate/countermelody/countermelody.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

constexpr std::string_view kAnswerNames[] =
#include "generate/countermelody/imitation_answers.gen.inc"
    ;
static_assert(sizeof(kAnswerNames) / sizeof(kAnswerNames[0]) == IMITATION_ANSWERS.size(),
              "IMITATION_ANSWERS and ImitationAnswer disagree");

/** How many scale degrees a spelled interval spans, signed by its direction. */
double degrees_of(const SpelledInterval& interval) {
  return (interval.number - 1) * (interval.descending ? -1.0 : 1.0);
}

/** Reject a pitch the transposition has pushed off the keyboard. */
double assert_playable(double pitch) {
  if (pitch < 0 || pitch > 127) {
    throw InvalidInputError("imitated pitch " + js::to_string(pitch) +
                            " is outside the MIDI range 0..127");
  }
  return pitch;
}

}  // namespace

std::string_view to_string(ImitationAnswer answer) {
  return kAnswerNames[static_cast<std::size_t>(answer)];
}

std::vector<std::string_view> imitation_answer_names() {
  return std::vector<std::string_view>(std::begin(kAnswerNames), std::end(kAnswerNames));
}

std::optional<ImitationAnswer> parse_imitation_answer(std::string_view name) {
  for (ImitationAnswer answer : IMITATION_ANSWERS) {
    if (to_string(answer) == name) {
      return answer;
    }
  }
  return std::nullopt;
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
  for (std::size_t index : subject) {
    const NoteEvent& note = sounding[index];
    double pitch = note.pitch;
    // A tonal answer counts along the key's ladder of scale tones.
    double offset = 0;
    if (plan.invert) {
      if (plan.tonal) {
        // Mirroring reflects the rung, and the offset with it.
        ScaleLadderPosition here = scale_ladder_position(pitch, plan.key);
        pitch = scale_ladder_pitch(2 * scale_ladder_position(pivot, plan.key).rung - here.rung,
                                   plan.key);
        offset = -here.offset;
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
      answer.velocity = static_cast<int>(
          js::max(1.0, js::min(127.0, js::round(*note.velocity * plan.velocityScale))));
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
