#include "ops/codec_a5.h"

#include <cmath>
#include <cstddef>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "analyze/reference/validate.h"
#include "cantus/analyze/functional.h"
#include "cantus/analyze/melody.h"
#include "cantus/analyze/reduction.h"
#include "cantus/analyze/rhythm.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "ops/accessors.h"
#include "ops/validate.h"

namespace cantus::ops {

void write_fields(const ReferenceKeyRegion& v, FieldWriter& w) {
  w.field("startBeat", v.startBeat);
  w.field("endBeat", v.endBeat);
  w.field("key", scale_first(v.key));
  w.field("confidence", v.confidence);
}

void write_fields(const ReferenceMelody& v, FieldWriter& w) {
  w.field("register", v.register_);
  w.field("shape", v.shape);
  w.field("motifs", v.motifs);
  w.field("graph", v.graph);
  w.field("rhythm", v.rhythm);
}

namespace {

constexpr double kMaxSafe = 9007199254740991.0;

std::string at(std::string_view name, std::size_t index) {
  return std::string(name) + "[" + index_text(index) + "]";
}

std::string with(std::string_view name, std::string_view suffix) {
  return std::string(name) + std::string(suffix);
}

template <class E>
std::vector<std::string_view> names_of(const std::vector<E>& values) {
  std::vector<std::string_view> names;
  for (E value : values) {
    names.push_back(to_string(value));
  }
  return names;
}

/** `assertString`. */
std::string assert_string(const json::Value& value, std::string_view name) {
  if (!value.is_string()) {
    throw InvalidInputError(std::string(name) + " must be a string; received " +
                            describe_rejected(value));
  }
  return value.as_string();
}

/** `assertNullable`: a field that has to be present but may be null. */
template <class F>
auto read_nullable(const json::Value& value, std::string_view name,
                   F&& read) -> Nullable<std::decay_t<decltype(read(value, name))>> {
  if (is_undefined(value)) {
    throw InvalidInputError(std::string(name) + " must be present; received undefined");
  }
  if (value.is_null()) {
    return std::nullopt;
  }
  return read(value, name);
}

/** The beats of a span, ordered (`assertFiniteNumber` twice, then `assertSpanOrder`). */
void read_span(const json::Value& read, std::string_view name, double& start_beat,
               double& end_beat) {
  start_beat = assert_finite_number(get(read, "startBeat"), with(name, ".startBeat"));
  end_beat = assert_finite_number(get(read, "endBeat"), with(name, ".endBeat"));
  assert_span_order(start_beat, end_beat, name);
}

/** `assertMassDistribution`. */
std::vector<double> read_mass_distribution(const json::Value& value, double length,
                                           std::string_view name, bool allow_all_zero) {
  const json::Array& shares = assert_array(value, name);
  if (static_cast<double>(shares.size()) != length) {
    throw InvalidInputError(std::string(name) + " must have length " + js::to_string(length) +
                            "; received " + js::to_string(static_cast<double>(shares.size())));
  }
  std::vector<double> out;
  double sum = 0;
  for (std::size_t index = 0; index < shares.size(); ++index) {
    double share = assert_finite_number(shares[index], at(name, index));
    assert_mass_share(share, at(name, index));
    out.push_back(share);
    sum += share;
  }
  assert_mass_sum(sum, name, allow_all_zero);
  return out;
}

BarPositionProfile read_bar_position_profile(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  BarPositionProfile out;
  out.ts = assert_time_signature(get(read, "ts"), with(name, ".ts"));
  double slots = assert_positive_int(get(read, "slotsPerBar"), with(name, ".slotsPerBar"));
  out.slotsPerBar = static_cast<int>(slots);
  double onsets = assert_integer(get(read, "onsets"), with(name, ".onsets"), 0);
  out.onsets = static_cast<std::size_t>(onsets);
  out.shares =
      read_mass_distribution(get(read, "shares"), slots, with(name, ".shares"), onsets == 0);
  return out;
}

RhythmAnalysis read_rhythm_analysis(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  RhythmAnalysis out;
  read_span(read, name, out.startBeat, out.endBeat);
  out.bars = assert_range(get(read, "bars"), 0, kMaxSafe, with(name, ".bars"));
  double onsets = assert_integer(get(read, "onsets"), with(name, ".onsets"), 0);
  out.onsets = static_cast<std::size_t>(onsets);
  out.onsetDensity =
      assert_range(get(read, "onsetDensity"), 0, kMaxSafe, with(name, ".onsetDensity"));
  const json::Array& bar_onsets = assert_array(get(read, "barOnsets"), with(name, ".barOnsets"));
  for (std::size_t index = 0; index < bar_onsets.size(); ++index) {
    double count =
        assert_range(bar_onsets[index], 0, kMaxSafe, at(with(name, ".barOnsets"), index));
    out.barOnsets.push_back(static_cast<std::size_t>(count));
  }
  out.onsetLevels = read_mass_distribution(get(read, "onsetLevels"), RHYTHM_LEVEL_COUNT,
                                           with(name, ".onsetLevels"), onsets == 0);
  const json::Array& positions =
      assert_array(get(read, "barPositions"), with(name, ".barPositions"));
  for (std::size_t index = 0; index < positions.size(); ++index) {
    out.barPositions.push_back(
        read_bar_position_profile(positions[index], at(with(name, ".barPositions"), index)));
  }
  out.interOnsetShares = read_mass_distribution(get(read, "interOnsetShares"),
                                                static_cast<double>(rhythm_ioi_bins().size()),
                                                with(name, ".interOnsetShares"), onsets == 0);
  out.restRatio = assert_range(get(read, "restRatio"), 0, 1, with(name, ".restRatio"));
  out.syncopation = assert_range(get(read, "syncopation"), 0, 1, with(name, ".syncopation"));
  out.offGridRatio = assert_range(get(read, "offGridRatio"), 0, 1, with(name, ".offGridRatio"));
  out.rationale = assert_string(get(read, "rationale"), with(name, ".rationale"));
  return out;
}

FormSection read_form_section(const json::Value& value, std::string_view name,
                              double section_count) {
  const json::Value& read = assert_record(value, name);
  FormSection out;
  out.label = assert_string(get(read, "label"), with(name, ".label"));
  read_span(read, name, out.startBeat, out.endBeat);
  out.bars = assert_range(get(read, "bars"), 0, kMaxSafe, with(name, ".bars"));
  out.firstOccurrence = static_cast<std::size_t>(assert_integer(get(read, "firstOccurrence"),
                                                                with(name, ".firstOccurrence"), 0,
                                                                js::max(section_count - 1, 0)));
  out.similarity = assert_range(get(read, "similarity"), 0, 1, with(name, ".similarity"));
  out.rationale = assert_string(get(read, "rationale"), with(name, ".rationale"));
  return out;
}

ReferenceCadence read_reference_cadence(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  ReferenceCadence out;
  out.atBeat = assert_finite_number(get(read, "atBeat"), with(name, ".atBeat"));
  out.type = *parse_cadence_type(
      assert_one_of(get(read, "type"), names_of(cadence_types()), with(name, ".type")));
  out.weight = assert_range(get(read, "weight"), 0, 1, with(name, ".weight"));
  return out;
}

ReferencePhraseMelody read_reference_phrase_melody(const json::Value& value,
                                                   std::string_view name) {
  const json::Value& read = assert_record(value, name);
  ReferencePhraseMelody out;
  out.shape = *parse_melodic_contour_shape(
      assert_one_of(get(read, "shape"), names_of(melodic_contour_shapes()), with(name, ".shape")));
  out.low = static_cast<int>(assert_midi_pitch(get(read, "low"), with(name, ".low")));
  out.high = static_cast<int>(assert_midi_pitch(get(read, "high"), with(name, ".high")));
  out.mean = assert_range(get(read, "mean"), 0, MIDI_MAX, with(name, ".mean"));
  out.peakPitch = assert_range(get(read, "peakPitch"), 0, MIDI_MAX, with(name, ".peakPitch"));
  out.peakPosition = assert_range(get(read, "peakPosition"), 0, 1, with(name, ".peakPosition"));
  const json::Array& outline = assert_array(get(read, "outline"), with(name, ".outline"));
  if (outline.size() != static_cast<std::size_t>(PHRASE_OUTLINE_POINTS)) {
    throw InvalidInputError(std::string(name) + ".outline must have length " +
                            js::to_string(PHRASE_OUTLINE_POINTS) + "; received " +
                            js::to_string(static_cast<double>(outline.size())));
  }
  for (std::size_t index = 0; index < outline.size(); ++index) {
    out.outline.push_back(assert_finite_number(outline[index], at(with(name, ".outline"), index)));
  }
  out.onsetDensity =
      assert_range(get(read, "onsetDensity"), 0, kMaxSafe, with(name, ".onsetDensity"));
  out.restRatio = assert_range(get(read, "restRatio"), 0, 1, with(name, ".restRatio"));
  return out;
}

ReferencePhrase read_reference_phrase(const json::Value& value, std::string_view name,
                                      const ReferenceSpan& span, double section_count,
                                      double node_count) {
  const json::Value& read = assert_record(value, name);
  ReferencePhrase out;
  read_span(read, name, out.startBeat, out.endBeat);
  // A phrase is part of the piece the profile measures; a plan reads it bar by bar.
  cantus::assert_range(out.startBeat, span.startBeat, span.endBeat, with(name, ".startBeat"));
  cantus::assert_range(out.endBeat, span.startBeat, span.endBeat, with(name, ".endBeat"));
  out.bars = assert_range(get(read, "bars"), 0, kMaxSafe, with(name, ".bars"));
  out.section = read_nullable(
      get(read, "section"), with(name, ".section"), [&](const json::Value& v, std::string_view n) {
        return static_cast<std::size_t>(assert_integer(v, n, 0, js::max(section_count - 1, 0)));
      });
  out.confidence = assert_range(get(read, "confidence"), 0, 1, with(name, ".confidence"));
  out.cadence = read_nullable(get(read, "cadence"), with(name, ".cadence"), read_reference_cadence);
  out.melody =
      read_nullable(get(read, "melody"), with(name, ".melody"), read_reference_phrase_melody);
  const json::Array& nodes = assert_array(get(read, "motifNodes"), with(name, ".motifNodes"));
  for (std::size_t index = 0; index < nodes.size(); ++index) {
    out.motifNodes.push_back(static_cast<std::size_t>(assert_integer(
        nodes[index], at(with(name, ".motifNodes"), index), 0, js::max(node_count - 1, 0))));
  }
  return out;
}

ReferenceForm read_reference_form(const json::Value& value, std::string_view name,
                                  const ReferenceSpan& span, double node_count) {
  const json::Value& read = assert_record(value, name);
  ReferenceForm out;
  const json::Value& hypermeter = assert_record(get(read, "hypermeter"), with(name, ".hypermeter"));
  out.hypermeter.groupBars =
      assert_range(get(hypermeter, "groupBars"), 0, kMaxSafe, with(name, ".hypermeter.groupBars"));
  out.hypermeter.confidence =
      assert_range(get(hypermeter, "confidence"), 0, 1, with(name, ".hypermeter.confidence"));
  const json::Array& sections = assert_array(get(read, "sections"), with(name, ".sections"));
  auto section_count = static_cast<double>(sections.size());
  for (std::size_t index = 0; index < sections.size(); ++index) {
    out.sections.push_back(
        read_form_section(sections[index], at(with(name, ".sections"), index), section_count));
  }
  const json::Array& phrases = assert_array(get(read, "phrases"), with(name, ".phrases"));
  for (std::size_t index = 0; index < phrases.size(); ++index) {
    out.phrases.push_back(read_reference_phrase(phrases[index], at(with(name, ".phrases"), index),
                                                span, section_count, node_count));
  }
  return out;
}

/** `assertResolvedKeyField`: the key as the library reads every key-shaped argument. */
ResolvedKey read_resolved_key_field(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  try {
    return resolve_key(read_key_arg(read));
  } catch (const InvalidInputError& error) {
    throw InvalidInputError(std::string(name) + " must be a valid key: " + error.message());
  }
}

ReferenceKeyRegion read_reference_key_region(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  ReferenceKeyRegion out;
  read_span(read, name, out.startBeat, out.endBeat);
  out.key = read_resolved_key_field(get(read, "key"), with(name, ".key"));
  out.confidence = assert_range(get(read, "confidence"), 0, 1, with(name, ".confidence"));
  return out;
}

ReferenceChord read_reference_chord(const json::Value& value, std::string_view name,
                                    const std::vector<ReferenceKeyRegion>& keys) {
  const json::Value& read = assert_record(value, name);
  ReferenceChord out;
  read_span(read, name, out.startBeat, out.endBeat);
  double key_index = assert_integer(get(read, "key"), with(name, ".key"), 0,
                                    js::max(static_cast<double>(keys.size()) - 1, 0));
  out.key = static_cast<std::size_t>(key_index);
  out.roman = assert_string(get(read, "roman"), with(name, ".roman"));
  try {
    if (out.key >= keys.size()) {
      throw InvalidInputError("key must be a key name or a key/scale; received undefined");
    }
    roman_to_chord(out.roman, keys[out.key].key);
  } catch (const InvalidInputError& error) {
    throw InvalidInputError(std::string(name) +
                            ".roman must be readable by romanToChord; received " +
                            describe_rejected(json::Value(out.roman)) + ": " + error.message());
  }
  out.function = *parse_harmonic_function(assert_one_of(
      get(read, "function"), names_of(harmonic_functions()), with(name, ".function")));
  out.level = *parse_reduction_level(
      assert_one_of(get(read, "level"), names_of(reduction_levels()), with(name, ".level")));
  return out;
}

ReferenceHarmony read_reference_harmony(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  ReferenceHarmony out;
  const json::Array& keys = assert_array(get(read, "keys"), with(name, ".keys"));
  for (std::size_t index = 0; index < keys.size(); ++index) {
    out.keys.push_back(read_reference_key_region(keys[index], at(with(name, ".keys"), index)));
  }
  const json::Array& chords = assert_array(get(read, "chords"), with(name, ".chords"));
  for (std::size_t index = 0; index < chords.size(); ++index) {
    out.chords.push_back(
        read_reference_chord(chords[index], at(with(name, ".chords"), index), out.keys));
  }
  out.rhythm = read_rhythm_analysis(get(read, "rhythm"), with(name, ".rhythm"));
  return out;
}

MotifRelationSummary read_motif_relation_summary(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  MotifRelationSummary out;
  out.kind = *parse_motif_relation_kind(
      assert_one_of(get(read, "kind"), names_of(motif_relation_kinds()), with(name, ".kind")));
  out.sequence = assert_flag(get(read, "sequence"), with(name, ".sequence"));
  out.semitones = assert_finite_number(get(read, "semitones"), with(name, ".semitones"));
  const json::Value& degrees = get(read, "degrees");
  if (!is_undefined(degrees)) {
    out.degrees = assert_finite_number(degrees, with(name, ".degrees"));
  }
  out.timeRatio = assert_finite_number(get(read, "timeRatio"), with(name, ".timeRatio"));
  if (out.timeRatio <= 0) {
    throw InvalidInputError(std::string(name) + ".timeRatio must be positive; received " +
                            js::to_string(out.timeRatio));
  }
  return out;
}

MotifGraphNode read_motif_graph_node(const json::Value& value, std::string_view name,
                                     const std::vector<double>& occurrence_counts) {
  const json::Value& read = assert_record(value, name);
  MotifGraphNode out;
  double motif = assert_integer(get(read, "motif"), with(name, ".motif"), 0,
                                js::max(static_cast<double>(occurrence_counts.size()) - 1, 0));
  out.motif = static_cast<std::size_t>(motif);
  double occurrences = out.motif < occurrence_counts.size() ? occurrence_counts[out.motif] : 1;
  out.occurrence = static_cast<std::size_t>(assert_integer(
      get(read, "occurrence"), with(name, ".occurrence"), 0, js::max(occurrences - 1, 0)));
  read_span(read, name, out.startBeat, out.endBeat);
  return out;
}

MotifGraphEdge read_motif_graph_edge(const json::Value& value, std::string_view name,
                                     double node_count) {
  const json::Value& read = assert_record(value, name);
  MotifGraphEdge out;
  double from =
      assert_integer(get(read, "from"), with(name, ".from"), 0, js::max(node_count - 1, 0));
  double to = assert_integer(get(read, "to"), with(name, ".to"), 0, js::max(node_count - 1, 0));
  if (from >= to) {
    throw InvalidInputError(std::string(name) + ".from must be less than " + std::string(name) +
                            ".to; received from=" + js::to_string(from) +
                            ", to=" + js::to_string(to));
  }
  out.from = static_cast<std::size_t>(from);
  out.to = static_cast<std::size_t>(to);
  out.relation =
      read_nullable(get(read, "relation"), with(name, ".relation"), read_motif_relation_summary);
  out.similarity = assert_range(get(read, "similarity"), 0, 1, with(name, ".similarity"));
  return out;
}

MotifGraph read_motif_graph(const json::Value& value, std::string_view name,
                            const std::vector<double>& occurrence_counts) {
  const json::Value& read = assert_record(value, name);
  MotifGraph out;
  const json::Array& nodes = assert_array(get(read, "nodes"), with(name, ".nodes"));
  for (std::size_t index = 0; index < nodes.size(); ++index) {
    out.nodes.push_back(
        read_motif_graph_node(nodes[index], at(with(name, ".nodes"), index), occurrence_counts));
  }
  const json::Array& edges = assert_array(get(read, "edges"), with(name, ".edges"));
  std::set<std::size_t> seen_to;
  for (std::size_t index = 0; index < edges.size(); ++index) {
    MotifGraphEdge edge = read_motif_graph_edge(edges[index], at(with(name, ".edges"), index),
                                                static_cast<double>(nodes.size()));
    if (!seen_to.insert(edge.to).second) {
      throw InvalidInputError(std::string(name) + ".edges: node " +
                              js::to_string(static_cast<double>(edge.to)) +
                              " has more than one incoming edge");
    }
    out.edges.push_back(std::move(edge));
  }
  return out;
}

ReferenceMotif read_reference_motif(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  ReferenceMotif out;
  const json::Array& intervals = assert_array(get(read, "intervals"), with(name, ".intervals"));
  // The cell has to be writable as MIDI notes: whole semitones spanning at most MIDI_MAX.
  double pitch = 0;
  double low = 0;
  double high = 0;
  for (std::size_t index = 0; index < intervals.size(); ++index) {
    std::string label = at(with(name, ".intervals"), index);
    double interval = assert_finite_number(intervals[index], label);
    if (std::floor(interval) != interval) {
      throw InvalidInputError(label + " must be a whole number of semitones; received " +
                              js::to_string(interval));
    }
    out.intervals.push_back(interval);
    pitch += interval;
    low = js::min(low, pitch);
    high = js::max(high, pitch);
  }
  if (high - low > MIDI_MAX) {
    throw InvalidInputError(std::string(name) + ".intervals must span at most " +
                            js::to_string(MIDI_MAX) + " semitones; received " +
                            js::to_string(high - low));
  }
  const json::Array& rhythm = assert_array(get(read, "rhythm"), with(name, ".rhythm"));
  if (rhythm.size() != intervals.size()) {
    throw InvalidInputError(std::string(name) + ".rhythm must hold one ratio per interval (" +
                            js::to_string(static_cast<double>(intervals.size())) + "); received " +
                            js::to_string(static_cast<double>(rhythm.size())));
  }
  for (std::size_t index = 0; index < rhythm.size(); ++index) {
    std::string label = at(with(name, ".rhythm"), index);
    double ratio = assert_finite_number(rhythm[index], label);
    if (!(ratio > 0)) {
      throw InvalidInputError(label + " must be positive; received " + js::to_string(ratio));
    }
    out.rhythm.push_back(ratio);
  }
  out.unitBeats = assert_range(get(read, "unitBeats"), 0, kMaxSafe, with(name, ".unitBeats"));
  if ((out.unitBeats > 0) != (!rhythm.empty())) {
    throw InvalidInputError(std::string(name) +
                            ".unitBeats must be positive exactly when rhythm is non-empty; "
                            "received " +
                            js::to_string(out.unitBeats) + " with " +
                            js::to_string(static_cast<double>(rhythm.size())) + " ratio(s)");
  }
  out.spanBeats = assert_range(get(read, "spanBeats"), 0, kMaxSafe, with(name, ".spanBeats"));
  out.occurrences = assert_positive_int(get(read, "occurrences"), with(name, ".occurrences"));
  return out;
}

ReferenceRegister read_register(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  ReferenceRegister out;
  out.low = static_cast<int>(assert_midi_pitch(get(read, "low"), with(name, ".low")));
  out.high = static_cast<int>(assert_midi_pitch(get(read, "high"), with(name, ".high")));
  out.mean = assert_range(get(read, "mean"), 0, MIDI_MAX, with(name, ".mean"));
  return out;
}

ReferenceMelody read_reference_melody(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  ReferenceMelody out;
  out.register_ = read_nullable(get(read, "register"), with(name, ".register"), read_register);
  out.shape = read_nullable(get(read, "shape"), with(name, ".shape"),
                            [](const json::Value& v, std::string_view n) {
                              return *parse_melodic_contour_shape(
                                  assert_one_of(v, names_of(melodic_contour_shapes()), n));
                            });
  const json::Array& motifs = assert_array(get(read, "motifs"), with(name, ".motifs"));
  std::vector<double> occurrence_counts;
  for (std::size_t index = 0; index < motifs.size(); ++index) {
    out.motifs.push_back(read_reference_motif(motifs[index], at(with(name, ".motifs"), index)));
    occurrence_counts.push_back(out.motifs.back().occurrences);
  }
  out.graph = read_motif_graph(get(read, "graph"), with(name, ".graph"), occurrence_counts);
  out.rhythm = read_rhythm_analysis(get(read, "rhythm"), with(name, ".rhythm"));
  return out;
}

}  // namespace

ReferenceProfile read_reference_profile(const json::Value& value, std::string_view name) {
  const json::Value& read = assert_record(value, name);
  ReferenceProfile out;
  const json::Value& version = get(read, "profileVersion");
  std::optional<double> version_number = number_of(version);
  if (!version_number || *version_number != REFERENCE_PROFILE_VERSION) {
    throw InvalidInputError(std::string(name) + ".profileVersion must be " +
                            js::to_string(REFERENCE_PROFILE_VERSION) + "; received " +
                            describe_rejected(version));
  }
  std::string span = with(name, ".span");
  const json::Value& span_value = assert_record(get(read, "span"), span);
  read_span(span_value, span, out.span.startBeat, out.span.endBeat);
  out.span.bars = assert_range(get(span_value, "bars"), 0, kMaxSafe, span + ".bars");
  out.meters = assert_meter_map(get(read, "meters"), with(name, ".meters"));
  out.melody = read_reference_melody(get(read, "melody"), with(name, ".melody"));
  out.form = read_reference_form(get(read, "form"), with(name, ".form"), out.span,
                                 static_cast<double>(out.melody.graph.nodes.size()));
  out.harmony = read_reference_harmony(get(read, "harmony"), with(name, ".harmony"));
  return out;
}

}  // namespace cantus::ops
