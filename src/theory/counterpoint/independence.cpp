// Voice independence as a measurement rather than a verdict:
// ts/src/theory/counterpoint/independence.ts.

#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/theory/counterpoint.h"
#include "js/math.h"
#include "js/number.h"
#include "theory/counterpoint/internal.h"

namespace cantus {

namespace {

/** One slot of both lines, resolved to what the metrics read off it (`Slot`). */
struct Slot {
  Nullable<NoteData> lead;
  Nullable<NoteData> counter;
  std::optional<double> lead_pitch;
  std::optional<double> counter_pitch;
};

/** The motion the two voices make between two adjacent sounding slots (`motionBetween`). */
enum class Motion { kNone, kContrary, kOblique, kSimilar, kParallel };

bool both_sound(const Slot& slot) { return slot.lead.has_value() && slot.counter.has_value(); }

/** Whether a voice attacks at a slot, by the caller's flags or by note change (`attacksAt`). */
bool attacks_at(std::size_t index, const std::vector<Nullable<NoteData>>& notes,
                const std::optional<std::vector<bool>>& flags) {
  if (flags) {
    return index < flags->size() && (*flags)[index];
  }
  const Nullable<NoteData>& current = notes[index];
  if (!current) {
    return false;
  }
  if (index == 0 || !notes[index - 1]) {
    return true;
  }
  const NoteData& previous = *notes[index - 1];
  return previous.letter != current->letter || previous.alter != current->alter ||
         previous.octave != current->octave;
}

Motion motion_between(const Slot& from, const Slot& to) {
  double lead_move = *to.lead_pitch - *from.lead_pitch;
  double counter_move = *to.counter_pitch - *from.counter_pitch;
  if (lead_move == 0 && counter_move == 0) {
    return Motion::kNone;
  }
  if (lead_move == 0 || counter_move == 0) {
    return Motion::kOblique;
  }
  if ((lead_move > 0) != (counter_move > 0)) {
    return Motion::kContrary;
  }
  int before = simple_interval_number(spelled_interval(*from.counter, *from.lead).number);
  int after = simple_interval_number(spelled_interval(*to.counter, *to.lead).number);
  return before == after ? Motion::kParallel : Motion::kSimilar;
}

/** The pitch of a note a line holds, which must carry an octave (`pitchOf`). */
std::optional<double> slot_pitch(const Nullable<NoteData>& note) {
  if (!note) {
    return std::nullopt;
  }
  return pitch_of(PitchArg(*note));
}

}  // namespace

VoiceIndependenceReport voice_independence(const std::vector<Nullable<NoteData>>& lead,
                                           const std::vector<Nullable<NoteData>>& counter,
                                           const VoiceIndependenceOptions& opts) {
  if (lead.size() != counter.size()) {
    throw InvalidInputError(
        "voiceIndependence needs the two lines aligned slot for slot; received " +
        js::to_string(lead.size()) + " and " + js::to_string(counter.size()));
  }
  // An attack array of the wrong length would count every slot past its end as a sustain.
  const std::pair<const char*, const std::optional<std::vector<bool>>*> attack_arrays[] = {
      {"leadAttacks", &opts.leadAttacks}, {"counterAttacks", &opts.counterAttacks}};
  for (const auto& [name, flags] : attack_arrays) {
    if (*flags && (*flags)->size() != lead.size()) {
      throw InvalidInputError(std::string("voiceIndependence needs ") + name +
                              " aligned slot for slot with the lines; received " +
                              js::to_string((*flags)->size()) + " and " +
                              js::to_string(lead.size()));
    }
  }
  std::vector<Slot> slots;
  slots.reserve(lead.size());
  for (std::size_t index = 0; index < lead.size(); ++index) {
    Slot slot;
    slot.lead = lead[index];
    slot.counter = counter[index];
    slot.lead_pitch = slot_pitch(lead[index]);
    slot.counter_pitch = slot_pitch(counter[index]);
    slots.push_back(std::move(slot));
  }

  double contrary = 0;
  double oblique = 0;
  double similar = 0;
  double parallel = 0;
  double moves = 0;
  for (std::size_t index = 1; index < slots.size(); ++index) {
    const Slot& from = slots[index - 1];
    const Slot& to = slots[index];
    if (!both_sound(from) || !both_sound(to)) {
      continue;
    }
    Motion motion = motion_between(from, to);
    if (motion == Motion::kNone) {
      continue;
    }
    switch (motion) {
      case Motion::kContrary:
        contrary += 1;
        break;
      case Motion::kOblique:
        oblique += 1;
        break;
      case Motion::kSimilar:
        similar += 1;
        break;
      case Motion::kParallel:
        parallel += 1;
        break;
      case Motion::kNone:
        break;
    }
    moves += 1;
  }

  double filled = 0;
  double gaps = 0;
  for (std::size_t index = 0; index < slots.size(); ++index) {
    if (attacks_at(index, lead, opts.leadAttacks)) {
      continue;
    }
    gaps += 1;
    if (attacks_at(index, counter, opts.counterAttacks)) {
      filled += 1;
    }
  }

  int sounding = 0;
  double total_gap = 0;
  double min_gap = std::numeric_limits<double>::infinity();
  double order_sum = 0;
  int perfect_run = 0;
  int longest_perfect_run = 0;
  bool count_fourths = opts.countFourths.value_or(false);
  for (const Slot& slot : slots) {
    if (!slot.lead_pitch || !slot.counter_pitch) {
      perfect_run = 0;
      continue;
    }
    sounding += 1;
    double gap = *slot.lead_pitch - *slot.counter_pitch;
    total_gap += std::fabs(gap);
    min_gap = js::min(min_gap, std::fabs(gap));
    order_sum += js::sign(gap);
    SpelledInterval interval = spelled_interval(*slot.counter, *slot.lead);
    bool perfect =
        classify_spelled_interval(interval) == ConsonanceClass::kPerfectConsonance ||
        (count_fourths && interval.quality == "P" && simple_interval_number(interval.number) == 4);
    perfect_run = perfect ? perfect_run + 1 : 0;
    longest_perfect_run = std::max<int>(longest_perfect_run, perfect_run);
  }

  // The prevailing order is whichever way round the two lines sit most of the time.
  bool lead_above = order_sum >= 0;
  int crossings = 0;
  for (const Slot& slot : slots) {
    if (!slot.lead_pitch || !slot.counter_pitch) {
      continue;
    }
    double gap = *slot.lead_pitch - *slot.counter_pitch;
    if (gap != 0 && (gap > 0) != lead_above) {
      crossings += 1;
    }
  }

  VoiceIndependenceReport report;
  report.motion.contrary = moves == 0 ? 0 : contrary / moves;
  report.motion.oblique = moves == 0 ? 0 : oblique / moves;
  report.motion.similar = moves == 0 ? 0 : similar / moves;
  report.motion.parallel = moves == 0 ? 0 : parallel / moves;
  report.rhythmicComplementarity = gaps == 0 ? 0 : filled / gaps;
  report.separation.mean = sounding == 0 ? 0 : total_gap / sounding;
  report.separation.min = sounding == 0 ? 0 : min_gap;
  report.crossings = crossings;
  report.longestPerfectRun = longest_perfect_run;
  report.sounding = sounding;
  return report;
}

}  // namespace cantus
