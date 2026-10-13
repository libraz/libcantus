/**
 * @file roman.h
 * @brief Internal helpers of ts/src/analyze/functional/roman.ts: rendering a chord as a numeral
 *        with the facts that decided it. The public entry points are declared in
 *        cantus/analyze/functional.h.
 */
#ifndef CANTUS_SRC_ANALYZE_FUNCTIONAL_ROMAN_H_
#define CANTUS_SRC_ANALYZE_FUNCTIONAL_ROMAN_H_

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Where a chord's bass ended up in the numeral (`RomanBass`). */
enum class RomanBass : std::uint8_t { kRoot, kFigured, kUnfigurable, kForeign };

/** How a numeral was arrived at, as the facts themselves rather than as prose (`RomanDerivation`).
 */
struct RomanDerivation {
  enum class Kind : std::uint8_t { kAugmentedSixth, kApplied, kNeapolitan, kDegree };
  Kind kind = Kind::kDegree;
  /** The numeral of the tonicized degree (`applied`). */
  std::string target;
  int degreeNumber = 1;
  /** The accidental the numeral is printed with. */
  std::string accidental;
  /** The accidental the root literally stands at above the degree. */
  std::string literalAccidental;
  /** The name of the chord's quality as the rationale quotes it. */
  std::string quality;
  RomanBass bass = RomanBass::kRoot;
  std::optional<std::string> figure;
};

/** A numeral and the facts that decided it. */
struct RomanRendering {
  std::string roman;
  RomanDerivation derivation;
};

/**
 * A quality named like a member of `Object.prototype` (`toString`): the style table's lookup finds
 * a value that carries no case and no suffix, so the numeral is upper case and ends in the text
 * `undefined`. The chord's own quality field then only has to stand outside every quality set.
 */
struct InheritedQuality {
  std::string name;
};

/**
 * Render a chord as a numeral, keeping the facts that decided it (`renderRoman`); `inherited`
 * stands for a quality the style table has no entry for.
 */
RomanRendering render_roman(const Chord& chord, const KeyArg& key, const ChordToRomanOptions& opts,
                            const InheritedQuality* inherited = nullptr);

/** The numerals the options turned down for this chord (`romanAlternatives`). */
std::vector<RejectedCandidate> roman_alternatives(const Chord& chord, const KeyArg& key,
                                                  const ChordToRomanOptions& opts,
                                                  const InheritedQuality* inherited = nullptr);

/** The rationale for a rendered numeral (`describeRoman`). */
std::string describe_roman(const std::string& roman, const RomanDerivation& derivation);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FUNCTIONAL_ROMAN_H_
