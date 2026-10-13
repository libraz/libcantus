// ts/src/analyze/reference/compare.ts: two reference profiles compared dimension by dimension.

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "analyze/reference/measures.h"
#include "cantus/analyze/reference.h"
#include "cantus/core/limits.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

struct Measured {
  std::string name;
  double value = 0;
  std::size_t order = 0;
};

/** A sentence naming the most and least alike of the measured fields (`rationaleOf`). */
std::string rationale_of(const ReferenceComparison& comparison) {
  std::vector<Measured> measured;
  auto add = [&](const char* name, const Nullable<double>& value) {
    if (value) {
      measured.push_back(Measured{name, *value, measured.size()});
    }
  };
  add("sectionSequenceSimilarity", comparison.form.sectionSequenceSimilarity);
  add("phraseLengthSimilarity", comparison.form.phraseLengthSimilarity);
  add("progressionSimilarity", comparison.harmony.progressionSimilarity);
  add("functionSimilarity", comparison.harmony.functionSimilarity);
  add("cadenceSimilarity", comparison.harmony.cadenceSimilarity);
  add("keyPlanSimilarity", comparison.harmony.keyPlanSimilarity);
  add("harmonicRhythmOnsetSimilarity", comparison.harmony.harmonicRhythmOnsetSimilarity);
  add("harmonicRhythmDensitySimilarity", comparison.harmony.harmonicRhythmDensitySimilarity);
  add("surfaceSimilarity", comparison.melody.surfaceSimilarity);
  add("motifStructureSimilarity", comparison.melody.motifStructureSimilarity);
  add("contourSimilarity", comparison.melody.contourSimilarity);
  add("registerSimilarity", comparison.melody.registerSimilarity);
  add("onsetSimilarity", comparison.rhythm.onsetSimilarity);
  add("densitySimilarity", comparison.rhythm.densitySimilarity);
  add("durationSimilarity", comparison.rhythm.durationSimilarity);
  add("syncopationSimilarity", comparison.rhythm.syncopationSimilarity);
  if (measured.empty()) {
    return "Nothing to compare: neither profile has material for any field";
  }
  auto describe = [](const std::vector<Measured>& entries) {
    std::string out;
    std::size_t count = std::min<std::size_t>(entries.size(), RATIONALE_FIELDS);
    for (std::size_t i = 0; i < count; ++i) {
      if (i > 0) {
        out += ", ";
      }
      out += entries[i].name + " " + js::to_string(js::round(entries[i].value * 100)) + "%";
    }
    return out;
  };
  std::vector<Measured> highest = measured;
  std::stable_sort(highest.begin(), highest.end(), [](const Measured& x, const Measured& y) {
    return x.value != y.value ? x.value > y.value : x.order < y.order;
  });
  std::vector<Measured> lowest = measured;
  std::stable_sort(lowest.begin(), lowest.end(), [](const Measured& x, const Measured& y) {
    return x.value != y.value ? x.value < y.value : x.order < y.order;
  });
  return "Most alike: " + describe(highest) + "; least alike: " + describe(lowest);
}

std::vector<ProgressionChord> structural(const ReferenceProfile& profile) {
  std::vector<ProgressionChord> out;
  for (const ReferenceChord& chord : profile.harmony.chords) {
    if (chord.level == ReductionLevel::kStructural) {
      out.push_back(ProgressionChord{chord.roman, chord.function});
    }
  }
  return out;
}

std::vector<Nullable<CadenceType>> cadences(const ReferenceProfile& profile) {
  std::vector<Nullable<CadenceType>> out;
  for (const ReferencePhrase& phrase : profile.form.phrases) {
    Nullable<CadenceType> type;
    if (phrase.cadence) {
      type = phrase.cadence->type;
    }
    out.push_back(type);
  }
  return out;
}

std::vector<TimedFunction> timed_functions(const ReferenceProfile& profile) {
  std::vector<TimedFunction> out;
  for (const ReferenceChord& chord : profile.harmony.chords) {
    out.push_back(TimedFunction{chord.startBeat, chord.endBeat, chord.function});
  }
  return out;
}

std::vector<KeyScale> key_plan(const ReferenceProfile& profile) {
  std::vector<KeyScale> out;
  for (const ReferenceKeyRegion& region : profile.harmony.keys) {
    out.push_back(region.key.scale);
  }
  return out;
}

