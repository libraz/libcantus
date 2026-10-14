// Key signatures: ts/src/theory/scale/signature.ts.

#include <array>
#include <cmath>
#include <cstdlib>

#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/theory/scale.h"
#include "theory/scale/masks.h"
#include "theory/scale/scales.h"

namespace cantus {

namespace {

/** One entry of DIATONIC_MODE_OFFSET_ENTRIES: a diatonic mode's mask and signature offset. */
struct ModeOffset {
  int mask;
  int offset;
};

/** Position of each natural letter on the circle of fifths (`LETTER_FIFTHS`). */
constexpr std::array<int, 7> kLetterFifths = {
#include "theory/scale/letter_fifths.gen.inc"
};

/** The letters of the circle of fifths from F upward (`FIFTHS_LETTERS`). */
constexpr std::array<int, 7> kFifthsLetters = {
#include "theory/scale/fifths_letters.gen.inc"
};

/** Signature offset of each diatonic mode (`DIATONIC_MODE_OFFSETS`). */
constexpr std::array<ModeOffset, 7> kSignatureModeOffsets = {
#include "theory/scale/diatonic_mode_offset_entries.gen.inc"
};
static_assert(kSignatureModeOffsets.back().mask != 0, "DIATONIC_MODE_OFFSET_ENTRIES is short");

const ModeOffset* diatonic_mode(int mask) {
  for (const ModeOffset& entry : kSignatureModeOffsets) {
    if (entry.mask == mask) {
      return &entry;
    }
  }
  return nullptr;
}

/** Fifths between a key's signature and the major key on its tonic (`modeOffset`). */
int mode_offset(const KeyScale& key) {
  if (const ModeOffset* diatonic = diatonic_mode(key.modeMask12)) {
    return diatonic->offset;
  }
  return is_minor_mask(key.modeMask12) ? MINOR_MODE_OFFSET : 0;
}

}  // namespace

bool is_signature_key(const KeyScale& key) {
  int mask = mask_of(key);
  return diatonic_mode(mask) != nullptr || mask == HARMONIC_MINOR_MASK ||
         mask == MELODIC_MINOR_MASK;
}

int key_signature_fifths(const NoteArg& tonic, const KeyArg& key) {
  NoteData note = to_note_data(tonic);
  KeyScale scale = to_key_scale(key);
  int letter = diatonic_letter_of(note.letter);
  assert_integer(note.alter, "tonic.alter");
  assert_integer(scale.modeMask12, "key.modeMask12", 1, CHROMATIC_MASK);
  return kLetterFifths[static_cast<std::size_t>(letter)] + FIFTHS_PER_ALTERATION * note.alter +
         mode_offset(scale);
}

ResolvedKey key_from_fifths(double fifths, KeyMode mode) {
  auto steps = static_cast<int>(assert_integer(fifths, "fifths", -MAX_FIFTHS, MAX_FIFTHS));
  // The circle of fifths starts at F, so the major tonic of `fifths` sharps is one step along it;
  // a minor key is the relative minor, three fifths further.
  int index = steps + 1 + (mode == KeyMode::kMinor ? -MINOR_MODE_OFFSET : 0);
  int letter = kFifthsLetters[static_cast<std::size_t>(((index % 7) + 7) % 7)];
  auto alter = static_cast<int>(std::floor(index / 7.0));
  int root_pc = pitch_class_of(natural_pitch_class_of(letter) + alter);
  KeyScale scale = mode == KeyMode::kMinor ? minor_scale(root_pc) : major_scale(root_pc);
  return ResolvedKey{
      scale, NoteData{static_cast<double>(letter), static_cast<double>(alter), std::nullopt},
      variant_of_mask(scale.modeMask12)};
}

}  // namespace cantus
