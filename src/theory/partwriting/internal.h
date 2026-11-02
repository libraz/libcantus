/**
 * @file internal.h
 * @brief Internal helpers of ts/src/theory/partwriting/internal.ts: the violation record and the
 *        interval names the four-part checker and the species checker share.
 */
#ifndef CANTUS_SRC_THEORY_PARTWRITING_INTERNAL_H_
#define CANTUS_SRC_THEORY_PARTWRITING_INTERNAL_H_

#include <cstddef>
#include <iterator>
#include <optional>
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

/** The note lengths a species exercise is read by, or the reason they cannot be read. */
struct SpeciesDurations {
  std::vector<double> durations;
  std::optional<std::string> problem;
};

/**
 * `resolveDurations` for a counterpoint of `notes` notes over `measures` cantus-firmus notes. It
 * reads no note, so check_species() reports an unreadable rhythm before any note is read.
 * @throws InvalidInputError for the fifth species given no durations.
 */
SpeciesDurations resolve_species_durations(std::size_t notes, std::size_t measures, int species,
                                           const SpeciesOptions& opts);

/** A counterpoint note and a cantus-firmus note it sounds against (one `buildEntries` entry). */
struct SpeciesEntryPair {
  std::size_t note = 0;
  std::size_t against = 0;
  bool held = false;
  /** Where the stretch begins: the note's onset, or the measure it is held into. */
  double begins = 0;
};

/** The pairs `buildEntries` measures, in its order, for resolved durations. */
std::vector<SpeciesEntryPair> species_entry_pairs(std::size_t cantus_firmus,
                                                  const std::vector<double>& durations);

/** Build one violation record (`violation`). */
PartWritingViolation violation(PartWritingViolationKind kind, std::vector<int> voices,
                               int from_index, int to_index, std::string rationale);

/** Append `from` to `to`, moving its elements. */
inline void append(std::vector<PartWritingViolation>& to, std::vector<PartWritingViolation> from) {
  to.insert(to.end(), std::make_move_iterator(from.begin()), std::make_move_iterator(from.end()));
}

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_PARTWRITING_INTERNAL_H_
