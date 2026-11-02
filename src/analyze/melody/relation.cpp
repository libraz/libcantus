// The transformation between two statements of a motif, named:
// ts/src/analyze/melody/relation.ts.

#include "analyze/melody/relation.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <string>

#include "analyze/adjacency.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

constexpr std::size_t kKindCount = static_cast<std::size_t>(MotifRelationKind::kDiminution) + 1;

/** MOTIF_RELATION_KINDS, indexed by MotifRelationKind. */
constexpr std::array<std::string_view, kKindCount> kKindNames = {
#include "analyze/melody/motif_relation_kinds.gen.inc"
};
static_assert(!kKindNames.back().empty(), "MOTIF_RELATION_KINDS and MotifRelationKind disagree");

/** Whether a key writes its accidentals as flats (`spellingOf`). */
MidiSpelling spelling_of(const std::optional<ResolvedKey>& key) {
  if (!key) {
    return MidiSpelling::kSharp;
  }
  return key_signature_fifths(key->tonic, key->scale) < 0 ? MidiSpelling::kFlat
                                                          : MidiSpelling::kSharp;
}

/**
 * Name the distance between two pitches as a spelled interval: the start is spelled by the key's
 * side and the end is reached by the conventional interval for that distance (`intervalBetween`).
 */
SpelledInterval interval_between(double from, double to, const std::optional<ResolvedKey>& key) {
  NoteData start = midi_to_note(from, spelling_of(key));
  return spelled_interval(start, transpose_note(start, to - from));
}

/** An interval name in the grammar `parseInterval` reads, such as `-m3` (`intervalName`). */
std::string interval_name(const SpelledInterval& interval) {
  return std::string(interval.descending && interval.semitones != 0 ? "-" : "") + interval.quality +
         js::to_string(interval.number);
}

/**
 * Position of every note on the key's diatonic ladder, counted in scale degrees from the root and
 * continuing across octaves (`ladderIndices`); nullopt where a note is outside the key.
 */
std::optional<std::vector<double>> ladder_indices(const std::vector<LineNote>& notes,
                                                  const KeyScale& key) {
  int root = pitch_class_of(key.rootPc);
  std::vector<double> offsets;
  for (int pc : scale_tones_in_degree_order(key)) {
    offsets.push_back(pitch_class_of(pc - root));
  }
  if (offsets.empty()) {
    return std::nullopt;
  }
  std::vector<double> out;
  for (const LineNote& note : notes) {
    if (note.absent != nullptr) {
      throw js::TypeError(std::string("Cannot read properties of ") + note.absent +
                          " (reading 'pitch')");
    }
    double semitones = note.rawPitch - root;
    double octave = std::floor(semitones / 12);
    auto degree = std::find(offsets.begin(), offsets.end(), semitones - octave * 12);
    if (degree == offsets.end()) {
      return std::nullopt;
    }
    out.push_back(octave * static_cast<double>(offsets.size()) +
                  static_cast<double>(degree - offsets.begin()));
  }
  return out;
}

/** Differences between consecutive ladder positions (`ladderSteps`). */
std::vector<double> ladder_steps(const std::vector<double>& indices) {
  std::vector<double> out;
  for (std::size_t i = 1; i < indices.size(); ++i) {
    out.push_back(indices[i] - indices[i - 1]);
  }
  return out;
}

/** The pitch shapes one motif can stand in to another, before timing (`PitchShape`). */
enum class PitchShape { kExact, kInversion, kRetrograde, kRetrogradeInversion };

std::vector<double> negated(const std::vector<double>& values) {
  std::vector<double> out;
  for (double value : values) {
    out.push_back(-value);
  }
  return out;
}

