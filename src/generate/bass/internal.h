/**
 * @file internal.h
 * @brief Internal pieces of ts/src/generate/bass/internal.ts: the placement rules a bass line is
 *        built from, shared by the phrase-shape styles and the lick dictionary.
 */
#ifndef CANTUS_SRC_GENERATE_BASS_INTERNAL_H_
#define CANTUS_SRC_GENERATE_BASS_INTERNAL_H_

#include <optional>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/bass.h"
#include "cantus/theory/chord.h"
#include "generate/bass/limits.gen.h"

namespace cantus {

/** The meter a bass part is written against when the caller names none (`DEFAULT_TS`). */
extern const TimeSignature kBassDefaultTs;

/** Place a pitch class as a MIDI note near an anchor, within the band `[low, low + 12]`. */
double place_pc(double pc, double anchor, double low);

/** Place a pitch class above the bass a chord names, rather than in the band. */
double place_above_bass(double pc, double bass_midi);

/** Place a segment's bass note in the register band. */
double place_root(double pc, double low);

/** A bar-long slice of a segment: the span one turn of a figure fills (`BarTile`). */
struct BarTile {
  double startBeat = 0;
  double endBeat = 0;
};

/** The bars a segment spans, one tile per bar of it. */
std::vector<BarTile> bar_tiles(double start_beat, double end_beat, const TimeSignature& ts);

/** The pulse a bar's second half begins on. */
double mid_bar_pulse(double bar_start, const TimeSignature& ts);

/** One segment's share of assertBassSegments: its range, its duration, and the one before it. */
void assert_bass_segment_at(const std::vector<BassSegment>& segments, std::size_t index);

/**
 * Check a chord placement a bass part can be written over, sorted by onset.
 * @throws InvalidInputError if a segment starts outside the timeline, has no positive duration or
 *   overlaps the one before it.
 */
void assert_bass_segments(const std::vector<BassSegment>& segments);

/** Sort a placement by onset (`sort((a, b) => a.startBeat - b.startBeat)`). */
void sort_bass_segments(std::vector<BassSegment>& segments);

/** Chord-tone pitch classes in stacked-thirds order, deduplicated. */
std::vector<int> chord_tone_pcs(const Chord& chord);

/** The chord's fifth pitch class, falling back to the root when it has none (`fifthPcOf`). */
int bass_fifth_pc_of(const Chord& chord);

/** The sounding bass pitch class of a chord: its slash bass, else its root. */
int bass_pc_of(const Chord& chord);

/** The chord tones an arpeggiating line cycles through, starting from the bass. */
std::vector<int> bass_tone_cycle(const Chord& chord);

/** Main-pulse positions within `[start, end)`, aligned to the global bar grid. */
std::vector<double> beat_positions(double start, double end, const TimeSignature& ts);

/** Shift a pitch by whole octaves until it lies in the band `[low, low + 12]`. */
double fold_into_band(double midi, double low);

/** The register band's floor, moved by whole octaves until the band lies inside the instrument. */
double band_floor(double low, const std::optional<StringedProfile>& instrument);

/** A diatonic or chromatic neighbour of `target`, a step toward `from` (`approachNote`). */
double bass_approach_note(double target, double from, const KeyScale& key, bool chromatic);

/** The instrument a bass part is written for, and the floor of its register. */
struct BassRegister {
  std::optional<StringedProfile> instrument;
  double low = 0;
};

/**
 * `bassRegister(named, given, octave)`.
 * @param named The instrument the generation context names for the bass, if any.
 * @param given The instrument the caller named, if any.
 * @throws InvalidInputError if `given` is not a stringed instrument.
 */
BassRegister bass_register(const std::optional<InstrumentProfile>& named,
                           const std::optional<InstrumentProfileArg>& given, double octave);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_BASS_INTERNAL_H_
