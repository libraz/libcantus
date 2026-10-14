// Reads four bars of block chords with the typed C++ API.

#include <cantus/cantus.h>

#include <cstdio>
#include <string>
#include <vector>

int main() {
  const int chords[4][4] = {{48, 60, 64, 67}, {41, 60, 65, 69}, {43, 59, 62, 65}, {48, 60, 64, 67}};
  std::vector<cantus::NoteEvent> notes;
  for (int bar = 0; bar < 4; ++bar) {
    for (int pitch : chords[bar]) {
      cantus::NoteEvent note;
      note.pitch = pitch;
      note.startBeat = bar * 4;
      note.durationBeat = 4;
      notes.push_back(note);
    }
  }

  cantus::Timeline timeline = cantus::Score::of(notes).timeline();
  std::string numerals;
  for (const cantus::TimelineRoman& entry : timeline.roman()) {
    numerals += entry.roman + " ";
  }
  std::printf("%s\n", numerals.c_str());
  if (numerals != "I IV V7 I ") return 1;

  // An out-of-range pitch is an InvalidInputError, as in TypeScript.
  try {
    cantus::detect_chord({128});
    return 1;
  } catch (const cantus::InvalidInputError& error) {
    std::printf("%s\n", error.what());
  }
  return 0;
}
