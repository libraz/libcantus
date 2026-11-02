#include "cantus/model/arrangement.h"

#include <algorithm>
#include <limits>
#include <string>
#include <utility>

#include "analyze/arrange/internal.h"
#include "analyze/reference/profile.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "model/shared.h"

namespace cantus {

namespace {

/** `Number.MIN_VALUE`. */

/** A track's notes checked and copied, in the order they were given (`copyNotes`). */
std::vector<NoteEvent> copy_notes(const std::vector<NoteEvent>& notes, const std::string& name,
                                  std::optional<double> budget) {
  NoteEventAssertOptions options;
  options.allowNonPositiveDuration = true;
  options.budget = budget;
  std::vector<NoteEvent> out;
  assert_note_events(notes, name, options);
  for (const NoteEvent& note : notes) {
    out.push_back(copy_note_event(note));
  }
  return out;
}

/** Defensive copy of one track, its notes checked as they are copied (`copyTrack`). */
ArrangementTrack copy_track(const ArrangementTrack& track, std::size_t index,
                            std::optional<double> budget) {
  ArrangementTrack copy;
  copy.notes = copy_notes(track.notes, "tracks[" + index_text(index) + "].notes", budget);
  copy.name = track.name;
  copy.role = track.role;
  return copy;
}

/** Defensive copy of the settings, with every part validated (`copySettings`). */
std::optional<ArrangementSettings> copy_settings(const std::optional<ArrangementSettings>& given,
                                                 const std::vector<ArrangementTrack>& tracks) {
  if (!given) {
    return std::nullopt;
  }
  const ArrangementSettings& settings = *given;
  ArrangementSettings copy;
  bool named = false;
  ResolveMetersOptions meter_options;
  if (settings.ts) {
    meter_options.ts = MeterArg(*settings.ts);
  }
  if (settings.meters) {
    meter_options.meters = MeterArg(*settings.meters);
  }
  MeterMap meters = resolve_meters(meter_options, "arrangement meters");
  if (settings.ts) {
    copy.ts = to_meter_data(MeterArg(*settings.ts), "arrangement ts");
    named = true;
  }
  if (settings.meters) {
    copy.meters = meters;
    named = true;
  }
  if (settings.key) {
    copy.key = resolve_key(KeyArg(*settings.key));
    named = true;
  }
  if (settings.keys) {
    // Validated and copied by the class that owns the shape.
    copy.keys = Timeline(TimelineData{{}, 0, settings.keys, std::nullopt}).keys();
    named = true;
  }
  if (settings.timeline) {
    copy.timeline = Timeline(TimelineData{*settings.timeline, span_end(*settings.timeline),
                                          std::nullopt, std::nullopt})
                        .segments();
    named = true;
  }
  if (settings.harmonyTracks) {
    std::vector<double> harmony;
    for (std::size_t index = 0; index < settings.harmonyTracks->size(); ++index) {
      harmony.push_back(assert_integer((*settings.harmonyTracks)[index],
                                       "arrangement harmonyTracks[" + index_text(index) + "]", 0,
                                       static_cast<double>(tracks.size()) - 1));
    }
    copy.harmonyTracks = std::move(harmony);
    // A percussion track states no harmony, which the analysis refuses too.
    harmony_track_set(copy.harmonyTracks, tracks, "arrangement harmonyTracks");
    named = true;
  }
  if (settings.minSeverity) {
    copy.minSeverity = assert_integer(*settings.minSeverity, "arrangement minSeverity",
                                      static_cast<double>(NoteSafety::kSafe),
                                      static_cast<double>(NoteSafety::kDissonant));
    named = true;
  }
  if (settings.pickupBeats) {
    copy.pickupBeats =
        assert_range(*settings.pickupBeats, 0, kMaxSafeInteger, "arrangement pickupBeats");
    // A note before the declared pickup is one the analysis refuses, under the same name.
    NoteEventAssertOptions onsets;
    onsets.allowNonPositiveDuration = true;
    onsets.minStartBeat = -*copy.pickupBeats;
    onsets.budget = settings.budget;
    assert_track_notes(tracks, onsets);
    named = true;
  }
  if (settings.harmonicRhythm) {
    copy.harmonicRhythm = assert_range(*settings.harmonicRhythm, kMinValue, kMaxSafeInteger,
                                       "arrangement harmonicRhythm");
    named = true;
  }
  if (settings.profile) {
    copy.profile = settings.profile;
    named = true;
  }
  if (settings.budget) {
    copy.budget = assert_positive_int(*settings.budget, "arrangement budget", kMaxSafeInteger);
    named = true;
  }
  if (!named) {
    return std::nullopt;
  }
  return copy;
}

/** Defensive copy of plain arrangement data, with every part validated (`copyArrangement`). */
ArrangementData copy_arrangement(const ArrangementData& data) {
  std::optional<double> budget = data.settings ? data.settings->budget : std::nullopt;
  ArrangementData copy;
  for (std::size_t index = 0; index < data.tracks.size(); ++index) {
    copy.tracks.push_back(copy_track(data.tracks[index], index, budget));
  }
  copy.settings = copy_settings(data.settings, copy.tracks);
  return copy;
}

/** The settings a caller's setup describes, in the plain form data carries (`settingsFrom`). */
std::optional<ArrangementSettings> settings_from(const std::optional<ArrangementSetup>& given) {
  if (!given) {
    return std::nullopt;
  }
  const ArrangementSetup& setup = *given;
  ArrangementSettings settings;
  settings.keys = setup.keys;
  settings.harmonyTracks = setup.harmonyTracks;
  settings.minSeverity = setup.minSeverity;
  if (setup.ts) {
    settings.ts = to_meter_data(*setup.ts, "ts");
  }
  settings.pickupBeats = setup.pickupBeats;
  settings.harmonicRhythm = setup.harmonicRhythm;
  settings.profile = setup.profile;
  settings.budget = setup.budget;
  if (setup.key) {
    settings.key = resolve_key(*setup.key);
  }
  if (setup.meters) {
    ResolveMetersOptions options;
    options.meters = setup.meters;
    settings.meters = resolve_meters(options, "arrangement meters");
  }
  if (setup.timeline) {
    settings.timeline = setup.timeline->segments;
  }
  return settings;
}

/** A caller's setup as the analysis functions take it (`analysisOptionsOf`). */
TensionOptions analysis_options_of(const std::optional<ArrangementSetup>& given,
                                   std::optional<double> step = std::nullopt) {
  TensionOptions opts;
  if (!given) {
    return opts;
  }
  const ArrangementSetup& setup = *given;
  opts.keys = setup.keys;
  opts.timeline = setup.timeline;
  opts.harmonyTracks = setup.harmonyTracks;
  opts.minSeverity = setup.minSeverity;
  opts.ts = setup.ts;
  opts.pickupBeats = setup.pickupBeats;
  opts.harmonicRhythm = setup.harmonicRhythm;
  opts.profile = setup.profile;
  opts.budget = setup.budget;
  opts.step = step;
  if (setup.key) {
    opts.key = KeyArg(resolve_key(*setup.key));
  }
  if (setup.meters) {
    ResolveMetersOptions options;
    options.meters = setup.meters;
    opts.meters = MeterArg(resolve_meters(options, "arrangement meters"));
  }
  return opts;
}

/** `{...mine, ...theirs}` over the fields a caller named. */
template <class T>
void lay_over(std::optional<T>& mine, const std::optional<T>& theirs) {
  if (theirs) {
    mine = theirs;
  }
}

//--------------------------------------------------------------------------------------------
// samePlain over the plain data

bool same(double a, double b) { return a == b; }
bool same(const std::string& a, const std::string& b) { return a == b; }
template <class E, std::enable_if_t<std::is_enum_v<E>, int> = 0>
bool same(E a, E b) {
  return a == b;
}
bool same(const PitchSpelling& a, const PitchSpelling& b) {
  return a.letter == b.letter && a.alter == b.alter;
}
bool same(const NoteData& a, const NoteData& b) {
  return a.letter == b.letter && a.alter == b.alter && a.octave == b.octave;
}
bool same(const KeyScale& a, const KeyScale& b) {
  return a.rootPc == b.rootPc && a.modeMask12 == b.modeMask12;
}
bool same(const ResolvedKey& a, const ResolvedKey& b) {
  return same(a.scale, b.scale) && same(a.tonic, b.tonic) && a.variant == b.variant;
}
bool same(int a, int b);
bool same(const Chord& a, const Chord& b);
bool same(const ChordSegment& a, const ChordSegment& b);
bool same(const PivotChord& a, const PivotChord& b);
bool same(const KeyRegion& a, const KeyRegion& b);
bool same(const NoteEvent& a, const NoteEvent& b);
bool same(const TimeSignature& a, const TimeSignature& b);
bool same(const MeterChange& a, const MeterChange& b);
bool same(const MeterData& a, const MeterData& b);
bool same(const ArrangementTrack& a, const ArrangementTrack& b);
bool same(const ArrangementSettings& a, const ArrangementSettings& b);
template <class T>
bool same(const std::optional<T>& a, const std::optional<T>& b);
template <class T>
bool same(const std::vector<T>& a, const std::vector<T>& b) {
  if (a.size() != b.size()) {
    return false;
  }
  for (std::size_t i = 0; i < a.size(); ++i) {
    if (!same(a[i], b[i])) {
      return false;
    }
  }
  return true;
}
template <class T>
bool same(const std::optional<T>& a, const std::optional<T>& b) {
  if (!a || !b) {
    return !a && !b;
  }
  return same(*a, *b);
}
bool same(const Chord& a, const Chord& b) {
  return a.rootPc == b.rootPc && a.quality == b.quality && same(a.intervals, b.intervals) &&
         same(a.bassPc, b.bassPc) && same(a.rootSpelling, b.rootSpelling) &&
         same(a.bassSpelling, b.bassSpelling) && same(a.toneSpellings, b.toneSpellings);
}
bool same(const ChordSegment& a, const ChordSegment& b) {
  return a.startBeat == b.startBeat && a.endBeat == b.endBeat && same(a.chord, b.chord);
}
bool same(const PivotChord& a, const PivotChord& b) {
  return same(a.chord, b.chord) && a.romanFrom == b.romanFrom && a.romanTo == b.romanTo;
}
bool same(const KeyRegion& a, const KeyRegion& b) {
  return a.startBeat == b.startBeat && a.endBeat == b.endBeat && same(a.key, b.key) &&
         a.confidence == b.confidence && same(a.modulation, b.modulation) && same(a.pivot, b.pivot);
}
bool same(const NoteEvent& a, const NoteEvent& b) {
  return a.pitch == b.pitch && a.startBeat == b.startBeat && a.durationBeat == b.durationBeat &&
         same(a.velocity, b.velocity) && same(a.articulation, b.articulation);
}
bool same(int a, int b) { return a == b; }
bool same(const TimeSignature& a, const TimeSignature& b) {
  return a.numerator == b.numerator && a.denominator == b.denominator &&
         same(a.grouping, b.grouping);
}
bool same(const MeterChange& a, const MeterChange& b) {
  return a.startBeat == b.startBeat && same(a.ts, b.ts);
}
bool same(const MeterData& a, const MeterData& b) {
  if (a.index() != b.index()) {
    return false;
  }
  if (const auto* ts = std::get_if<TimeSignature>(&a)) {
    return same(*ts, std::get<TimeSignature>(b));
  }
  return same(std::get<MeterMap>(a), std::get<MeterMap>(b));
}
bool same(const ArrangementTrack& a, const ArrangementTrack& b) {
  return same(a.notes, b.notes) && same(a.name, b.name) && same(a.role, b.role);
}
bool same(const ArrangementSettings& a, const ArrangementSettings& b) {
  return same(a.key, b.key) && same(a.keys, b.keys) && same(a.timeline, b.timeline) &&
         same(a.harmonyTracks, b.harmonyTracks) && same(a.minSeverity, b.minSeverity) &&
         same(a.ts, b.ts) && same(a.meters, b.meters) && same(a.pickupBeats, b.pickupBeats) &&
         same(a.harmonicRhythm, b.harmonicRhythm) && same(a.profile, b.profile) &&
         same(a.budget, b.budget);
}

}  // namespace

Arrangement::Arrangement(const ArrangementData& data) : data_(copy_arrangement(data)) {}

Arrangement Arrangement::of(const std::vector<ArrangementTrack>& tracks,
                            const std::optional<ArrangementSetup>& opts) {
  return Arrangement(ArrangementData{tracks, settings_from(opts)});
}

Arrangement Arrangement::from_data(const ArrangementData& data) { return Arrangement(data); }

Arrangement Arrangement::from_json(const ArrangementData& data) { return Arrangement(data); }

ArrangementOptions Arrangement::analysis_options() const {
  ArrangementOptions opts;
  if (!data_.settings) {
    return opts;
  }
  const ArrangementSettings& settings = *data_.settings;
  if (settings.key) {
    opts.key = KeyArg(*settings.key);
  }
  opts.keys = settings.keys;
  if (settings.timeline) {
    opts.timeline = Timeline(TimelineData{*settings.timeline, span_end(*settings.timeline),
                                          std::nullopt, std::nullopt})
                        .chord_timeline();
  }
  opts.harmonyTracks = settings.harmonyTracks;
  opts.minSeverity = settings.minSeverity;
  if (settings.ts) {
    opts.ts = MeterArg(*settings.ts);
  }
  if (settings.meters) {
    opts.meters = MeterArg(*settings.meters);
  }
  opts.pickupBeats = settings.pickupBeats;
  opts.harmonicRhythm = settings.harmonicRhythm;
  opts.profile = settings.profile;
  opts.budget = settings.budget;
  return opts;
}

ArrangementSession Arrangement::session() const {
  return create_arrangement_session(data_.tracks, analysis_options());
}

namespace {

/** The arrangement's own options with a caller's laid over them (`#layered`). */
TensionOptions layered(const ArrangementOptions& mine, const TensionOptions& theirs) {
  TensionOptions out;
  static_cast<ArrangementOptions&>(out) = mine;
  if (theirs.ts || theirs.meters) {
    // A meter named by the caller replaces the arrangement's rather than joining it.
    out.ts.reset();
    out.meters.reset();
  }
  lay_over(out.key, theirs.key);
  lay_over(out.keys, theirs.keys);
  lay_over(out.timeline, theirs.timeline);
  lay_over(out.harmonyTracks, theirs.harmonyTracks);
  lay_over(out.minSeverity, theirs.minSeverity);
  lay_over(out.ts, theirs.ts);
  lay_over(out.meters, theirs.meters);
  lay_over(out.pickupBeats, theirs.pickupBeats);
  lay_over(out.harmonicRhythm, theirs.harmonicRhythm);
  lay_over(out.profile, theirs.profile);
  lay_over(out.budget, theirs.budget);
  out.step = theirs.step;
  return out;
}

}  // namespace

ArrangementAnalysis Arrangement::analysis() const {
  ArrangementAnalysis analysis = session().analysis();
  analysis.timeline = timeline().chord_timeline();
  return analysis;
}

std::vector<Conflict> Arrangement::conflicts() const { return session().analysis().conflicts; }

std::optional<Score> Arrangement::track(std::string_view name) const {
  ArrangementSession open = session();
  const std::vector<TrackAnalysis>& tracks = open.analysis().tracks;
  auto found = std::find_if(tracks.begin(), tracks.end(),
                            [name](const TrackAnalysis& track) { return track.name == name; });
  if (found == tracks.end()) {
    return std::nullopt;
  }
  auto index = static_cast<std::size_t>(found - tracks.begin());
  if (index >= data_.tracks.size()) {
    return std::nullopt;
  }
  ScoreOptions opts;
  if (data_.settings && data_.settings->meters) {
    opts.meters = MeterArg(*data_.settings->meters);
  } else if (data_.settings && data_.settings->ts) {
    opts.meters = MeterArg(*data_.settings->ts);
  }
  if (data_.settings && data_.settings->key) {
    opts.key = KeyArg(*data_.settings->key);
  }
  return Score::of(data_.tracks[index].notes, opts);
}

Arrangement Arrangement::update(const std::vector<TrackEdit>& edits) const {
  std::optional<double> budget = data_.settings ? data_.settings->budget : std::nullopt;
  std::vector<TrackEdit> copied;
  for (std::size_t index = 0; index < edits.size(); ++index) {
    copied.push_back(TrackEdit{
        edits[index].trackIndex,
        copy_notes(edits[index].notes, "edits[" + index_text(index) + "].notes", budget)});
  }
  ArrangementSession next = session().update(copied);
  return Arrangement(ArrangementData{next.tracks(), data_.settings});
}

std::vector<TensionPoint> Arrangement::tension(
    const std::optional<ArrangementTensionOptions>& opts) const {
  TensionOptions theirs =
      opts ? analysis_options_of(ArrangementSetup(*opts), opts->step) : TensionOptions{};
  ArrangementSession open = session();
  return tension_curve_from(data_.tracks, open.analysis(), layered(analysis_options(), theirs));
}

ArrangementAnalysis Arrangement::analyze(const std::optional<ArrangementSetup>& opts) const {
  return analyze_arrangement(data_.tracks, layered(analysis_options(), analysis_options_of(opts)));
}

Timeline Arrangement::timeline() const {
  ArrangementAnalysis analysis = session().analysis();
  // The analysis reports where the chords and the keys end, so the span is read back off them.
  TimelineData data{analysis.timeline.segments, span_end(analysis.timeline.segments, analysis.keys),
                    analysis.keys, std::nullopt};
  return Timeline::from_data(data);
}

ReferenceProfile Arrangement::reference(std::optional<double> budget) const {
  const std::optional<std::vector<double>> harmony_tracks =
      data_.settings ? data_.settings->harmonyTracks : std::nullopt;
  std::vector<NoteEvent> harmony;
  std::vector<NoteEvent> melody;
  for (std::size_t index = 0; index < data_.tracks.size(); ++index) {
    const ArrangementTrack& track = data_.tracks[index];
    bool listed = !harmony_tracks || std::find(harmony_tracks->begin(), harmony_tracks->end(),
                                               static_cast<double>(index)) != harmony_tracks->end();
    if (track.role != TrackRole::kDrums && listed) {
      harmony.insert(harmony.end(), track.notes.begin(), track.notes.end());
    }
    if (track.role == TrackRole::kMelody) {
      melody.insert(melody.end(), track.notes.begin(), track.notes.end());
    }
  }
  ArrangementAnalysis analysis = session().analysis();
  ReferenceProfileOptions opts;
  // The meter the arrangement's own analysis reads, `ts` included.
  if (data_.settings && data_.settings->meters) {
    opts.meters = MeterArg(*data_.settings->meters);
  } else if (data_.settings && data_.settings->ts) {
    opts.meters = MeterArg(*data_.settings->ts);
  }
  opts.totalBeats = timeline().total_beats();
  if (!melody.empty()) {
    opts.melody = std::move(melody);
  }
  opts.budget = budget;
  ReferenceReadings readings{analysis.timeline, analysis.keys, analysis.prevailingKey};
  return reference_from_readings(harmony, readings, opts);
}

bool Arrangement::equals(const Arrangement& other) const {
  return same(data_.tracks, other.data_.tracks) && same(data_.settings, other.data_.settings);
}

}  // namespace cantus
