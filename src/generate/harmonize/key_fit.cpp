// How well a key suits the melody it is asked to harmonize: ts/src/generate/harmonize/key-fit.ts.

#include "generate/harmonize/key_fit.h"

#include "generate/harmonize/internal.h"
#include "generate/harmonize/limits.gen.h"
#include "js/math.h"

namespace cantus {

double tessitura_cost(const std::vector<NoteEvent>& melody) {
  double cost = 0;
  for (const NoteEvent& n : melody) {
    if (n.pitch < HARMONIZE_COMFORT_LOW) {
      cost += (HARMONIZE_COMFORT_LOW - n.pitch) * HARMONIZE_TESSITURA_WEIGHT;
    } else if (n.pitch > HARMONIZE_COMFORT_HIGH) {
      cost += (n.pitch - HARMONIZE_COMFORT_HIGH) * HARMONIZE_TESSITURA_WEIGHT;
    }
  }
  return cost;
}

double key_fit_cost(const std::vector<NoteEvent>& melody, const KeyScale& key) {
  double cost = 0;
  for (const NoteEvent& n : melody) {
    if (!is_key_tone(n.pitch, key)) {
      cost += js::max(0.25, n.durationBeat) * HARMONIZE_OUT_OF_KEY_PER_BEAT;
    }
  }
  return cost;
}

}  // namespace cantus
