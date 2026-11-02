// Realize a chord as a tertian voicing in a chosen style: ts/src/theory/voicing/styled.ts.

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "cantus/theory/chord.h"
#include "js/math.h"
#include "js/number.h"
#include "theory/voicing/limits.gen.h"
#include "theory/voicing/satb.h"

namespace cantus {

namespace {

/** Which voice of the close stack, counted from the top, a style lowers an octave; 0 for none. */
int drop_position_from_top(VoicingStyle style) {
  if (style == VoicingStyle::kDrop2) {
    return 2;
  }
  return style == VoicingStyle::kDrop3 ? 3 : 0;
}

/** `((value % modulus) + modulus) % modulus` over integers. */
int euclidean_mod(int value, int modulus) {
  int r = static_cast<int>(std::fmod(value, modulus));
  return r < 0 ? r + modulus : r;
}

/** The pitch classes of a list in order, without duplicates (`dedupePcs`). */
std::vector<int> dedupe_pcs(const std::vector<int>& pcs) {
  std::vector<int> result;
  for (int pc : pcs) {
    if (std::find(result.begin(), result.end(), pc) == result.end()) {
      result.push_back(pc);
    }
  }
  return result;
}

/** The lowest MIDI pitch of a pitch class at or above a floor (`lowestPitchAtOrAbove`). */
int lowest_pitch_at_or_above(int pc, int floor) {
  return floor + pitch_class_of(pc - pitch_class_of(floor));
}

/** The pitch class in `pcs` whose circular distance to `target` is smallest (`nearestPc`). */
int nearest_pc(int target, const std::vector<int>& pcs) {
  int best = pcs.empty() ? target : pcs[0];
  int best_dist = 12;
  for (int pc : pcs) {
    int dist = std::min<int>(pitch_class_of(pc - target), pitch_class_of(target - pc));
    if (dist < best_dist) {
      best_dist = dist;
      best = pc;
    }
  }
  return best;
}

/** `[...order.slice(at), ...order.slice(0, at)]`. */
std::vector<int> rotate_to(const std::vector<int>& order, std::size_t at) {
  std::vector<int> rotated(order.begin() + static_cast<std::ptrdiff_t>(at), order.end());
  rotated.insert(rotated.end(), order.begin(), order.begin() + static_cast<std::ptrdiff_t>(at));
  return rotated;
}

}  // namespace

std::vector<int> voice_chord_styled(const ChordArg& given, const StyledVoicingOptions& opts) {
  Chord chord = to_chord_data(given);
  VoicingStyle style = opts.style.value_or(VoicingStyle::kClose);
  double octave = opts.octave.value_or(DEFAULT_STYLE_OCTAVE);
  assert_integer(octave, "styled voicing octave", -10, 10);
  if (opts.topNote) {
    assert_finite_number(*opts.topNote, "styled voicing topNote");
  }
  int base = static_cast<int>(12 * (octave + 1));
  int root_pc = pitch_class_of(chord.rootPc);
  int bass_pc = pitch_class_of(chord.bassPc.value_or(chord.rootPc));
  bool omit_root = style == VoicingStyle::kRootless || opts.rootless == true;

  // Tertian chord tones in order, with the bass tone rotated to the bottom.
  std::vector<int> tones;
  for (double interval : chord.intervals) {
    tones.push_back(pitch_class_of(chord.rootPc + interval));
  }
  std::vector<int> order = dedupe_pcs(tones);
  auto bass_found = std::find(order.begin(), order.end(), bass_pc);
  bool bass_is_chord_tone = bass_found != order.end();
  if (bass_is_chord_tone && bass_found != order.begin()) {
    order = rotate_to(order, static_cast<std::size_t>(bass_found - order.begin()));
  } else if (!bass_is_chord_tone) {
    order.insert(order.begin(), bass_pc);
  }

  if (style == VoicingStyle::kShell) {
    std::vector<Nullable<ChordToneRole>> roles;
    for (int pc : order) {
      roles.push_back(chord_tone_role(pc, chord));
    }
    auto has_role = [&](ChordToneRole wanted) {
      return std::any_of(roles.begin(), roles.end(), [&](const Nullable<ChordToneRole>& role) {
        return role && *role == wanted;
      });
    };
    // The guide tone is the seventh when present; on a sixth chord the sixth stands in for it,
    // and otherwise the voicing falls back to the fifth.
    ChordToneRole guide = has_role(ChordToneRole::kSeventh) ? ChordToneRole::kSeventh
                          : has_role(ChordToneRole::kSixth) ? ChordToneRole::kSixth
                                                            : ChordToneRole::kFifth;
    std::vector<int> kept;
    for (std::size_t i = 0; i < order.size(); ++i) {
      const Nullable<ChordToneRole>& role = roles[i];
      if (order[i] == bass_pc || (role && (*role == ChordToneRole::kRoot ||
                                           *role == ChordToneRole::kThird || *role == guide))) {
        kept.push_back(order[i]);
      }
    }
    order = std::move(kept);
  }

  if (omit_root) {
    std::vector<int> kept;
    for (int pc : order) {
      if (pc != root_pc || (chord.bassPc && pc == bass_pc)) {
        kept.push_back(pc);
      }
    }
    order = std::move(kept);
  }

  if (order.empty()) {
    return {};
  }

  if (opts.topNote) {
    int top_pc = pitch_class_of(*opts.topNote);
    int target = nearest_pc(top_pc, order);
    auto target_at = std::find(order.begin(), order.end(), target);
    order = rotate_to(order, static_cast<std::size_t>(target_at - order.begin()) + 1);
  }

  // A drop puts the voice it lowers under the whole stack, so on a drop voicing the dropped voice
  // is the bass. A named bass tone rotates the close stack so the style drops that tone; this
  // overrides any `topNote` rotation.
  int drop_from_top = drop_position_from_top(style);
  bool drops_to_named_bass = drop_from_top > 0 && bass_is_chord_tone && chord.bassPc &&
                             static_cast<int>(order.size()) > drop_from_top;
  if (drops_to_named_bass) {
    auto bass_at = std::find(order.begin(), order.end(), bass_pc);
    if (bass_at != order.end()) {
      int size = static_cast<int>(order.size());
      int shift =
          euclidean_mod(static_cast<int>(bass_at - order.begin()) - (size - drop_from_top), size);
      order = rotate_to(order, static_cast<std::size_t>(shift));
    }
  }

  // Stack the ordered pitch classes upward in close position.
  std::vector<int> stack;
  bool has_previous = false;
  int previous = 0;
  for (int pc : order) {
    if (!has_previous) {
      previous = lowest_pitch_at_or_above(pc, base);
      has_previous = true;
    } else {
      int delta = pitch_class_of(pc - pitch_class_of(previous));
      if (delta == 0) {
        delta = 12;
      }
      previous += delta;
    }
    stack.push_back(previous);
  }

  // The dropped voice needs another voice below it; a chord that short is voiced in close
  // position. A bass the chord does not contain sounds under the stack and is not counted.
  int stacked_floor = bass_is_chord_tone ? 0 : 1;
  if (drop_from_top > 0 && static_cast<int>(stack.size()) - drop_from_top > stacked_floor) {
    stack[stack.size() - static_cast<std::size_t>(drop_from_top)] -= 12;
  }

  // An explicit slash bass is a structural requirement, including when it is not a chord member;
  // lower the retained bass by octaves before the final sort.
  if (chord.bassPc) {
    auto bass_it = std::find_if(stack.begin(), stack.end(),
                                [&](int pitch) { return pitch_class_of(pitch) == bass_pc; });
    if (bass_it != stack.end()) {
      int other_lowest = std::numeric_limits<int>::max();
      for (auto it = stack.begin(); it != stack.end(); ++it) {
        if (it != bass_it) {
          other_lowest = std::min<int>(other_lowest, *it);
        }
      }
      while (*bass_it >= other_lowest) {
        *bass_it -= 12;
      }
    }
  }

  std::stable_sort(stack.begin(), stack.end());
  int lowest = stack.front();
  int highest = stack.back();
  if (lowest < 0 || highest > 127) {
    throw InvalidInputError("styled voicing at octave " + js::to_string(octave) + " spans MIDI " +
                            js::to_string(lowest) + ".." + js::to_string(highest) +
                            ", outside 0..127");
  }
  return stack;
}

}  // namespace cantus
