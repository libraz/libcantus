// Phrases, the unit of music one bar larger than the chord: ts/src/analyze/form/phrase.ts.

#include "analyze/form/phrase.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <map>
#include <memory>
#include <set>
#include <string>

#include "analyze/adjacency.h"
#include "analyze/form/hypermeter.h"
#include "analyze/form/internal.h"
#include "analyze/grid.h"
#include "analyze/keys/keys.h"
#include "analyze/melody/internal.h"
#include "analyze/voice/voice.h"
#include "cantus/analyze/melody.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** `Number.MIN_VALUE`. */

/** A name and the number it stands for. */
struct NamedDouble {
  std::string_view name;
  double value;
};

/** CADENCE_BOUNDARY_STRENGTH: how strongly each cadence type marks a boundary. */
constexpr NamedDouble kCadenceBoundaryStrength[] =
#include "analyze/form/cadence_boundary_strength.gen.inc"
    ;

/** CADENCE_CLOSURE: how much of the structure each cadence type closes. */
constexpr NamedDouble kCadenceClosure[] =
#include "analyze/form/cadence_closure.gen.inc"
    ;

/** SIGNAL_ORDER: the order boundary signals are reported in when they are equally strong. */
constexpr std::string_view kSignalOrder[] =
#include "analyze/form/signal_order.gen.inc"
    ;

constexpr std::array<std::string_view, 6> kSignalNames = {"cadence",    "rest",       "longNote",
                                                          "repetition", "hypermeter", "pieceEnd"};

double lookup(const NamedDouble* table, std::size_t size, std::string_view name) {
  for (std::size_t i = 0; i < size; ++i) {
    if (table[i].name == name) {
      return table[i].value;
    }
  }
  return 0;
}

/** `SIGNAL_ORDER.indexOf(signal)`. */
std::size_t signal_rank(PhraseSignal signal) {
  std::string_view name = to_string(signal);
  for (std::size_t i = 0; i < std::size(kSignalOrder); ++i) {
    if (kSignalOrder[i] == name) {
      return i;
    }
  }
  return std::size(kSignalOrder);
}

/** A candidate boundary and everything that argues for it (`Boundary`). */
struct Boundary {
  double beat = 0;
  std::map<PhraseSignal, double> strengths;
  Nullable<CadenceHit> cadence;
  /** The segment the cadence arrived on. */
  std::optional<std::size_t> arrival;
};

/** Orders keys the way a `Map` of numbers finds them: NaN is a key, equal to itself. */
struct KeyLess {
  bool operator()(double a, double b) const {
    if (std::isnan(a)) {
      return false;
    }
    return std::isnan(b) || a < b;
  }
};

using Boundaries = std::map<double, Boundary, KeyLess>;

/** Record a signal at a beat, keeping the strongest claim made for it (`addSignal`). */
void add_signal(Boundaries& boundaries, double beat, PhraseSignal signal, double strength,
                const CadenceHit* cadence = nullptr, std::optional<std::size_t> arrival = {}) {
  // Beats arrive from bar arithmetic and from note ends, which land an epsilon apart on the same
  // boundary; keying on a rounded beat merges them.
  double key = beat_key(beat);
  auto found = boundaries.find(key);
  if (found == boundaries.end()) {
    Boundary fresh;
    fresh.beat = beat;
    found = boundaries.emplace(key, std::move(fresh)).first;
  }
  Boundary& boundary = found->second;
  auto held = boundary.strengths.find(signal);
  boundary.strengths[signal] =
      js::max(held != boundary.strengths.end() ? held->second : 0, strength);
  if (cadence != nullptr && !boundary.cadence) {
    boundary.cadence = *cadence;
    boundary.arrival = arrival;
  }
}

/** What a boundary is worth, with and without the cadence it carries (`BoundaryReading`). */
struct BoundaryReading {
  /** Total strength of every signal. */
  double strength = 0;
  /** Total strength of the signals other than the cadence. */
  double uncredited = 0;
  /** The signals, strongest first. */
  std::vector<PhraseSignal> signals;
};

