// Built-in instrument profiles of ts/src/core/instrument/profiles.ts.
//
// The values are written out here because tools/data/gen_tables.mjs has no row form for a single
// object export; the corpus replay of each `$const:` op compares them with the TS values.

#include <vector>

#include "cantus/core/instrument.h"

namespace cantus {

namespace {

/** Techniques common to every fretted string instrument here (`STRINGED_ARTICULATIONS`). */
std::vector<Articulation> stringed_articulations() {
  return {Articulation::kAccent, Articulation::kGhost, Articulation::kStaccato,
          Articulation::kLegato, Articulation::kSlide, Articulation::kHammer,
          Articulation::kMute,   Articulation::kOpen};
}

}  // namespace

const StringedProfile BASS_4_STRING{
    "4-string bass", {28, 33, 38, 43}, 24, 4, stringed_articulations(), 4, std::nullopt};

const StringedProfile BASS_5_STRING{
    "5-string bass", {23, 28, 33, 38, 43}, 24, 4, stringed_articulations(), 5, std::nullopt};

const StringedProfile GUITAR_STANDARD{
    "guitar", {40, 45, 50, 55, 59, 64}, 24, 5, stringed_articulations(), 6, std::nullopt};

const StringedProfile GUITAR_DROP_D{
    "guitar (drop D)", {38, 45, 50, 55, 59, 64}, 24, 5, stringed_articulations(), 6, std::nullopt};

}  // namespace cantus
