/**
 * @file score.h
 * @brief Public C++ API of ts/src/model/score.ts: sounding notes with the meter, tempo and key
 *        that give them meaning.
 *
 * The notes are held in time order, ties broken by pitch, and their onsets are unbounded below:
 * beat 0 is the first downbeat, so a pickup sounds at a negative beat. The TS class keeps the
 * readings it infers for later members; an immutable C++ value recomputes them on each call.
 */
#ifndef CANTUS_MODEL_SCORE_H_
#define CANTUS_MODEL_SCORE_H_

#include <functional>
#include <optional>
#include <variant>
#include <vector>

#include "cantus/analyze/detect.h"
#include "cantus/analyze/form.h"
#include "cantus/analyze/keys.h"
#include "cantus/analyze/melody.h"
#include "cantus/analyze/reference.h"
#include "cantus/analyze/rhythm.h"
#include "cantus/analyze/timeline.h"
#include "cantus/analyze/voice.h"
#include "cantus/core/event_index.h"
#include "cantus/core/instrument.h"
#include "cantus/core/meter.h"
#include "cantus/core/pitch.h"
#include "cantus/core/tempo.h"
#include "cantus/core/types.h"
#include "cantus/generate/groove.h"
#include "cantus/generate/ornament.h"
#include "cantus/generate/plan.h"
#include "cantus/model/key.h"
#include "cantus/model/timeline.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** The plain form a Score hands out and is rebuilt from (`ScoreData`). */
struct ScoreData {
  std::vector<NoteEvent> notes;
  MeterMap meters;
  TempoMap tempo;
  /** The key the notes are read in, when one was given. */
  std::optional<ResolvedKey> key;
};

/** A tempo given as one bpm or as a map of changes. */
using ScoreTempoArg = std::variant<TempoMap, double>;

/** How a score is built: the context the notes are read against (`ScoreOptions`). */
struct ScoreOptions {
  /** One time signature or a map of changes; 4/4 when absent. */
  std::optional<MeterArg> meters;
  /** One bpm or a map of changes; 120 bpm when absent. */
  std::optional<ScoreTempoArg> tempo;
  /** The key the notes are read in, when it is already known. */
  std::optional<KeyArg> key;
};

/**
 * Sounding notes with a meter map, a tempo map and optionally the key they are read in
 * (`Score`).
 */
class Score {
 public:
  /**
   * Wrap plain score data (`new Score`); it is copied and the notes are put in time order.
   * @throws InvalidInputError if a note, the meter map or the tempo map is invalid.
   */
  explicit Score(const ScoreData& data);

  /** A score from note events (`Score.of`). */
  static Score of(const std::vector<NoteEvent>& notes, const ScoreOptions& opts = {});

  /** An empty score (`Score.empty`). */
  static Score empty(const ScoreOptions& opts = {});

  /** A score from events timed in ticks (`Score.fromTicks`). */
  static Score from_ticks(const std::vector<NoteEvent>& events, int ppq,
                          const ScoreOptions& opts = {});

  /** Rebuild a score from its data() (`Score.fromData`). */
  static Score from_data(const ScoreData& data);

  /** Rebuild a score from its to_json() (`Score.fromJSON`). */
  static Score from_json(const ScoreData& data);

  /** The sounding notes, in time order (`notes`). */
  const std::vector<NoteEvent>& notes() const noexcept { return data_.notes; }

  /** Where the last note stops sounding, measured from beat 0 (`totalBeats`). */
  double total_beats() const;

  /** The meter map (`meters`). */
  const MeterMap& meters() const noexcept { return data_.meters; }

  /** The tempo map (`tempo`). */
  const TempoMap& tempo() const noexcept { return data_.tempo; }

  /** The notes whose onsets fall in `[from_beat, to_beat)` (`slice`). */
  Score slice(double from_beat, double to_beat) const;

  /** The notes a predicate keeps (`filter`). */
  Score filter(const std::function<bool(const NoteEvent&, std::size_t)>& predicate) const;

  /** The notes a function returns (`map`). */
  Score map(const std::function<NoteEvent(const NoteEvent&, std::size_t)>& fn) const;

  /** This score followed by another's notes (`concat`). */
  Score concat(const Score& other) const;
  /** This score followed by more notes. */
  Score concat(const std::vector<NoteEvent>& notes) const;

  /** The notes moved along the timeline; the maps stay where they are (`shift`). */
  Score shift(double beats) const;

  /** The notes moved by semitones; a carried key moves with them (`transpose`). */
  Score transpose(double semitones) const;

  /** The notes moved by a spelled interval; a carried key moves by the interval (`transposeBy`). */
  Score transpose_by(const IntervalArg& interval) const;

  /** The same notes against another meter (`withMeters`). */
  Score with_meters(const MeterArg& meters) const;

  /** The same notes at another tempo (`withTempo`). */
  Score with_tempo(const ScoreTempoArg& tempo) const;

  /** The same notes in another key (`withKey`). */
  Score with_key(const KeyArg& key) const;