BoundaryReading read_boundary(const Boundary& boundary) {
  std::vector<std::pair<PhraseSignal, double>> signals(boundary.strengths.begin(),
                                                       boundary.strengths.end());
  std::stable_sort(signals.begin(), signals.end(), [](const auto& a, const auto& b) {
    double by_strength = b.second - a.second;
    return js::or_else(by_strength, static_cast<double>(signal_rank(a.first)) -
                                        static_cast<double>(signal_rank(b.first))) < 0;
  });
  BoundaryReading out;
  std::vector<double> strengths;
  std::vector<double> uncredited;
  for (const auto& [signal, strength] : signals) {
    strengths.push_back(strength);
    if (signal != PhraseSignal::kCadence) {
      uncredited.push_back(strength);
    }
    out.signals.push_back(signal);
  }
  out.strength = combine_evidence(strengths);
  out.uncredited = combine_evidence(uncredited);
  return out;
}

/** Whether a cadence arriving at `at_beat` closes the phrase [start, end) (`closesPhrase`). */
bool closes_phrase(double at_beat, double start_beat, double end_beat) {
  return within_beats(at_beat, start_beat, end_beat);
}

/** How well a length matches what a phrase is expected to run (`lengthFit`). */
double length_fit(double length, double expected) {
  if (!(expected > 0)) {
    return 0;
  }
  return js::max(-1, 1 - std::fabs(length - expected) / expected);
}

/**
 * Boundaries argued for by a cadence's arrival chord held across bar lines
 * (`heldCadenceBoundaries`): every bar line the chord sounds across closes its phrase.
 */
void held_cadence_boundaries(Boundaries& boundaries, const CadenceHit& hit,
                             std::optional<std::size_t> arrival, const CadenceSpan& span,
                             const MeterArg& meters, double span_end) {
  // Bar lines past the end of the span bound no phrase.
  double first_line = bar_index_at(span.atBeat, meters) + 1;
  double last_line = bar_index_at(js::min(span.endBeat, span_end), meters);
  // The lines lie inside the span, whose bar count the form bars check has bounded.
  for (double bar = first_line; bar <= last_line; bar += 1) {
    double line = bar_position_to_beat(BarPosition{bar, 0}, meters);
    if (line < span.endBeat - BEAT_EPS) {
      add_signal(boundaries, line, PhraseSignal::kCadence, span.strength, &hit, arrival);
    }
  }
}

/** Boundaries argued for by silence in the melody (`restBoundaries`). */
void rest_boundaries(Boundaries& boundaries, const std::vector<NoteEvent>& notes,
                     const MeterArg& meters, double rest_beats) {
  std::vector<NoteEvent> ordered = notes;
  std::stable_sort(ordered.begin(), ordered.end(), [](const NoteEvent& a, const NoteEvent& b) {
    double by_start = a.startBeat - b.startBeat;
    return js::or_else(by_start, a.pitch - b.pitch) < 0;
  });
  double covered = -std::numeric_limits<double>::infinity();
  for (const NoteEvent& note : ordered) {
    double gap = note.startBeat - covered;
    if (std::isfinite(covered) && gap >= rest_beats - BEAT_EPS) {
      double bar = beats_per_bar_at(note.startBeat, meters);
      add_signal(boundaries, note.startBeat, PhraseSignal::kRest,
                 REST_STRENGTH * clamp01(bar > 0 ? gap / bar : 1));
    }
    covered = js::max(covered, note.startBeat + note.durationBeat);
  }
}

