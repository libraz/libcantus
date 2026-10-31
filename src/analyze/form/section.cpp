// Sections, recovered from repetition: ts/src/analyze/form/section.ts.

#include <algorithm>
#include <cmath>
#include <map>
#include <string>

#include "analyze/adjacency.h"
#include "analyze/form/internal.h"
#include "analyze/grid.h"
#include "analyze/histogram.h"
#include "cantus/analyze/form.h"
#include "cantus/analyze/melody.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** One unit of comparison: a fixed run of bars and what sounds in it (`Unit`). */
struct Unit {
  double startBeat = 0;
  double endBeat = 0;
  /** The notes whose onsets fall inside the unit, in time order. */
  std::vector<NoteEvent> notes;
  /** Pitch-class weights over the unit. */
  std::array<double, 12> weights{};
};

/** The nth label in the sequence A, B, ... Z, AA, AB, ... (`labelAt`). */
std::string label_at(double index) {
  double n = index;
  std::string label;
  do {
    label = std::string(1, static_cast<char>(65 + static_cast<int>(std::fmod(n, 26)))) + label;
    n = std::floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Whether nothing sounds in a unit (`isSilent`): silence takes no label of its own. */
bool is_silent(const Unit& unit) { return unit.notes.empty(); }

/** How alike two units are, in [0, 1] (`unitSimilarity`). */
double unit_similarity(const Unit& a, const Unit& b) {
  double harmony = weight_similarity(a.weights, b.weights);
  if (a.notes.size() < 2 || b.notes.size() < 2) {
    return a.notes.size() == b.notes.size() ? harmony : 0;
  }
  double melody = melodic_similarity(a.notes, b.notes);
  return clamp01(MELODY_SHARE * melody + HARMONY_SHARE * harmony);
}

}  // namespace

std::vector<FormSection> sections_from_notes(const std::vector<NoteEvent>& notes,
                                             const FormSectionOptions& opts) {
  ResolveMetersOptions meter_options;
  meter_options.ts = opts.ts;
  meter_options.meters = opts.meters;
  MeterMap meters_map = resolve_meters(meter_options, "section meters");
  const MeterArg meters(meters_map);
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = opts.budget;
  assert_note_events(notes, "section notes", note_options);
  std::vector<NoteEvent> sounding;
  for (const NoteEvent& note : notes) {
    if (note.durationBeat > 0) {
      sounding.push_back(note);
    }
  }
  // The pickup rule the whole analysis shares.
  double first_sounding = first_sounding_beat(sounding);
  double first_onset = bar_grid_start(first_sounding, meters);
  double span_end = resolve_span_end(opts.totalBeats, first_onset, latest_sounding_end(sounding),
                                     "section totalBeats");
  if (sounding.empty()) {
    // Nothing sounds, so there is no material to hear a form in.
    return {};
  }
  double threshold = opts.threshold.value_or(SECTION_DEFAULT_THRESHOLD);
  assert_range(threshold, 0, 1, "section threshold");
  HypermeterOptions grouping_options;
  grouping_options.totalBeats = span_end;
  grouping_options.budget = opts.budget;
  double unit_bars =
      opts.unitBars ? *opts.unitBars : hypermeter(sounding, meters, grouping_options).groupBars;
  assert_positive_int(unit_bars, "section unitBars");

  double first_bar = bar_index_at(first_onset, meters);
  double last_bar = last_bar_of(meters, first_onset, span_end);
  // The units are counted from the bar the music starts in, not from bar 0; a pickup is folded
  // into the opening unit.
  double start_bar = js::max(0, first_bar);
  double unit_count = js::max(1, std::ceil((last_bar - start_bar + 1) / unit_bars));
  assert_generation_budget(unit_count * unit_count, "form section comparisons", opts.budget);
  assert_generation_budget(unit_count * static_cast<double>(sounding.size()),
                           "form section unit notes", opts.budget);

  std::vector<Unit> units;
  for (double index = 0; index < unit_count; index += 1) {
    double bar_start = start_bar + index * unit_bars;
    double start_beat =
        index == 0 ? first_onset : bar_position_to_beat(BarPosition{bar_start, 0}, meters);
    double end_beat = index == unit_count - 1
                          ? span_end
                          : bar_position_to_beat(BarPosition{bar_start + unit_bars, 0}, meters);
    Unit unit;
    unit.startBeat = start_beat;
    unit.endBeat = end_beat;
    // The opening unit holds everything before its end: a note a millibeat early sounds in it.
    double from_beat = index == 0 ? js::min(first_sounding, start_beat) : start_beat;
    for (const NoteEvent& note : sounding) {
      if (note.startBeat >= from_beat - BEAT_EPS && note.startBeat < end_beat - BEAT_EPS) {
        unit.notes.push_back(note);
      }
    }
    std::stable_sort(
        unit.notes.begin(), unit.notes.end(), [](const NoteEvent& a, const NoteEvent& b) {
          double by_start = a.startBeat - b.startBeat;
          double order = by_start != 0 && !std::isnan(by_start) ? by_start : a.pitch - b.pitch;
          return order < 0;
        });
    unit.weights = window_weights(unit.notes, nullptr, start_beat, end_beat, meters).weights;
    units.push_back(std::move(unit));
  }

  // Comparing two units runs an edit distance over their notes, so what the comparisons cost is
  // the sum over pairs of the product of what each holds.
  double comparisons = 0;
  double earlier_notes = 0;
  for (const Unit& unit : units) {
    comparisons += static_cast<double>(unit.notes.size()) * earlier_notes;
    earlier_notes += static_cast<double>(unit.notes.size());
  }
  assert_generation_budget(comparisons, "form section melody comparisons", opts.budget);

  // Label every unit, then merge the neighbours that agree. A silent unit takes no label.
  std::vector<std::optional<std::string>> labels;
  std::vector<double> scores;
  double distinct = 0;
  for (std::size_t index = 0; index < units.size(); ++index) {
    const Unit& unit = units[index];
    if (is_silent(unit)) {
      labels.emplace_back(std::nullopt);
      scores.push_back(index >= 1 ? scores[index - 1] : 1);
      continue;
    }
    double best_score = -1;
    double best_index = -1;
    for (std::size_t earlier = 0; earlier < index; ++earlier) {
      const Unit& other = units[earlier];
      if (is_silent(other)) {
        continue;
      }
      double score = unit_similarity(unit, other);
      // Ties keep the earlier match, which is the statement being restated.
      if (score > best_score) {
        best_score = score;
        best_index = static_cast<double>(earlier);
      }
    }
    if (best_index >= 0 && best_score >= threshold) {
      const std::optional<std::string>& matched = labels[static_cast<std::size_t>(best_index)];
      labels.emplace_back(matched ? *matched : label_at(distinct));
      scores.push_back(best_score);
    } else {
      labels.emplace_back(label_at(distinct));
      scores.push_back(1);
      distinct += 1;
    }
  }

  std::vector<FormSection> sections;
  std::map<std::string, std::size_t> first_by_label;
  for (std::size_t index = 0; index < units.size();) {
    if (!labels[index]) {
      // Only reachable before anything sounds, which the unit grid rules out.
      index += 1;
      continue;
    }
    const std::string label = *labels[index];
    std::size_t end = index;
    double score_sum = 0;
    double sounded = 0;
    while (end < units.size() && labels[end] == label) {
      score_sum += scores[end];
      sounded += 1;
      end += 1;
    }
    // Silence following the statement belongs to it, but it also closes it.
    while (end < units.size() && !labels[end]) {
      end += 1;
    }
    double start_beat = units[index].startBeat;
    double end_beat = units[end - 1].endBeat;
    // Counted on the unit grid the sections were merged on, not from the raw start beat.
    double section_first_bar = start_bar + static_cast<double>(index) * unit_bars;
    double section_last_bar = js::max(
        section_first_bar, js::min(last_bar, start_bar + static_cast<double>(end) * unit_bars - 1));
    std::size_t section_index = sections.size();
    auto found = first_by_label.find(label);
    bool is_first = found == first_by_label.end();
    if (is_first) {
      first_by_label[label] = section_index;
    }
    double similarity = is_first ? 1 : clamp01(score_sum / js::max(1, sounded));
    FormSection section;
    section.label = label;
    section.startBeat = start_beat;
    section.endBeat = end_beat;
    section.bars = section_last_bar - section_first_bar + 1;
    section.firstOccurrence = is_first ? section_index : found->second;
    section.similarity = similarity;
    section.rationale =
        is_first
            ? "Section " + label + ": material first heard at beat " + js::to_string(start_beat)
            : "Section " + label + ": " + js::to_string(js::round(similarity * 100)) +
                  "% alike the " + label + " at beat " +
                  js::to_string(sections[found->second].startBeat);
    sections.push_back(std::move(section));
    index = end;
  }
  return sections;
}

}  // namespace cantus
