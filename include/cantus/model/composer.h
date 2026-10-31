/**
 * @file composer.h
 * @brief Public C++ API of ts/src/model/composer.ts: the settings a piece is generated under,
 *        held in one place and handed to every part.
 *
 * A caller-held positional source is a live handle rather than a setting: it is held by
 * reference, carried across with() and its siblings, compared by identity, and left out of
 * data().
 */
#ifndef CANTUS_MODEL_COMPOSER_H_
#define CANTUS_MODEL_COMPOSER_H_

#include <any>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "cantus/analyze/reference.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/instrument.h"
#include "cantus/core/meter.h"
#include "cantus/core/random.h"
#include "cantus/generate/bass.h"
#include "cantus/generate/context.h"
#include "cantus/generate/countermelody.h"
#include "cantus/generate/drums.h"
#include "cantus/generate/harmonize.h"
#include "cantus/generate/melody.h"
#include "cantus/generate/plan.h"
#include "cantus/generate/progression.h"
#include "cantus/generate/vocabulary.h"
#include "cantus/model/score.h"
#include "cantus/model/timeline.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** The settings a composer holds and hands to every generator it drives (`ComposerOptions`). */
struct ComposerOptions {
  /** The key the parts are written in. */
  std::optional<KeyArg> key;
  /** The meter, as one time signature or a map of changes; 4/4 when absent. */
  std::optional<MeterArg> meters;
  /** Tempo in quarter-note beats per minute. */
  std::optional<double> bpm;
  /** The seed every part's own stream is derived from; 0 when absent. */
  std::optional<std::uint32_t> seed;
  /** The complexity dials. */
  std::optional<Complexity> complexity;
  /** The instrument each named part is written for. */
  std::optional<std::map<std::string, InstrumentProfileArg>> instruments;
  /** Extra material the generators may draw from. */
  std::optional<std::vector<Vocabulary<std::any>>> vocabulary;
  /** The algorithm version the parts are generated under; this build's when absent. */
  std::optional<std::int64_t> algorithmVersion;
  /** Draw from this source instead of one derived from `seed`. */
  std::optional<PositionalDraw> rng;
};

/** The plain settings a composer hands back (`Composer#data`): resolved, without the source. */
struct ComposerData {
  MeterMap meters;
  std::optional<ResolvedKey> key;
  std::optional<double> bpm;
  std::uint32_t seed = 0;
  std::uint32_t algorithmVersion = 0;
  std::optional<Complexity> complexity;
  std::optional<std::map<std::string, InstrumentProfile>> instruments;
  std::optional<std::vector<Vocabulary<std::any>>> vocabulary;
};

/** How a progression is written: what ProgressionOptions asks for but the composer's settings. */
struct ComposerProgressionOptions {
  ProgStyle style = ProgStyle::kMinimal;
  int bars = 0;
  std::optional<std::string> presetId;
  std::optional<ProgressionPresetInput> preset;
  std::optional<ChordQuality> ext;
};

/** How a bass line is written (`BassLineSettings`): BassLineOptions but the composer's settings. */
struct BassLineSettings {
  std::optional<BassStyle> style;
  std::optional<double> octave;
  /** The instrument the line is written for; a stringed profile. */
  std::optional<InstrumentProfileArg> instrument;
  std::optional<double> budget;
};

/** How a counter line is written (`CounterMelodySettings`). */
struct CounterMelodySettings {
  /** The harmony to write against; wins over `chordAt` when both are given. */
  std::optional<ChordTimeline> timeline;
  std::function<Nullable<Chord>(double)> chordAt;
  std::optional<std::vector<double>> chordChangeBeats;
  std::optional<CounterRegister> register_;
  std::optional<CounterRhythm> rhythm;
  std::optional<SafetyProfile> profile;
  std::optional<ProfileWeightOverrides> weights;
  std::optional<double> pitchLow;
  std::optional<double> pitchHigh;
};

/** How a melody is harmonized: HarmonizeOptions but the melody and the composer's settings. */
struct ComposerHarmonizeOptions {
  std::optional<double> harmonicRhythm;
  std::optional<ReharmonizeStrength> reharmonize;
  std::optional<HarmonizePlacement> placement;
  std::optional<std::vector<double>> phraseEnds;
  std::optional<double> budget;
};

