// The violation record and interval names: ts/src/theory/partwriting/internal.ts.

#include "theory/partwriting/internal.h"

#include <algorithm>
#include <cstddef>
#include <iterator>
#include <utility>

#include "core/validation/validation.h"
#include "js/number.h"
#include "theory/partwriting/limits.gen.h"

namespace cantus {

namespace {

constexpr int kSpeciesNumbers[] =
#include "theory/partwriting/species_numbers.gen.inc"
    ;

constexpr std::string_view kIntervalWords[] =
#include "theory/partwriting/interval_words.gen.inc"
    ;

}  // namespace

std::string interval_word(int number) {
  if (number >= 1 && static_cast<std::size_t>(number) <= std::size(kIntervalWords)) {
    return std::string(kIntervalWords[number - 1]);
  }
  return js::to_string(number) + "th";
}

bool is_species_number(double value) {
  return std::find(std::begin(kSpeciesNumbers), std::end(kSpeciesNumbers), value) !=
         std::end(kSpeciesNumbers);
}

InvalidInputError species_rejected(const json::Value& species) {
  std::string listed;
  for (int number : kSpeciesNumbers) {
    listed += (listed.empty() ? "" : ", ") + js::to_string(number);
  }
  return InvalidInputError("species must be one of " + listed + "; received " +
                           describe_rejected(species));
}

std::string_view interval_article(std::string_view word) {
  return !word.empty() && std::string_view("aeiou").find(word[0]) != std::string_view::npos ? "an"
                                                                                            : "a";
}

PartWritingViolation violation(PartWritingViolationKind kind, std::vector<int> voices,
                               int from_index, int to_index, std::string rationale) {
  PartWritingViolation out;
  out.kind = kind;
  out.voices = std::move(voices);
  out.fromIndex = from_index;
  out.toIndex = to_index;
  out.rationale = std::move(rationale);
  return out;
}

}  // namespace cantus
