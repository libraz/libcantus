// The cross relation, written once: ts/src/theory/partwriting/cross-relation.ts.

#include "theory/partwriting/cross_relation.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <tuple>

#include "cantus/theory/counterpoint.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

/**
 * Whether a chord resolves as an applied dominant: the dominant's sonority, taken down a fifth
 * onto a degree the key can make a local tonic, with the chord it names actually following.
 */
bool resolves_as_applied_dominant(const Chord& chord, const Chord* next, const KeyScale& key) {
  if (next == nullptr || !has_dominant_sonority(chord)) {
    return false;
  }
  Nullable<TonicizableDegree> target = applied_dominant_target(chord.rootPc + 5, key);
  return target && pitch_class_of(next->rootPc) == target->rootPc;
}

/** Whether a voicing sounds an augmented sixth above the lowered submediant. */
bool sounds_augmented_sixth(const ChromaticMoment& moment, const KeyScale& key) {
  if (moment.notes.empty()) {
    return false;
  }
  const NoteData& bass = moment.notes[0];
  if (note_to_pitch_class(bass) != pitch_class_of(key.rootPc + 8)) {
    return false;
  }
  for (std::size_t voice = 1; voice < moment.notes.size(); ++voice) {
    SpelledInterval interval = spelled_interval(bass, moment.notes[voice]);
    if ((interval.number - 1) % 7 + 1 == 6 && pitch_class_of(interval.semitones) == 10) {
      return true;
    }
  }
  return false;
}

/** Whether a chord is one of the chromatic harmonies whose own definition contains the
 * contradiction. */
bool is_chromatic_harmony(const ChromaticMoment& moment, const Chord* next, const KeyScale& key) {
  return resolves_as_applied_dominant(moment.chord, next, key) ||
         is_neapolitan_chord_of(moment.chord, key) || sounds_augmented_sixth(moment, key);
}

/** Whether a voice reaches its note by a diatonic step from the voicing before. */
bool approached_by_step(const std::vector<NoteData>* before, const std::vector<NoteData>& moment,
                        std::size_t voice) {
  if (before == nullptr || voice >= before->size() || voice >= moment.size()) {
    return false;
  }
  return spelled_interval((*before)[voice], moment[voice]).number == 2;
}

}  // namespace

bool is_outer_voice(int voice, const std::vector<NoteData>& notes) {
  return voice == 0 || voice == static_cast<int>(notes.size()) - 1;
}

std::vector<CrossRelation> cross_relations(const ChromaticMoment& from, const ChromaticMoment& to,
                                           const KeyScale& key, const ChromaticContext& context) {
  std::vector<CrossRelation> found;
  bool chromatic =
      is_chromatic_harmony(from, &to.chord, key) || is_chromatic_harmony(to, context.after, key);
  if (chromatic) {
    return found;
  }
  std::set<std::tuple<int, int, int>> reported;
  for (std::size_t first = 0; first < from.notes.size(); ++first) {
    for (std::size_t second = 0; second < to.notes.size(); ++second) {
      if (first == second) {
        continue;
      }
      const NoteData& earlier = from.notes[first];
      const NoteData& later = to.notes[second];
      int letter = diatonic_letter_of(earlier.letter);
      if (letter != diatonic_letter_of(later.letter) || earlier.alter == later.alter) {
        continue;
      }
      int first_voice = static_cast<int>(first);
      int second_voice = static_cast<int>(second);
      if (approached_by_step(context.before, from.notes, first) ||
          approached_by_step(&from.notes, to.notes, second) ||
          (!is_outer_voice(first_voice, from.notes) && !is_outer_voice(second_voice, to.notes))) {
        continue;
      }
      std::tuple<int, int, int> pair(letter, std::min<int>(first_voice, second_voice),
                                     std::max<int>(first_voice, second_voice));
      if (!reported.insert(pair).second) {
        continue;
      }
      found.push_back(CrossRelation{first_voice, second_voice, earlier, later});
    }
  }
  return found;
}

}  // namespace cantus