  /**
   * The notes pulled onto a grid (`quantize`).
   * @throws InvalidInputError if the grid is not a positive length.
   */
  Score quantize(double grid) const;

  /** The notes humanized against the score's meter map (`humanize`). */
  Score humanize(const HumanizeOptions& opts = {}) const;

  /** The notes ornamented against the score's meter map (`ornament`). */
  Score ornament(const OrnamentOptions& opts = {}) const;

  /** The notes placed on a groove template's slots (`groove`). */
  Score groove(const GrooveTemplate& groove_template) const;

  /** The feel of the score's own timing (`grooveTemplate`). */
  GrooveTemplate groove_template(std::optional<int> subdivision = std::nullopt) const;

  /** The harmony the notes spell out, in time (`timeline`). */
  Timeline timeline(const std::optional<ChordTimelineOptions>& opts = std::nullopt) const;

  /** The key held longest across the score, or absent when nothing sounds (`key`). */
  std::optional<Key> key() const;

  /** Every key region the score passes through (`keys`). */
  std::vector<KeyRegion> keys(const std::optional<KeyTimelineOptions>& opts = std::nullopt) const;

  /** Every key the score could be in, ranked (`detectKeys`). */
  std::vector<DetectedKeyMatch> detect_keys(const DetectKeyFromNotesOptions& opts = {}) const;

  /** The phrases the notes fall into (`phrases`). */
  std::vector<Phrase> phrases(const PhraseOptions& opts = {}) const;

  /** The cadences that close the phrases, heaviest first (`structuralCadences`). */
  std::vector<StructuralCadence> structural_cadences(const PhraseOptions& opts = {}) const;

  /** The sections the score divides into (`sections`). */
  std::vector<FormSection> sections(const FormSectionOptions& opts = {}) const;

  /** The bar-level pulse above the meter (`hypermeter`). */
  Hypermeter hypermeter(const HypermeterOptions& opts = {}) const;

  /** The motifs the melody repeats (`motifs`). */
  std::vector<MotifData> motifs(const ExtractMotifsOptions& opts = {}) const;

  /** The shape the melody traces (`contour`). */
  MelodicContour contour() const;

  /** The score's structural fingerprint (`reference`). */
  ReferenceProfile reference(
      const std::optional<ReferenceProfileOptions>& opts = std::nullopt) const;

  /** The onset placement of the melodic line (`rhythm`). */
  RhythmAnalysis rhythm(const RhythmAnalysisOptions& opts = {}) const;

  /** How the motifs derive from one another (`motifGraph`). */
  MotifGraph motif_graph(const MotifGraphOptions& graph = {},
                         const ExtractMotifsOptions& motifs = {}) const;

  /** How the score, read as a melody, keeps to a plan (`evaluate`). */
  CompositionEvaluation evaluate(const CompositionPlan& plan,
                                 const EvaluateCompositionOptions& opts = {}) const;

  /** Each note's role in the harmony under it (`voices`). */
  std::vector<AnalyzedNote> voices(const std::optional<KeyArg>& key = std::nullopt) const;

  /** The notes carrying the ids the voice analysis reports (`voiceNotes`). */
  std::vector<IdentifiedVoiceNote> voice_notes() const;

  /** Whether an instrument can play the score, read through its whole tempo map. */
  PlayabilityReport playability(const InstrumentProfileArg& instrument) const;

  /** An index for repeated lookups over the notes (`index`). */
  NoteEventIndex index(const NoteEventIndexOptions& opts = {}) const;

  /** Where a beat falls in seconds (`secondsAt`). */
  double seconds_at(double beat) const;

  /** Where a beat falls in bars (`barAt`). */
  BarPosition bar_at(double beat) const;

  /** The time signature sounding at a beat (`meterAt`). */
  TimeSignature meter_at(double beat) const;

  /** The notes with tick-valued onsets and durations (`toTicks`). */
  std::vector<NoteEvent> to_ticks(int ppq) const;

  /** Whether another score holds the same notes in the same context (`equals`). */
  bool equals(const Score& other) const;

  /** The plain data (`data`). */
  ScoreData data() const { return data_; }

  /** The plain data (`toJSON`). */
  ScoreData to_json() const { return data_; }

 private:
  /** The same context carrying other notes. */
  Score with_notes(std::vector<NoteEvent> notes) const;
  /** The same context carrying other notes, with a carried key moved the same way. */
  Score moved(std::vector<NoteEvent> notes, const std::function<Key(const Key&)>& move_key) const;
  /** The score's own chord reading. */
  ChordTimelineResult chord_analysis() const;
  /** The score's context as chord-timeline options, with the caller's on top. */
  ChordTimelineOptions analysis_options(const ChordTimelineOptions& opts = {}) const;
  /** The key regions: the stated key across the score, or those read from the notes. */
  std::vector<KeyRegion> key_regions() const;
  /** The key each note is read against. */
  KeyContext key_context(const std::optional<KeyArg>& key) const;

  ScoreData data_;
  std::optional<Key> key_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_SCORE_H_
