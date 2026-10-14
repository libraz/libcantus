#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/model/key.h"
#include "cantus/model/score.h"
#include "cantus/model/timeline.h"

using namespace cantus;

namespace {

Score cadence() {
  std::vector<NoteEvent> notes;
  const std::vector<std::vector<int>> chords = {
      {60, 64, 67}, {65, 69, 72}, {67, 71, 74}, {60, 64, 67}};
  for (std::size_t index = 0; index < chords.size(); ++index) {
    for (int pitch : chords[index]) {
      NoteEvent note;
      note.pitch = pitch;
      note.startBeat = static_cast<double>(index) * 2;
      note.durationBeat = 2;
      notes.push_back(note);
    }
  }
  ScoreOptions opts;
  opts.tempo = 90.0;
  return Score::of(notes, opts);
}

}  // namespace

TEST_CASE("Score reads its harmony and key from the notes", "[model][score]") {
  Score s = cadence();
  CHECK(s.total_beats() == 8);
  CHECK(s.key()->to_string() == "C major");
  CHECK(s.keys().size() == 1);
  Timeline t = s.timeline();
  CHECK(t.length() == 4);
  std::vector<std::string> numerals;
  for (const TimelineRoman& entry : t.roman()) {
    numerals.push_back(entry.roman);
  }
  CHECK(numerals == std::vector<std::string>{"I", "IV", "V", "I"});
  CHECK(s.phrases().size() == 1);
  CHECK(s.hypermeter().groupBars == 2);
  CHECK(s.detect_keys()[0].key.to_string() == "C major");
  CHECK(s.voices().size() == 12);
  CHECK(s.structural_cadences().size() == 1);
  CHECK(s.contour().shape == MelodicContourShape::kArch);
}

TEST_CASE("Score moves its notes and keeps its context", "[model][score]") {
  Score s = cadence();
  CHECK(s.transpose(2).notes()[0].pitch == 62);
  CHECK(s.shift(1).notes()[0].startBeat == 1);
  CHECK(s.quantize(0.5).notes().size() == 12);
  CHECK(s.seconds_at(4) == 2.6666666666666665);
  BarPosition bar = s.bar_at(5);
  CHECK(bar.bar == 1);
  CHECK(bar.beat == 1);
  CHECK(s.meter_at(0).numerator == 4);
  CHECK(s.to_ticks(480)[1].durationBeat == 960);
  CHECK(s.slice(2, 4).notes().size() == 3);
  CHECK(s.with_key("A minor").key()->to_string() == "A minor");
  CHECK(s.equals(Score::from_data(s.data())));
  CHECK(s.voice_notes().size() == 12);
  CHECK_THROWS_WITH(s.transpose(0.5),
                    "score notes[0].pitch must be an integer in [0, 127]; received 60.5");
  KeyTimelineOptions span;
  span.totalBeats = -1;
  CHECK_THROWS_WITH(s.with_key("C major").keys(span),
                    "key timeline totalBeats must be in [0, 9007199254740991]; received -1");
}
