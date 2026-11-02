// The boundary validation of ts/src/generate/plan/validate.ts.

#include "generate/plan/validate.h"

#include <algorithm>
#include <cmath>
#include <string>

#include "cantus/analyze/functional.h"
#include "cantus/analyze/rhythm.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "generate/plan/limits.gen.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

double clamp_index(std::size_t count) { return js::max(static_cast<double>(count) - 1, 0.0); }

void check_mass_distribution(const std::vector<double>& shares, double length,
                             std::string_view name) {
  assert_plan_mass_length(static_cast<double>(shares.size()), length, name);
  double sum = 0;
  for (std::size_t index = 0; index < shares.size(); ++index) {
    double share = assert_finite_number(shares[index], indexed_name(name, index));
    assert_plan_mass_share(share, indexed_name(name, index));
    sum += share;
  }
  assert_plan_mass_sum(sum, name);
}

void check_section(const PlannedSection& section, std::string_view name) {
  double start_beat = assert_finite_number(section.startBeat, join_name(name, ".startBeat"));
  double end_beat = assert_finite_number(section.endBeat, join_name(name, ".endBeat"));
  assert_plan_span_order(start_beat, end_beat, name);
}

void check_phrase(const PlannedPhrase& phrase, std::string_view name, std::size_t section_count,
                  std::size_t motif_count) {
  double start_beat = assert_finite_number(phrase.startBeat, join_name(name, ".startBeat"));
  double end_beat = assert_finite_number(phrase.endBeat, join_name(name, ".endBeat"));
  assert_plan_span_order(start_beat, end_beat, name);
  if (phrase.section) {
    assert_integer(*phrase.section, join_name(name, ".section"), 0, clamp_index(section_count));
  }
  assert_range(phrase.peakPosition, 0, 1, join_name(name, ".peakPosition"));
  assert_midi_pitch(phrase.register_.low, join_name(name, ".register.low"));
  assert_midi_pitch(phrase.register_.high, join_name(name, ".register.high"));
  assert_range(phrase.register_.mean, 0, 127, join_name(name, ".register.mean"));
  assert_range(phrase.onsetDensity, 0, kMaxSafeInteger, join_name(name, ".onsetDensity"));
  for (std::size_t index = 0; index < phrase.motifs.size(); ++index) {
    assert_integer(phrase.motifs[index], indexed_name(join_name(name, ".motifs"), index), 0,
                   clamp_index(motif_count));
  }
}

void check_chord(const PlannedChord& chord, std::string_view name,
                 const std::vector<ResolvedKey>& keys) {
  double start_beat = assert_finite_number(chord.startBeat, join_name(name, ".startBeat"));
  double end_beat = assert_finite_number(chord.endBeat, join_name(name, ".endBeat"));
  assert_plan_span_order(start_beat, end_beat, name);
  double key_index =
      assert_integer(chord.key, join_name(name, ".key"), 0, clamp_index(keys.size()));
  assert_plan_roman(chord.roman, keys[static_cast<std::size_t>(key_index)], name);
}

void check_relation(const MotifRelationSummary& relation, std::string_view name) {
  if (relation.kind == MotifRelationKind::kTonalTransposition) {
    // The one kind a generator cannot replay from `semitones` alone.
    assert_finite_number(relation.degrees.value_or(std::nan("")), join_name(name, ".degrees"));
  } else if (relation.degrees) {
    assert_finite_number(*relation.degrees, join_name(name, ".degrees"));
  }
}