/** Boundaries argued for by immediate repetition of the preceding span (`repetitionBoundaries`). */
void repetition_boundaries(Boundaries& boundaries, const std::vector<NoteEvent>& notes,
                           const MeterArg& meters, double span_start, double span_end,
                           double window_beats, std::optional<double> budget) {
  if (!(window_beats > 0)) {
    return;
  }
  std::vector<BarSlice> slices = slice_bars(notes, meters, span_start, span_end, budget);
  assert_generation_budget(static_cast<double>(slices.size()) * static_cast<double>(notes.size()),
                           "form repetition comparisons", budget);
  auto onsets_in = [&](double from, double to) {
    std::vector<NoteEvent> out;
    for (const NoteEvent& note : notes) {
      if (within_beats(note.startBeat, from, to)) {
        out.push_back(note);
      }
    }
    return out;
  };
  // Comparing the two windows runs an edit distance over their notes, so the work is the product
  // of what each side holds, charged as it is incurred.
  double comparisons = 0;
  for (const BarSlice& slice : slices) {
    double beat = slice.startBeat;
    if (beat - window_beats < span_start - BEAT_EPS || beat + window_beats > span_end + BEAT_EPS) {
      continue;
    }
    std::vector<NoteEvent> before = onsets_in(beat - window_beats, beat);
    std::vector<NoteEvent> after = onsets_in(beat, beat + window_beats);
    // One note is a pitch, not a figure.
    if (before.size() < 2 || after.size() < 2) {
      continue;
    }
    comparisons += static_cast<double>(before.size()) * static_cast<double>(after.size());
    assert_generation_budget(comparisons, "form repetition melody comparisons", budget);
    double similarity = melodic_similarity(before, after);
    if (similarity >= REPETITION_THRESHOLD) {
      add_signal(boundaries, beat, PhraseSignal::kRepetition, REPETITION_STRENGTH * similarity);
    }
  }
}

/** Grade a cadence by how much of the structure it closes (`structuralWeightOf`). */
double structural_weight_of(const Nullable<CadenceHit>& cadence, double confidence, bool aligned,
                            bool is_last) {
  if (!cadence || !cadence->cadence.type) {
    return 0;
  }
  const CadenceResult& result = cadence->cadence;
  double base = lookup(kCadenceClosure, std::size(kCadenceClosure), to_string(*result.type));
  if (result.type == CadenceType::kAuthentic) {
    if (result.strength == CadenceStrength::kPerfect) {
      base = 1;
    } else if (result.strength == CadenceStrength::kImperfect) {
      base *= IMPERFECT_CLOSURE_FACTOR;
    }
  }
  if (result.evaded) {
    base *= EVADED_FACTOR;
  }
  double weight = base * confidence;
  if (is_last) {
    weight += FINAL_PHRASE_BONUS;
  }
  if (aligned) {
    weight += HYPERMETRIC_CLOSE_BONUS;
  }
  return clamp01(weight);
}

/** Name a cadence the way a rationale reads it (`describeCadence`). */
std::string describe_cadence(const Nullable<CadenceHit>& cadence) {
  if (!cadence || !cadence->cadence.type) {
    return "no cadence";
  }
  const CadenceResult& result = cadence->cadence;
  std::optional<std::string> strength;
  if (result.strength) {
    strength = std::string(to_string(*result.strength));
  }
  return describe_cadence_text(std::string(to_string(*result.type)), strength,
                               js::to_string(cadence->atBeat));
}

}  // namespace

std::string_view to_string(PhraseSignal signal) {
  return kSignalNames[static_cast<std::size_t>(signal)];
}

std::optional<PhraseSignal> parse_phrase_signal(std::string_view name) {
  return parse_named<PhraseSignal>(kSignalNames, name);
}

std::string describe_cadence_text(const std::string& type,
                                  const std::optional<std::string>& strength,
                                  const std::string& at_beat) {
  std::string graded = strength ? *strength + " " + type : type;
  return "a " + graded + " cadence at beat " + at_beat;
}

