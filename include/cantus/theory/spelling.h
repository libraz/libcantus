/**
 * @file spelling.h
 * @brief Public C++ API of ts/src/theory/spelling: letter names for pitch classes, scales and
 *        chords, derived from a spelled tonic.
 *
 * Every entry point takes the spelled tonic of the key it spells, and rejects a tonic that sounds
 * a pitch class other than the key's root.
 */
#ifndef CANTUS_THEORY_SPELLING_H_
#define CANTUS_THEORY_SPELLING_H_

#include <optional>
#include <string>
#include <vector>

#include "cantus/core/pitch.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** The musical evidence around a pitch, refining an enharmonic choice (`SpellingContext`). */
struct SpellingContext {
  /** The chord sounding under the pitch; supersedes `chordRoot`. */
  std::optional<Chord> chord;
  /** Root pitch class of the chord sounding under the pitch. */
  std::optional<double> chordRoot;
  /** The pitch immediately before this one (MIDI pitch or bare pitch class). */
  std::optional<double> previous;
  /** The pitch immediately after this one (MIDI pitch or bare pitch class). */
  std::optional<double> next;
};

/**
 * Spell a pitch class relative to a spelled tonic and key, refined by context (`spellPitchClass`).
 * @throws InvalidInputError if the tonic does not sound the key's root.
 */
NoteData spell_pitch_class(double pc, const NoteArg& tonic, const KeyArg& key,
                           const SpellingContext& context = {});

/** Spell every pitch class of a scale, in scale-degree order (`spellScale`). */
std::vector<NoteData> spell_scale(const NoteArg& tonic, const KeyArg& key);

/**
 * Spell a list of pitch classes relative to a key, in input order (`spellPitchClasses`).
 * @throws InvalidInputError if an entry is not an integer pitch class.
 */
std::vector<NoteData> spell_pitch_classes(const std::vector<double>& pcs, const NoteArg& tonic,
                                          const KeyArg& key);

/**
 * Spell chord tones from an already chosen root spelling (`spellChordFromRoot`).
 * @throws InvalidInputError if the root spelling does not sound the chord's root.
 */
std::vector<NoteData> spell_chord_from_root(const Chord& chord, const NoteArg& root);

/** Spell a chord's tones, root first, relative to a key (`spellChord`). */
std::vector<NoteData> spell_chord(const Chord& chord, const NoteArg& tonic, const KeyArg& key);

/** Spell a MIDI pitch relative to a key, with the octave that reproduces it (`spellPitch`). */
NoteData spell_pitch(double pitch, const NoteArg& tonic, const KeyArg& key,
                     const SpellingContext& context = {});

/** Render notes as letter-name strings (`noteNames`). */
std::vector<std::string> note_names(const std::vector<NoteArg>& notes);

}  // namespace cantus

#endif  // CANTUS_THEORY_SPELLING_H_
