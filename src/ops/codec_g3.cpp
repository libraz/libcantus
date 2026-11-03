#include "ops/codec_g3.h"

#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/analyze/melody.h"
#include "cantus/analyze/rhythm.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/random.h"
#include "core/validation/validation.h"
#include "generate/plan/limits.gen.h"
#include "generate/plan/validate.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "ops/accessors.h"
#include "ops/validate.h"

namespace cantus::ops {

void write_fields(const PlannedPhrase& v, FieldWriter& w) {
  w.field("startBeat", v.startBeat);
  w.field("endBeat", v.endBeat);
  w.field("section", v.section);
  w.field("cadence", v.cadence);
  w.field("shape", v.shape);
  w.field("peakPosition", v.peakPosition);
  w.field("register", v.register_);
  w.field("onsetDensity", v.onsetDensity);
  w.field("motifs", v.motifs);
}

void write_fields(const CompositionPlan& v, FieldWriter& w) {
  json::Array keys;
  for (const ResolvedKey& key : v.keys) {
    keys.push_back(scale_first(key));
  }
  w.field("planVersion", v.planVersion);
  w.field("seed", v.seed);
  w.field("algorithmVersion", v.algorithmVersion);
  w.field("keys", json::Value(std::move(keys)));
  w.field("meters", v.meters);
  w.field("span", v.span);
  w.field("sections", v.sections);
  w.field("phrases", v.phrases);
  w.field("harmony", v.harmony);
  w.field("motifs", v.motifs);
  w.field("rhythm", v.rhythm);
}

void write_fields(const CompositionFit& v, FieldWriter& w) {
  w.field("contour", v.contour);
  w.field("register", v.register_);
  w.field("onset", v.onset);
  w.field("duration", v.duration);
  w.field("syncopation", v.syncopation);
  w.field("density", v.density);
}

namespace {

/** Number of the highest index an array of `count` entries admits; 0 for none. */
double last_index(std::size_t count) { return js::max(static_cast<double>(count) - 1, 0.0); }

/** `assertString`. */
std::string assert_string(const json::Value& value, std::string_view name) {
  if (!value.is_string()) {
    throw InvalidInputError(std::string(name) + " must be a string; received " +
                            describe_rejected(value));
  }
  return value.as_string();
}

/** The beats of a span, ordered. */
void read_span(const json::Value& read, std::string_view name, double& start_beat,
               double& end_beat) {
  start_beat = assert_finite_number(get(read, "startBeat"), join_name(name, ".startBeat"));
  end_beat = assert_finite_number(get(read, "endBeat"), join_name(name, ".endBeat"));
  assert_plan_span_order(start_beat, end_beat, name);
}

/** `assertMassDistribution`. */
std::vector<double> read_mass_distribution(const json::Value& value, double length,
                                           std::string_view name) {
  const json::Array& shares = assert_array(value, name);
  assert_plan_mass_length(static_cast<double>(shares.size()), length, name);
  std::vector<double> out;
  double sum = 0;
  for (std::size_t index = 0; index < shares.size(); ++index) {
    double share = assert_finite_number(shares[index], indexed_name(name, index));
    assert_plan_mass_share(share, indexed_name(name, index));
    out.push_back(share);
    sum += share;
  }
  assert_plan_mass_sum(sum, name);
  return out;
}

PlannedSection read_section(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  PlannedSection out;
  out.label = assert_string(get(read, "label"), join_name(name, ".label"));
  read_span(read, name, out.startBeat, out.endBeat);
  return out;
}

PlannedPhrase read_phrase(const json::Value& value, std::string_view name,
                          std::size_t section_count, std::size_t motif_count) {
  const json::Value& read = assert_record(value, name);
  PlannedPhrase out;
  read_span(read, name, out.startBeat, out.endBeat);
  out.section =
      read_nullable(get(read, "section"), join_name(name, ".section"),
                    [&](const json::Value& v, std::string_view n) {
                      return static_cast<int>(assert_integer(v, n, 0, last_index(section_count)));
                    });
  out.cadence =
      read_nullable(get(read, "cadence"), join_name(name, ".cadence"),
                    [](const json::Value& v, std::string_view n) {
                      return *parse_cadence_type(assert_one_of(v, names_of(cadence_types()), n));
                    });
  out.shape = *parse_melodic_contour_shape(assert_one_of(
      get(read, "shape"), names_of(melodic_contour_shapes()), join_name(name, ".shape")));
  out.peakPosition =
      assert_range(get(read, "peakPosition"), 0, 1, join_name(name, ".peakPosition"));
  std::string register_name = join_name(name, ".register");
  const json::Value& range = assert_record(get(read, "register"), register_name);
  out.register_.low = assert_midi_pitch(get(range, "low"), register_name + ".low");
  out.register_.high = assert_midi_pitch(get(range, "high"), register_name + ".high");
  out.register_.mean = assert_range(get(range, "mean"), 0, 127, register_name + ".mean");
  out.onsetDensity =
      assert_range(get(read, "onsetDensity"), 0, kMaxSafeInteger, join_name(name, ".onsetDensity"));
  const json::Array& motifs = assert_array(get(read, "motifs"), join_name(name, ".motifs"));
  for (std::size_t index = 0; index < motifs.size(); ++index) {
    out.motifs.push_back(static_cast<int>(
        assert_integer(motifs[index], indexed_name(join_name(name, ".motifs"), index), 0,
                       last_index(motif_count))));
  }
  return out;
}

PlannedChord read_chord(const json::Value& value, std::string_view name,
                        const std::vector<ResolvedKey>& keys) {
  const json::Value& read = assert_record(value, name);
  PlannedChord out;
  read_span(read, name, out.startBeat, out.endBeat);
  out.key = static_cast<int>(
      assert_integer(get(read, "key"), join_name(name, ".key"), 0, last_index(keys.size())));
  out.roman = assert_string(get(read, "roman"), join_name(name, ".roman"));
  assert_plan_roman(out.roman, keys[static_cast<std::size_t>(out.key)], name);
  return out;
}

MotifRelationSummary read_relation(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  MotifRelationSummary out;
  out.kind = *parse_motif_relation_kind(
      assert_one_of(get(read, "kind"), names_of(motif_relation_kinds()), join_name(name, ".kind")));
  out.sequence = assert_flag(get(read, "sequence"), join_name(name, ".sequence"));
  out.semitones = assert_finite_number(get(read, "semitones"), join_name(name, ".semitones"));
  const json::Value& degrees = get(read, "degrees");
  if (out.kind == MotifRelationKind::kTonalTransposition) {
    // The one kind a generator cannot replay from `semitones` alone.
    out.degrees = assert_finite_number(degrees, join_name(name, ".degrees"));
  } else if (!is_undefined(degrees)) {
    out.degrees = assert_finite_number(degrees, join_name(name, ".degrees"));
  }
  out.timeRatio = assert_finite_number(get(read, "timeRatio"), join_name(name, ".timeRatio"));
  assert_plan_time_ratio(out.timeRatio, name);
  return out;
}

PlannedMotif read_motif(const json::Value& value, std::string_view name, std::size_t own_index,
                        std::size_t motif_count, std::size_t phrase_count) {
  const json::Value& read = assert_record(value, name);
  PlannedMotif out;
  out.phrase = static_cast<int>(
      assert_integer(get(read, "phrase"), join_name(name, ".phrase"), 0, last_index(phrase_count)));
  read_span(read, name, out.startBeat, out.endBeat);
  double notes = assert_positive_int(get(read, "notes"), join_name(name, ".notes"));
  out.notes = static_cast<int>(notes);
  out.from = read_nullable(
      get(read, "from"), join_name(name, ".from"), [&](const json::Value& v, std::string_view n) {
        return static_cast<int>(assert_integer(v, n, 0, last_index(motif_count)));
      });
  if (out.from) {
    assert_plan_source_before(*out.from, static_cast<double>(own_index), name);
  }
  out.relation = read_nullable(get(read, "relation"), join_name(name, ".relation"), read_relation);
  if (!out.from) {
    assert_plan_root_has_no_relation(!out.relation.has_value(), name);
  }
  const json::Value& rhythm_value = get(read, "rhythm");
  std::string rhythm_name = join_name(name, ".rhythm");
  const json::Array* rhythm = nullptr;
  if (is_undefined(rhythm_value)) {
    throw InvalidInputError(rhythm_name + " must be present; received undefined");
  }
  if (!rhythm_value.is_null()) {
    rhythm = &assert_array(rhythm_value, rhythm_name);
  }
  if (rhythm != nullptr) {
    assert_plan_derived_has_no_rhythm(out.from.has_value(), name);
    assert_plan_rhythm_length(notes, static_cast<double>(rhythm->size()), name);
    std::vector<double> gaps;
    double total = 0;
    for (std::size_t index = 0; index < rhythm->size(); ++index) {
      double gap = assert_finite_number((*rhythm)[index], indexed_name(rhythm_name, index));
      assert_plan_rhythm_gap(gap, indexed_name(rhythm_name, index));
      gaps.push_back(gap);
      total += gap;
    }
    assert_plan_rhythm_total(total, out.endBeat - out.startBeat, name);
    out.rhythm = std::move(gaps);
  }
  return out;
}

PlannedRhythm read_rhythm(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  PlannedRhythm out;
  out.onsetLevels = read_mass_distribution(get(read, "onsetLevels"), RHYTHM_LEVEL_COUNT,
                                           join_name(name, ".onsetLevels"));
  out.interOnsetShares = read_mass_distribution(get(read, "interOnsetShares"),
                                                static_cast<double>(rhythm_ioi_bins().size()),
                                                join_name(name, ".interOnsetShares"));
  out.syncopation = assert_range(get(read, "syncopation"), 0, 1, join_name(name, ".syncopation"));
  return out;
}

}  // namespace

CompositionPlan read_composition_plan(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  CompositionPlan out;
  const json::Value& version = get(read, "planVersion");
  std::optional<double> version_number = number_of(version);
  assert_plan_version(describe_rejected(version),
                      version_number && *version_number == COMPOSITION_PLAN_VERSION, name);
  out.planVersion = COMPOSITION_PLAN_VERSION;
  out.seed = assert_integer(get(read, "seed"), join_name(name, ".seed"), 0, 4294967295.0);
  out.algorithmVersion = static_cast<int>(assert_integer(get(read, "algorithmVersion"),
                                                         join_name(name, ".algorithmVersion"),
                                                         MIN_ALGORITHM_VERSION, ALGORITHM_VERSION));
  const json::Array& keys = assert_array(get(read, "keys"), join_name(name, ".keys"));
  if (keys.empty()) {
    throw InvalidInputError(join_name(name, ".keys") +
                            " must hold at least one key; received an empty array");
  }
  for (std::size_t index = 0; index < keys.size(); ++index) {
    out.keys.push_back(
        read_resolved_key_field(keys[index], indexed_name(join_name(name, ".keys"), index)));
  }
  out.meters = assert_meter_map(get(read, "meters"), join_name(name, ".meters"));
  std::string span_name = join_name(name, ".span");
  const json::Value& span = assert_record(get(read, "span"), span_name);
  read_span(span, span_name, out.span.startBeat, out.span.endBeat);
  out.span.bars = assert_range(get(span, "bars"), 0, kMaxSafeInteger, span_name + ".bars");

  const json::Array& sections = assert_array(get(read, "sections"), join_name(name, ".sections"));
  for (std::size_t index = 0; index < sections.size(); ++index) {
    out.sections.push_back(
        read_section(sections[index], indexed_name(join_name(name, ".sections"), index)));
  }

  const json::Array& phrases = assert_array(get(read, "phrases"), join_name(name, ".phrases"));
  const json::Array& motifs = assert_array(get(read, "motifs"), join_name(name, ".motifs"));
  for (std::size_t index = 0; index < phrases.size(); ++index) {
    out.phrases.push_back(read_phrase(phrases[index],
                                      indexed_name(join_name(name, ".phrases"), index),
                                      sections.size(), motifs.size()));
  }

  const json::Array& harmony = assert_array(get(read, "harmony"), join_name(name, ".harmony"));
  for (std::size_t index = 0; index < harmony.size(); ++index) {
    out.harmony.push_back(
        read_chord(harmony[index], indexed_name(join_name(name, ".harmony"), index), out.keys));
  }

  for (std::size_t index = 0; index < motifs.size(); ++index) {
    out.motifs.push_back(read_motif(motifs[index], indexed_name(join_name(name, ".motifs"), index),
                                    index, motifs.size(), phrases.size()));
  }

  out.rhythm = read_rhythm(get(read, "rhythm"), join_name(name, ".rhythm"));
  return out;
}

}  // namespace cantus::ops
