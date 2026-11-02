// ts/src/analyze/reference/profile.ts: a piece read into a reference profile.

#include "analyze/reference/profile.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <utility>

#include "analyze/adjacency.h"
#include "analyze/form/internal.h"
#include "analyze/grid.h"
#include "analyze/keys/keys.h"
#include "analyze/melody/internal.h"
#include "analyze/reference/internal.h"
#include "analyze/rhythm/internal.h"
#include "analyze/timeline/timeline.h"
#include "cantus/analyze/form.h"
#include "cantus/analyze/functional.h"
#include "cantus/analyze/melody.h"
#include "cantus/analyze/reduction.h"
#include "cantus/analyze/rhythm.h"
#include "cantus/core/limits.h"
#include "cantus/core/meter.h"
#include "cantus/core/validation.h"
#include "cantus/theory/scale.h"
#include "core/validation/validation.h"
#include "js/math.h"

namespace cantus {

namespace {

struct Span {
  double startBeat = 0;
  double endBeat = 0;
};

/** The span every analysis is read over (`spanOf`). */
Span span_of(const std::vector<NoteEvent>& sounding, const ChordTimeline& timeline,
             const MeterMap& meters, std::optional<double> total_beats) {
  TimelineSpan extent = timeline_span(sounding, timeline.segments, meters);
  double start_beat = extent.startBeat;
  return Span{start_beat, js::max(start_beat, total_beats.value_or(extent.notesEnd))};
}

/** Whether two keys hold the same pitch classes. */
bool same_key(const ResolvedKey& a, const ResolvedKey& b) {
  return key_id(a.scale) == key_id(b.scale);
}

/** Index of the key region a chord is read against (`keyIndexAt`). */
std::size_t key_index_at(const std::vector<ReferenceKeyRegion>& regions, double beat,
                         const ResolvedKey& prevailing) {
  for (std::size_t i = 0; i < regions.size(); ++i) {
    if (regions[i].startBeat <= beat && beat < regions[i].endBeat) {
      return i;
    }
  }
  for (std::size_t i = 0; i < regions.size(); ++i) {
    if (same_key(regions[i].key, prevailing)) {
      return i;
    }
  }
  return 0;
}

/** Index of the section a beat falls in (`sectionAt`). */
Nullable<std::size_t> section_at(const std::vector<FormSection>& sections, double beat) {
  for (std::size_t i = 0; i < sections.size(); ++i) {
    if (within_beats(beat, sections[i].startBeat, sections[i].endBeat)) {
      return i;
    }
  }
  return std::nullopt;
}

std::vector<NoteEvent> sounding_of(const std::vector<NoteEvent>& notes,
                                   std::optional<double> budget) {
  NoteEventAssertOptions options;
  options.allowNonPositiveDuration = true;
  options.budget = budget;
  assert_note_events(notes, "reference notes", options);
  return drop_silent_notes(notes);
}

MeterMap meters_of(const ReferenceProfileOptions& opts) {
  ResolveMetersOptions asked;
  asked.ts = opts.ts;
  asked.meters = opts.meters;
  return resolve_meters(asked, "reference meters");
}

}  // namespace

ReferenceReadings readings_for(const std::vector<NoteEvent>& notes,
                               const ReferenceProfileOptions& opts) {
  MeterMap meters = meters_of(opts);
  if (!opts.timeline) {
    ChordTimelineOptions inferred;
    inferred.meters = meters;
    inferred.key = opts.key;
    inferred.totalBeats = opts.totalBeats;
    inferred.budget = opts.budget;
    ChordTimelineResult result = chord_timeline_from_notes(notes, inferred);
    return ReferenceReadings{std::move(result.timeline), std::move(result.keys),
                             std::move(result.prevailingKey)};
  }
  ChordTimeline timeline = assert_chord_timeline(*opts.timeline, "reference timeline");
  std::vector<KeyRegion> keys;
  if (!opts.key) {
    KeyTimelineOptions searched;
    searched.meters = meters;
    searched.totalBeats = opts.totalBeats;
    searched.budget = opts.budget;
    keys = key_timeline_from_notes(notes, searched);
  } else {
    // A stated key is taken as read across the span, as chord inference takes it.
    std::vector<NoteEvent> sounding = sounding_of(notes, opts.budget);
    Span span = span_of(sounding, timeline, meters, opts.totalBeats);
    keys = stated_key_regions(resolve_key(*opts.key), span.startBeat, span.endBeat);
  }
  ResolvedKey key = prevailing_key_or_default(keys);
  return ReferenceReadings{std::move(timeline), std::move(keys), std::move(key)};
}

ReferenceProfile reference_from_readings(const std::vector<NoteEvent>& notes,
                                         const ReferenceReadings& readings,
                                         const ReferenceProfileOptions& opts) {
  MeterMap meters = meters_of(opts);
  std::optional<double> budget = opts.budget;
  std::vector<NoteEvent> sounding = sounding_of(notes, budget);
  if (opts.totalBeats) {
    assert_range(*opts.totalBeats, 0, kMaxSafeInteger, "reference totalBeats");
  }
  std::vector<NoteEvent> line =
      ordered_notes(opts.melody ? *opts.melody : notes, "reference melody", budget);
  const ChordTimeline& timeline = readings.timeline;
  const ResolvedKey& prevailing = readings.prevailingKey;

  Span span = span_of(sounding, timeline, meters, opts.totalBeats);
  double span_end = span.endBeat;
  KeyLookup key_at(readings.keys, prevailing);
  KeyAtBeat scale_at = [&key_at](double beat) { return scale_of(key_at(beat)); };

  HypermeterOptions grouping_options;
  {
    std::vector<double> beats;
    for (const CadenceHit& hit : detect_cadences(timeline, KeyContext(scale_at))) {
      beats.push_back(hit.atBeat);
    }
    grouping_options.cadenceBeats = std::move(beats);
  }
  grouping_options.totalBeats = span_end;
  grouping_options.budget = budget;
  Hypermeter grouping = hypermeter(sounding, meters, grouping_options);
  PhraseOptions phrase_options;
  phrase_options.meters = meters;
  phrase_options.key = KeyContext(scale_at);
  phrase_options.hypermeter = grouping;
  phrase_options.totalBeats = span_end;
  phrase_options.budget = budget;
  std::vector<Phrase> phrases = phrases_from_timeline(timeline, notes, phrase_options);
  std::map<std::size_t, ReferenceCadence> cadences;
  for (const StructuralCadence& closing : structural_cadences(phrases)) {
    if (closing.cadence.type) {
      cadences[closing.phraseIndex] =
          ReferenceCadence{closing.atBeat, *closing.cadence.type, closing.weight};
    }
  }
  FormSectionOptions section_options;
  section_options.meters = meters;
  section_options.unitBars = grouping.groupBars;
  section_options.totalBeats = span_end;
  section_options.budget = budget;
  std::vector<FormSection> sections = sections_from_notes(notes, section_options);

  // A timeline with no key region under it is read in the prevailing key throughout.
  std::vector<ReferenceKeyRegion> keys;
  if (readings.keys.empty() && !timeline.segments.empty()) {
    keys.push_back(ReferenceKeyRegion{span.startBeat, span_end, resolve_key(prevailing), 0});
  } else {
    for (const KeyRegion& region : readings.keys) {
      keys.push_back(ReferenceKeyRegion{region.startBeat, region.endBeat, resolve_key(region.key),
                                        region.confidence});
    }
  }
  std::vector<ReferenceChord> chords;
  for (const ReducedChord& reduced : reduce_progression(timeline, KeyContext(scale_at))) {
    std::size_t index = key_index_at(keys, (reduced.startBeat + reduced.endBeat) / 2, prevailing);
    const ResolvedKey& key = keys[index].key;
    ReferenceChord chord;
    chord.startBeat = reduced.startBeat;
    chord.endBeat = reduced.endBeat;
    chord.key = index;
    chord.roman = chord_to_roman(reduced.chord, key);
    chord.function = function_of(reduced.chord, key);
    chord.level = reduced.level;
    chords.push_back(std::move(chord));
  }
  std::vector<NoteEvent> chord_onsets;
  for (const ChordSegment& segment : timeline.segments) {
    NoteEvent onset;
    onset.pitch = 60;
    onset.startBeat = segment.startBeat;
    onset.durationBeat = segment.endBeat - segment.startBeat;
    chord_onsets.push_back(onset);
  }
  RhythmAnalysisOptions rhythm_options;
  rhythm_options.meters = meters;
  rhythm_options.totalBeats = span_end;
  rhythm_options.budget = budget;
  RhythmAnalysis harmony_rhythm = analyze_rhythm(chord_onsets, rhythm_options);

  ExtractMotifsOptions motif_options;
  motif_options.budget = budget;
  std::vector<MotifData> motifs = extract_motifs(line, motif_options);
  MotifGraphOptions graph_options;
  graph_options.key = KeyArg(prevailing);
  graph_options.budget = budget;
  MotifGraph graph = motif_graph(line, motifs, graph_options);
  Nullable<ReferenceRegister> register_;
  if (!line.empty()) {
    int low = line.front().pitch;
    int high = line.front().pitch;
    for (const NoteEvent& note : line) {
      low = std::min<int>(low, note.pitch);
      high = std::max<int>(high, note.pitch);
    }
    register_ = ReferenceRegister{low, high, weighted_mean(line)};
  }
  double line_mean = register_ ? register_->mean : 0;
  std::vector<ReferenceMotif> reference_motifs;
  for (const MotifData& motif : motifs) {
    ReferenceMotif out;
    out.intervals = motif.intervals;
    out.rhythm = motif.rhythm;
    out.unitBeats =
        motif.notes.size() < 2 ? 0 : motif.notes[1].startBeat - motif.notes[0].startBeat;
    out.spanBeats = motif.occurrences.empty()
                        ? 0
                        : motif.occurrences[0].endBeat - motif.occurrences[0].startBeat;
    out.occurrences = static_cast<double>(motif.occurrences.size());
    reference_motifs.push_back(std::move(out));
  }

  std::vector<ReferencePhrase> reference_phrases;
  for (std::size_t index = 0; index < phrases.size(); ++index) {
    const Phrase& phrase = phrases[index];
    ReferencePhrase out;
    out.startBeat = phrase.startBeat;
    out.endBeat = phrase.endBeat;
    out.bars = bar_span_of(phrase.startBeat, phrase.endBeat, meters);
    out.section = section_at(sections, phrase.startBeat);
    out.confidence = phrase.confidence;
    auto cadence = cadences.find(index);
    if (cadence != cadences.end()) {
      out.cadence = cadence->second;
    }
    out.melody = phrase_melody(line, phrase.startBeat, phrase.endBeat, line_mean, meters, budget);
    for (std::size_t node = 0; node < graph.nodes.size(); ++node) {
      double start = graph.nodes[node].startBeat;
      if (within_beats(start, phrase.startBeat, phrase.endBeat)) {
        out.motifNodes.push_back(node);
      }
    }
    reference_phrases.push_back(std::move(out));
  }

  ReferenceProfile profile;
  profile.profileVersion = REFERENCE_PROFILE_VERSION;
  profile.span =
      ReferenceSpan{span.startBeat, span_end, bar_span_of(span.startBeat, span_end, meters)};
  profile.meters = meters;
  profile.form.hypermeter =
      ReferenceHypermeter{static_cast<double>(grouping.groupBars), grouping.confidence};
  profile.form.sections = std::move(sections);
  profile.form.phrases = std::move(reference_phrases);
  profile.harmony.keys = std::move(keys);
  profile.harmony.chords = std::move(chords);
  profile.harmony.rhythm = std::move(harmony_rhythm);
  profile.melody.register_ = register_;
  if (line.size() >= 2) {
    profile.melody.shape = melodic_contour(line).shape;
  }
  profile.melody.motifs = std::move(reference_motifs);
  profile.melody.graph = std::move(graph);
  profile.melody.rhythm = rhythm_over(line, rhythm_options, span.startBeat);
  return profile;
}

ReferenceProfile analyze_reference(const std::vector<NoteEvent>& notes,
                                   const ReferenceProfileOptions& opts) {
  return reference_from_readings(notes, readings_for(notes, opts), opts);
}

}  // namespace cantus