std::vector<SurfaceMotif> surface(const ReferenceProfile& profile) {
  std::vector<SurfaceMotif> out;
  for (const ReferenceMotif& motif : profile.melody.motifs) {
    out.push_back(SurfaceMotif{motif.intervals, motif.rhythm, motif.occurrences});
  }
  return out;
}

MotifStructure structure(const ReferenceProfile& profile) {
  return MotifStructure{profile.melody.graph, profile.span.endBeat - profile.span.startBeat};
}

std::vector<Nullable<ContourPhrase>> contours(const ReferenceProfile& profile) {
  std::vector<Nullable<ContourPhrase>> out;
  for (const ReferencePhrase& phrase : profile.form.phrases) {
    Nullable<ContourPhrase> entry;
    if (phrase.melody) {
      entry = ContourPhrase{phrase.melody->shape, static_cast<double>(phrase.melody->low),
                            static_cast<double>(phrase.melody->high), phrase.melody->outline};
    }
    out.push_back(std::move(entry));
  }
  return out;
}

RegisterPlan register_plan(const ReferenceProfile& profile) {
  RegisterPlan plan;
  for (const ReferencePhrase& phrase : profile.form.phrases) {
    Nullable<RegisterPhrase> entry;
    if (phrase.melody) {
      entry = RegisterPhrase{static_cast<double>(phrase.melody->low),
                             static_cast<double>(phrase.melody->high), phrase.melody->mean,
                             phrase.melody->peakPosition};
    }
    plan.phrases.push_back(std::move(entry));
  }
  if (profile.melody.register_) {
    plan.mean = profile.melody.register_->mean;
  }
  return plan;
}

}  // namespace

ReferenceComparison compare_references(const ReferenceProfile& a, const ReferenceProfile& b,
                                       const ReferenceComparisonOptions& opts) {
  assert_reference_profile(a, "reference profile a");
  assert_reference_profile(b, "reference profile b");
  ReferenceComparison out;
  std::vector<std::string> a_labels;
  std::vector<std::string> b_labels;
  for (const FormSection& section : a.form.sections) {
    a_labels.push_back(section.label);
  }
  for (const FormSection& section : b.form.sections) {
    b_labels.push_back(section.label);
  }
  std::vector<double> a_bars;
  std::vector<double> b_bars;
  for (const ReferencePhrase& phrase : a.form.phrases) {
    a_bars.push_back(phrase.bars);
  }
  for (const ReferencePhrase& phrase : b.form.phrases) {
    b_bars.push_back(phrase.bars);
  }
  out.form.sectionSequenceSimilarity = section_sequence_similarity(a_labels, b_labels);
  out.form.phraseLengthSimilarity = phrase_length_similarity(a_bars, b_bars);
  out.harmony.progressionSimilarity =
      progression_similarity(structural(a), structural(b), opts.budget);
  out.harmony.functionSimilarity = function_similarity(timed_functions(a), timed_functions(b));
  out.harmony.cadenceSimilarity = cadence_similarity(cadences(a), cadences(b));
  out.harmony.keyPlanSimilarity = key_plan_similarity(key_plan(a), key_plan(b));
  out.harmony.harmonicRhythmOnsetSimilarity = onset_similarity(a.harmony.rhythm, b.harmony.rhythm);
  out.harmony.harmonicRhythmDensitySimilarity =
      density_similarity(a.harmony.rhythm, b.harmony.rhythm);
  out.melody.surfaceSimilarity = surface_similarity(surface(a), surface(b));
  out.melody.motifStructureSimilarity = motif_structure_similarity(structure(a), structure(b));
  out.melody.contourSimilarity = contour_similarity(contours(a), contours(b));
  out.melody.registerSimilarity = register_similarity(register_plan(a), register_plan(b));
  out.rhythm.onsetSimilarity = onset_similarity(a.melody.rhythm, b.melody.rhythm);
  out.rhythm.densitySimilarity = density_similarity(a.melody.rhythm, b.melody.rhythm);
  out.rhythm.durationSimilarity = duration_similarity(a.melody.rhythm, b.melody.rhythm);
  out.rhythm.syncopationSimilarity = syncopation_similarity(a.melody.rhythm, b.melody.rhythm);
  out.rationale = rationale_of(out);
  return out;
}

}  // namespace cantus
