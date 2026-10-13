/**
 * @file grammar.h
 * @brief Internal helpers of ts/src/theory/symbol/grammar.ts: what a chord symbol may say, and
 *        how it is read.
 */
#ifndef CANTUS_SRC_THEORY_SYMBOL_GRAMMAR_H_
#define CANTUS_SRC_THEORY_SYMBOL_GRAMMAR_H_

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/pitch.h"
#include "cantus/theory/chord.h"

namespace cantus {

/** The system a symbol is read and written in when the caller names none (`DEFAULT_SYSTEM`). */
inline constexpr NoteNameSystem kDefaultSystem = NoteNameSystem::kEnglish;

/** A chord root read off the front of a symbol, and the text left after it (`RootSplit`). */
struct RootSplit {
  NoteData root;
  std::string rest;
};

/** Every way the front of `text` reads as a chord root, longest root first (`rootSplits`). */
std::vector<RootSplit> root_splits(std::string_view text, NoteNameSystem system);

/**
 * The chord a root and the text after it name, or nullopt when that text names no chord
 * (`chordAfterRoot`).
 */
std::optional<Chord> chord_after_root(const NoteData& root, std::string_view rest,
                                      NoteNameSystem system);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_SYMBOL_GRAMMAR_H_