/** What a harmonization gives back: the chords, and the melody they fit (`HarmonizedMelody`). */
struct HarmonizedMelody {
  Timeline chords;
  /** The melody as the chords read it, moved into their key where the harmonizer moved it. */
  Score melody;
  /** How far the melody was moved, in semitones. */
  double transposeSemitones = 0;
};

/** The harmony a bass line follows: a timeline, or the chord segments one is made of. */
using BassSource = std::variant<Timeline, std::vector<BassSegment>>;

/** The settings a piece is generated under, held in one place (`Composer`). */
class Composer {
 public:
  /**
   * Wrap the settings a piece is generated under (`new Composer`); they are copied.
   * @throws InvalidInputError if the key names no key, the meter map is malformed, or the seed,
   *   tempo, dials, instruments or vocabulary carry a value the generators cannot hold.
   */
  explicit Composer(const ComposerOptions& options);

  /** Start from a set of settings (`Composer.of`). */
  static Composer of(const ComposerOptions& options);

  /** Rebuild a composer from its data() (`Composer.fromData`). */
  static Composer from_data(const ComposerData& data);

  /** Rebuild a composer from its to_json() (`Composer.fromJSON`). */
  static Composer from_json(const ComposerData& data);

  /** The same settings with the named ones replaced (`with`). */
  Composer with(const ComposerOptions& patch) const;

  /** The same settings in a different key (`withKey`). */
  Composer with_key(const KeyArg& key) const;

  /** The same settings from a different seed (`withSeed`). */
  Composer with_seed(std::uint32_t seed) const;

  /** The same settings at different complexity (`withComplexity`). */
  Composer with_complexity(const Complexity& complexity) const;

  /**
   * A chord progression, one chord per bar of the composer's meter (`progression`).
   * @throws InvalidInputError if the composer names no key or changes meter.
   */
  Timeline progression(const ComposerProgressionOptions& opts) const;

  /**
   * A drum part (`drums`); the options' meter and context are the composer's.
   * @throws InvalidInputError if the composer's meter is not 4/4 throughout.
   */
  Score drums(const DrumsOptions& opts) const;

  /**
   * A bass line under a harmony (`bass`).
   * @throws InvalidInputError if the composer names no key, or the instrument names a kit.
   */
  Score bass(const BassSource& source, const BassLineSettings& opts = {}) const;

  /**
   * A second line against a melody (`counterMelody`).
   * @throws InvalidInputError if the composer names no key.
   */
  Score counter_melody(const Score& melody, const CounterMelodySettings& opts = {}) const;

  /** Chords under a melody, with the melody the chords read (`harmonize`). */
  HarmonizedMelody harmonize(const Score& melody, const ComposerHarmonizeOptions& opts = {}) const;

  /**
   * A composition plan derived from a reference profile (`plan`); the context is the composer's.
   * @throws InvalidInputError if the composer draws from a caller-held source.
   */
  CompositionPlan plan(const ReferenceProfile& reference,
                       const CompositionPlanOptions& opts = {}) const;

  /** A melody written to a composition plan (`melody`), under the plan's seed. */
  Score melody(const CompositionPlan& plan, const MelodyOptions& opts = {}) const;

  /** Whether another composer would generate the same parts (`equals`). */
  bool equals(const Composer& other) const;

  /** The resolved context, for handing back to the function API (`context`). */
  GenerationContext context() const;

  /** The plain settings, without the source (`data`). */
  ComposerData data() const;

  /** The plain settings (`toJSON`). */
  ComposerData to_json() const { return data(); }

 private:
  /** The held settings in their copied, canonical form. */
  ComposerData settings_;
  /** The caller-held source, shared by every composer derived from this one. */
  std::shared_ptr<const PositionalDraw> rng_;

  /** The key a pitched part is written in. @throws InvalidInputError if there is none. */
  ResolvedKey require_key(const char* part) const;
  /** The one signature a part laid out in bars is written against. */
  TimeSignature unchanging_meter(const char* part) const;
  /** The context every score a composer hands back is read against. */
  ScoreOptions score_options(const std::optional<ResolvedKey>& key = std::nullopt) const;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_COMPOSER_H_
