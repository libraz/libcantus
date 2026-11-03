// The drum pattern dictionary of ts/src/generate/drums/vocabulary.ts.

#include "generate/drums/vocabulary.h"

#include <any>
#include <string_view>
#include <variant>

#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "generate/context/context.h"
#include "generate/vocabulary/limits.gen.h"

namespace cantus {

namespace {

/** A generated stroke, with its names still as text. */
struct StrokeRecord {
  std::string_view voice;
  double step;
  double velocity;
  std::optional<double> duration;
  std::optional<std::string_view> articulation;
  std::optional<std::string_view> limb;
};

/** A generated DRUM_PATTERNS entry, with its names still as text. */
struct PatternRecord {
  std::string_view id;
  std::string_view genre;
  double difficulty;
  std::vector<std::string_view> articulations;
  SignatureSlot ts;
  GeneratedList<double> tempoRange;
  struct {
    double steps;
    std::vector<StrokeRecord> strokes;
  } material;
  struct {
    std::string_view basis;
    std::string_view note;
  } provenance;
  GeneratedList<std::string_view> sections;
  GeneratedList<std::string_view> fitsOver;
};

std::vector<DrumVocabulary> make_drum_patterns() {
  static const std::vector<PatternRecord> rows =
#include "generate/drums/drum_patterns.gen.inc"
      ;
  std::vector<DrumVocabulary> out;
  for (const PatternRecord& row : rows) {
    DrumVocabulary entry;
    read_vocabulary_row(row, entry);
    entry.material.steps = row.material.steps;
    for (const StrokeRecord& record : row.material.strokes) {
      DrumStroke stroke;
      stroke.voice = *parse_drum_voice(record.voice);
      stroke.step = record.step;
      stroke.velocity = record.velocity;
      stroke.duration = record.duration;
      if (record.articulation) {
        stroke.articulation = *parse_articulation(*record.articulation);
      }
      if (record.limb) {
        stroke.limb = *parse_limb(*record.limb);
      }
      entry.material.strokes.push_back(stroke);
    }
    out.push_back(std::move(entry));
  }
  return out;
}

/** DrumStroke as a grid model: the stream is the limb, else the voice. */
struct DrumStrokeModel : StepModel<DrumStrokeModel, DrumStroke> {
  static std::string stream_text(const DrumStroke& e) {
    return std::string(e.limb ? to_string(*e.limb) : to_string(e.voice));
  }
};

/** The typed pattern model: built-in and caller entries as DrumVocabulary. */
struct TypedPatternModel {
  using Grid = DrumStrokeModel;
  using Hit = DrumHit;

  const ResolvedContext& resolved;
  std::optional<InstrumentProfile> kit;

  std::vector<DrumVocabulary> dictionary() const {
    return merge_vocabulary(DRUM_PATTERNS,
                            std::optional<std::vector<DrumVocabulary>>(
                                vocabulary_of_kind<DrumPattern>(resolved.vocabulary)));
  }
  bool any_in_meter(const std::vector<DrumVocabulary>& dictionary, const TimeSignature& ts) const {
    VocabularyQuery query;
    query.ts = ts;
    return !select_vocabulary(dictionary, query).empty();
  }
  std::optional<DrumVocabulary> pick(const std::vector<DrumVocabulary>& dictionary,
                                     const PatternPlan& plan, const Draw& draw, int bar) const {
    VocabularyQuery query;
    query.genre = plan.genre;
    query.section = plan.section;
    query.bpm = plan.bpm;
    query.ts = plan.ts;
    query.difficulty = plan.difficulty;
    // A figure calling for a technique the kit cannot produce is not offered at all.
    if (kit) {
      query.articulations =
          std::visit([](const auto& profile) { return profile.articulations; }, *kit);
    }
    return pick_vocabulary(dictionary, query, draw,
                           {std::string("pattern"), static_cast<double>(bar)});
  }
  const std::vector<DrumStroke>& strokes(const DrumVocabulary& entry) const {
    for (std::size_t index = 0; index < entry.material.strokes.size(); ++index) {
      assert_finite_number(entry.material.strokes[index].step,
                           "figure events[" + index_text(index) + "].step");
    }
    return entry.material.strokes;
  }
  double span_steps(const DrumVocabulary& entry) const {
    return assert_span_steps(entry.material.steps);
  }
  static bool is_ghost(const DrumStroke& stroke) {
    return stroke.articulation == Articulation::kGhost;
  }
  static std::optional<int> pitch(const DrumStroke& stroke) { return drum_note(stroke.voice); }
  static double duration(const DrumStroke& stroke) { return stroke.duration.value_or(STEP_BEATS); }
  static double velocity(double base, const DrumStroke& stroke) { return base * stroke.velocity; }
  static std::optional<Articulation> articulation(const DrumStroke& stroke) {
    return stroke.articulation;
  }
  bool playable(int pitch) const { return !kit || can_sound(*kit, pitch); }
};

}  // namespace

const std::vector<DrumVocabulary> DRUM_PATTERNS = make_drum_patterns();

bool is_drum_pattern(const std::any& material) {
  return std::any_cast<DrumPattern>(&material) != nullptr;
}

std::vector<DrumHit> place_drum_pattern(const DrumPatternOptions& opts) {
  assert_positive_int(opts.bars, "drum pattern bars");
  assert_generation_budget(opts.bars * MAX_STROKES_PER_BAR, "drum pattern hits", opts.budget);
  PatternPlan plan;
  plan.bars = opts.bars;
  plan.genre = opts.genre;
  plan.section = opts.section;
  plan.ts = meter_at(0, to_meter_data(opts.ts.value_or(MeterArg(kGenerateDefaultTs)), "ts"));
  if (opts.velocity) {
    assert_range(*opts.velocity, 1, 127, "drum pattern velocity");
  }
  plan.feel = opts.feel.value_or(GrooveFeel::kStraight);
  ResolvedContext resolved = resolve_context(opts.ctx);
  plan.bpm = resolved.bpm.value_or(DRUM_PATTERN_DEFAULT_BPM);
  plan.baseVelocity = opts.velocity.value_or(DRUM_PATTERN_DEFAULT_VELOCITY);
  plan.rate = opts.rate.value_or(FigureRate::kStraight);
  plan.rhythmic = resolved.rhythmic;
  plan.ornament = resolved.ornament;
  plan.difficulty = resolved.difficulty;
  Draw draw = resolved.part("drums");
  TypedPatternModel model{resolved, resolved.instrument("drums")};
  return place_drum_pattern_with(plan, draw, model);
}

}  // namespace cantus