void check_motif(const PlannedMotif& motif, std::string_view name, std::size_t own_index,
                 std::size_t motif_count, std::size_t phrase_count) {
  assert_integer(motif.phrase, join_name(name, ".phrase"), 0, clamp_index(phrase_count));
  double start_beat = assert_finite_number(motif.startBeat, join_name(name, ".startBeat"));
  double end_beat = assert_finite_number(motif.endBeat, join_name(name, ".endBeat"));
  assert_plan_span_order(start_beat, end_beat, name);
  assert_positive_int(motif.notes, join_name(name, ".notes"));
  std::optional<double> from;
  if (motif.from) {
    from = assert_integer(*motif.from, join_name(name, ".from"), 0, clamp_index(motif_count));
  }
  if (from) {
    assert_plan_source_before(*from, static_cast<double>(own_index), name);
  }
  if (motif.relation) {
    assert_finite_number(motif.relation->semitones, join_name(name, ".relation.semitones"));
    check_relation(*motif.relation, join_name(name, ".relation"));
    assert_finite_number(motif.relation->timeRatio, join_name(name, ".relation.timeRatio"));
    assert_plan_time_ratio(motif.relation->timeRatio, join_name(name, ".relation"));
  }
  if (!from) {
    assert_plan_root_has_no_relation(!motif.relation.has_value(), name);
  }
  if (motif.rhythm) {
    assert_plan_derived_has_no_rhythm(from.has_value(), name);
    assert_plan_rhythm_length(motif.notes, static_cast<double>(motif.rhythm->size()), name);
    double total = 0;
    for (std::size_t index = 0; index < motif.rhythm->size(); ++index) {
      double gap = assert_finite_number((*motif.rhythm)[index],
                                        indexed_name(join_name(name, ".rhythm"), index));
      assert_plan_rhythm_gap(gap, indexed_name(join_name(name, ".rhythm"), index));
      total += gap;
    }
    assert_plan_rhythm_total(total, end_beat - start_beat, name);
  }
}

}  // namespace

void assert_plan_span_order(double start_beat, double end_beat, std::string_view name) {
  if (end_beat < start_beat) {
    throw InvalidInputError(std::string(name) + ".endBeat must be at least " + std::string(name) +
                            ".startBeat; received " + js::to_string(end_beat) + " < " +
                            js::to_string(start_beat));
  }
}

void assert_plan_mass_share(double share, std::string_view name) {
  if (share < 0) {
    throw InvalidInputError(std::string(name) + " must be at least 0; received " +
                            js::to_string(share));
  }
}

void assert_plan_mass_sum(double sum, std::string_view name) {
  if (std::abs(sum - 1) > PLAN_MASS_TOLERANCE) {
    throw InvalidInputError(std::string(name) + " must sum to 1; received " + js::to_string(sum));
  }
}

void assert_plan_mass_length(double length, double expected, std::string_view name) {
  if (length != expected) {
    throw InvalidInputError(std::string(name) + " must have length " + js::to_string(expected) +
                            "; received " + js::to_string(length));
  }
}

void assert_plan_key(const KeyArg& key, std::string_view name) {
  try {
    resolve_key(key);
  } catch (const InvalidInputError& error) {
    throw InvalidInputError(std::string(name) + " must be a valid key: " + error.message());
  }
}

void assert_plan_roman(const std::string& roman, const ResolvedKey& key, std::string_view name) {
  try {
    roman_to_chord(roman, KeyArg(key));
  } catch (const InvalidInputError& error) {
    throw InvalidInputError(std::string(name) +
                            ".roman must be readable by romanToChord; received " +
                            describe_rejected(json::Value(roman)) + ": " + error.message());
  }
}

void assert_plan_time_ratio(double time_ratio, std::string_view name) {
  if (time_ratio <= 0) {
    throw InvalidInputError(std::string(name) + ".timeRatio must be positive; received " +
                            js::to_string(time_ratio));
  }
}

void assert_plan_source_before(double from, double own_index, std::string_view name) {
  if (from >= own_index) {
    throw InvalidInputError(std::string(name) + ".from must be less than this motif's own index (" +
                            js::to_string(own_index) + "); received " + js::to_string(from));
  }
}

void assert_plan_root_has_no_relation(bool relation_is_null, std::string_view name) {
  if (!relation_is_null) {
    throw InvalidInputError(std::string(name) +
                            ".relation must be null for a root motif (from = null); received a "
                            "relation");
  }
}

