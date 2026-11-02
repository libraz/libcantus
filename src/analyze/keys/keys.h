/**
 * @file keys.h
 * @brief Internal helpers of ts/src/analyze/keys/index.ts beside the public API in
 *        cantus/analyze/keys.h: the modulation search over chord beats whose chords are read on
 *        demand, the key lookup over a run of regions, and the choice of the prevailing key.
 */
#ifndef CANTUS_SRC_ANALYZE_KEYS_KEYS_H_
#define CANTUS_SRC_ANALYZE_KEYS_KEYS_H_

#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "analyze/detect/profiles.h"
#include "cantus/analyze/keys.h"
#include "cantus/analyze/voice.h"

namespace cantus {

/** The beats of one chord segment, as the modulation search reads them. */
struct SegmentBeats {
  double startBeat = 0;
  double endBeat = 0;
  /** Whether the segment sounds (`endBeat > startBeat` as the caller wrote the beats). */
  bool sounds = false;
  /**
   * Throws if the start beat is not a number; run when the search reads the beat of a segment that
   * follows another. Empty for a start written as a number.
   */
  std::function<void()> assert_start;
};

/** The beats of one chord segment an analysis of a timeline reads. */
struct SegmentSpan {
  double startBeat = 0;
  double endBeat = 0;
};

/** The beats of every segment of a chord timeline, in order. */
std::vector<SegmentSpan> spans_of(const std::vector<ChordSegment>& segments);

/** The chord of the segment at an index; called only for the segments the search keeps. */
using ChordSource = std::function<const Chord&(std::size_t)>;

/**
 * key_timeline_from_notes() with the profile resolved by `profile_source` at the point the
 * analysis first needs it (`opts.profile` is not read).
 */
std::vector<KeyRegion> key_timeline_over(const std::vector<NoteEvent>& notes,
                                         const KeyTimelineOptions& opts,
                                         const ProfileSource& profile_source);

/**
 * detect_modulations() over segment beats, reading each chord when the search first needs it, so a
 * caller holding chords in another form can read them lazily and in the order TS does; the
 * profile is resolved by `profile_source` (`opts.profile` is not read). When `first_segments` is
 * given, it receives for each region the index of the segment the region starts on.
 */
std::vector<KeyRegion> detect_modulations_over(const std::vector<SegmentBeats>& segments,
                                               const ChordSource& chord_at,
                                               const KeyTimelineOptions& opts,
                                               const ProfileSource& profile_source,
                                               std::vector<std::size_t>* first_segments = nullptr);

/**
 * attach_pivots() over segment beats, reading each chord when the search first needs it, so a
 * caller holding chords in another form can read them lazily and in the order TS does.
 */
void attach_pivots_over(std::vector<KeyRegion>& regions, const std::vector<SegmentSpan>& chords,
                        const ChordSource& chord_at);

/**
 * Name the chord each modulation between regions turned on, where the chords support one
 * (`attachPivots`); `chords` are every chord that sounded, in the order they were given.
 */
void attach_pivots(std::vector<KeyRegion>& regions, const std::vector<ChordSegment>& chords);

/**
 * The index of the key held longest, given the identity and held length of each region in order
 * (ties keep the earlier key, as `prevailingKeyOf` does).
 */
std::optional<std::size_t> prevailing_key_index(
    const std::vector<std::pair<std::string, double>>& regions);

/** prevailing_key_of(), or C major when there are no regions (`prevailingKeyOrDefault`). */
ResolvedKey prevailing_key_or_default(const std::vector<KeyRegion>& regions);

/** Identity of a key by the pitch classes it holds (`keyId`). */
std::string key_id(const KeyScale& scale);

/**
 * The key in force at a beat over a run of regions in beat order, or `fallback` outside every
 * region (`keyLookup`). It refers to `regions`, which must outlive it.
 */
class KeyLookup {
 public:
  KeyLookup(const std::vector<KeyRegion>& regions, ResolvedKey fallback)
      : regions_(&regions), fallback_(std::move(fallback)) {}

  /** The key at `beat`. */
  const ResolvedKey& operator()(double beat) const;

 private:
  const std::vector<KeyRegion>* regions_;
  ResolvedKey fallback_;
};

/**
 * `KeyLookup(regions, fallback)` as a callback yielding the scale of the key in force at a beat.
 * It owns its copy of the regions.
 */
KeyAtBeat key_at_beat(std::vector<KeyRegion> regions, ResolvedKey fallback);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_KEYS_KEYS_H_
