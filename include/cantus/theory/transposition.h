/**
 * @file transposition.h
 * @brief Public C++ API of ts/src/theory/transposition: the fixed interval between the pitch a
 *        transposing instrument reads and the pitch it sounds.
 *
 * The distance is a spelled interval, never a semitone count, so the letter a part is written on
 * survives the conversion. An instrument is named by an entry of TRANSPOSING_INSTRUMENTS or by an
 * interval in the same written-to-sounding direction.
 */
#ifndef CANTUS_THEORY_TRANSPOSITION_H_
#define CANTUS_THEORY_TRANSPOSITION_H_

#include <string_view>
#include <vector>

#include "cantus/core/pitch.h"

namespace cantus {

/** A built-in transposing instrument and its written-to-sounding interval name. */
struct TransposingInstrumentEntry {
  std::string_view name;
  /** An interval name as parse_interval() reads it; a leading '-' sounds below what is read. */
  std::string_view interval;
};

/** The interval from a written pitch to the pitch each built-in instrument sounds. */
extern const std::vector<TransposingInstrumentEntry> TRANSPOSING_INSTRUMENTS;

/**
 * The interval a transposing instrument sounds at, measured from what it reads
 * (`instrumentTransposition`). A string is a built-in instrument name or an interval name.
 * @throws InvalidInputError if the value is neither a known instrument nor a spelled interval.
 */
SpelledInterval instrument_transposition(const IntervalArg& instrument);

/**
 * The pitch an instrument sounds for a written note (`toSoundingPitch`).
 * @throws InvalidInputError if the note is malformed or the instrument is unknown.
 */
NoteData to_sounding_pitch(const NoteArg& note, const IntervalArg& instrument);

/**
 * The note an instrument must read to sound a given concert pitch (`toWrittenPitch`).
 * @throws InvalidInputError if the note is malformed or the instrument is unknown.
 */
NoteData to_written_pitch(const NoteArg& note, const IntervalArg& instrument);

}  // namespace cantus

#endif  // CANTUS_THEORY_TRANSPOSITION_H_
