/**
 * @file internal.h
 * @brief Internal helpers of ts/src/theory/counterpoint/internal.ts: the interval reading the
 *        predicates, the species checker and the independence metric share.
 */
#ifndef CANTUS_SRC_THEORY_COUNTERPOINT_INTERNAL_H_
#define CANTUS_SRC_THEORY_COUNTERPOINT_INTERNAL_H_

#include "cantus/theory/counterpoint.h"

namespace cantus {

/**
 * The sounding pitch of a predicate argument, whichever form it arrived in (`pitchOf`).
 * @throws InvalidInputError if a note is malformed or has no octave.
 */
double pitch_of(const PitchArg& value);

/** Reduce a compound diatonic number to its simple form in [1, 7] (`simpleIntervalNumber`). */
int simple_interval_number(double number);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_COUNTERPOINT_INTERNAL_H_
