// Boundary validation for a reference profile: ts/src/analyze/reference/validate.ts.

#include "analyze/reference/validate.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <string>

#include "cantus/analyze/functional.h"
#include "cantus/analyze/reference.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "json/json.h"

namespace cantus {

namespace {

/** `describeRejected` of a number: a number is named by its kind. */
std::string number_text(double value) { return describe_rejected(json::Value(value)); }

/** Validate one time-signature's onset placement profile (`assertBarPositionProfile`). */
void assert_bar_position_profile(const BarPositionProfile& read, std::string_view name) {
  assert_time_signature(read.ts, join_name(name, ".ts"));
  double slots = assert_positive_int(read.slotsPerBar, join_name(name, ".slotsPerBar"));
  assert_integer(static_cast<double>(read.onsets), join_name(name, ".onsets"), 0);
  assert_mass_distribution(read.shares, slots, join_name(name, ".shares"), read.onsets == 0);
}

/** Validate a rhythm analysis (`assertRhythmAnalysis`). */
void assert_rhythm_analysis(const RhythmAnalysis& read, std::string_view name) {
  double start_beat = assert_finite_number(read.startBeat, join_name(name, ".startBeat"));
  double end_beat = assert_finite_number(read.endBeat, join_name(name, ".endBeat"));
  assert_span_order(start_beat, end_beat, name);
  assert_range(read.bars, 0, kMaxSafeInteger, join_name(name, ".bars"));
  assert_integer(static_cast<double>(read.onsets), join_name(name, ".onsets"), 0);
  assert_range(read.onsetDensity, 0, kMaxSafeInteger, join_name(name, ".onsetDensity"));
  for (std::size_t index = 0; index < read.barOnsets.size(); ++index) {
    assert_range(static_cast<double>(read.barOnsets[index]), 0, kMaxSafeInteger,
                 indexed_name(join_name(name, ".barOnsets"), index));
  }
  assert_mass_distribution(read.onsetLevels, RHYTHM_LEVEL_COUNT, join_name(name, ".onsetLevels"),
                           read.onsets == 0);
  for (std::size_t index = 0; index < read.barPositions.size(); ++index) {
    assert_bar_position_profile(read.barPositions[index],
                                indexed_name(join_name(name, ".barPositions"), index));
  }
  assert_mass_distribution(read.interOnsetShares, static_cast<double>(rhythm_ioi_bins().size()),
                           join_name(name, ".interOnsetShares"), read.onsets == 0);
  assert_range(read.restRatio, 0, 1, join_name(name, ".restRatio"));
  assert_range(read.syncopation, 0, 1, join_name(name, ".syncopation"));
  assert_range(read.offGridRatio, 0, 1, join_name(name, ".offGridRatio"));
}

/** Validate one form section, bounding `firstOccurrence` by its array (`assertFormSection`). */
void assert_form_section(const FormSection& read, std::string_view name, double section_count) {
  double start_beat = assert_finite_number(read.startBeat, join_name(name, ".startBeat"));
  double end_beat = assert_finite_number(read.endBeat, join_name(name, ".endBeat"));
  assert_span_order(start_beat, end_beat, name);
  assert_range(read.bars, 0, kMaxSafeInteger, join_name(name, ".bars"));
  assert_integer(static_cast<double>(read.firstOccurrence), join_name(name, ".firstOccurrence"), 0,
                 js::max(section_count - 1, 0));
  assert_range(read.similarity, 0, 1, join_name(name, ".similarity"));
}

/** Validate a phrase's melodic descriptors (`assertReferencePhraseMelody`). */
void assert_reference_phrase_melody(const ReferencePhraseMelody& read, std::string_view name) {
  assert_midi_pitch(read.low, join_name(name, ".low"));
  assert_midi_pitch(read.high, join_name(name, ".high"));
  assert_range(read.mean, 0, MIDI_MAX, join_name(name, ".mean"));
  assert_range(read.peakPitch, 0, MIDI_MAX, join_name(name, ".peakPitch"));
  assert_range(read.peakPosition, 0, 1, join_name(name, ".peakPosition"));
  if (read.outline.size() != static_cast<std::size_t>(PHRASE_OUTLINE_POINTS)) {
    throw InvalidInputError(std::string(name) + ".outline must have length " +
                            js::to_string(PHRASE_OUTLINE_POINTS) + "; received " +
                            js::to_string(static_cast<double>(read.outline.size())));
  }
  for (std::size_t index = 0; index < read.outline.size(); ++index) {
    assert_finite_number(read.outline[index], indexed_name(join_name(name, ".outline"), index));
  }
  assert_range(read.onsetDensity, 0, kMaxSafeInteger, join_name(name, ".onsetDensity"));
  assert_range(read.restRatio, 0, 1, join_name(name, ".restRatio"));
}

/** Validate one phrase, bounding its section and motif-node indices (`assertReferencePhrase`). */
void assert_reference_phrase(const ReferencePhrase& read, std::string_view name,
                             double section_count, double node_count) {
  double start_beat = assert_finite_number(read.startBeat, join_name(name, ".startBeat"));
  double end_beat = assert_finite_number(read.endBeat, join_name(name, ".endBeat"));
  assert_span_order(start_beat, end_beat, name);
  assert_range(read.bars, 0, kMaxSafeInteger, join_name(name, ".bars"));
  if (read.section) {
    assert_integer(static_cast<double>(*read.section), join_name(name, ".section"), 0,
                   js::max(section_count - 1, 0));
  }
  assert_range(read.confidence, 0, 1, join_name(name, ".confidence"));
  if (read.cadence) {
    std::string cadence = join_name(name, ".cadence");
    assert_finite_number(read.cadence->atBeat, cadence + ".atBeat");
    assert_range(read.cadence->weight, 0, 1, cadence + ".weight");
  }
  if (read.melody) {
    assert_reference_phrase_melody(*read.melody, join_name(name, ".melody"));
  }
  for (std::size_t index = 0; index < read.motifNodes.size(); ++index) {
    assert_integer(static_cast<double>(read.motifNodes[index]),
                   indexed_name(join_name(name, ".motifNodes"), index), 0,
                   js::max(node_count - 1, 0));
  }
}

/** Validate the form reading (`assertReferenceForm`). */
void assert_reference_form(const ReferenceForm& read, std::string_view name, double node_count) {
  std::string hypermeter = join_name(name, ".hypermeter");
  assert_range(read.hypermeter.groupBars, 0, kMaxSafeInteger, hypermeter + ".groupBars");
  assert_range(read.hypermeter.confidence, 0, 1, hypermeter + ".confidence");
  auto section_count = static_cast<double>(read.sections.size());
  for (std::size_t index = 0; index < read.sections.size(); ++index) {
    assert_form_section(read.sections[index], indexed_name(join_name(name, ".sections"), index),
                        section_count);
  }
  for (std::size_t index = 0; index < read.phrases.size(); ++index) {
    assert_reference_phrase(read.phrases[index], indexed_name(join_name(name, ".phrases"), index),
                            section_count, node_count);
  }
}

/** Validate one key region (`assertReferenceKeyRegion`). */
void assert_reference_key_region(const ReferenceKeyRegion& read, std::string_view name) {
  double start_beat = assert_finite_number(read.startBeat, join_name(name, ".startBeat"));
  double end_beat = assert_finite_number(read.endBeat, join_name(name, ".endBeat"));
  assert_span_order(start_beat, end_beat, name);
  assert_range(read.confidence, 0, 1, join_name(name, ".confidence"));
}

/** Validate one reduced chord against the key region it points into (`assertReferenceChord`). */
void assert_reference_chord(const ReferenceChord& read, std::string_view name,
                            const std::vector<ReferenceKeyRegion>& keys) {
  double start_beat = assert_finite_number(read.startBeat, join_name(name, ".startBeat"));
  double end_beat = assert_finite_number(read.endBeat, join_name(name, ".endBeat"));
  assert_span_order(start_beat, end_beat, name);
  assert_integer(static_cast<double>(read.key), join_name(name, ".key"), 0,
                 js::max(static_cast<double>(keys.size()) - 1, 0));
  try {
    if (read.key >= keys.size()) {
      throw InvalidInputError("key must be a key name or a key/scale; received undefined");
    }
    roman_to_chord(read.roman, keys[read.key].key);
  } catch (const InvalidInputError& error) {
    throw InvalidInputError(std::string(name) +
                            ".roman must be readable by romanToChord; received " +
                            js::quote(read.roman) + ": " + error.message());
  }
}

/** Validate the harmonic reading (`assertReferenceHarmony`). */
void assert_reference_harmony(const ReferenceHarmony& read, std::string_view name) {
  for (std::size_t index = 0; index < read.keys.size(); ++index) {
    assert_reference_key_region(read.keys[index], indexed_name(join_name(name, ".keys"), index));
  }
  for (std::size_t index = 0; index < read.chords.size(); ++index) {
    assert_reference_chord(read.chords[index], indexed_name(join_name(name, ".chords"), index),
                           read.keys);
  }
  assert_rhythm_analysis(read.rhythm, join_name(name, ".rhythm"));
}

/** Validate one motif's interval and rhythm ratios (`assertReferenceMotif`). */
void assert_reference_motif(const ReferenceMotif& read, std::string_view name) {
  // The cell has to be writable as MIDI notes: whole semitones spanning at most MIDI_MAX.
  double pitch = 0;
  double low = 0;
  double high = 0;
  for (std::size_t index = 0; index < read.intervals.size(); ++index) {
    double interval = assert_finite_number(read.intervals[index],
                                           indexed_name(join_name(name, ".intervals"), index));
    if (std::floor(interval) != interval) {
      throw InvalidInputError(indexed_name(join_name(name, ".intervals"), index) +
                              " must be a whole number of semitones; received " +
                              js::to_string(interval));
    }
    pitch += interval;
    low = js::min(low, pitch);
    high = js::max(high, pitch);
  }
  if (high - low > MIDI_MAX) {
    throw InvalidInputError(std::string(name) + ".intervals must span at most " +
                            js::to_string(MIDI_MAX) + " semitones; received " +
                            js::to_string(high - low));
  }
  if (read.rhythm.size() != read.intervals.size()) {
    throw InvalidInputError(std::string(name) + ".rhythm must hold one ratio per interval (" +
                            js::to_string(static_cast<double>(read.intervals.size())) +
                            "); received " +
                            js::to_string(static_cast<double>(read.rhythm.size())));
  }
  for (std::size_t index = 0; index < read.rhythm.size(); ++index) {
    double ratio =
        assert_finite_number(read.rhythm[index], indexed_name(join_name(name, ".rhythm"), index));
    if (!(ratio > 0)) {
      throw InvalidInputError(indexed_name(join_name(name, ".rhythm"), index) +
                              " must be positive; received " + js::to_string(ratio));
    }
  }
  double unit_beats =
      assert_range(read.unitBeats, 0, kMaxSafeInteger, join_name(name, ".unitBeats"));
  if ((unit_beats > 0) != (!read.rhythm.empty())) {
    throw InvalidInputError(
        std::string(name) +
        ".unitBeats must be positive exactly when rhythm is non-empty; received " +
        js::to_string(unit_beats) + " with " +
        js::to_string(static_cast<double>(read.rhythm.size())) + " ratio(s)");
  }
  assert_range(read.spanBeats, 0, kMaxSafeInteger, join_name(name, ".spanBeats"));
  assert_positive_int(read.occurrences, join_name(name, ".occurrences"));
}

/** Validate the motif graph (`assertMotifGraph`). */
void assert_motif_graph(const MotifGraph& read, std::string_view name,
                        const std::vector<double>& occurrence_counts) {
  for (std::size_t index = 0; index < read.nodes.size(); ++index) {
    const MotifGraphNode& node = read.nodes[index];
    std::string label = indexed_name(join_name(name, ".nodes"), index);
    double motif = assert_integer(static_cast<double>(node.motif), label + ".motif", 0,
                                  js::max(static_cast<double>(occurrence_counts.size()) - 1, 0));
    double occurrences = motif < static_cast<double>(occurrence_counts.size())
                             ? occurrence_counts[static_cast<std::size_t>(motif)]
                             : 1;
    assert_integer(static_cast<double>(node.occurrence), label + ".occurrence", 0,
                   js::max(occurrences - 1, 0));
    double start_beat = assert_finite_number(node.startBeat, label + ".startBeat");
    double end_beat = assert_finite_number(node.endBeat, label + ".endBeat");
    assert_span_order(start_beat, end_beat, label);
  }
  std::set<std::size_t> seen_to;
  auto node_count = static_cast<double>(read.nodes.size());
  for (std::size_t index = 0; index < read.edges.size(); ++index) {
    const MotifGraphEdge& edge = read.edges[index];
    std::string label = indexed_name(join_name(name, ".edges"), index);
    double from = assert_integer(static_cast<double>(edge.from), label + ".from", 0,
                                 js::max(node_count - 1, 0));
    double to =
        assert_integer(static_cast<double>(edge.to), label + ".to", 0, js::max(node_count - 1, 0));
    if (from >= to) {
      throw InvalidInputError(label + ".from must be less than " + label + ".to; received from=" +
                              js::to_string(from) + ", to=" + js::to_string(to));
    }
    if (edge.relation) {
      std::string relation = label + ".relation";
      assert_finite_number(edge.relation->semitones, relation + ".semitones");
      if (edge.relation->degrees) {
        assert_finite_number(*edge.relation->degrees, relation + ".degrees");
      }
      double time_ratio = assert_finite_number(edge.relation->timeRatio, relation + ".timeRatio");
      if (time_ratio <= 0) {
        throw InvalidInputError(relation + ".timeRatio must be positive; received " +
                                js::to_string(time_ratio));
      }
    }
    assert_range(edge.similarity, 0, 1, label + ".similarity");
    if (!seen_to.insert(edge.to).second) {
      throw InvalidInputError(std::string(name) + ".edges: node " +
                              js::to_string(static_cast<double>(edge.to)) +
                              " has more than one incoming edge");
    }
  }
}

/** Validate the melodic reading (`assertReferenceMelody`). */
void assert_reference_melody(const ReferenceMelody& read, std::string_view name) {
  if (read.register_) {
    std::string label = join_name(name, ".register");
    assert_midi_pitch(read.register_->low, label + ".low");
    assert_midi_pitch(read.register_->high, label + ".high");
    assert_range(read.register_->mean, 0, MIDI_MAX, label + ".mean");
  }
  std::vector<double> occurrence_counts;
  for (std::size_t index = 0; index < read.motifs.size(); ++index) {
    assert_reference_motif(read.motifs[index], indexed_name(join_name(name, ".motifs"), index));
    occurrence_counts.push_back(read.motifs[index].occurrences);
  }
  assert_motif_graph(read.graph, join_name(name, ".graph"), occurrence_counts);
  assert_rhythm_analysis(read.rhythm, join_name(name, ".rhythm"));
}

}  // namespace

void assert_span_order(double start_beat, double end_beat, std::string_view name) {
  if (end_beat < start_beat) {
    throw InvalidInputError(std::string(name) + ".endBeat must be at least " + std::string(name) +
                            ".startBeat; received " + js::to_string(end_beat) + " < " +
                            js::to_string(start_beat));
  }
}

void assert_mass_share(double share, std::string_view name) {
  if (share < 0) {
    throw InvalidInputError(std::string(name) + " must be at least 0; received " +
                            js::to_string(share));
  }
}

void assert_mass_sum(double sum, std::string_view name, bool allow_all_zero) {
  if (allow_all_zero && sum == 0) {
    return;
  }
  if (std::fabs(sum - 1) > MASS_TOLERANCE) {
    throw InvalidInputError(std::string(name) + " must sum to 1; received " + js::to_string(sum));
  }
}

void assert_mass_distribution(const std::vector<double>& shares, double length,
                              std::string_view name, bool allow_all_zero) {
  if (static_cast<double>(shares.size()) != length) {
    throw InvalidInputError(std::string(name) + " must have length " + js::to_string(length) +
                            "; received " + js::to_string(static_cast<double>(shares.size())));
  }
  double sum = 0;
  for (std::size_t index = 0; index < shares.size(); ++index) {
    double share = assert_finite_number(shares[index], indexed_name(name, index));
    assert_mass_share(share, indexed_name(name, index));
    sum += share;
  }
  assert_mass_sum(sum, name, allow_all_zero);
}

const ReferenceProfile& assert_reference_profile(const ReferenceProfile& value,
                                                 std::string_view name) {
  if (value.profileVersion != REFERENCE_PROFILE_VERSION) {
    throw InvalidInputError(std::string(name) + ".profileVersion must be " +
                            js::to_string(REFERENCE_PROFILE_VERSION) + "; received " +
                            number_text(value.profileVersion));
  }
  std::string span = join_name(name, ".span");
  double start_beat = assert_finite_number(value.span.startBeat, span + ".startBeat");
  double end_beat = assert_finite_number(value.span.endBeat, span + ".endBeat");
  assert_span_order(start_beat, end_beat, span);
  assert_range(value.span.bars, 0, kMaxSafeInteger, span + ".bars");
  assert_meter_map(value.meters, join_name(name, ".meters"));
  assert_reference_melody(value.melody, join_name(name, ".melody"));
  assert_reference_form(value.form, join_name(name, ".form"),
                        static_cast<double>(value.melody.graph.nodes.size()));
  assert_reference_harmony(value.harmony, join_name(name, ".harmony"));
  return value;
}

}  // namespace cantus