/** Which pitch transformations carry `a`'s intervals onto `b`'s, simplest first (`pitchShapes`). */
std::vector<PitchShape> pitch_shapes(const std::vector<double>& a, const std::vector<double>& b) {
  std::vector<PitchShape> shapes;
  if (same_numbers(a, b)) {
    shapes.push_back(PitchShape::kExact);
  }
  if (same_numbers(b, negated(a))) {
    shapes.push_back(PitchShape::kInversion);
  }
  std::vector<double> reversed(a.rbegin(), a.rend());
  if (same_numbers(b, negated(reversed))) {
    shapes.push_back(PitchShape::kRetrograde);
  }
  if (same_numbers(b, reversed)) {
    shapes.push_back(PitchShape::kRetrogradeInversion);
  }
  return shapes;
}

bool has_shape(const std::vector<PitchShape>& shapes, PitchShape shape) {
  return std::find(shapes.begin(), shapes.end(), shape) != shapes.end();
}

/** Total distance a run of gaps covers (`totalGap`). */
double total_gap(const std::vector<double>& gaps) {
  double sum = 0;
  for (double gap : gaps) {
    sum += gap;
  }
  return sum;
}

/** How far the answer's note values are stretched against the model's (`stretchRatio`). */
double stretch_ratio(const std::vector<double>& model_gaps,
                     const std::vector<double>& answer_gaps) {
  double span = total_gap(model_gaps);
  return span > BEAT_EPS ? total_gap(answer_gaps) / span : 1;
}

/** Sentence naming a stretch, for the rationales that mention one (`stretchPhrase`). */
std::string stretch_phrase(double ratio) {
  return "note values " + js::to_string(round_to(ratio, 3)) + "x the model's";
}

}  // namespace

std::string_view to_string(MotifRelationKind kind) {
  return kKindNames[static_cast<std::size_t>(kind)];
}

std::optional<MotifRelationKind> parse_motif_relation_kind(std::string_view name) {
  for (std::size_t i = 0; i < kKindNames.size(); ++i) {
    if (kKindNames[i] == name) {
      return static_cast<MotifRelationKind>(i);
    }
  }
  return std::nullopt;
}

std::vector<MotifRelationKind> motif_relation_kinds() {
  std::vector<MotifRelationKind> kinds;
  for (std::size_t i = 0; i < kKindNames.size(); ++i) {
    kinds.push_back(static_cast<MotifRelationKind>(i));
  }
  return kinds;
}