std::vector<std::size_t> choose_phrase_path(const std::vector<double>& beats,
                                            const std::vector<double>& strengths,
                                            double min_phrase_beats, double expected,
                                            const HeldCadences* held) {
  std::vector<double> value(beats.size(), -std::numeric_limits<double>::infinity());
  std::vector<std::ptrdiff_t> came_from(beats.size(), -1);
  if (!beats.empty()) {
    value[0] = 0;
  }
  for (std::size_t j = 1; j < beats.size(); ++j) {
    double end_beat = beats[j];
    for (std::size_t i = 0; i < j; ++i) {
      if (!std::isfinite(value[i])) {
        continue;
      }
      double length = end_beat - beats[i];
      if (length < min_phrase_beats - BEAT_EPS) {
        continue;
      }
      bool credited =
          held == nullptr || closes_phrase(j < held->arrivals.size() ? held->arrivals[j] : end_beat,
                                           beats[i], end_beat);
      double strength = credited ? (j < strengths.size() ? strengths[j] : 0)
                                 : (j < held->uncredited.size() ? held->uncredited[j] : 0);
      double gain = value[i] + strength + length_fit(length, expected) - PHRASE_CUT_COST;
      if (gain > value[j]) {
        value[j] = gain;
        came_from[j] = static_cast<std::ptrdiff_t>(i);
      }
    }
  }
  std::vector<std::size_t> path;
  if (beats.empty()) {
    return path;
  }
  std::size_t last = beats.size() - 1;
  if (last > 0 && std::isfinite(value[last])) {
    for (std::size_t i = last; i > 0; i = static_cast<std::size_t>(came_from[i])) {
      path.push_back(i);
    }
    std::reverse(path.begin(), path.end());
  } else if (last > 0) {
    // Nothing reached the end, so the whole span is the phrase.
    path.push_back(last);
  }
  return path;
}

KeyAtBeat modulation_key_at(std::vector<KeyRegion> regions) {
  auto held = std::make_shared<std::vector<KeyRegion>>(std::move(regions));
  auto lookup_key = std::make_shared<KeyLookup>(*held, prevailing_key_or_default(*held));
  // The pitch classes alone: a phrase boundary is argued from cadences and scale membership.
  return [held, lookup_key](double beat) { return scale_of((*lookup_key)(beat)); };
}

BoundaryCadences boundary_cadences(const std::vector<CadenceHit>& found,
                                   const std::vector<std::size_t>& found_arrivals,
                                   const std::vector<SegmentSpan>& segments) {
  BoundaryCadences out;
  std::vector<CadenceArrival> arrivals;
  for (std::size_t n = 0; n < found.size(); ++n) {
    if (!found[n].cadence.type) {
      continue;
    }
    arrivals.push_back(CadenceArrival{
        found[n].atBeat, lookup(kCadenceBoundaryStrength, std::size(kCadenceBoundaryStrength),
                                to_string(*found[n].cadence.type))});
    out.hits.push_back(found[n]);
    if (n < found_arrivals.size()) {
      out.arrivals.push_back(found_arrivals[n]);
    }
  }
  out.spans = cadence_spans(arrivals, segments);
  return out;
}

BoundaryCadences boundary_cadences(const ChordTimeline& timeline, const KeyContext& key) {
  return boundary_cadences(detect_cadences(timeline, key), {}, spans_of(timeline.segments));
}

