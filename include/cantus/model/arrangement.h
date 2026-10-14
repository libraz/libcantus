/**
 * @file arrangement.h
 * @brief Public C++ API of ts/src/model/arrangement.ts: several named tracks read together, with
 *        the analysis of how they fit.
 *
 * The TS class keeps the analysis open across edits; an immutable C++ value makes the reading
 * again on each call, and update() runs it through an arrangement session so the edited
 * arrangement reports what a fresh one over the edited tracks reports.
 */
#ifndef CANTUS_MODEL_ARRANGEMENT_H_
#define CANTUS_MODEL_ARRANGEMENT_H_

#include <optional>
#include <string_view>
#include <vector>

#include "cantus/analyze/arrange.h"
#include "cantus/analyze/keys.h"
#include "cantus/analyze/reference.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/meter.h"
#include "cantus/model/score.h"
#include "cantus/model/timeline.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/safety.h"
#include "cantus/theory/scale.h"

namespace cantus {

/**
 * The options an arrangement is read under, in the plain form its data carries them
 * (`ArrangementSettings`): those of analyze_arrangement(), the harmony held as chord segments.
 */
struct ArrangementSettings {
  std::optional<ResolvedKey> key;
  std::optional<std::vector<KeyRegion>> keys;
  /** Chord segments to analyse against, instead of inferring the harmony from the notes. */
  std::optional<std::vector<ChordSegment>> timeline;
  std::optional<std::vector<double>> harmonyTracks;
  std::optional<double> minSeverity;
  /** One time signature, as it was named. */
  std::optional<MeterData> ts;
  /** The meter map. */
  std::optional<MeterMap> meters;
  std::optional<double> pickupBeats;
  std::optional<double> harmonicRhythm;
  std::optional<SafetyProfile> profile;
  std::optional<double> budget;
};

/** The plain form an Arrangement hands out and is rebuilt from (`ArrangementData`). */
struct ArrangementData {
  /** The tracks, in the order they were given. */
  std::vector<ArrangementTrack> tracks;
  /** The options the tracks are read under; absent when they are all defaults. */
  std::optional<ArrangementSettings> settings;
};

/**
 * How an arrangement is built (`ArrangementSetup`): the settings, with the key and the meter
 * named any way the library names one and the harmony given as a chord timeline.
 */
struct ArrangementSetup {
  std::optional<KeyArg> key;
  std::optional<std::vector<KeyRegion>> keys;
  std::optional<ChordTimeline> timeline;
  std::optional<std::vector<double>> harmonyTracks;
  std::optional<double> minSeverity;
  std::optional<MeterArg> ts;
  std::optional<MeterArg> meters;
  std::optional<double> pickupBeats;
  std::optional<double> harmonicRhythm;
  std::optional<SafetyProfile> profile;
  std::optional<double> budget;
};

/** How an arrangement's tension is sampled: its settings, plus the step. */
struct ArrangementTensionOptions : ArrangementSetup {
  /** Distance between samples in beats; one beat when absent. */
  std::optional<double> step;
};

/** Several named tracks read together, with the analysis of how they fit (`Arrangement`). */
class Arrangement {
 public:
  /**
   * Wrap plain arrangement data (`new Arrangement`); it is copied.
   * @throws InvalidInputError if a note, the meter, or one of the settings is invalid.
   */
  explicit Arrangement(const ArrangementData& data);

  /** Build an arrangement from tracks (`Arrangement.of`). */
  static Arrangement of(const std::vector<ArrangementTrack>& tracks,
                        const std::optional<ArrangementSetup>& opts = std::nullopt);

  /** Rebuild an arrangement from its data() (`Arrangement.fromData`). */
  static Arrangement from_data(const ArrangementData& data);

  /** Rebuild an arrangement from its to_json() (`Arrangement.fromJSON`). */
  static Arrangement from_json(const ArrangementData& data);

  /** The tracks as they were given, in that order (`tracks`). */
  const std::vector<ArrangementTrack>& tracks() const noexcept { return data_.tracks; }

  /** The reading of the whole arrangement (`analysis`). */
  ArrangementAnalysis analysis() const;

  /** The notes clashing with the harmony sounding beneath them (`conflicts`). */
  std::vector<Conflict> conflicts() const;

  /** One track's notes as a score, or absent when no track carries the name (`track`). */
  std::optional<Score> track(std::string_view name) const;

  /**
   * Re-analyse after replacing the notes of one or more tracks (`update`).
   * @throws InvalidInputError if an edit names no track or carries a note the analysis cannot
   *   read.
   */
  Arrangement update(const std::vector<TrackEdit>& edits) const;

  /** The harmonic tension across the arrangement, sampled at regular beats (`tension`). */
  std::vector<TensionPoint> tension(
      const std::optional<ArrangementTensionOptions>& opts = std::nullopt) const;

  /** The whole reading made afresh, under settings laid over the arrangement's own (`analyze`). */
  ArrangementAnalysis analyze(const std::optional<ArrangementSetup>& opts = std::nullopt) const;

  /** The harmony the tracks spell out together, in time (`timeline`). */
  Timeline timeline() const;

  /** The arrangement's structural fingerprint; only the budget is on offer (`reference`). */
  ReferenceProfile reference(std::optional<double> budget = std::nullopt) const;

  /** Whether another arrangement holds the same tracks under the same settings (`equals`). */
  bool equals(const Arrangement& other) const;

  /** The plain data (`data`). */
  ArrangementData data() const { return data_; }

  /** The plain data (`toJSON`). */
  ArrangementData to_json() const { return data_; }

 private:
  /** The stored settings as the options the analysis functions take. */
  ArrangementOptions analysis_options() const;
  /** The open reading of the tracks. */
  ArrangementSession session() const;

  ArrangementData data_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_ARRANGEMENT_H_
