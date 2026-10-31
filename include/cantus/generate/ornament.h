/**
 * @file ornament.h
 * @brief Public C++ API of ts/src/generate/ornament: ornaments applied to notes that already
 *        exist.
 *
 * The decoration is carried as an Articulation, not baked into extra onsets: a flam is one note
 * marked `flam`, so the grace stroke stays the reader's to voice. The choice of notes is addressed
 * by each note's own position, so raising the amount adds ornaments without moving the ones
 * already there.
 */
#ifndef CANTUS_GENERATE_ORNAMENT_H_
#define CANTUS_GENERATE_ORNAMENT_H_

#include <array>
#include <cstdint>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"

namespace cantus {

/** The kind of ornament to apply (`OrnamentStyle`). */
enum class OrnamentStyle : std::uint8_t { kGhost, kFlam, kDrag, kSlide, kAccent };

/** Every ornament idiom, in declaration order (`ORNAMENT_STYLES`). */
inline constexpr std::array<OrnamentStyle, 5> ORNAMENT_STYLES = {
    OrnamentStyle::kGhost, OrnamentStyle::kFlam, OrnamentStyle::kDrag, OrnamentStyle::kSlide,
    OrnamentStyle::kAccent};

/** The TS name of an ornament style ("ghost", ...). */
std::string_view to_string(OrnamentStyle style);

/** The ornament style named `name`, or nullopt. */
std::optional<OrnamentStyle> parse_ornament_style(std::string_view name);

/** Options of ornament() (`OrnamentOptions`). */
struct OrnamentOptions {
  /** The ornament to apply; `ghost` when absent. */
  std::optional<OrnamentStyle> style;
  /** How much of the eligible material is decorated, in [0, 1]; the context's, else 0.5. */
  std::optional<double> amount;
  /**
   * Time signature telling strong positions from weak ones, a meter map read bar by bar; 4/4 when
   * absent.
   */
  std::optional<MeterArg> ts;
  /** The generation context; `{ seed: 0 }` when absent. */
  std::optional<GenerationContextInput> ctx;
};

/**
 * Decorate existing notes with an ornament (`ornament`). Notes that never sound are dropped; the
 * rest come back as copies in input order, a note that already carries an articulation untouched.
 * @throws InvalidInputError if an option is outside its range or a note is malformed.
 */
std::vector<NoteEvent> ornament(const std::vector<NoteEvent>& notes,
                                const OrnamentOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_GENERATE_ORNAMENT_H_
