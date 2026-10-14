/**
 * @file reharmony.h
 * @brief Public C++ API of ts/src/generate/reharmony: chord substitution, modal-interchange
 *        palettes and negative harmony.
 *
 * These transforms take an existing chord (or a key) and propose alternative harmonies that
 * preserve a chosen relationship: a shared function, a common tone, or a reflection across the key
 * axis. Every proposed chord carries the spelling hints of the key it was asked for.
 */
#ifndef CANTUS_GENERATE_REHARMONY_H_
#define CANTUS_GENERATE_REHARMONY_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/core/nullable.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"

namespace cantus {

/** The kind of substitution relationship a candidate realizes (`SubstitutionType`). */
enum class SubstitutionType : std::uint8_t { kTritone, kRelative, kBorrowed, kChromaticMediant };

/** The TS name of a substitution type ("tritone", "relative", "borrowed", "chromaticMediant"). */
std::string_view to_string(SubstitutionType type);

/** The substitution type named `name`, or nullopt. */
std::optional<SubstitutionType> parse_substitution_type(std::string_view name);

/** A proposed chord substitution with its relationship, numeral and function (`Substitution`). */
struct Substitution {
  Chord chord;
  SubstitutionType type = SubstitutionType::kTritone;
  std::string roman;
  HarmonicFunction function = HarmonicFunction::kTonic;
};

/** Options of substitute_chord() (`SubstituteOptions`). */
struct SubstituteOptions {
  /** Melody pitch classes that must remain chord tones. */
  std::optional<std::vector<double>> melodyPcs;
};

/**
 * Propose substitutions for a chord within a key (`substituteChord`).
 * @throws InvalidInputError if the chord or the key is malformed.
 */
std::vector<Substitution> substitute_chord(const ChordArg& chord, const KeyArg& key,
                                           const SubstituteOptions& opts = {});

/** A borrowed chord in the modal-interchange palette of a key (`BorrowedChord`). */
struct BorrowedChord {
  Chord chord;
  std::string roman;
  /** Where the chord is borrowed from; null for a chord no mode of the key's kind holds. */
  Nullable<BorrowedSource> source;
};

/**
 * The modal-interchange palette of a key (`modalInterchangePalette`).
 * @throws InvalidInputError if the key is malformed.
 */
std::vector<BorrowedChord> modal_interchange_palette(const KeyArg& key);

/**
 * Reflect a chord across the tonic-dominant axis of a key (`negativeHarmonyMirror`).
 * @throws InvalidInputError if the chord or the key is malformed.
 */
Chord negative_harmony_mirror(const ChordArg& chord, const KeyArg& key);

}  // namespace cantus

#endif  // CANTUS_GENERATE_REHARMONY_H_