Nullable<MotifRelation> relate_lines(const std::vector<LineNote>& model,
                                     const std::vector<LineNote>& answer,
                                     const KeySource* key_source) {
  // Read whole, so the interval names a motif relation is reported under follow the key the
  // caller named rather than the side its pitch classes read best as.
  std::optional<ResolvedKey> key;
  if (key_source != nullptr) {
    key = (*key_source)();
  }
  if (model.empty() || model.size() != answer.size()) {
    return std::nullopt;
  }
  std::vector<double> model_gaps = onset_gaps(model);
  std::vector<double> answer_gaps = onset_gaps(answer);
  std::optional<std::vector<double>> model_profile = rhythm_profile(model_gaps);
  std::optional<std::vector<double>> answer_profile = rhythm_profile(answer_gaps);
  // The rhythm the model would have if it were played backwards, which is what a retrograde has to
  // match: note values kept, their order reversed.
  std::vector<double> retro_gaps = retrograde_gaps(model);
  std::optional<std::vector<double>> retro_profile = rhythm_profile(retro_gaps);
  if (!model_profile || !answer_profile) {
    return std::nullopt;
  }
  bool forward = same_numbers(*model_profile, *answer_profile);
  bool backward = retro_profile && same_numbers(*retro_profile, *answer_profile);
  double semitones = answer.front().pitch - model.front().pitch;
  SpelledInterval interval = interval_between(model.front().pitch, answer.front().pitch, key);
  // A sequence follows its model immediately; anything further off is a restatement somewhere else
  // in the piece.
  bool sequence = adjacent(end_beat_of(model), answer.front().startBeat);
  double time_ratio = stretch_ratio(model_gaps, answer_gaps);
  bool stretched = std::fabs(time_ratio - 1) > BEAT_EPS;
  std::vector<PitchShape> shapes = pitch_shapes(intervals_of(model), intervals_of(answer));

  MotifRelation base;
  base.sequence = sequence;
  base.semitones = semitones;
  base.interval = interval;
  base.timeRatio = time_ratio;
  // A relation of the retrograde family is a stretch of the model played backwards, so that is
  // what its own ratio is measured against.
  MotifRelation backward_base = base;
  backward_base.timeRatio = stretch_ratio(retro_gaps, answer_gaps);

  if (forward && has_shape(shapes, PitchShape::kExact)) {
    MotifRelation out = base;
    if (semitones == 0) {
      if (!stretched) {
        out.kind = MotifRelationKind::kRepetition;
        out.rationale = "Exact repetition: the same pitches in the same rhythm";
        return out;
      }
      bool augmented = time_ratio > 1;
      out.kind = augmented ? MotifRelationKind::kAugmentation : MotifRelationKind::kDiminution;
      out.rationale = std::string(augmented ? "Augmentation" : "Diminution") +
                      ": the same pitches in " + stretch_phrase(time_ratio);
      return out;
    }
    std::string name = interval_name(interval);
    out.kind = MotifRelationKind::kTransposition;
    out.rationale = (sequence ? "Real sequence: the cell restated " + name +
                                    " away with every interval kept literally"
                              : "Transposition by " + name + ": every interval kept literally") +
                    (stretched ? ", in " + stretch_phrase(time_ratio) : "");
    return out;
  }

  if (forward && key) {
    std::optional<std::vector<double>> model_ladder = ladder_indices(model, key->scale);
    std::optional<std::vector<double>> answer_ladder = ladder_indices(answer, key->scale);
    if (model_ladder && answer_ladder) {
      double degrees = answer_ladder->front() - model_ladder->front();
      if (degrees != 0 && same_numbers(ladder_steps(*model_ladder), ladder_steps(*answer_ladder))) {
        std::string direction = degrees > 0 ? "higher" : "lower";
        double count = std::fabs(degrees);
        MotifRelation out = base;
        out.kind = MotifRelationKind::kTonalTransposition;
        out.degrees = degrees;
        out.rationale = std::string(sequence ? "Tonal sequence" : "Tonal transposition") +
                        ": the cell restated " + js::to_string(count) + " scale " +
                        (count == 1 ? "degree" : "degrees") + " " + direction +
                        " inside the key, so the key resizes its intervals \xE2\x80\x94 a real one "
                        "would have kept them literal";
        return out;
      }
    }
  }

  // Even rhythm runs both ways, so the shape that needs no transposition names the pair.
  bool literal_retrograde = backward && has_shape(shapes, PitchShape::kRetrograde) &&
                            answer.front().pitch == model.back().pitch;
  if (forward && has_shape(shapes, PitchShape::kInversion) &&
      !(literal_retrograde && semitones != 0)) {
    MotifRelation out = base;
    out.kind = MotifRelationKind::kInversion;
    out.rationale = std::string("Inversion: every interval turned upside down") +
                    (semitones == 0 ? " about the first note" : "") +
                    (stretched ? ", in " + stretch_phrase(time_ratio) : "");
    return out;
  }
  if (backward && has_shape(shapes, PitchShape::kRetrograde)) {
    MotifRelation out = backward_base;
    out.kind = MotifRelationKind::kRetrograde;
    out.rationale = "Retrograde: the cell read back to front, rhythm included";
    return out;
  }
  if (backward && has_shape(shapes, PitchShape::kRetrogradeInversion)) {
    MotifRelation out = backward_base;
    out.kind = MotifRelationKind::kRetrogradeInversion;
    out.rationale = "Retrograde inversion: the cell read back to front and turned upside down";
    return out;
  }
  return std::nullopt;
}

Nullable<MotifRelation> relate_motifs(const MotifData& a, const MotifData& b,
                                      const std::optional<KeyArg>& key) {
  KeySource source = [key] { return resolve_key(*key); };
  return relate_lines(line_of(a.notes), line_of(b.notes), key ? &source : nullptr);
}

}  // namespace cantus
