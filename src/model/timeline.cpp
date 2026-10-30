#include "cantus/model/timeline.h"

#include <limits>
#include <utility>

#include "analyze/keys/keys.h"
#include "analyze/timeline/timeline.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "model/limits.gen.h"
#include "model/shared.h"

namespace cantus {

namespace {

/** `Number.MIN_VALUE`. */
constexpr double kMinValue = std::numeric_limits<double>::denorm_min();

/** A validated, defensive copy of one chord segment (`copySegment`). */
ChordSegment copy_segment(const ChordSegment& segment) {
  ChordSegment copy;
  copy.startBeat = assert_finite_number(segment.startBeat, "timeline segment startBeat");
  copy.endBeat = assert_finite_number(segment.endBeat, "timeline segment endBeat");
  copy.chord = ChordValue(segment.chord).to_json();
  return copy;
}

/** The per-segment confidences, one per segment (`copyConfidence`). */
std::vector<double> copy_confidence(const std::optional<std::vector<double>>& confidence,
                                    std::size_t segments) {
  if (!confidence) {
    return {};
  }
  if (confidence->size() != segments) {
    throw InvalidInputError(
        "timeline segmentConfidence must hold one value per segment; received " +
        js::to_string(static_cast<double>(confidence->size())) + " for " +
        js::to_string(static_cast<double>(segments)));
  }
  std::vector<double> out;
  for (std::size_t index = 0; index < confidence->size(); ++index) {
    out.push_back(assert_range((*confidence)[index], 0, 1,
                               "timeline segmentConfidence[" + index_text(index) + "]"));
  }
  return out;
}

/** Reject a timeline whose segments or key regions a reader cannot search (`validateTimeline`). */
void validate_timeline(const std::vector<ChordSegment>& segments,
                       const std::vector<KeyRegion>& keys) {
  assert_spans_in_order(segments, "timeline segments");
  assert_spans_in_order(keys, "timeline keys");
}

/** The part of a span inside `[from_beat, to_beat)`, or nothing (`clipSpan`). */
template <class T>
std::optional<T> clip_span(const T& span, double from_beat, double to_beat) {
  double start = js::max(span.startBeat, from_beat);
  double end = js::min(span.endBeat, to_beat);
  if (!(end > start)) {
    return std::nullopt;
  }
  T out = span;
  out.startBeat = start;
  out.endBeat = end;
  return out;
}

}  // namespace

KeyRegion copy_key_region(const KeyRegion& region) {
  KeyRegion copy;
  copy.startBeat = assert_finite_number(region.startBeat, "key region startBeat");
  copy.endBeat = assert_finite_number(region.endBeat, "key region endBeat");
  // Read through the key itself, so a tonic that does not spell the root is refused here.
  copy.key = key_identity(to_key(region.key));
  copy.confidence = assert_finite_number(region.confidence, "key region confidence");
  copy.modulation = region.modulation;
  if (region.pivot) {
    copy.pivot = PivotChord{ChordValue(region.pivot->chord).to_json(), region.pivot->romanFrom,
                            region.pivot->romanTo};
  }
  return copy;
}

Timeline::Timeline(const TimelineData& data) {
  for (const ChordSegment& segment : data.segments) {
    segments_.push_back(copy_segment(segment));
  }
  total_beats_ = assert_range(data.totalBeats, 0, kMaxSafeInteger, "timeline totalBeats");
  if (data.keys) {
    for (const KeyRegion& region : *data.keys) {
      keys_.push_back(copy_key_region(region));
    }
  }
  segment_confidence_ = copy_confidence(data.segmentConfidence, segments_.size());
  validate_timeline(segments_, keys_);
}

Timeline Timeline::from_chords(const std::vector<ChordSpan>& spans, double total_beats,
                               const std::optional<KeyArg>& key) {
  ChordTimeline timeline = chord_timeline_from_chords(spans, total_beats);
  TimelineData data{timeline.segments, total_beats, std::nullopt, std::nullopt};
  if (key) {
    ResolvedKey stated = key_identity(to_key(*key));
    // The region starts where the music does, so a chord in a pickup is covered by its key.
    data.keys = timeline.segments.empty()
                    ? std::vector<KeyRegion>{}
                    : stated_key_regions(stated, timeline.segments.front().startBeat, total_beats);
  }
  return Timeline(data);
}

Timeline Timeline::from_notes(const std::vector<NoteEvent>& notes,
                              const ChordTimelineOptions& opts) {
  ChordTimelineResult result = chord_timeline_from_notes(notes, opts);
  // The analysis reports where the chords and the keys end, so the span is read back off them.
  double total =
      opts.totalBeats ? *opts.totalBeats : span_end(result.timeline.segments, result.keys);
  return Timeline(
      TimelineData{result.timeline.segments, total, result.keys, result.segmentConfidence});
}

Timeline Timeline::from_progression(const Progression& progression, double beats_each) {
  assert_range(beats_each, kMinValue, kMaxSafeInteger, "timeline beatsEach");
  std::vector<ChordSpan> spans;
  const std::vector<ChordValue>& chords = progression.chords();
  for (std::size_t index = 0; index < chords.size(); ++index) {
    spans.push_back(chords[index].span(static_cast<double>(index) * beats_each));
  }
  double total = static_cast<double>(chords.size()) * beats_each;
  std::optional<KeyArg> key;
  if (progression.key()) {
    key = KeyArg(*progression.key());
  }
  return from_chords(spans, total, key);
}

Timeline Timeline::from_data(const TimelineData& data) { return Timeline(data); }

Timeline Timeline::from_json(const TimelineData& data) { return Timeline(data); }

ResolvedKey Timeline::prevailing_key() const {
  Nullable<ResolvedKey> prevailing = prevailing_key_of(keys_);
  if (!prevailing) {
    throw InvalidInputError(
        "timeline carries no key; build it from notes, or pass a key to Timeline.fromChords");
  }
  return *prevailing;
}

ResolvedKey Timeline::resolved_key_at(double beat) const {
  return KeyLookup(keys_, prevailing_key())(beat);
}

Nullable<ChordValue> Timeline::at(double beat) const {
  Nullable<Chord> chord = chord_at_beat(segments_, beat);
  if (!chord) {
    return std::nullopt;
  }
  Nullable<ResolvedKey> prevailing = prevailing_key_of(keys_);
  if (!prevailing) {
    return ChordValue(*chord);
  }
  return ChordValue(*chord, KeyArg(to_key(KeyLookup(keys_, *prevailing)(beat))));
}

std::optional<Key> Timeline::key() const {
  Nullable<ResolvedKey> prevailing = prevailing_key_of(keys_);
  if (!prevailing) {
    return std::nullopt;
  }
  return to_key(*prevailing);
}

Progression Timeline::progression() const {
  std::vector<ChordValue> chords;
  for (const ChordSegment& segment : segments_) {
    chords.emplace_back(segment.chord);
  }
  std::optional<Key> prevailing = key();
  std::optional<KeyArg> carried;
  if (prevailing) {
    carried = KeyArg(*prevailing);
  }
  return Progression(chords, carried);
}

std::vector<ReducedChord> Timeline::reduce(const ReduceProgressionOptions& opts) const {
  ResolvedKey fallback = prevailing_key();
  std::vector<KeyRegion> regions = keys_;
  KeyAtBeat key_at = [regions, fallback](double beat) {
    return scale_of(KeyLookup(regions, fallback)(beat));
  };
  return reduce_progression(chord_timeline(), key_at, opts);
}

std::vector<CadenceHit> Timeline::cadences() const {
  ResolvedKey fallback = prevailing_key();
  std::vector<KeyRegion> regions = keys_;
  KeyAtBeat key_at = [regions, fallback](double beat) {
    return scale_of(KeyLookup(regions, fallback)(beat));
  };
  return detect_cadences(chord_timeline(), key_at);
}

std::vector<KeyRegion> Timeline::modulations(const KeyTimelineOptions& opts) const {
  KeyTimelineOptions asked = opts;
  if (!asked.totalBeats) {
    asked.totalBeats = total_beats_;
  }
  std::vector<KeyRegion> out;
  for (const KeyRegion& region : detect_modulations(segments_, asked)) {
    out.push_back(copy_key_region(region));
  }
  return out;
}

std::vector<TimelineRoman> Timeline::roman(const std::optional<KeyArg>& key,
                                           const ChordToRomanOptions& opts) const {
  // The key a caller names travels whole: a numeral is written from the degrees the key spells.
  std::optional<ResolvedKey> given;
  if (key) {
    given = resolve_key(*key);
  }
  std::optional<ResolvedKey> fallback;
  if (!given) {
    fallback = prevailing_key();
  }
  std::vector<TimelineRoman> out;
  for (const ChordSegment& segment : segments_) {
    ResolvedKey at = given ? *given : KeyLookup(keys_, *fallback)(segment.startBeat);
    out.push_back(
        TimelineRoman{segment.startBeat, segment.endBeat, chord_to_roman(segment.chord, at, opts)});
  }
  return out;
}

Timeline Timeline::slice(double from_beat, double to_beat) const {
  assert_finite_number(from_beat, "timeline slice fromBeat");
  assert_finite_number(to_beat, "timeline slice toBeat");
  if (to_beat < from_beat) {
    throw InvalidInputError("timeline slice toBeat must not precede fromBeat; received [" +
                            js::to_string(from_beat) + ", " + js::to_string(to_beat) + ")");
  }
  TimelineData data;
  std::vector<double> confidence;
  for (std::size_t index = 0; index < segments_.size(); ++index) {
    if (std::optional<ChordSegment> clipped = clip_span(segments_[index], from_beat, to_beat)) {
      data.segments.push_back(*clipped);
      // The confidences travel with the segments they describe.
      if (!segment_confidence_.empty()) {
        confidence.push_back(segment_confidence_[index]);
      }
    }
  }
  data.totalBeats = js::max(0.0, js::min(to_beat, total_beats_));
  std::vector<KeyRegion> regions;
  for (const KeyRegion& region : keys_) {
    if (std::optional<KeyRegion> clipped = clip_span(region, from_beat, to_beat)) {
      regions.push_back(*clipped);
    }
  }
  data.keys = std::move(regions);
  if (!segment_confidence_.empty()) {
    data.segmentConfidence = std::move(confidence);
  }
  return Timeline(data);
}

namespace {

/** Move every chord and every key region by the same step (`#moved`). */
template <class MoveChord, class MoveKey>
TimelineData moved_data(const std::vector<ChordSegment>& segments, double total,
                        const std::vector<KeyRegion>& keys, const std::vector<double>& confidence,
                        MoveChord&& move_chord, MoveKey&& move_key) {
  TimelineData data;
  for (const ChordSegment& segment : segments) {
    data.segments.push_back(ChordSegment{segment.startBeat, segment.endBeat,
                                         move_chord(ChordValue(segment.chord)).to_json()});
  }
  data.totalBeats = total;
  std::vector<KeyRegion> regions;
  for (const KeyRegion& region : keys) {
    KeyRegion moved = region;
    moved.key = key_identity(move_key(to_key(region.key)));
    if (region.pivot) {
      // The numerals a pivot carries are degrees, so they survive the move.
      moved.pivot->chord = move_chord(ChordValue(region.pivot->chord)).to_json();
    }
    regions.push_back(std::move(moved));
  }
  data.keys = std::move(regions);
  if (!confidence.empty()) {
    data.segmentConfidence = confidence;
  }
  return data;
}

}  // namespace

Timeline Timeline::transpose(double semitones) const {
  return Timeline(moved_data(
      segments_, total_beats_, keys_, segment_confidence_,
      [semitones](const ChordValue& chord) { return chord.transpose(semitones); },
      [semitones](const Key& key) { return key.transpose(semitones); }));
}

Timeline Timeline::transpose_by(const IntervalArg& interval) const {
  return Timeline(moved_data(
      segments_, total_beats_, keys_, segment_confidence_,
      [&interval](const ChordValue& chord) { return chord.transpose_by(interval); },
      [&interval](const Key& key) { return key.transpose_by(interval); }));
}

bool Timeline::equals(const Timeline& other) const {
  if (other.total_beats() != total_beats_ || other.length() != segments_.size()) {
    return false;
  }
  for (std::size_t index = 0; index < segments_.size(); ++index) {
    const ChordSegment& mine = segments_[index];
    const ChordSegment& yours = other.segments()[index];
    if (mine.startBeat != yours.startBeat || mine.endBeat != yours.endBeat ||
        !ChordValue(mine.chord).equals(ChordValue(yours.chord))) {
      return false;
    }
  }
  return true;
}

TimelineData Timeline::data() const {
  TimelineData data{segments_, total_beats_, std::nullopt, std::nullopt};
  // Omitted rather than written as an empty list, so a keyless timeline is the segments alone.
  if (!keys_.empty()) {
    data.keys = keys_;
  }
  if (!segment_confidence_.empty()) {
    data.segmentConfidence = segment_confidence_;
  }
  return data;
}

}  // namespace cantus
