/**
 * @file figured_bass.h
 * @brief Public C++ API of ts/src/theory/figured_bass: read a bass note and its figures as the
 *        chord they name, and write a chord as figures.
 *
 * The figures are intervals above the bass, and every interval a figure does not alter is the one
 * the key's own scale gives. An accidental on a figure names its note exactly as it does on the
 * staff; the crossed figure, typed `+`, is the one sign that raises instead of naming.
 */
#ifndef CANTUS_THEORY_FIGURED_BASS_H_
#define CANTUS_THEORY_FIGURED_BASS_H_

#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/pitch.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"

namespace cantus {

/** A figure that moves over a held bass, such as the `4-3` suspension. */
struct FiguredBassSuspension {
  /** The interval above the bass that sounds first: the suspended note. */
  int from = 0;
  /** The interval it moves to, which is the one the chord contains. */
  int to = 0;
  /** The suspended note, spelled. */
  NoteData note;
  /** The note it moves to, spelled. */
  NoteData resolution;
};

/** Everything a figured bass states: the chord, its spelled notes and any moving figure. */
struct FiguredBassRealization {
  /** The chord, carrying the bass as its `bassPc` and the root and bass spellings as hints. */
  Chord chord;
  /** The spelled notes, bass first and then each figured interval in ascending order. */
  std::vector<NoteData> notes;
  /** Every moving figure, in written order. */
  std::vector<FiguredBassSuspension> suspensions;
};

/**
 * Read a figured bass in full (`figuredBassRealization`).
 * @throws InvalidInputError if the figures are malformed or name no chord, or the key is not
 *   heptatonic.
 * @throws NoSolutionError if the figures sound a chord no quality names.
 */
FiguredBassRealization figured_bass_realization(const NoteArg& bass, std::string_view figures,
                                                const KeyArg& key);

/** The chord a bass note and its figures name in a key (`realizeFiguredBass`). */
Chord realize_figured_bass(const NoteArg& bass, std::string_view figures, const KeyArg& key);

/**
 * Write a chord as the figures a bass would carry under it, in a key (`figuredBassOf`).
 * @throws InvalidInputError if the key is not heptatonic.
 * @throws NoSolutionError if no figure names the chord.
 */
std::string figured_bass_of(const ChordArg& chord, const KeyArg& key);

}  // namespace cantus

#endif  // CANTUS_THEORY_FIGURED_BASS_H_
