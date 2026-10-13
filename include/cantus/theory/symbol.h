/**
 * @file symbol.h
 * @brief Public C++ API of ts/src/theory/symbol: lead-sheet chord symbols, read and written.
 *
 * A symbol is `<root><quality>[/<bass>]`. The root and the bass are note names, read and written
 * in the notation system the caller names; a symbol is never attributed to a system on its own, so
 * with none given it is English.
 */
#ifndef CANTUS_THEORY_SYMBOL_H_
#define CANTUS_THEORY_SYMBOL_H_

#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <variant>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/chord.h"

namespace cantus {

/**
 * Anything that names a chord (`ChordLike`): a chord symbol, chord data, or any value whose
 * `data()` returns chord data.
 */
class ChordArg {
 public:
  /** The forms a ChordArg holds. */
  using Value = std::variant<std::string, Chord>;

  ChordArg(std::string symbol) : value_(std::move(symbol)) {}         // NOLINT
  ChordArg(std::string_view symbol) : value_(std::string(symbol)) {}  // NOLINT
  ChordArg(const char* symbol) : value_(std::string(symbol)) {}       // NOLINT
  ChordArg(Chord chord) : value_(std::move(chord)) {}                 // NOLINT
  /** A value whose `data()` returns chord data. */
  template <class T,
            std::enable_if_t<
                std::is_convertible_v<decltype(std::declval<const T&>().data()), Chord>, int> = 0>
  ChordArg(const T& value) : value_(Chord(value.data())) {}  // NOLINT

  /** The form this argument holds. */
  const Value& value() const noexcept { return value_; }

 private:
  Value value_;
};

/** How a chord symbol is written (`ChordSymbolOptions`). */
struct ChordSymbolOptions {
  /** Reads and writes the root and the bass in this system; English when absent. */
  std::optional<NoteNameSystem> system;
  /**
   * Which side of the staff the whole symbol is written on: true writes it in flats, false in
   * sharps. A spelling hint already on the requested side is kept.
   */
  std::optional<bool> flats;
};

/**
 * Parse a lead-sheet chord symbol (`parseChordSymbol`).
 * @throws InvalidInputError if the root or the quality is not recognized in that system.
 */
Chord parse_chord_symbol(std::string_view text, const NoteNameOptions& opts = {});

/** parse_chord_symbol() reporting failure instead of throwing it (`tryParseChordSymbol`). */
ParseResult<Chord> try_parse_chord_symbol(std::string_view text, const NoteNameOptions& opts = {});

/**
 * Format a chord as a lead-sheet chord symbol (`formatChordSymbol`).
 * @throws InvalidInputError if the chord is malformed.
 */
std::string format_chord_symbol(const ChordArg& chord, const ChordSymbolOptions& opts = {});

/**
 * Transpose a chord symbol by a number of semitones, respelling what moving by letter would leave
 * unwritable (`transposeChordSymbol`).
 * @throws InvalidInputError if `semitones` is not finite or the text is not a chord symbol.
 */
std::string transpose_chord_symbol(std::string_view text, double semitones,
                                   const ChordSymbolOptions& opts = {});

/**
 * Resolve any chord-shaped value to validated chord data, root and bass reduced to pitch classes
 * (`toChordData`).
 * @throws InvalidInputError if the value names no chord or a number in it is not finite.
 */
Chord to_chord_data(const ChordArg& value);

}  // namespace cantus

#endif  // CANTUS_THEORY_SYMBOL_H_
