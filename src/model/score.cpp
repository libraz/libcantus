#include "cantus/model/score.h"

#include <limits>
#include <map>
#include <utility>

#include "analyze/form/hypermeter.h"
#include "analyze/form/phrase.h"
#include "analyze/keys/keys.h"
#include "analyze/reference/profile.h"
#include "analyze/timeline/timeline.h"
#include "cantus/analyze/arrange.h"
#include "cantus/core/validation.h"
#include "core/tempo/tempo.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "model/limits.gen.h"
#include "model/shared.h"

namespace cantus {

namespace {

/** `Number.MIN_VALUE`. */
constexpr double kMinValue = std::numeric_limits<double>::denorm_min();

/** The note-event check a score holds its notes to: zero-length notes are accepted. */
NoteEventAssertOptions score_note_options() {
  NoteEventAssertOptions options;
  options.allowNonPositiveDuration = true;
  return options;
}

/** The notes checked and copied, in time order, ties broken by pitch (`orderNotes`). */
std::vector<NoteEvent> order_notes(const std::vector<NoteEvent>& notes, std::string_view name) {
  std::vector<NoteEvent> out;
  assert_note_events(notes, name, score_note_options());
  for (const NoteEvent& note : notes) {
    out.push_back(copy_note_event(note));
  }
  std::stable_sort(out.begin(), out.end(), [](const NoteEvent& a, const NoteEvent& b) {
    double order = a.startBeat - b.startBeat;
    if (order == 0) {
      order = a.pitch - b.pitch;
    }
    if (order == 0) {
      order = a.durationBeat - b.durationBeat;
    }
    return order < 0;
  });
  return out;
}

/** A defensive copy of a meter map, signatures copied entry by entry (`copyMeters`). */
MeterMap copy_meters(const MeterMap& meters) {
  MeterMap out;
  for (const MeterChange& change : meters) {
    MeterChange copy;
    copy.startBeat = without_negative_zero(change.startBeat);
    copy.ts.numerator = change.ts.numerator;
    copy.ts.denominator = change.ts.denominator;
    if (change.ts.grouping) {
      copy.ts.grouping = change.ts.grouping;
    }
    out.push_back(copy);
  }
  return out;
}

/** A defensive copy of a tempo map, validated by reading it at its origin (`copyTempo`). */
TempoMap copy_tempo(const TempoMap& tempo) {
  tempo_at(0, tempo);
  TempoMap out;
  for (const TempoEvent& event : tempo) {
    out.push_back(TempoEvent{without_negative_zero(event.startBeat), event.bpm});
  }
  return out;
}

/** The meter map a meter names, as every score entry point resolves it. */
MeterMap resolved_meters(const std::optional<MeterArg>& meters) {
  ResolveMetersOptions opts;
  opts.meters = meters;
  return resolve_meters(opts, "score meters");
}

/** A defensive copy of plain score data, every part validated (`copyScore`). */
ScoreData copy_score(const ScoreData& data) {
  ScoreData copy;
  copy.notes = order_notes(data.notes, "score notes");
  copy.meters = copy_meters(resolved_meters(MeterArg(data.meters)));
  copy.tempo = copy_tempo(data.tempo);
  if (data.key) {
    copy.key = Key::from_json(*data.key).to_json();
  }
  return copy;
}

/** The tempo map a ScoreOptions tempo names (`tempoFrom`). */
TempoMap tempo_from(const std::optional<ScoreTempoArg>& tempo) {
  if (!tempo) {
    return TempoMap{TempoEvent{0, SCORE_DEFAULT_BPM}};
  }
  if (const auto* bpm = std::get_if<double>(&*tempo)) {
    return TempoMap{TempoEvent{0, *bpm}};
  }
  return std::get<TempoMap>(*tempo);
}

/** The one region a stated key describes, from where the music starts (`scoreKeyRegions`). */
std::vector<KeyRegion> score_key_regions(const Key& key, const std::vector<NoteEvent>& notes,
                                         double total_beats) {
  if (notes.empty()) {
    return {};
  }
  return stated_key_regions(key_identity(key), notes.front().startBeat, total_beats);
}

/** The plain data a set of notes and a context describe (`scoreData`). */
ScoreData score_data(const std::vector<NoteEvent>& notes, const ScoreOptions& opts) {
  ScoreData data;
  data.notes = notes;
  data.meters = resolved_meters(opts.meters);
  data.tempo = tempo_from(opts.tempo);
  if (opts.key) {
    // Read through the resolver that keeps a spelled tonic and a scale form.
    data.key = to_key(*opts.key).to_json();
  }
  return data;
}

/** A pitch moved by `semitones`, held to the bound the score's note check applies. */
int moved_pitch(int pitch, double semitones, std::size_t index) {
  return static_cast<int>(
      assert_midi_pitch(pitch + semitones, "score notes[" + index_text(index) + "].pitch"));
}

}  // namespace

Score::Score(const ScoreData& data) : data_(copy_score(data)) {
  if (data_.key) {
    key_ = Key::from_json(*data_.key);
  }
}

Score Score::of(const std::vector<NoteEvent>& notes, const ScoreOptions& opts) {
  return Score(score_data(notes, opts));
}

Score Score::empty(const ScoreOptions& opts) { return Score(score_data({}, opts)); }

Score Score::from_ticks(const std::vector<NoteEvent>& events, int ppq, const ScoreOptions& opts) {
  std::vector<NoteEvent> notes;
  for (const NoteEvent& event : events) {
    NoteEvent note = event;
    note.startBeat = ticks_to_beats(event.startBeat, ppq);
    note.durationBeat = ticks_to_beats(event.durationBeat, ppq);
    notes.push_back(note);
  }
  return Score(score_data(notes, opts));
}

Score Score::from_data(const ScoreData& data) { return Score(data); }

Score Score::from_json(const ScoreData& data) { return Score(data); }

double Score::total_beats() const {
  double end = 0;
  for (const NoteEvent& note : data_.notes) {
    end = js::max(end, note.startBeat + note.durationBeat);
  }
  return end;
}

Score Score::with_notes(std::vector<NoteEvent> notes) const {
  ScoreData data = data_;
  data.notes = std::move(notes);
  return Score(data);
}

Score Score::moved(std::vector<NoteEvent> notes,
                   const std::function<Key(const Key&)>& move_key) const {
  ScoreData data = data_;
  data.notes = std::move(notes);
  if (key_) {
    data.key = move_key(*key_).to_json();
  }
  return Score(data);
}

Score Score::slice(double from_beat, double to_beat) const {
  assert_finite_number(from_beat, "slice fromBeat");
  assert_finite_number(to_beat, "slice toBeat");
  std::vector<NoteEvent> kept;
  for (const NoteEvent& note : data_.notes) {
    if (note.startBeat >= from_beat && note.startBeat < to_beat) {
      kept.push_back(note);
    }
  }
  return with_notes(std::move(kept));
}

Score Score::filter(const std::function<bool(const NoteEvent&, std::size_t)>& predicate) const {
  std::vector<NoteEvent> kept;
  for (std::size_t index = 0; index < data_.notes.size(); ++index) {
    if (predicate(copy_note_event(data_.notes[index]), index)) {
      kept.push_back(data_.notes[index]);
    }
  }
  return with_notes(std::move(kept));
}

Score Score::map(const std::function<NoteEvent(const NoteEvent&, std::size_t)>& fn) const {
  std::vector<NoteEvent> mapped;
  for (std::size_t index = 0; index < data_.notes.size(); ++index) {
    mapped.push_back(fn(copy_note_event(data_.notes[index]), index));
  }
  return with_notes(std::move(mapped));
}

Score Score::concat(const Score& other) const { return concat(other.notes()); }

Score Score::concat(const std::vector<NoteEvent>& notes) const {
  std::vector<NoteEvent> joined = data_.notes;
  joined.insert(joined.end(), notes.begin(), notes.end());
  return with_notes(std::move(joined));
}

Score Score::shift(double beats) const {
  assert_finite_number(beats, "shift beats");
  std::vector<NoteEvent> notes = data_.notes;
  for (NoteEvent& note : notes) {
    note.startBeat += beats;
  }
  return with_notes(std::move(notes));
}

Score Score::transpose(double semitones) const {
  assert_finite_number(semitones, "transpose semitones");
  std::vector<NoteEvent> notes = data_.notes;
  for (std::size_t index = 0; index < notes.size(); ++index) {
    notes[index].pitch = moved_pitch(notes[index].pitch, semitones, index);
  }
  return moved(std::move(notes), [semitones](const Key& key) { return key.transpose(semitones); });
}

Score Score::transpose_by(const IntervalArg& interval) const {
  SpelledInterval step = to_spelled_interval(interval);
  std::vector<NoteEvent> notes = data_.notes;
  for (std::size_t index = 0; index < notes.size(); ++index) {
    notes[index].pitch = moved_pitch(notes[index].pitch, step.semitones, index);
  }
  // Moved by the interval rather than by its semitone count, so the key keeps its spelling.
  return moved(std::move(notes), [&step](const Key& key) { return key.transpose_by(step); });
}

Score Score::with_meters(const MeterArg& meters) const {
  ScoreData data = data_;
  data.meters = resolved_meters(meters);
  return Score(data);
}

Score Score::with_tempo(const ScoreTempoArg& tempo) const {
  ScoreData data = data_;
  data.tempo = tempo_from(tempo);
  return Score(data);
}

Score Score::with_key(const KeyArg& key) const {
  ScoreData data = data_;
  data.key = to_key(key).to_json();
  return Score(data);
}

Score Score::quantize(double grid) const {
  assert_range(grid, kMinValue, kMaxSafeInteger, "quantize grid");
  std::vector<NoteEvent> notes = data_.notes;
  for (NoteEvent& note : notes) {
    note.startBeat = js::round(note.startBeat / grid) * grid;
    note.durationBeat = js::max(1.0, js::round(note.durationBeat / grid)) * grid;
  }
  return with_notes(std::move(notes));
}

Score Score::humanize(const HumanizeOptions& opts) const {
  HumanizeOptions asked = opts;
  if (!asked.ts) {
    asked.ts = MeterArg(data_.meters);
  }
  return with_notes(cantus::humanize(data_.notes, asked));
}

Score Score::ornament(const OrnamentOptions& opts) const {
  OrnamentOptions asked = opts;
  if (!asked.ts) {
    asked.ts = MeterArg(data_.meters);
  }
  return with_notes(cantus::ornament(data_.notes, asked));
}

Score Score::groove(const GrooveTemplate& groove_template) const {
  return with_notes(apply_groove_template(data_.notes, groove_template, MeterArg(data_.meters)));
}

GrooveTemplate Score::groove_template(std::optional<int> subdivision) const {
  return extract_groove_template(data_.notes, MeterArg(data_.meters), subdivision);
}

ChordTimelineOptions Score::analysis_options(const ChordTimelineOptions& opts) const {
  ChordTimelineOptions asked = opts;
  if (!asked.meters) {
    asked.meters = MeterArg(data_.meters);
  }
  if (!asked.key && key_) {
    asked.key = KeyArg(key_identity(*key_));
  }
  return asked;
}

ChordTimelineResult Score::chord_analysis() const {
  return chord_timeline_from_notes(data_.notes, analysis_options());
}

std::vector<KeyRegion> Score::key_regions() const {
  if (key_) {
    return score_key_regions(*key_, data_.notes, total_beats());
  }
  KeyTimelineOptions opts;
  opts.meters = MeterArg(data_.meters);
  return key_timeline_from_notes(data_.notes, opts);
}

Timeline Score::timeline(const std::optional<ChordTimelineOptions>& opts) const {
  ChordTimelineResult result =
      opts ? chord_timeline_from_notes(data_.notes, analysis_options(*opts)) : chord_analysis();
  double total = opts && opts->totalBeats ? *opts->totalBeats : total_beats();
  return Timeline::from_data(
      TimelineData{result.timeline.segments, total, result.keys, result.segmentConfidence});
}

std::optional<Key> Score::key() const {
  if (key_) {
    return key_;
  }
  Nullable<ResolvedKey> prevailing = prevailing_key_of(key_regions());
  if (!prevailing) {
    return std::nullopt;
  }
  return to_key(*prevailing);
}

std::vector<KeyRegion> Score::keys(const std::optional<KeyTimelineOptions>& opts) const {
  if (opts) {
    // A score told its key answers with that key across the whole of it.
    if (key_) {
      // Held to the bound the search holds it to, so the region's end is a beat.
      double total = opts->totalBeats ? assert_range(*opts->totalBeats, 0, kMaxSafeInteger,
                                                     "key timeline totalBeats")
                                      : total_beats();
      return score_key_regions(*key_, data_.notes, total);
    }
    KeyTimelineOptions asked = *opts;
    if (!asked.meters) {
      asked.meters = MeterArg(data_.meters);
    }
    return key_timeline_from_notes(data_.notes, asked);
  }
  std::vector<KeyRegion> out;
  for (const KeyRegion& region : key_regions()) {
    out.push_back(copy_key_region(region));
  }
  return out;
}

std::vector<DetectedKeyMatch> Score::detect_keys(const DetectKeyFromNotesOptions& opts) const {
  std::vector<DetectedKeyMatch> out;
  for (const KeyMatch& match : detect_key_from_notes(data_.notes, opts)) {
    out.push_back(detected_key_match(match));
  }
  return out;
}

std::vector<Phrase> Score::phrases(const PhraseOptions& opts) const {
  ChordTimeline timeline = chord_analysis().timeline;
  PhraseOptions asked = opts;
  if (!asked.meters) {
    asked.meters = MeterArg(data_.meters);
  }
  if (!asked.key && key_) {
    asked.key = KeyContext(KeyArg(key_identity(*key_)));
  }
  return phrases_from_timeline(timeline, data_.notes, asked);
}

std::vector<StructuralCadence> Score::structural_cadences(const PhraseOptions& opts) const {
  return cantus::structural_cadences(phrases(opts));
}

std::vector<FormSection> Score::sections(const FormSectionOptions& opts) const {
  FormSectionOptions asked = opts;
  if (!asked.meters) {
    asked.meters = MeterArg(data_.meters);
  }
  return sections_from_notes(data_.notes, asked);
}

KeyContext Score::key_context(const std::optional<KeyArg>& key) const {
  // One key travels whole; a key that changes over the piece is read per beat as its scale.
  if (key) {
    return KeyContext(KeyArg(key_identity(to_key(*key))));
  }
  if (key_) {
    return KeyContext(KeyArg(key_identity(*key_)));
  }
  std::vector<KeyRegion> regions = key_regions();
  Nullable<ResolvedKey> found = prevailing_key_of(regions);
  ResolvedKey prevailing = found ? *found : key_identity(Key::major("C"));
  return KeyContext(KeyAtBeat([regions, prevailing](double beat) {
    return scale_of(KeyLookup(regions, prevailing)(beat));
  }));
}

Hypermeter Score::hypermeter(const HypermeterOptions& opts) const {
  if (opts.cadenceBeats) {
    return cantus::hypermeter(data_.notes, MeterArg(data_.meters), opts);
  }
  // The score's own cadences, as the spans their arrival chords sound through, read in the key
  // phrases() reads them in: the carried key, or the keys the chords modulate through.
  return hypermeter_over(data_.notes, MeterArg(data_.meters), opts, [&] {
    ChordTimeline timeline = chord_analysis().timeline;
    KeyContext key = key_ ? KeyContext(KeyArg(key_identity(*key_))) : [&] {
      KeyTimelineOptions key_options;
      key_options.meters = MeterArg(data_.meters);
      key_options.budget = opts.budget;
      return KeyContext(modulation_key_at(detect_modulations(timeline.segments, key_options)));
    }();
    return boundary_cadences(timeline, key).spans;
  });
}

std::vector<MotifData> Score::motifs(const ExtractMotifsOptions& opts) const {
  return extract_motifs(data_.notes, opts);
}

MelodicContour Score::contour() const { return melodic_contour(data_.notes); }

ReferenceProfile Score::reference(const std::optional<ReferenceProfileOptions>& opts) const {
  ReferenceProfileOptions asked = opts ? *opts : ReferenceProfileOptions{};
  if (!asked.meters) {
    asked.meters = MeterArg(data_.meters);
  }
  if (!asked.totalBeats) {
    asked.totalBeats = total_beats();
  }
  if (!asked.key && key_) {
    asked.key = KeyArg(key_identity(*key_));
  }
  if (opts && opts->timeline) {
    return analyze_reference(data_.notes, asked);
  }
  ChordTimelineResult analysis = chord_analysis();
  ReferenceReadings readings{analysis.timeline, analysis.keys, analysis.prevailingKey};
  return reference_from_readings(data_.notes, readings, asked);
}

RhythmAnalysis Score::rhythm(const RhythmAnalysisOptions& opts) const {
  RhythmAnalysisOptions asked = opts;
  if (!asked.meters) {
    asked.meters = MeterArg(data_.meters);
  }
  if (!asked.totalBeats) {
    asked.totalBeats = total_beats();
  }
  return analyze_rhythm(data_.notes, asked);
}

MotifGraph Score::motif_graph(const MotifGraphOptions& graph,
                              const ExtractMotifsOptions& motifs) const {
  std::vector<MotifData> found = extract_motifs(data_.notes, motifs);
  MotifGraphOptions asked = graph;
  if (!asked.key) {
    if (std::optional<Key> prevailing = key()) {
      asked.key = KeyArg(*prevailing);
    }
  }
  return cantus::motif_graph(data_.notes, found, asked);
}

CompositionEvaluation Score::evaluate(const CompositionPlan& plan,
                                      const EvaluateCompositionOptions& opts) const {
  return evaluate_composition(data_.notes, plan, opts);
}

std::vector<AnalyzedNote> Score::voices(const std::optional<KeyArg>& key) const {
  ChordTimeline timeline = chord_analysis().timeline;
  KeyContext context = key_context(key);
  return analyze_polyphony(
      data_.notes, [&timeline](double beat) { return timeline.at(beat); }, context);
}

std::vector<IdentifiedVoiceNote> Score::voice_notes() const { return to_voice_notes(data_.notes); }

PlayabilityReport Score::playability(const InstrumentProfileArg& instrument) const {
  InstrumentProfile profile = to_instrument_profile(instrument);
  const TempoMap& tempo = data_.tempo;
  double opening = tempo_at(0, tempo);
  if (tempo.size() < 2) {
    // One marking governs the whole score, so there is nothing to integrate.
    return cantus::playability(data_.notes, profile, opening);
  }
  // Each onset is restated as the beat it would fall on at the opening tempo throughout, which
  // keeps the elapsed seconds between any two notes what the map says.
  TempoReader played(tempo);
  TempoReader evenly(TempoMap{TempoEvent{0, opening}});
  auto restate = [&](double beat) { return evenly.beat_at(played.seconds_at(beat)); };
  std::map<double, double> score_beats;
  std::vector<NoteEvent> paced;
  for (const NoteEvent& note : data_.notes) {
    NoteEvent copy = note;
    copy.startBeat = restate(note.startBeat);
    score_beats[copy.startBeat == 0 ? 0 : copy.startBeat] = note.startBeat;
    copy.durationBeat = restate(note.startBeat + note.durationBeat) - copy.startBeat;
    paced.push_back(copy);
  }
  PlayabilityReport report = cantus::playability(paced, profile, opening);
  for (PlayabilityIssue& issue : report.issues) {
    auto found = score_beats.find(issue.startBeat == 0 ? 0 : issue.startBeat);
    if (found != score_beats.end()) {
      issue.startBeat = found->second;
    }
  }
  return report;
}

NoteEventIndex Score::index(const NoteEventIndexOptions& opts) const {
  NoteEventIndexOptions asked = opts;
  if (!asked.allowNonPositiveDuration) {
    asked.allowNonPositiveDuration = true;
  }
  if (!asked.name) {
    asked.name = "score notes";
  }
  return create_note_event_index(data_.notes, asked);
}

double Score::seconds_at(double beat) const { return beats_to_seconds(beat, data_.tempo); }

BarPosition Score::bar_at(double beat) const {
  return beat_to_bar_position(beat, MeterArg(data_.meters));
}

TimeSignature Score::meter_at(double beat) const {
  return cantus::meter_at(beat, MeterArg(data_.meters));
}

std::vector<NoteEvent> Score::to_ticks(int ppq) const {
  std::vector<NoteEvent> out = data_.notes;
  for (NoteEvent& note : out) {
    note.startBeat = beats_to_ticks(note.startBeat, ppq);
    note.durationBeat = beats_to_ticks(note.durationBeat, ppq);
  }
  return out;
}

namespace {

bool same_note(const NoteEvent& a, const NoteEvent& b) {
  return a.pitch == b.pitch && a.startBeat == b.startBeat && a.durationBeat == b.durationBeat &&
         a.velocity == b.velocity && a.articulation == b.articulation;
}

bool same_meter(const MeterChange& a, const MeterChange& b) {
  std::vector<int> mine = a.ts.grouping.value_or(std::vector<int>{});
  std::vector<int> theirs = b.ts.grouping.value_or(std::vector<int>{});
  return a.startBeat == b.startBeat && a.ts.numerator == b.ts.numerator &&
         a.ts.denominator == b.ts.denominator && mine == theirs;
}

bool same_key(const std::optional<ResolvedKey>& a, const std::optional<ResolvedKey>& b) {
  if (!a || !b) {
    return a.has_value() == b.has_value();
  }
  return Key::from_json(*a).equals(Key::from_json(*b));
}

}  // namespace

bool Score::equals(const Score& other) const {
  const ScoreData& theirs = other.data_;
  if (data_.notes.size() != theirs.notes.size() || data_.meters.size() != theirs.meters.size() ||
      data_.tempo.size() != theirs.tempo.size()) {
    return false;
  }
  for (std::size_t index = 0; index < data_.notes.size(); ++index) {
    if (!same_note(data_.notes[index], theirs.notes[index])) {
      return false;
    }
  }
  for (std::size_t index = 0; index < data_.meters.size(); ++index) {
    if (!same_meter(data_.meters[index], theirs.meters[index])) {
      return false;
    }
  }
  for (std::size_t index = 0; index < data_.tempo.size(); ++index) {
    if (data_.tempo[index].startBeat != theirs.tempo[index].startBeat ||
        data_.tempo[index].bpm != theirs.tempo[index].bpm) {
      return false;
    }
  }
  return same_key(data_.key, theirs.key);
}

}  // namespace cantus