PhraseReading phrases_over(const PhraseSource& source, const std::vector<NoteEvent>& notes,
                           const PhraseOptions& opts) {
  MeterMap meters_map = resolve_meters({opts.ts, opts.meters}, "phrase meters");
  const MeterArg meters(meters_map);
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = opts.budget;
  assert_note_events(notes, "phrase notes", note_options);
  if (opts.hypermeter) {
    // The one structured option, held to the contract its own type states.
    assert_range(opts.hypermeter->confidence, 0, 1, "phrase hypermeter confidence");
    assert_positive_int(opts.hypermeter->groupBars, "phrase hypermeter groupBars");
  }
  std::vector<NoteEvent> sounding = drop_silent_notes(notes);
  const std::vector<SegmentSpan>& segments = source.segments;
  // The pickup rule the whole analysis shares.
  TimelineSpan extent = timeline_span(sounding, segments, meters);
  double span_start = extent.startBeat;
  double span_end =
      resolve_span_end(source.total_beats(), span_start, extent.notesEnd, "phrase totalBeats");
  PhraseReading reading;
  if (span_end <= span_start + BEAT_EPS) {
    // Nothing sounds, so there is no material to hear a phrase in.
    return reading;
  }

  double bar_beats = beats_per_bar_at(js::max(0, span_start), meters);
  double rest_beats = source.rest_beats(bar_beats / 2);
  assert_range(rest_beats, kMinValue, kMaxSafeInteger, "phrase restBeats");
  double long_note_beats = source.long_note_beats(bar_beats);
  assert_range(long_note_beats, kMinValue, kMaxSafeInteger, "phrase longNoteBeats");
  double min_phrase_beats = source.min_phrase_beats(bar_beats);
  assert_range(min_phrase_beats, kMinValue, kMaxSafeInteger, "phrase minPhraseBeats");

  // The key context cadence detection is read against.
  KeyAtBeat key_at;
  if (source.key) {
    key_at = source.key();
  } else {
    // Read from the chords the cadences are formed of, as the timeline's own modulations are
    // (`keyContextFor`).
    KeyTimelineOptions key_options;
    key_options.meters = meters_map;
    key_options.totalBeats = span_end;
    key_options.budget = opts.budget;
    key_at = modulation_key_at(source.modulations(key_options));
  }
  // Each cadence that marks a boundary once, as the span its arrival chord sounds through: the
  // phrase boundaries and the hyperbar ends are both read from these.
  std::vector<std::size_t> found_arrivals;
  std::vector<CadenceHit> found =
      detect_cadences_over(segments, source.chords, key_at, &found_arrivals);
  BoundaryCadences marking = boundary_cadences(found, found_arrivals, segments);
  const std::vector<CadenceHit>& cadences = marking.hits;
  const std::vector<std::size_t>& hit_arrivals = marking.arrivals;
  const std::vector<CadenceSpan>& spans = marking.spans;
  Hypermeter grouping;
  if (opts.hypermeter) {
    grouping = *opts.hypermeter;
  } else {
    HypermeterOptions grouping_options;
    grouping_options.totalBeats = span_end;
    grouping_options.budget = opts.budget;
    grouping = hypermeter_over(sounding, meters, grouping_options, [&] { return spans; });
  }
  auto downbeats = [&]() -> std::vector<double> {
    return opts.hypermeter ? source.given_downbeats() : grouping.downbeats;
  };
  // The hyperbar the span opens in, not the one the piece opens in.
  double first_bar = bar_index_at(js::max(0, span_start), meters);
  double hyper_beats = js::max(
      bar_beats, bar_position_to_beat(BarPosition{first_bar + grouping.groupBars, 0}, meters) -
                     bar_position_to_beat(BarPosition{first_bar, 0}, meters));
  double expected = source.expected_phrase_beats(hyper_beats);
  assert_range(expected, kMinValue, kMaxSafeInteger, "phrase expectedPhraseBeats");

  Boundaries boundaries;
  for (std::size_t n = 0; n < cadences.size(); ++n) {
    const CadenceHit& hit = cadences[n];
    const CadenceSpan& span = spans[n];
    add_signal(boundaries, span.endBeat, PhraseSignal::kCadence, span.strength, &hit,
               hit_arrivals[n]);
    held_cadence_boundaries(boundaries, hit, hit_arrivals[n], span, meters, span_end);
  }
  rest_boundaries(boundaries, sounding, meters, rest_beats);
  for (const NoteEvent& note : sounding) {
    if (note.durationBeat >= long_note_beats - BEAT_EPS) {
      add_signal(boundaries, note.startBeat + note.durationBeat, PhraseSignal::kLongNote,
                 LONG_NOTE_STRENGTH);
    }
  }
  repetition_boundaries(boundaries, sounding, meters, span_start, span_end, hyper_beats,
                        opts.budget);
  for (double downbeat : downbeats()) {
    add_signal(boundaries, downbeat, PhraseSignal::kHypermeter,
               HYPERMETER_STRENGTH * grouping.confidence);
  }
  add_signal(boundaries, span_end, PhraseSignal::kPieceEnd, PIECE_END_STRENGTH);

  // The span's own ends are boundaries whether or not anything argues for them.
  struct Candidate {
    const Boundary* boundary;
    BoundaryReading reading;
  };
  std::vector<Candidate> candidates;
  for (const auto& entry : boundaries) {
    const Boundary& boundary = entry.second;
    if (boundary.beat > span_start + BEAT_EPS && boundary.beat < span_end - BEAT_EPS) {
      BoundaryReading boundary_reading = read_boundary(boundary);
      if (boundary_reading.strength > 0) {
        candidates.push_back(Candidate{&boundary, std::move(boundary_reading)});
      }
    }
  }
  std::stable_sort(candidates.begin(), candidates.end(),
                   [](const Candidate& a, const Candidate& b) {
                     return a.boundary->beat - b.boundary->beat < 0;
                   });
  Boundary fallback_end;
  fallback_end.beat = span_end;
  auto end_found = boundaries.find(beat_key(span_end));
  const Boundary& end_boundary = end_found != boundaries.end() ? end_found->second : fallback_end;
  Boundary start_boundary;
  start_boundary.beat = span_start;
  std::vector<const Boundary*> stops;
  std::vector<BoundaryReading> readings;
  stops.push_back(&start_boundary);
  readings.push_back(read_boundary(start_boundary));
  for (Candidate& candidate : candidates) {
    stops.push_back(candidate.boundary);
    readings.push_back(std::move(candidate.reading));
  }
  stops.push_back(&end_boundary);
  readings.push_back(read_boundary(end_boundary));
  assert_generation_budget(static_cast<double>(stops.size()) * static_cast<double>(stops.size()),
                           "form phrase boundary pairs", opts.budget);

  std::vector<double> stop_beats;
  std::vector<double> stop_strengths;
  HeldCadences held;
  for (std::size_t i = 0; i < stops.size(); ++i) {
    const Boundary* stop = stops[i];
    stop_beats.push_back(stop->beat);
    stop_strengths.push_back(readings[i].strength);
    held.arrivals.push_back(stop->cadence ? stop->cadence->atBeat : stop->beat);
    held.uncredited.push_back(readings[i].uncredited);
  }
  std::vector<std::size_t> path =
      choose_phrase_path(stop_beats, stop_strengths, min_phrase_beats, expected, &held);

  std::set<double, KeyLess> downbeat_keys;
  for (double downbeat : downbeats()) {
    downbeat_keys.insert(beat_key(downbeat));
  }
  std::size_t from = 0;
  for (std::size_t n = 0; n < path.size(); ++n) {
    std::size_t to = path[n];
    double start_beat = stops[from]->beat;
    const Boundary& stop = *stops[to];
    double end_beat = stop.beat;
    const BoundaryReading& stop_reading = readings[to];
    double length = end_beat - start_beat;
    bool is_last = n == path.size() - 1;
    // A cadence that arrived before this phrase began cannot be the one closing it.
    Nullable<CadenceHit> cadence;
    std::optional<std::size_t> arrival;
    if (stop.cadence && closes_phrase(stop.cadence->atBeat, start_beat, end_beat)) {
      cadence = stop.cadence;
      arrival = stop.arrival;
    }
    // Read from the signals the phrase reports, so a dropped cadence adds nothing.
    double closing_strength = cadence ? stop_reading.strength : stop_reading.uncredited;
    double confidence = clamp01(CLOSING_SHARE * closing_strength +
                                (1 - CLOSING_SHARE) * js::max(0, length_fit(length, expected)));
    double structural_weight = structural_weight_of(
        cadence, confidence, downbeat_keys.count(beat_key(end_beat)) > 0, is_last);
    // The signals say what the boundary was read from, so a cadence dropped as belonging to an
    // earlier phrase is dropped from them too.
    std::vector<PhraseSignal> signals;
    for (PhraseSignal signal : stop_reading.signals) {
      if (cadence || signal != PhraseSignal::kCadence) {
        signals.push_back(signal);
      }
    }
    double bars = round_to(bar_span_of(start_beat, end_beat, meters), 2);
    std::string names;
    for (std::size_t i = 0; i < signals.size(); ++i) {
      names += (i > 0 ? ", " : "") + std::string(to_string(signals[i]));
    }
    Phrase phrase;
    phrase.startBeat = start_beat;
    phrase.endBeat = end_beat;
    phrase.cadence = cadence;
    phrase.confidence = confidence;
    phrase.structuralWeight = structural_weight;
    phrase.rationale = "Phrase of " + js::to_string(bars) + " bar(s) closing on " +
                       describe_cadence(cadence) + "; boundary from " +
                       (signals.empty() ? "the end of the span" : names);
    phrase.signals = std::move(signals);
    reading.phrases.push_back(std::move(phrase));
    reading.arrivals.push_back(arrival);
    from = to;
  }
  return reading;
}

