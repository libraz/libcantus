// Instrument profiles of ts/src/core/instrument/profile.ts.

#include "core/instrument/profile.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>
#include <string>

#include "cantus/core/validation.h"
#include "core/instrument/articulation.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "json/json.h"

namespace cantus {

namespace {

bool has_limb(const std::vector<Limb>& limbs, Limb limb) {
  return std::find(limbs.begin(), limbs.end(), limb) != limbs.end();
}

/** Every field the library reads is checked, not only the family's (`assertProfile`). */
void assert_profile(const InstrumentProfile& profile) {
  const std::string& name =
      std::visit([](const auto& p) -> const std::string& { return p.name; }, profile);
  if (name.empty()) {
    throw InvalidInputError("instrument name must be a non-empty string; received " +
                            describe_rejected(json::Value(name)));
  }
  int polyphony = std::visit([](const auto& p) { return p.polyphony; }, profile);
  assert_positive_int(polyphony, name + " polyphony", MAX_POLYPHONY);
  if (const auto* stringed = std::get_if<StringedProfile>(&profile)) {
    if (stringed->tuning.empty()) {
      throw InvalidInputError(name + " must have at least one string");
    }
    for (std::size_t i = 0; i < stringed->tuning.size(); ++i) {
      assert_midi_pitch(stringed->tuning[i],
                        name + " tuning[" + js::to_string(static_cast<double>(i)) + "]");
    }
    assert_integer(stringed->frets, name + " frets", 0, MAX_FRETS);
    // A hand holds down frets, so its span is a fret count bounded by the neck.
    assert_integer(stringed->maxStretch, name + " maxStretch", 0, MAX_FRETS);
    return;
  }
  const auto& kit = std::get<PercussionProfile>(profile);
  if (kit.limbs.empty()) {
    throw InvalidInputError(name + " must have at least one limb");
  }
  for (const auto& [pitch, limbs] : kit.reach) {
    assert_midi_pitch(pitch, name + " reach pitch");
  }
  // A voice is on the kit only when a limb the player has can strike it.
  bool reachable = false;
  for (const auto& [pitch, limbs] : kit.reach) {
    if (!reach_of(kit, pitch).empty()) {
      reachable = true;
      break;
    }
  }
  if (!reachable) {
    throw InvalidInputError(name + " must have at least one voice within reach");
  }
  if (kit.overdub) {
    for (int pitch : *kit.overdub) {
      assert_midi_pitch(pitch, name + " overdub pitch");
    }
  }
}

}  // namespace

std::string_view to_string(Limb limb) { return kLimbNames[static_cast<std::size_t>(limb)]; }

std::optional<Limb> parse_limb(std::string_view name) {
  for (std::size_t i = 0; i < kLimbNames.size(); ++i) {
    if (kLimbNames[i] == name) {
      return LIMBS[i];
    }
  }
  return std::nullopt;
}

std::vector<std::string_view> limb_names() {
  return std::vector<std::string_view>(kLimbNames.begin(), kLimbNames.end());
}

InstrumentProfile to_instrument_profile(const InstrumentProfileArg& value, std::string_view) {
  assert_profile(value.value());
  return value.value();
}

StringedProfile to_stringed_profile(const InstrumentProfileArg& value, std::string_view name) {
  InstrumentProfile profile = to_instrument_profile(value, name);
  if (auto* stringed = std::get_if<StringedProfile>(&profile)) {
    return std::move(*stringed);
  }
  throw InvalidInputError(std::string(name) + " must be a stringed instrument; " +
                          std::get<PercussionProfile>(profile).name + " has no strings");
}

bool is_overdub(const PercussionProfile& profile, int pitch) {
  return profile.overdub && std::find(profile.overdub->begin(), profile.overdub->end(), pitch) !=
                                profile.overdub->end();
}

std::vector<Limb> reach_of(const PercussionProfile& profile, int pitch) {
  std::vector<Limb> out;
  auto it = profile.reach.find(pitch);
  if (it == profile.reach.end()) {
    return out;
  }
  for (Limb limb : it->second) {
    if (has_limb(profile.limbs, limb)) {
      out.push_back(limb);
    }
  }
  return out;
}

InstrumentRange instrument_range(const InstrumentProfileArg& profile) {
  return range_in(to_instrument_profile(profile));
}

InstrumentRange range_in(const InstrumentProfile& profile) {
  double low = std::numeric_limits<double>::infinity();
  double high = -std::numeric_limits<double>::infinity();
  if (const auto* stringed = std::get_if<StringedProfile>(&profile)) {
    for (int open : stringed->tuning) {
      low = js::min(low, open);
      high = js::max(high, open + stringed->frets);
    }
  } else {
    const auto& kit = std::get<PercussionProfile>(profile);
    for (const auto& [pitch, limbs] : kit.reach) {
      // A voice only an absent limb reaches does not stretch the range.
      if (reach_of(kit, pitch).empty()) {
        continue;
      }
      low = js::min(low, pitch);
      high = js::max(high, pitch);
    }
  }
  return InstrumentRange{static_cast<int>(low), static_cast<int>(high)};
}

bool can_sound(const InstrumentProfileArg& profile, int pitch) {
  InstrumentProfile resolved = to_instrument_profile(profile, "instrument");
  assert_midi_pitch(pitch, "pitch");
  return sounds_in(resolved, pitch);
}

bool sounds_in(const InstrumentProfile& profile, int pitch) {
  if (const auto* stringed = std::get_if<StringedProfile>(&profile)) {
    for (int open : stringed->tuning) {
      if (pitch >= open && pitch - open <= stringed->frets) {
        return true;
      }
    }
    return false;
  }
  return !reach_of(std::get<PercussionProfile>(profile), pitch).empty();
}

std::vector<StringFingering> fingerings_for(const InstrumentProfileArg& profile, int pitch) {
  StringedProfile stringed = to_stringed_profile(profile, "instrument");
  assert_midi_pitch(pitch, "pitch");
  return fingerings_in(stringed, pitch);
}

std::vector<StringFingering> fingerings_in(const StringedProfile& stringed, int pitch) {
  std::vector<StringFingering> out;
  for (std::size_t string = 0; string < stringed.tuning.size(); ++string) {
    int fret = pitch - stringed.tuning[string];
    if (fret >= 0 && fret <= stringed.frets) {
      out.push_back(StringFingering{string, fret});
    }
  }
  return out;
}

int fold_into_range(int pitch, const InstrumentProfileArg& profile) {
  InstrumentProfile resolved = to_instrument_profile(profile, "instrument");
  assert_midi_pitch(pitch, "pitch");
  return fold_in(pitch, resolved);
}

int fold_in(int pitch, const InstrumentProfile& resolved) {
  if (sounds_in(resolved, pitch)) {
    return pitch;
  }
  InstrumentRange range = range_in(resolved);
  // Every octave inside the instrument is weighed and the least distant sounding one wins,
  // starting at the first octave inside rather than stepping up to it.
  double first = pitch + 12 * std::ceil((range.low - pitch) / 12.0);
  std::optional<double> best;
  for (double candidate = first; candidate <= range.high; candidate += 12) {
    if (!sounds_in(resolved, static_cast<int>(candidate))) {
      continue;
    }
    // Not strictly nearer: the candidates rise, so a tie takes the upper octave.
    if (!best || std::fabs(candidate - pitch) <= std::fabs(*best - pitch)) {
      best = candidate;
    }
  }
  return best ? static_cast<int>(*best) : pitch;
}

}  // namespace cantus
