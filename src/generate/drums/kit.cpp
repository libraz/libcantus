// The drum kit profile of ts/src/generate/drums/kit.ts.

#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/instrument.h"
#include "generate/drums/hit.h"

namespace cantus {

namespace {

/** One REACH_BY_VOICE row: the limbs that reach a voice, in the order a player takes them. */
struct ReachRow {
  std::string_view voice;
  std::vector<std::string_view> limbs;
};

/** The DRUM_KIT fields stated outright; its reach is derived from REACH_BY_VOICE. */
struct KitRecord {
  std::string_view kind;
  std::string_view name;
  std::vector<std::string_view> limbs;
  std::vector<int> overdub;
  std::vector<std::string_view> articulations;
  int polyphony;
};

PercussionProfile make_drum_kit() {
  static const std::vector<ReachRow> reach =
#include "generate/drums/reach_by_voice.gen.inc"
      ;
  static const KitRecord record =
#include "generate/drums/drum_kit.gen.inc"
      ;
  PercussionProfile kit;
  kit.name = std::string(record.name);
  for (std::string_view limb : record.limbs) {
    kit.limbs.push_back(*parse_limb(limb));
  }
  // The reach table keyed the way a hit is: by General MIDI note number.
  for (const ReachRow& row : reach) {
    std::vector<Limb> limbs;
    for (std::string_view limb : row.limbs) {
      limbs.push_back(*parse_limb(limb));
    }
    kit.reach[*drum_note_of(row.voice)] = std::move(limbs);
  }
  kit.overdub = record.overdub;
  for (std::string_view articulation : record.articulations) {
    kit.articulations.push_back(*parse_articulation(articulation));
  }
  kit.polyphony = record.polyphony;
  return kit;
}

}  // namespace

const PercussionProfile DRUM_KIT = make_drum_kit();

}  // namespace cantus
