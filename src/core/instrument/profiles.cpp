// Built-in instrument profiles of ts/src/core/instrument/profiles.ts.

#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/instrument.h"

namespace cantus {

namespace {

/** A generated profile row, with articulations still by name. */
struct StringedRecord {
  std::string_view name;
  std::vector<int> tuning;
  int frets;
  int maxStretch;
  std::vector<std::string_view> articulations;
  int polyphony;
  std::optional<bool> fretless;
};

StringedProfile make_profile(const StringedRecord& record) {
  StringedProfile profile;
  profile.name = std::string(record.name);
  profile.tuning = record.tuning;
  profile.frets = record.frets;
  profile.maxStretch = record.maxStretch;
  for (std::string_view name : record.articulations) {
    profile.articulations.push_back(*parse_articulation(name));
  }
  profile.polyphony = record.polyphony;
  profile.fretless = record.fretless;
  return profile;
}

const StringedRecord kBass4String =
#include "core/instrument/bass_4_string.gen.inc"
    ;
const StringedRecord kBass5String =
#include "core/instrument/bass_5_string.gen.inc"
    ;
const StringedRecord kGuitarStandard =
#include "core/instrument/guitar_standard.gen.inc"
    ;
const StringedRecord kGuitarDropD =
#include "core/instrument/guitar_drop_d.gen.inc"
    ;

}  // namespace

const StringedProfile BASS_4_STRING = make_profile(kBass4String);
const StringedProfile BASS_5_STRING = make_profile(kBass5String);
const StringedProfile GUITAR_STANDARD = make_profile(kGuitarStandard);
const StringedProfile GUITAR_DROP_D = make_profile(kGuitarDropD);

}  // namespace cantus