void assert_plan_derived_has_no_rhythm(bool derived, std::string_view name) {
  if (derived) {
    throw InvalidInputError(std::string(name) + ".rhythm must be null for a derived statement");
  }
}

void assert_plan_rhythm_length(double notes, double length, std::string_view name) {
  if (length != notes - 1) {
    throw InvalidInputError(std::string(name) + ".rhythm must hold notes - 1 (" +
                            js::to_string(notes - 1) + ") gaps; received " + js::to_string(length));
  }
}

void assert_plan_rhythm_gap(double gap, std::string_view name) {
  if (gap <= 0) {
    throw InvalidInputError(std::string(name) + " must be positive; received " +
                            js::to_string(gap));
  }
}

void assert_plan_rhythm_total(double total, double length, std::string_view name) {
  if (total >= length - BEAT_EPS) {
    throw InvalidInputError(std::string(name) +
                            ".rhythm must sum to less than the statement's length (" +
                            js::to_string(length) + "); received " + js::to_string(total));
  }
}

void assert_plan_version(const std::string& received, bool matches, std::string_view name) {
  if (!matches) {
    throw InvalidInputError(std::string(name) + ".planVersion must be " +
                            js::to_string(COMPOSITION_PLAN_VERSION) + "; received " + received);
  }
}

const CompositionPlan& assert_composition_plan(const CompositionPlan& plan, std::string_view name) {
  assert_plan_version(js::to_string(plan.planVersion), plan.planVersion == COMPOSITION_PLAN_VERSION,
                      name);
  assert_integer(plan.seed, join_name(name, ".seed"), 0, 4294967295.0);
  assert_integer(plan.algorithmVersion, join_name(name, ".algorithmVersion"), MIN_ALGORITHM_VERSION,
                 ALGORITHM_VERSION);
  if (plan.keys.empty()) {
    throw InvalidInputError(std::string(name) +
                            ".keys must hold at least one key; received an empty array");
  }
  for (std::size_t index = 0; index < plan.keys.size(); ++index) {
    assert_plan_key(KeyArg(plan.keys[index]), indexed_name(join_name(name, ".keys"), index));
  }
  assert_meter_map(plan.meters, join_name(name, ".meters"));
  double span_start = assert_finite_number(plan.span.startBeat, join_name(name, ".span.startBeat"));
  double span_end = assert_finite_number(plan.span.endBeat, join_name(name, ".span.endBeat"));
  assert_plan_span_order(span_start, span_end, join_name(name, ".span"));
  assert_range(plan.span.bars, 0, kMaxSafeInteger, join_name(name, ".span.bars"));

  for (std::size_t index = 0; index < plan.sections.size(); ++index) {
    check_section(plan.sections[index], indexed_name(join_name(name, ".sections"), index));
  }
  for (std::size_t index = 0; index < plan.phrases.size(); ++index) {
    check_phrase(plan.phrases[index], indexed_name(join_name(name, ".phrases"), index),
                 plan.sections.size(), plan.motifs.size());
  }
  for (std::size_t index = 0; index < plan.harmony.size(); ++index) {
    check_chord(plan.harmony[index], indexed_name(join_name(name, ".harmony"), index), plan.keys);
  }
  for (std::size_t index = 0; index < plan.motifs.size(); ++index) {
    check_motif(plan.motifs[index], indexed_name(join_name(name, ".motifs"), index), index,
                plan.motifs.size(), plan.phrases.size());
  }
  check_mass_distribution(plan.rhythm.onsetLevels, 6, join_name(name, ".rhythm.onsetLevels"));
  check_mass_distribution(plan.rhythm.interOnsetShares,
                          static_cast<double>(rhythm_ioi_bins().size()),
                          join_name(name, ".rhythm.interOnsetShares"));
  assert_range(plan.rhythm.syncopation, 0, 1, join_name(name, ".rhythm.syncopation"));
  return plan;
}

}  // namespace cantus
