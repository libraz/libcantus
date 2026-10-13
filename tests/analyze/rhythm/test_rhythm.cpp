#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "analyze/rhythm/internal.h"
#include "cantus/analyze/rhythm.h"
#include "cantus/core/errors.h"

using namespace cantus;

namespace {

std::vector<NoteEvent> quarters(int count) {
  std::vector<NoteEvent> out;
  for (int i = 0; i < count; ++i) {
    NoteEvent note;
    note.pitch = 60;
    note.startBeat = i;
    note.durationBeat = 1;
    out.push_back(note);
  }
  return out;
}

}  // namespace

TEST_CASE("four straight quarters read as dense, on grid and unsyncopated", "[rhythm]") {
  RhythmAnalysisOptions options;
  options.ts = MeterArg("4/4");
  RhythmAnalysis result = analyze_rhythm(quarters(4), options);
  CHECK(result.startBeat == 0);
  CHECK(result.endBeat == 4);
  CHECK(result.bars == 1);
  CHECK(result.onsets == 4);
  CHECK(result.onsetDensity == 4);
  CHECK(result.restRatio == 0);
  CHECK(result.syncopation == 0);
  CHECK(result.offGridRatio == 0);
  REQUIRE(result.barPositions.size() == 1);
  CHECK(result.barPositions[0].slotsPerBar == 48);
  CHECK(result.rationale == "4 onsets over 1.00 bars (4.00 per bar), 0% rest, syncopation 0.00");
}

TEST_CASE("a span with nothing sounding has no rhythm to place", "[rhythm]") {
  RhythmAnalysisOptions options;
  options.totalBeats = std::numeric_limits<double>::quiet_NaN();
  RhythmAnalysis result = analyze_rhythm({}, options);
  CHECK(result.onsets == 0);
  CHECK(result.onsetLevels.size() == 6);
  CHECK(result.interOnsetShares.size() == rhythm_ioi_bins().size());
  CHECK(result.rationale == "Nothing sounds, so there is no rhythm to place on a grid");
  CHECK_THROWS_AS(analyze_rhythm(quarters(4), options), InvalidInputError);
}

TEST_CASE("intervals are binned to the half-octave steps", "[rhythm]") {
  CHECK(rhythm_ioi_bins().size() == 17);
  CHECK(ioi_bin_index(1) == 8);
  CHECK(ioi_bin_index(0.001) == 0);
  CHECK(ioi_bin_index(1000) == 16);
  CHECK(rhythm_level(0, MeterArg("4/4")) == 5);
  CHECK(rhythm_level(0.5, MeterArg("4/4")) == 1);
  CHECK(rhythm_level(0.25, MeterArg("4/4")) == 0);
}