std::vector<Phrase> phrases_from_timeline(const ChordTimeline& timeline,
                                          const std::vector<NoteEvent>& notes,
                                          const PhraseOptions& opts) {
  assert_chord_timeline(timeline);
  PhraseSource source;
  source.segments = spans_of(timeline.segments);
  ChordSource chord_at = [&](std::size_t index) -> const Chord& {
    return timeline.segments[index].chord;
  };
  source.chords = ChordReads{chord_at, chord_at, {}, {}, {}, {}};
  source.total_beats = [&] { return opts.totalBeats; };
  source.rest_beats = [&](double fallback) { return opts.restBeats.value_or(fallback); };
  source.long_note_beats = [&](double fallback) { return opts.longNoteBeats.value_or(fallback); };
  source.min_phrase_beats = [&](double fallback) { return opts.minPhraseBeats.value_or(fallback); };
  source.expected_phrase_beats = [&](double fallback) {
    return opts.expectedPhraseBeats.value_or(fallback);
  };
  if (opts.key) {
    source.key = [&] { return key_scale_at(*opts.key); };
  }
  source.modulations = [&](const KeyTimelineOptions& key_options) {
    return detect_modulations(timeline.segments, key_options);
  };
  if (opts.hypermeter) {
    source.given_downbeats = [&] { return opts.hypermeter->downbeats; };
  }
  return phrases_over(source, notes, opts).phrases;
}

std::vector<StructuralCadence> structural_cadences(const std::vector<Phrase>& phrases) {
  std::vector<StructuralCadence> ranked;
  for (std::size_t index = 0; index < phrases.size(); ++index) {
    const Phrase& phrase = phrases[index];
    if (!phrase.cadence || !phrase.cadence->cadence.type) {
      continue;
    }
    const CadenceHit& hit = *phrase.cadence;
    StructuralCadence entry;
    entry.phraseIndex = index;
    entry.atBeat = hit.atBeat;
    entry.endBeat = phrase.endBeat;
    entry.cadence = hit.cadence;
    entry.weight = phrase.structuralWeight;
    entry.rationale = "Closes " + describe_cadence(phrase.cadence) + " on a phrase of confidence " +
                      js::to_string(round_to(phrase.confidence, 2));
    ranked.push_back(std::move(entry));
  }
  std::stable_sort(ranked.begin(), ranked.end(),
                   [](const StructuralCadence& a, const StructuralCadence& b) {
                     double by_weight = b.weight - a.weight;
                     return js::or_else(by_weight, a.atBeat - b.atBeat) < 0;
                   });
  return ranked;
}

}  // namespace cantus
