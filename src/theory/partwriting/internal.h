/**
 * @file internal.h
 * @brief Internal helpers of ts/src/theory/partwriting/internal.ts: the violation record and the
 *        interval names the four-part checker and the species checker share.
 */
#ifndef CANTUS_SRC_THEORY_PARTWRITING_INTERNAL_H_
#define CANTUS_SRC_THEORY_PARTWRITING_INTERNAL_H_

#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/theory/partwriting.h"
#include "json/json.h"

namespace cantus {

/** Name an interval number, writing it out as `17th` past the words (`intervalWord`). */
std::string interval_word(int number);

/** The article an interval name takes: `an octave`, `a ninth` (`intervalArticle`). */
std::string_view interval_article(std::string_view word);

/** Whether a number is one of the species there are (`SPECIES_NUMBERS.includes`). */
bool is_species_number(double value);

/** The error check_species() raises for a species it does not accept. */
InvalidInputError species_rejected(const json::Value& species);

/** Build one violation record (`violation`). */
PartWritingViolation violation(PartWritingViolationKind kind, std::vector<int> voices,
                               int from_index, int to_index, std::string rationale);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_PARTWRITING_INTERNAL_H_
