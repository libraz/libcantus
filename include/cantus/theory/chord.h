/**
 * @file chord.h
 * @brief Public C++ API of ts/src/theory/chord: chord qualities, the structural chord spec, and
 *        building and reading chords.
 *
 * A Chord is a root pitch class plus semitone offsets; its quality is the name that fits the
 * offsets, or the nearest one inside them. A ChordSpec names a chord by its parts instead, so a
 * combination no quality covers still has exact intervals. Root, bass and offsets are doubles
 * because a chord built by a caller is only required to be finite there.
 */
#ifndef CANTUS_THEORY_CHORD_H_
#define CANTUS_THEORY_CHORD_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/limits.h"
#include "cantus/core/nullable.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Chord quality names, in the canonical order of QUALITY_SPECS (`ChordQuality`). */
enum class ChordQuality : std::uint8_t {
  kMaj,
  kMin,
  kDim,
  kAug,
  kMajB5,
  kMaj7,
  kMin7,
  kDom7,
  kDim7,
  kM7b5,
  kMinMaj7,
  kMinMaj9,
  kMinMaj11,
  kMinMaj13,
  kAug7,
  kAugMaj7,
  k6,
  kMin6,
  k6_9,
  kSus2,
  kSus4,
  kAdd9,
  kAdd11,
  kMaj9,
  kMin9,
  kDom9,
  k7b9,
  k7s9,
  k7s11,
  k7b13,
  k11,
  k13,
  k5,
  k7sus4,
  k7b5,
  k7alt,
  k13b9,
  kMaj13,
  kMaj7s11,
  kMin11,
  kMin13,
  kMinAdd9,
  kMin6_9,
};

/** The TS name of a quality ("maj", ..., "6/9", "min6/9"). */
std::string_view to_string(ChordQuality quality);

/** The quality named `name`, or nullopt. */
std::optional<ChordQuality> parse_chord_quality(std::string_view name);

/** The triad (or dyad) a chord is built on (`ChordBase`). */
enum class ChordBase : std::uint8_t { kMaj, kMin, kDim, kAug, kSus2, kSus4, kPower };

/** The TS name of a base ("maj", ..., "power"). */
std::string_view to_string(ChordBase base);

/** The base named `name`, or nullopt. */
std::optional<ChordBase> parse_chord_base(std::string_view name);

/** The seventh stacked over a base (`ChordSeventh`). */
enum class ChordSeventh : std::uint8_t { kMaj7, kMin7, kDim7 };

/** The TS name of a seventh ("maj7", "min7", "dim7"). */
std::string_view to_string(ChordSeventh seventh);

/** The seventh named `name`, or nullopt. */
std::optional<ChordSeventh> parse_chord_seventh(std::string_view name);

/** One altered degree: which one (5, 9, 11 or 13), and by how much (-1, 0 or 1). */
struct Alteration {
  int degree = 5;
  /** A double so that a -0 the caller wrote reads back as written. */
  double alter = 0;
};

/** A chord as its parts (`ChordSpec`). */
struct ChordSpec {
  double rootPc = 0;
  ChordBase base = ChordBase::kMaj;
  std::optional<ChordSeventh> seventh;
  std::vector<Alteration> alterations;
  /** Degrees added without a seventh: 6, 9, 11 or 13. */
  std::vector<int> additions;
  /** Degrees left out: 1, 3 or 5. */
  std::vector<int> omissions;
  std::optional<double> bassPc;
};

/** A bare spelled pitch used as an enharmonic hint (`PitchSpelling`). */
struct PitchSpelling {
  double letter = 0;
  double alter = 0;
};

/** A chord as a root pitch class plus semitone offsets (`Chord`). */
struct Chord {
  double rootPc = 0;
  ChordQuality quality = ChordQuality::kMaj;
  std::vector<double> intervals;
  std::optional<double> bassPc;
  std::optional<PitchSpelling> rootSpelling;
  std::optional<PitchSpelling> bassSpelling;
  /** One spelling per entry of `intervals`, for chords whose letters stacking thirds misses. */
  std::optional<std::vector<PitchSpelling>> toneSpellings;
};

