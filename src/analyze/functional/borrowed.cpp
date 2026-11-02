// Borrowed chords (modal interchange) and the Neapolitan: ts/src/analyze/functional/borrowed.ts.

#include "analyze/functional/borrowed.h"

#include "analyze/functional/internal.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

/**
 * In a minor key, whether a non-diatonic chord is explained by the harmonic minor scale on the same
 * tonic, or by the melodic-minor raised-leading-tone half-diminished seventh
 * (`isMinorScaleAlteration`).
 */
bool is_minor_scale_alteration(const Chord& chord, const KeyScale& key) {
  if (!is_minor_scale(key)) {
    return false;
  }
  KeyScale altered{pitch_class_of(key.rootPc), HARMONIC_MINOR_MASK};
  if (is_diatonic_chord(chord, altered)) {
    return true;
  }
  return pitch_class_of(chord.rootPc - key.rootPc) == 11 &&
         is_diatonic_chord(chord, KeyScale{pitch_class_of(key.rootPc), MELODIC_MINOR_MASK});
}

/** `isBorrowedChord` on data already read into its narrow form (`isBorrowed`). */
bool is_borrowed(const Chord& chord, const KeyScale& key) {
  if (is_diatonic_chord(chord, key)) {
    return false;
  }
  if (is_neapolitan_chord_of(chord, key)) {
    return true;
  }
  if (is_minor_scale_alteration(chord, key)) {
    return false;
  }
  return is_diatonic_chord(chord, parallel_scale(key));
}

}  // namespace

Nullable<BorrowedSource> borrowed_source_of(const Chord& chord, const KeyScale& key) {
  if (is_diatonic_chord(chord, key)) {
    return std::nullopt;
  }
  if (is_neapolitan_chord_of(chord, key)) {
    return BorrowedSource::kNeapolitan;
  }
  // The checks of is_borrowed() that remain once the two above have failed.
  if (is_minor_scale_alteration(chord, key) || !is_diatonic_chord(chord, parallel_scale(key))) {
    return std::nullopt;
  }
  return is_minor_scale(key) ? BorrowedSource::kParallelMajor : BorrowedSource::kParallelMinor;
}

bool is_borrowed_chord(const ChordArg& chord, const KeyArg& key) {
  Chord data = to_chord_data(chord);
  KeyScale scale = to_key_scale(key);
  return is_borrowed(data, scale);
}

Nullable<BorrowedSource> borrowed_source(const ChordArg& chord, const KeyArg& key) {
  Chord data = to_chord_data(chord);
  KeyScale scale = to_key_scale(key);
  return borrowed_source_of(data, scale);
}

}  // namespace cantus
