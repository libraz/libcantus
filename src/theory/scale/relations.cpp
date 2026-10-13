// How keys stand to one another: ts/src/theory/scale/relations.ts.
//
// Every relation but parallel_key_of() is computed in fifths space, on top of
// key_signature_fifths() and key_from_fifths(), so the tonic comes back spelled the way the key is
// written.

#include "theory/scale/relations.h"

#include <array>
#include <cstdlib>
#include <optional>
#include <vector>

#include "cantus/theory/scale.h"
#include "cantus/theory/spelling.h"
#include "theory/scale/masks.h"
#include "theory/scale/scales.h"

namespace cantus {

namespace {

/** Which of the two modes a key leans to (`modeOf`). */
KeyMode mode_of(const KeyScale& key) {
  return is_minor_mask(mask_of(key)) ? KeyMode::kMinor : KeyMode::kMajor;
}

KeyMode opposite_mode(KeyMode mode) {
  return mode == KeyMode::kMajor ? KeyMode::kMinor : KeyMode::kMajor;
}

/** Whether two keys name the same key: same root pitch class, same mode (`soundsLike`). */
bool sounds_like(const KeyScale& a, const KeyScale& b) {
  return pitch_class_of(a.rootPc) == pitch_class_of(b.rootPc) &&
         is_minor_mask(a.modeMask12) == is_minor_mask(b.modeMask12);
}

/** Whether two tonics are written alike, octave aside (`spelledLike`). */
bool spelled_like(const NoteData& a, const NoteData& b) {
  return diatonic_letter_of(a.letter) == diatonic_letter_of(b.letter) && a.alter == b.alter;
}

/** What a candidate tonic costs the scale it is asked to spell (`TonicCost`). */
struct TonicCost {
  int doubles = 0;
  int accidentals = 0;
  int fifths = 0;
};

TonicCost tonic_cost(const NoteData& tonic, const KeyScale& key) {
  TonicCost cost;
  for (const NoteData& note : spell_scale(tonic, key)) {
    int alter = std::abs(note.alter);
    cost.accidentals += alter;
    if (alter >= MAX_NAME_ACCIDENTALS) {
      cost.doubles += 1;
    }
  }
  cost.fifths = std::abs(key_signature_fifths(tonic, key));
  return cost;
}

/** Whether the first tonic spells the key better than the second (`spellsBetter`). */
bool spells_better(const TonicCost& a, const TonicCost& b, bool signature_key) {
  std::array<int TonicCost::*, 3> order =
      signature_key ? std::array<int TonicCost::*, 3>{&TonicCost::fifths, &TonicCost::doubles,
                                                      &TonicCost::accidentals}
                    : std::array<int TonicCost::*, 3>{&TonicCost::doubles, &TonicCost::accidentals,
                                                      &TonicCost::fifths};
  for (int TonicCost::*term : order) {
    if (a.*term != b.*term) {
      return a.*term < b.*term;
    }
  }
  return false;
}

/** Where a spelled tonic itself stands on the circle of fifths (`tonicPosition`). */
int tonic_position(const NoteData& tonic) {
  return key_signature_fifths(tonic, major_scale(note_to_pitch_class(tonic)));
}

/** The signature the tonic's own plain major or minor key is written with (`tonicFifths`). */
int tonic_fifths(const NoteData& tonic, KeyMode mode) {
  return tonic_position(tonic) - (mode == KeyMode::kMinor ? MINOR_TONIC_FIFTHS : 0);
}

ResolvedKey relative_of(const NoteData& tonic, const KeyScale& key) {
  return relative_key_of(tonic, key);
}

ResolvedKey parallel_of(const NoteData& tonic, const KeyScale& key) {
  return parallel_key_of(tonic, key);
}

ResolvedKey dominant_of(const NoteData& tonic, const KeyScale& key) {
  return dominant_key_of(tonic, key);
}

ResolvedKey subdominant_of(const NoteData& tonic, const KeyScale& key) {
  return subdominant_key_of(tonic, key);
}

/** The relative of the dominant key (`relativeOfDominantKeyOf`). */
ResolvedKey relative_of_dominant(const NoteData& tonic, const KeyScale& key) {
  ResolvedKey dominant = dominant_key_of(tonic, key);
  return relative_key_of(dominant.tonic, dominant.scale);
}

/** The relative of the subdominant key (`relativeOfSubdominantKeyOf`). */
ResolvedKey relative_of_subdominant(const NoteData& tonic, const KeyScale& key) {
  ResolvedKey subdominant = subdominant_key_of(tonic, key);
  return relative_key_of(subdominant.tonic, subdominant.scale);
}

/** One closely related key: its relation and how to reach it (`CLOSELY_RELATED`). */
struct CloselyRelated {
  KeyRelation relation;
  ResolvedKey (*of)(const NoteData&, const KeyScale&);
};

constexpr std::array<CloselyRelated, 6> kCloselyRelated = {{
    {KeyRelation::kRelative, &relative_of},
    {KeyRelation::kParallel, &parallel_of},
    {KeyRelation::kDominant, &dominant_of},
    {KeyRelation::kSubdominant, &subdominant_of},
    {KeyRelation::kRelativeOfDominant, &relative_of_dominant},
    {KeyRelation::kRelativeOfSubdominant, &relative_of_subdominant},
}};

}  // namespace

std::string_view to_string(KeyRelation relation) {
  switch (relation) {
    case KeyRelation::kSame:
      return "same";
    case KeyRelation::kEnharmonic:
      return "enharmonic";
    case KeyRelation::kRelative:
      return "relative";
    case KeyRelation::kParallel:
      return "parallel";
    case KeyRelation::kDominant:
      return "dominant";
    case KeyRelation::kSubdominant:
      return "subdominant";
    case KeyRelation::kRelativeOfDominant:
      return "relativeOfDominant";
    case KeyRelation::kRelativeOfSubdominant:
      return "relativeOfSubdominant";
  }
  return "";
}

ResolvedKey spelled_key_of(const KeyScale& key) {
  int root_pc = pitch_class_of(key.rootPc);
  bool signature_key = is_signature_key(key);
  // Every pitch class is named somewhere in the span, so this tonic only stands in until the scan
  // makes its first match.
  NoteData tonic = key_from_fifths(0).tonic;
  std::optional<TonicCost> best;
  // Scanning from the flat end and keeping only a strictly better candidate settles an even tie
  // on the flat side.
  for (int fifths = FLATTEST_TONIC_FIFTHS; fifths <= SHARPEST_TONIC_FIFTHS; ++fifths) {
    NoteData candidate = key_from_fifths(fifths).tonic;
    if (note_to_pitch_class(candidate) != root_pc) {
      continue;
    }
    TonicCost cost = tonic_cost(candidate, key);
    if (!best || spells_better(cost, *best, signature_key)) {
      tonic = candidate;
      best = cost;
    }
  }
  return ResolvedKey{key, tonic, variant_of_mask(key.modeMask12)};
}

ResolvedKey relative_key_of(const NoteArg& tonic, const KeyArg& key) {
  KeyMode mode = mode_of(to_key_scale(key));
  return key_from_fifths(tonic_fifths(to_note_data(tonic), mode), opposite_mode(mode));
}

ResolvedKey parallel_key_of(const NoteArg& tonic, const KeyArg& key) {
  NoteData note = to_note_data(tonic);
  KeyMode mode = opposite_mode(mode_of(to_key_scale(key)));
  // The spelled tonic decides the root, so the returned key and its tonic agree.
  int root_pc = note_to_pitch_class(note);
  KeyScale scale = mode == KeyMode::kMinor ? minor_scale(root_pc) : major_scale(root_pc);
  return ResolvedKey{scale, NoteData{diatonic_letter_of(note.letter), note.alter, std::nullopt},
                     variant_of_mask(scale.modeMask12)};
}

bool is_written_tonic(const NoteData& tonic, const KeyScale& key) {
  int position = tonic_position(tonic);
  if (is_signature_key(key)) {
    return std::abs(position) <= MAX_FIFTHS &&
           std::abs(key_signature_fifths(tonic, key)) <= MAX_CONVENTIONAL_FIFTHS;
  }
  // A scale that only borrows a signature is read as this tonic roots it.
  return position >= FLATTEST_TONIC_FIFTHS && position <= SHARPEST_TONIC_FIFTHS &&
         tonic_cost(tonic, KeyScale{note_to_pitch_class(tonic), key.modeMask12}).doubles == 0;
}

ResolvedKey dominant_key_of(const NoteArg& tonic, const KeyArg& key) {
  KeyMode mode = mode_of(to_key_scale(key));
  return key_from_fifths(tonic_fifths(to_note_data(tonic), mode) + 1, mode);
}

ResolvedKey subdominant_key_of(const NoteArg& tonic, const KeyArg& key) {
  KeyMode mode = mode_of(to_key_scale(key));
  return key_from_fifths(tonic_fifths(to_note_data(tonic), mode) - 1, mode);
}

Nullable<ResolvedKey> enharmonic_key_of(const NoteArg& tonic, const KeyArg& key) {
  NoteData note = to_note_data(tonic);
  KeyScale scale = to_key_scale(key);
  mask_of(scale);
  int position = tonic_position(note);
  for (int candidate : {position - ENHARMONIC_FIFTHS, position + ENHARMONIC_FIFTHS}) {
    // Bounded by what the reader can spell, and no further, so the relation stays its own inverse.
    if (std::abs(candidate) > MAX_FIFTHS) {
      continue;
    }
    NoteData spelled = key_from_fifths(candidate).tonic;
    if (!is_written_tonic(spelled, scale)) {
      continue;
    }
    return ResolvedKey{KeyScale{note_to_pitch_class(spelled), scale.modeMask12}, spelled,
                       variant_of_mask(scale.modeMask12)};
  }
  return Nullable<ResolvedKey>();
}

std::vector<RelatedKey> related_keys_of(const NoteArg& tonic, const KeyArg& key) {
  NoteData note = to_note_data(tonic);
  KeyScale scale = to_key_scale(key);
  std::vector<RelatedKey> out;
  for (const CloselyRelated& related : kCloselyRelated) {
    ResolvedKey found = related.of(note, scale);
    out.push_back(RelatedKey{found.tonic, found.scale, found.variant, related.relation});
  }
  return out;
}

Nullable<KeyRelation> key_relation_between(const ResolvedKey& a, const ResolvedKey& b) {
  mask_of(a.scale, "a.scale");
  mask_of(b.scale, "b.scale");
  if (sounds_like(a.scale, b.scale)) {
    return spelled_like(a.tonic, b.tonic) ? KeyRelation::kSame : KeyRelation::kEnharmonic;
  }
  for (const CloselyRelated& related : kCloselyRelated) {
    if (sounds_like(related.of(a.tonic, a.scale).scale, b.scale)) {
      return related.relation;
    }
  }
  return Nullable<KeyRelation>();
}

}  // namespace cantus