/** A chord positioned in time (`ChordSpan`). */
struct ChordSpan {
  double rootPc = 0;
  ChordQuality quality = ChordQuality::kMaj;
  double startBeat = 0;
  std::optional<double> bassPc;
  /** Semitone offsets for a chord the quality cannot name exactly. */
  std::optional<std::vector<double>> intervals;
  /** 1-based scale degree of the chord root, when known. */
  std::optional<double> degree;
  /** True when the chord is a secondary dominant tonicizing another degree. */
  std::optional<bool> secondaryDominant;
};

/** A chord occupying the half-open beat span `[startBeat, endBeat)` (`ChordSegment`). */
struct ChordSegment {
  double startBeat = 0;
  double endBeat = 0;
  Chord chord;
};

/** The basic role a chord tone plays (`ChordToneRole`). */
enum class ChordToneRole : std::uint8_t { kRoot, kThird, kFifth, kSixth, kSeventh };

/** The TS name of a role ("root", "third", "fifth", "sixth", "seventh"). */
std::string_view to_string(ChordToneRole role);

/** The role named `name`, or nullopt. */
std::optional<ChordToneRole> parse_chord_tone_role(std::string_view name);

/** Options of chord_pitch_classes(). */
struct ChordPitchClassOptions {
  /** Set false to omit a slash bass. */
  std::optional<bool> includeBass;
};

/** Every chord quality, in declaration order (`chordQualities`). */
std::vector<ChordQuality> chord_qualities();

/**
 * A chord rooted on a diatonic scale degree, with the quality's template (`chordFromDegree`).
 * @throws InvalidInputError if `degree` is not an integer in [1, 1000].
 */
Chord chord_from_degree(double degree, ChordQuality ext, const KeyArg& key);

/**
 * A chord from a root pitch class and quality (`makeChord`).
 * @throws InvalidInputError if the root or bass is not finite.
 */
Chord make_chord(double root_pc, ChordQuality quality,
                 std::optional<double> bass_pc = std::nullopt);

/** A chord from a spec; its quality is the name that fits, or the nearest (`chordFromSpec`). */
Chord chord_from_spec(const ChordSpec& spec);

/** Read a chord structurally, from its tones (`chordSpecOf`). */
ChordSpec chord_spec_of(const Chord& chord);

/** The semitone offsets above the root a spec sounds, ascending (`chordSpecIntervals`). */
std::vector<double> chord_spec_intervals(const ChordSpec& spec);

/** The quality name a spec is reported under (`chordSpecQuality`). */
ChordQuality chord_spec_quality(const ChordSpec& spec);

/**
 * Read a span as a chord (`chordFromSpan`).
 * @throws InvalidInputError if its root, bass or intervals are invalid.
 */
Chord chord_from_span(const ChordSpan& span);

/** Place a chord at a beat; the template is kept only when it is custom (`spanFromChord`). */
ChordSpan span_from_chord(const Chord& chord, double start_beat);

/** Transpose a chord, dropping its spelling hints (`transposeChord`). */
Chord transpose_chord(const Chord& chord, double semitones);

/** The sorted pitch classes of a chord, slash bass included unless asked (`chordPitchClasses`). */
std::vector<int> chord_pitch_classes(const Chord& chord, const ChordPitchClassOptions& opts = {});

/** A pitch's interval class above the chord root (`intervalAboveRoot`). */
int interval_above_root(double pitch, const Chord& chord);

/** Whether a pitch is one of a chord's tones, ignoring octave (`isChordMember`). */
bool is_chord_member(double pitch, const Chord& chord);

/** No sounding harmony: no pitch is a member (`isChordMember` with null). */
inline bool is_chord_member(double /*pitch*/, std::nullptr_t /*chord*/) { return false; }

/** A pitch's harmonic role within a chord, or null for a tension (`chordToneRole`). */
Nullable<ChordToneRole> chord_tone_role(double pitch, const Chord& chord);

/**
 * The diatonic triad on a scale degree, by stacking scale thirds (`diatonicTriad`).
 * @throws InvalidInputError if the scale is not heptatonic.
 */
Chord diatonic_triad(double degree, const KeyArg& key);

/** The diatonic seventh chord on a scale degree (`diatonicSeventh`). */
Chord diatonic_seventh(double degree, const KeyArg& key);

}  // namespace cantus

#endif  // CANTUS_THEORY_CHORD_H_
