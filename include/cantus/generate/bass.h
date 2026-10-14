/**
 * @file bass.h
 * @brief Public C++ API of ts/src/generate/bass: deterministic bass lines over a chord placement,
 *        and the lick dictionary that lays remembered figures over a progression.
 *
 * generate_bass_line() builds a monophonic line in a low register from one of several idioms,
 * from a held root per segment to a walking line that leads by step into each chord change.
 * place_licks() lays the figures of BASS_LICKS (and any the context brings) over the same kind of
 * placement. Positions and durations are measured in quarter-note beats; given a seed the output
 * is fully reproducible.
 */
#ifndef CANTUS_GENERATE_BASS_H_
#define CANTUS_GENERATE_BASS_H_

#include <any>
#include <array>
#include <cstdint>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/vocabulary.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"

namespace cantus {

/** A chord sounding over a half-open beat span `[startBeat, endBeat)` (`BassSegment`). */
using BassSegment = ChordSegment;

/** A segment whose chord may be written as a chord symbol (`Omit<BassSegment, 'chord'> & ...`). */
struct BassSegmentArg {
  double startBeat = 0;
  double endBeat = 0;
  ChordArg chord;
};

/** Every bass-line idiom, in declaration order (`BassStyle`). */
enum class BassStyle : std::uint8_t { kRoot, kRootFifth, kPop, kWalking, kArpeggio };

/** Every bass-line idiom, in declaration order (`BASS_STYLES`). */
inline constexpr std::array<BassStyle, 5> BASS_STYLES = {BassStyle::kRoot, BassStyle::kRootFifth,
                                                         BassStyle::kPop, BassStyle::kWalking,
                                                         BassStyle::kArpeggio};

/** The TS name of a bass style ("root", ...). */
std::string_view to_string(BassStyle style);

/** The bass style named `name`, or nullopt. */
std::optional<BassStyle> parse_bass_style(std::string_view name);

/** Options of generate_bass_line() (`BassLineOptions`). */
struct BassLineOptions {
  BassLineOptions(std::vector<BassSegmentArg> segments_, KeyArg key_)
      : segments(std::move(segments_)), key(std::move(key_)) {}

  /** Chord placement to follow; need not be pre-sorted. */
  std::vector<BassSegmentArg> segments;
  /** Key/scale context, used for diatonic approach tones in `walking`. */
  KeyArg key;
  /** Time signature, for metric accents; 4/4 when absent. */
  std::optional<MeterArg> ts;
  /** Bass-line idiom; `root` when absent. */
  std::optional<BassStyle> style;
  /** Target register as a base MIDI octave, -1 to 8; 2 when absent. */
  std::optional<double> octave;
  /** The instrument the line is written for; a programmed part when absent. */
  std::optional<InstrumentProfileArg> instrument;
  /** The generation context; `{ seed: 0 }` when absent. */
  std::optional<GenerationContextInput> ctx;
  /** Maximum number of segments, and of notes, that may be worked through. */
  std::optional<double> budget;
};

/**
 * Generate a bass line following a chord placement (`generateBassLine`).
 * @returns Bass notes sorted by onset, non-overlapping.
 * @throws InvalidInputError if an option is malformed, a segment has no positive duration or two
 *   segments overlap.
 * @throws BudgetExceededError if the placement is larger than the budget allows.
 */
std::vector<NoteEvent> generate_bass_line(const BassLineOptions& opts);

/** One note of a lick, relative to the chord it is played over (`LickNote`). */
struct LickNote : GridEvent {
  /** Chord degree, 1-based; 8 is the octave above the root. */
  double degree = 1;
  /** Chromatic alteration in semitones, for a flattened or raised degree. */
  std::optional<double> alter;
  /** Sounding length in sixteenths; absent, the note sounds to the next onset. */
  std::optional<double> lengthSteps;
  /** How the note is played, when it is more than a plain note. */
  std::optional<Articulation> articulation;
};

/** A lick: its notes and how long the whole figure lasts (`LickMaterial`). */
struct LickMaterial {
  /** Length of the figure in sixteenths. */
  double lengthSteps = 0;
  std::vector<LickNote> notes;
};

/** A lick with the conditions it fits (`BassLick`). */
using BassLick = Vocabulary<LickMaterial>;

/** The built-in bass licks, in declaration order (`BASS_LICKS`). */
extern const std::vector<BassLick> BASS_LICKS;

/** Whether a mixed dictionary's material is a bass lick (`isLickMaterial`). */
bool is_lick_material(const std::any& material);

/** Options of place_licks() (`PlaceLicksOptions`). */
struct PlaceLicksOptions {
  /** The genre whose figures may be used. */
  Genre genre = Genre::kPop;
  /** The hardest figure that may be used, 1 to 5. */
  std::optional<double> difficulty;
  /** Time signature; 4/4 when absent. */
  std::optional<MeterArg> ts;
  /** Target register as a base MIDI octave, -1 to 8; 2 when absent. */
  std::optional<double> octave;
  /** The instrument the line is written for; its range always applies. */
  std::optional<InstrumentProfileArg> instrument;
  /** The generation context; `{ seed: 0, bpm: 120, complexity: { rhythmic: 0.6 } }` when absent. */
  std::optional<GenerationContextInput> ctx;
  /** Maximum number of segments, and of bars those segments span, that may be laid over. */
  std::optional<double> budget;
};

/**
 * Lay licks over a chord placement (`placeLicks`).
 * @returns Bass notes sorted by onset, non-overlapping.
 * @throws InvalidInputError if the genre or an option is malformed, a segment has no positive
 *   duration, or two segments overlap.
 * @throws BudgetExceededError if the placement is larger than the budget allows.
 */
std::vector<NoteEvent> place_licks(const std::vector<BassSegmentArg>& timeline, const KeyArg& key,
                                   const PlaceLicksOptions& opts);

}  // namespace cantus

#endif  // CANTUS_GENERATE_BASS_H_
