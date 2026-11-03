// The harmonic role of a pitch within a chord: ts/src/theory/harmony/index.ts.

#include "cantus/theory/harmony.h"

#include <array>

#include "cantus/core/pitch.h"
#include "core/validation/validation.h"
#include "theory/chord/chord.h"

namespace cantus {

namespace {

constexpr std::array<std::string_view, 3> kLockNames = {"identity", "quality", "voicing"};

HarmonyRole harmony_role_of(ChordToneRole role) {
  return static_cast<HarmonyRole>(static_cast<std::size_t>(role));
}

}  // namespace

std::string_view to_string(HarmonyRole role) {
  switch (role) {
    case HarmonyRole::kTension:
      return "tension";
    case HarmonyRole::kDoubling:
      return "doubling";
    case HarmonyRole::kRoot:
    case HarmonyRole::kThird:
    case HarmonyRole::kFifth:
    case HarmonyRole::kSixth:
    case HarmonyRole::kSeventh:
      break;
  }
  return to_string(static_cast<ChordToneRole>(static_cast<std::size_t>(role)));
}

std::optional<HarmonyRole> parse_harmony_role(std::string_view name) {
  if (name == "tension") {
    return HarmonyRole::kTension;
  }
  if (name == "doubling") {
    return HarmonyRole::kDoubling;
  }
  if (std::optional<ChordToneRole> role = parse_chord_tone_role(name)) {
    return harmony_role_of(*role);
  }
  return std::nullopt;
}

std::string_view to_string(LockLevel lock) { return kLockNames[static_cast<std::size_t>(lock)]; }

std::optional<LockLevel> parse_lock_level(std::string_view name) {
  return parse_named<LockLevel>(kLockNames, name);
}

VoicedRole role_of(double pitch, const ChordArg& chord, double chord_id) {
  // The id is carried into the result, so a value that is not one would be reported back.
  assert_finite_number(chord_id, "chordId");
  Chord data = to_chord_data(chord);
  int interval = (pitch_class_of(pitch) - pitch_class_of(data.rootPc) + 12) % 12;
  // What stands in the third's slot is read where the chord is read.
  ThirdSlot slot = third_slot_of(data);
  bool is_suspended_tone = slot.kind == ThirdSlot::Kind::kSuspension && interval == slot.interval;
  Nullable<ChordToneRole> chord_role = chord_tone_role(pitch, data);
  VoicedRole out;
  out.belongsToChordId = chord_id;
  if (is_suspended_tone) {
    out.role = HarmonyRole::kThird;  // the suspended tone occupies the third's slot
    out.lock = LockLevel::kQuality;
  } else if (chord_role) {
    out.role = harmony_role_of(*chord_role);
    out.lock = *chord_role == ChordToneRole::kRoot    ? LockLevel::kIdentity
               : *chord_role == ChordToneRole::kThird ? LockLevel::kQuality
                                                      : LockLevel::kVoicing;
  } else {
    out.role = HarmonyRole::kTension;
    out.lock = LockLevel::kVoicing;
  }
  return out;
}

}  // namespace cantus
