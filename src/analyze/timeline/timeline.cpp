// The chord timeline: ts/src/analyze/timeline/index.ts.

#include "analyze/timeline/timeline.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <optional>
#include <set>
#include <string>
#include <string_view>

#include "analyze/adjacency.h"
#include "analyze/form/internal.h"
#include "analyze/functional/augmented_sixth.h"
#include "analyze/functional/cadence.h"
#include "analyze/grid.h"
#include "analyze/voice/voice.h"
#include "cantus/analyze/detect.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "core/event_index/event_index.h"
#include "core/meter/meter.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** `Number.MIN_VALUE`. */

/** SEGMENTATION_QUALITIES: the qualities the boundary search considers. */
constexpr std::string_view kSegmentationQualityNames[] =
#include "analyze/timeline/segmentation_qualities.gen.inc"
    ;

/** SLASH_UPPER_QUALITY_LIST: the qualities a slash chord's upper structure is written in. */
constexpr std::string_view kSlashUpperQualityNames[] =
#include "analyze/timeline/slash_upper_quality_list.gen.inc"
    ;

constexpr std::array<std::string_view, 2> kSegmentationNames = {"dynamic", "grid"};

/** The chord quality whose root its tones leave open (`SYMMETRIC_QUALITY`). */
constexpr ChordQuality kSymmetricQuality = ChordQuality::kDim7;

/** The 12 x SEGMENTATION_QUALITIES lexicon, held flat (`LEXICON_*`). */
struct Lexicon {
  std::vector<int> roots;
  std::vector<std::size_t> tone_start;
  std::vector<int> tones;
  std::size_t size = 0;
};

const Lexicon& lexicon() {
  static const Lexicon built = [] {
    Lexicon out;
    for (int root_pc = 0; root_pc < 12; ++root_pc) {
      for (std::string_view name : kSegmentationQualityNames) {
        out.roots.push_back(root_pc);
        out.tone_start.push_back(out.tones.size());
        for (int pc : chord_pitch_classes(make_chord(root_pc, *parse_chord_quality(name)))) {
          out.tones.push_back(pc);
        }
      }
    }
    out.tone_start.push_back(out.tones.size());
    out.size = out.roots.size();
    return out;
  }();
  return built;
}

bool is_slash_upper_quality(ChordQuality quality) {
  static const std::set<ChordQuality> upper = [] {
    std::set<ChordQuality> out;
    for (std::string_view name : kSlashUpperQualityNames) {
      if (std::optional<ChordQuality> parsed = parse_chord_quality(name)) {
        out.insert(*parsed);
      }
    }
    return out;
  }();
  return upper.count(quality) > 0;
}

/** `slotOfBeat`: the index of the slot containing `beat`, unclamped. */
double slot_of_beat(const SlotGrid& grid, double beat) {
  return (beat - grid.origin) / grid.slotBeats;
}

/** `beatOfSlot`: the first beat of slot `index`. */
double beat_of_slot(const SlotGrid& grid, double index) {
  return grid.origin + index * grid.slotBeats;
}

/** The segment before the insertion point of `beat`, then the one at it, that begins on it. */
template <class Segment>
const Segment* starting_at(const std::vector<Segment>& segments, double beat) {
  std::size_t index = count_starting_at_or_before(segments, beat);
  for (std::size_t offset = 0; offset < 2; ++offset) {
    if (index + offset < 1 || index + offset - 1 >= segments.size()) {
      continue;
    }
    const Segment& candidate = segments[index + offset - 1];
    if (std::fabs(candidate.startBeat - beat) < BEAT_EPS) {
      return &candidate;
    }
  }
  return nullptr;
}

//--------------------------------------------------------------------------------------------
// The window reading

/** A window's chord match scored against its weights (`MatchAccount`). */
struct MatchAccount {
  /** Sounding pitch classes the candidate does not name. */
  double extras;
  /** Chord tones nothing voices. */
  double missing;
  /** Whether the candidate accounts for the window exactly. */
  bool exact;
};

/** Whether a candidate names a pitch class as an upper extension (`namesAsExtension`). */
bool names_as_extension(const Chord& chord, int pc) {
  for (double interval : chord.intervals) {
    if (interval >= EXTENSION_OCTAVE && pitch_class_of(chord.rootPc + interval) == pc) {
      return true;
    }
  }
  return false;
}

/** Whether a candidate reads the window as a triad standing on a foreign bass. */
bool is_slash_reading(const ChordMatch& match, const std::optional<int>& pedal_pc) {
  return pedal_pc.has_value() && !match.inversion.has_value() && match.missingPcs.empty() &&
         match.extraPcs.size() == 1 && match.extraPcs[0] == *pedal_pc &&
         is_slash_upper_quality(match.quality);
}

/** Weigh a candidate against the window with the pedal bass set aside (`matchAccount`). */
MatchAccount match_account(const ChordMatch& match, const Chord& chord,
                           const std::optional<int>& pedal_pc) {
  double unvoiced = pedal_pc.has_value() && names_as_extension(chord, *pedal_pc) ? 1 : 0;
  double named = is_slash_reading(match, pedal_pc) ? 1 : 0;
  return MatchAccount{static_cast<double>(match.extraPcs.size()) - named + unvoiced,
                      static_cast<double>(match.missingPcs.size()) + unvoiced,
                      match.exact && unvoiced == 0};
}

/** Score a chord match against a window's pitch-class weights (`scoreMatch`). */
double score_match(const ChordMatch& match, const std::array<double, 12>& weights,
                   double max_weight, const KeyScale& key, const std::optional<int>& pedal_pc) {
  double root_weight =
      max_weight > 0 ? weights[static_cast<std::size_t>(match.rootPc)] / max_weight : 0;
  // `inversion === 0` is exactly "the sounding bass is this candidate's root".
  double root_standing = match.inversion.has_value() && *match.inversion == 0
                             ? js::max(root_weight, BASS_ROOT_STANDING)
                             : root_weight;
  Chord chord = make_chord(match.rootPc, match.quality);
  MatchAccount account = match_account(match, chord, pedal_pc);
  double score = root_standing;
  bool diatonic = true;
  for (int pc : chord_pitch_classes(chord)) {
    if (!is_scale_tone(pc, key)) {
      diatonic = false;
      break;
    }
  }
  if (diatonic) {
    score += DIATONIC_BONUS;
  }
  if (account.exact) {
    score += EXACT_BONUS;
  }
  score -= EXTRA_TONE_PENALTY * account.extras;
  score -= OMITTED_TONE_PENALTY * account.missing;
  return score;
}

/** Whether the window's bass pitch class is heard only underneath the harmony. */
bool bass_sounds_only_below(const std::vector<NoteEvent>& all,
                            const std::vector<std::size_t>& selection, double window_start,
                            double window_end, int bass_pc) {
  double upper_floor = std::numeric_limits<double>::infinity();
  double highest_bass = -std::numeric_limits<double>::infinity();
  for (std::size_t index : selection) {
    const NoteEvent& note = all[index];
    double overlap = note_overlap(note, window_start, window_end);
    if (overlap <= BEAT_EPS) {
      continue;
    }
    if (pitch_class_of(note.pitch) == bass_pc) {
      highest_bass = js::max(highest_bass, note.pitch);
    } else {
      upper_floor = js::min(upper_floor, note.pitch);
    }
  }
  return highest_bass <= upper_floor;
}

/**
 * The bass of a window: the lowest note that sounds where the window's music begins, or that holds
 * for more than half of the window or for a whole expected chord (`windowBass`). A note heard for a
 * small part of the window does not invert the chord the rest of it holds, and a note the
 * histogram does not count cannot be the bass.
 */
double window_bass(const std::vector<NoteEvent>& all, const std::vector<std::size_t>& selection,
                   double window_start, double window_end, const MeterArg& meters,
                   double harmonic_rhythm) {
  struct Counted {
    const NoteEvent* note;
    double overlap;
  };
  std::vector<Counted> counted;
  double first_sounding = std::numeric_limits<double>::infinity();
  for (std::size_t index : selection) {
    const NoteEvent& note = all[index];
    double overlap = note_overlap(note, window_start, window_end);
    if (overlap <= BEAT_EPS) {
      continue;
    }
    if (note_weight(note, overlap,
                    onset_in_window(note, window_start, window_end) ? &meters : nullptr) <=
        BEAT_EPS) {
      continue;
    }
    counted.push_back(Counted{&note, overlap});
    first_sounding = js::min(first_sounding, js::max(note.startBeat, window_start));
  }
  double half = (window_end - window_start) / 2;
  double bass = std::numeric_limits<double>::infinity();
  for (const Counted& entry : counted) {
    if (entry.note->startBeat <= first_sounding + BEAT_EPS || entry.overlap > half ||
        entry.overlap >= harmonic_rhythm - BEAT_EPS) {
      bass = js::min(bass, entry.note->pitch);
    }
  }
  return bass;
}

/** Confidence of a chord for a window: chord-tone weight over total weight. */
double chord_confidence(const Chord& chord, const std::array<double, 12>& weights,
                        double total_weight, bool exact) {
  std::vector<int> tones = chord_pitch_classes(chord);
  double chord_weight = 0;
  for (int pc = 0; pc < 12; ++pc) {
    if (std::find(tones.begin(), tones.end(), pc) != tones.end()) {
      chord_weight += weights[static_cast<std::size_t>(pc)];
    }
  }
  double raw = total_weight > 0 ? chord_weight / total_weight : 0;
  double confidence = clamp01(raw);
  return exact ? confidence : confidence * INEXACT_CONFIDENCE_FACTOR;
}

/** What chord detection makes of one choice of a window's pitch classes (`WindowDetection`). */
struct WindowDetection {
  std::vector<int> selected;
  bool has_bass = false;
  std::optional<int> pedal_pc;
  std::vector<ChordMatch> matches;
};

/** Detect the chords a window's selected pitch classes name over its bass (`detectWindow`). */
WindowDetection detect_window(std::vector<int> selected, int bass_pc,
                              const std::vector<NoteEvent>& all,
                              const std::vector<std::size_t>& selection, double window_start,
                              double window_end) {
  WindowDetection out;
  // The window's true bass is the lowest pitch, so inversion detection works; if that pitch class
  // was removed as noise, detection becomes unordered instead.
  out.has_bass = std::find(selected.begin(), selected.end(), bass_pc) != selected.end();
  std::vector<int> detection_pitches;
  for (int pc : selected) {
    detection_pitches.push_back(out.has_bass && pc != bass_pc ? pc + 12 : pc);
  }
  // A bass heard nowhere above the harmony is a bass, whatever pitch class it carries.
  if (out.has_bass && bass_sounds_only_below(all, selection, window_start, window_end, bass_pc)) {
    out.pedal_pc = bass_pc;
  }
  DetectChordOptions detect;
  detect.input = out.has_bass ? ChordInputKind::kMidi : ChordInputKind::kPitchClass;
  out.matches = detect_chord(detection_pitches, detect);
  out.selected = std::move(selected);
  return out;
}

/**
 * Infer the chord sounding in one window from the notes overlapping it (`analyzeWindow`). Noise is
 * set aside only while the rest still names a chord; otherwise every sounding pitch class is read.
 */
std::optional<WindowChord> analyze_window(const std::vector<NoteEvent>& all,
                                          const std::vector<std::size_t>& selection,
                                          double window_start, double window_end,
                                          const MeterArg& meters, const ResolvedKey& key,
                                          double harmonic_rhythm) {
  WindowWeights window = window_weights(all, &selection, window_start, window_end, meters);
  const std::array<double, 12>& weights = window.weights;
  if (window.totalWeight <= BEAT_EPS) {
    return std::nullopt;
  }

  // Keep pitch classes with meaningful weight, strongest first.
  struct Ranked {
    int pc;
    double weight;
  };
  std::vector<Ranked> ranked;
  for (int pc = 0; pc < 12; ++pc) {
    double weight = weights[static_cast<std::size_t>(pc)];
    if (weight > 0) {
      ranked.push_back(Ranked{pc, weight});
    }
  }
  std::stable_sort(ranked.begin(), ranked.end(), [](const Ranked& a, const Ranked& b) {
    double by_weight = b.weight - a.weight;
    // `b.weight - a.weight || a.pc - b.pc`.
    return js::or_else(by_weight, a.pc - b.pc) < 0;
  });
  int bass_pc = pitch_class_of(
      window_bass(all, selection, window_start, window_end, meters, harmonic_rhythm));
  std::vector<int> sounding;
  std::vector<int> significant;
  for (const Ranked& entry : ranked) {
    if (sounding.size() < static_cast<std::size_t>(MAX_DETECTION_PCS)) {
      sounding.push_back(entry.pc);
    }
    if (entry.weight >= window.maxWeight * NOISE_THRESHOLD_RATIO &&
        significant.size() < static_cast<std::size_t>(MAX_DETECTION_PCS)) {
      significant.push_back(entry.pc);
    }
  }
  bool narrowed = significant.size() < sounding.size();
  WindowDetection detection =
      detect_window(std::move(significant), bass_pc, all, selection, window_start, window_end);
  if (detection.matches.empty() && narrowed) {
    detection = detect_window(sounding, bass_pc, all, selection, window_start, window_end);
  }
  const std::vector<int>& selected = detection.selected;
  bool has_bass = detection.has_bass;
  const std::optional<int>& pedal_pc = detection.pedal_pc;
  const std::vector<ChordMatch>& matches = detection.matches;
  const ChordMatch* best_match = nullptr;
  double best_score = -std::numeric_limits<double>::infinity();
  KeyScale scale = scale_of(key);
  for (const ChordMatch& match : matches) {
    double score = score_match(match, weights, window.maxWeight, scale, pedal_pc);
    if (score > best_score) {
      best_score = score;
      best_match = &match;
    }
  }
  if (best_match == nullptr) {
    return std::nullopt;
  }
  std::optional<double> best_bass;
  if (best_match->bassPc) {
    best_bass = *best_match->bassPc;
  }
  Chord chord = make_chord(best_match->rootPc, best_match->quality, best_bass);
  MatchAccount account =
      match_account(*best_match, make_chord(best_match->rootPc, best_match->quality), pedal_pc);
  // A slash chord names its bass, so a window holding nothing but the triad and that bass is
  // accounted for exactly, though it does not rank as exact.
  bool explained = account.exact || is_slash_reading(*best_match, pedal_pc);
  WindowChord reading;
  reading.confidence = chord_confidence(chord, weights, window.totalWeight, explained);
  reading.chord = std::move(chord);
  reading.object = std::make_shared<const char>('c');
  if (best_match->quality == kSymmetricQuality) {
    // Every tone of a diminished seventh roots the same tones, so the reading on each is carried
    // out of the window for the progression to choose from.
    for (int root_pc : chord_pitch_classes(make_chord(best_match->rootPc, best_match->quality))) {
      std::optional<double> rooted_bass;
      if (has_bass && bass_pc != root_pc) {
        rooted_bass = bass_pc;
      }
      Chord rooted = make_chord(root_pc, best_match->quality, rooted_bass);
      double confidence = chord_confidence(rooted, weights, window.totalWeight, explained);
      reading.rootings.push_back(
          WindowReading{std::move(rooted), confidence, std::make_shared<const char>('d')});
    }
  }
  // An augmented sixth is a bass and an interval rather than a stack of thirds, so the reading
  // is offered alongside the tertian one; the span after it settles which one stands.
  if (has_bass) {
    std::vector<double> pcs(selected.begin(), selected.end());
    Nullable<Chord> augmented = augmented_sixth_over_bass(pcs, bass_pc, KeyArg(key));
    if (augmented) {
      // Its tones are exactly the window's, so it explains them exactly.
      double confidence = chord_confidence(*augmented, weights, window.totalWeight, true);
      reading.augmented =
          WindowReading{std::move(*augmented), confidence, std::make_shared<const char>('a')};
    }
  }
  return reading;
}

/**
 * The root a diminished seventh read at `index` takes from its context, or nothing to keep the
 * reading the window chose (`settledDiminishedRoot`): the leading tone of the chord it resolves
 * to, else the key's leading tone. The same tones held across a boundary, or a rest, are not a
 * resolution.
 */
std::optional<int> settled_diminished_root(const std::vector<std::optional<WindowChord>>& readings,
                                           std::size_t index, const KeyScale& key) {
  if (!readings[index] || readings[index]->rootings.empty()) {
    return std::nullopt;
  }
  const WindowChord& reading = *readings[index];
  auto offers = [&](int pc) {
    for (const WindowReading& rooting : reading.rootings) {
      if (rooting.chord.rootPc == pc) {
        return true;
      }
    }
    return false;
  };
  std::vector<int> tones = chord_pitch_classes(reading.chord);
  for (std::size_t i = index + 1; i < readings.size(); ++i) {
    if (!readings[i] || chord_pitch_classes(readings[i]->chord) == tones) {
      continue;
    }
    // The leading tone lies a semitone below the root it leads to.
    int leading = pitch_class_of(readings[i]->chord.rootPc - 1);
    if (offers(leading)) {
      return leading;
    }
    break;
  }
  int leading_tone = pitch_class_of(key.rootPc - 1);
  if (offers(leading_tone)) {
    return leading_tone;
  }
  return std::nullopt;
}

/** Whether two chords are the same root, quality, and bass (`sameChord`). */
bool same_chord(const Chord& a, const Chord& b) {
  return a.rootPc == b.rootPc && a.quality == b.quality && a.bassPc == b.bassPc;
}

/** Whether the augmented-sixth reading offered at `index` is the one the music supports. */
bool resolves_onto_dominant(const std::vector<std::optional<WindowChord>>& readings,
                            std::size_t index, const KeyScale& key) {
  int dominant_pc = pitch_class_of(key.rootPc + DOMINANT_ABOVE_TONIC);
  const Chord* candidate = readings[index] ? &readings[index]->chord : nullptr;
  for (std::size_t i = index + 1; i < readings.size(); ++i) {
    if (!readings[i]) {
      continue;
    }
    const Chord& chord = readings[i]->chord;
    if (candidate != nullptr && same_chord(chord, *candidate)) {
      continue;
    }
    if (pitch_class_of(chord.bassPc ? *chord.bassPc : chord.rootPc) != dominant_pc) {
      return false;
    }
    if (pitch_class_of(chord.rootPc) == dominant_pc) {
      return true;
    }
    // Standing on the dominant bass without being the dominant is the preparation the dominant
    // arrives through, so the dominant it prepares is what the next window still has to hold.
  }
  return true;
}

//--------------------------------------------------------------------------------------------
// The boundary search

/** Score how well one lexicon candidate explains a slot's weights (`candidateScore`). */
double candidate_score(std::size_t candidate, const std::array<double, 12>& weights,
                       double total_weight) {
  const Lexicon& lex = lexicon();
  std::size_t first = lex.tone_start[candidate];
  std::size_t last = lex.tone_start[candidate + 1];
  double covered = 0;
  double missing = 0;
  for (std::size_t index = first; index < last; ++index) {
    double weight = weights[static_cast<std::size_t>(lex.tones[index])];
    covered += weight;
    if (weight <= BEAT_EPS) {
      missing += 1;
    }
  }
  double outside = total_weight - covered;
  double average_tone_weight = total_weight / static_cast<double>(last - first);
  return covered - OUTSIDE_TONE_PENALTY * outside -
         TIMELINE_MISSING_TONE_PENALTY * missing * average_tone_weight +
         ROOT_PRESENCE_BONUS * weights[static_cast<std::size_t>(lex.roots[candidate])];
}

/** A half-open span of beats the boundary search settled on (`BoundarySpan`). */
struct BoundarySpan {
  double startBeat;
  double endBeat;
};

/**
 * Choose chord boundaries over one run of slots by dynamic programming (`chooseBoundaries`). A
 * table read past its end is 0 and a write past it is dropped, as with a typed array.
 */
std::vector<BoundarySpan> choose_boundaries(BoundaryTables& tables, std::size_t from,
                                            std::size_t to, const SlotGrid& grid,
                                            const MeterArg& meters, double change_cost) {
  if (to <= from) {
    return {};
  }
  const std::size_t lex_size = lexicon().size;
  const std::size_t width = to - from;
  auto score_at = [&](std::size_t index) {
    return index < tables.scores.size() ? tables.scores[index] : 0.0;
  };
  // Costs are negated scores, so the search minimises.
  std::vector<double>* costs = &tables.costs;
  std::vector<double>* next = &tables.spare;
  for (std::size_t c = 0; c < lex_size; ++c) {
    (*costs)[c] = -score_at(from * lex_size + c);
  }
  for (std::size_t i = 1; i < width; ++i) {
    double cheapest = std::numeric_limits<double>::infinity();
    std::size_t cheapest_index = 0;
    for (std::size_t c = 0; c < lex_size; ++c) {
      double cost = (*costs)[c];
      if (cost < cheapest) {
        cheapest = cost;
        cheapest_index = c;
      }
    }
    double slot_start = beat_of_slot(grid, static_cast<double>(from + i));
    double accent = metric_weight(slot_start, meters);
    double penalty =
        change_cost * (1 - (TIMELINE_STRONG_BEAT_DISCOUNT * accent) / MAX_METRIC_WEIGHT);
    std::size_t row_base = (from + i) * lex_size;
    double change = cheapest + penalty;
    for (std::size_t c = 0; c < lex_size; ++c) {
      double stay = (*costs)[c];
      // Ties hold the current chord: a change has to be strictly better.
      double carried = stay <= change ? stay : change;
      if (row_base + c < tables.back.size()) {
        tables.back[row_base + c] = static_cast<std::int32_t>(stay <= change ? c : cheapest_index);
      }
      (*next)[c] = carried - score_at(row_base + c);
    }
    std::swap(costs, next);
  }

  std::size_t best = 0;
  for (std::size_t c = 1; c < lex_size; ++c) {
    if ((*costs)[c] < (*costs)[best]) {
      best = c;
    }
  }
  std::size_t current = best;
  for (std::size_t i = width; i-- > 0;) {
    if (from + i < tables.path.size()) {
      tables.path[from + i] = static_cast<std::int32_t>(current);
    }
    if (i > 0) {
      std::size_t at = (from + i) * lex_size + current;
      if (at < tables.back.size()) {
        current = static_cast<std::size_t>(tables.back[at]);
      }
    }
  }

  // Past the end of the path table every entry reads as undefined, and undefined equals itself.
  auto path_differs = [&](std::size_t a, std::size_t b) {
    bool a_in = a < tables.path.size();
    bool b_in = b < tables.path.size();
    if (!a_in && !b_in) {
      return false;
    }
    if (a_in != b_in) {
      return true;
    }
    return tables.path[a] != tables.path[b];
  };
  std::vector<BoundarySpan> spans;
  std::size_t run_start = 0;
  for (std::size_t i = 1; i <= width; ++i) {
    if (i == width || path_differs(from + i, from + run_start)) {
      spans.push_back(BoundarySpan{beat_of_slot(grid, static_cast<double>(from + run_start)),
                                   beat_of_slot(grid, static_cast<double>(from + i))});
      run_start = i;
    }
  }
  return spans;
}

/** The slot length a requested resolution is read at (`slotBeatsWithin`). */
double slot_beats_within(double grid_unit, double min_chord_beats, double harmonic_rhythm) {
  double resolution = js::min(min_chord_beats, harmonic_rhythm);
  double divisions = js::max(1, std::ceil(grid_unit / resolution - BEAT_EPS));
  return grid_unit / divisions;
}

/** One span per slot: the fixed grid, unchanged (`gridSpans`). */
std::vector<BoundarySpan> grid_spans(std::size_t slot_count, const SlotGrid& grid) {
  std::vector<BoundarySpan> spans;
  for (std::size_t i = 0; i < slot_count; ++i) {
    spans.push_back(BoundarySpan{beat_of_slot(grid, static_cast<double>(i)),
                                 beat_of_slot(grid, static_cast<double>(i + 1))});
  }
  return spans;
}

/** Place chord boundaries where the notes imply them (`dynamicSpans`). */
std::vector<BoundarySpan> dynamic_spans(const std::vector<WindowWeights>& slot_weights,
                                        BoundaryTables& tables, const SlotGrid& grid,
                                        double harmonic_rhythm, const MeterArg& meters) {
  double slot_beats = grid.slotBeats;
  std::size_t slot_count = slot_weights.size();
  double sounding_slots = 0;
  double weight_sum = 0;
  for (const WindowWeights& slot : slot_weights) {
    if (slot.totalWeight > BEAT_EPS) {
      sounding_slots += 1;
      weight_sum += slot.totalWeight;
    }
  }
  if (sounding_slots == 0) {
    return {};
  }
  // The change cost is in the same weight units the slot scores are, scaled to one expected
  // chord's worth of evidence.
  double mean_slot_weight = weight_sum / sounding_slots;
  double change_cost = CHANGE_COST * mean_slot_weight * (harmonic_rhythm / slot_beats);

  std::vector<bool> silent;
  for (const WindowWeights& slot : slot_weights) {
    silent.push_back(slot.totalWeight <= BEAT_EPS);
  }
  std::vector<bool> breaks(slot_count, false);
  for (std::size_t i = 0; i < slot_count;) {
    if (!silent[i]) {
      i += 1;
      continue;
    }
    std::size_t end = i;
    while (end < slot_count && silent[end]) {
      end += 1;
    }
    if (static_cast<double>(end - i) * slot_beats >= harmonic_rhythm - BEAT_EPS) {
      for (std::size_t k = i; k < end; ++k) {
        breaks[k] = true;
      }
    }
    i = end;
  }

  std::vector<BoundarySpan> spans;
  for (std::size_t i = 0; i < slot_count;) {
    if (breaks[i]) {
      i += 1;
      continue;
    }
    std::size_t end = i;
    while (end < slot_count && !breaks[end]) {
      end += 1;
    }
    std::vector<BoundarySpan> run = choose_boundaries(tables, i, end, grid, meters, change_cost);
    spans.insert(spans.end(), run.begin(), run.end());
    i = end;
  }
  return spans;
}

/** The distinct notes overlapping a span, gathered from the slots it covers (`notesOfSpan`). */
std::vector<std::size_t> notes_of_span(const std::vector<std::vector<std::size_t>>& slot_notes,
                                       const BoundarySpan& span, const SlotGrid& grid,
                                       std::size_t note_count) {
  double first = js::round(slot_of_beat(grid, span.startBeat));
  double last_exclusive = js::round(slot_of_beat(grid, span.endBeat));
  auto slot = [&](double i) -> const std::vector<std::size_t>* {
    return i >= 0 && i < static_cast<double>(slot_notes.size())
               ? &slot_notes[static_cast<std::size_t>(i)]
               : nullptr;
  };
  if (last_exclusive - first == 1) {
    const std::vector<std::size_t>* only = slot(first);
    return only != nullptr ? *only : std::vector<std::size_t>{};
  }
  // A note held across several slots appears in each of them; the histogram weighs by overlap, so
  // counting it twice would double its influence.
  std::vector<bool> seen(note_count, false);
  std::vector<std::size_t> out;
  for (double i = first; i < last_exclusive; i += 1) {
    const std::vector<std::size_t>* notes = slot(i);
    if (notes == nullptr) {
      continue;
    }
    for (std::size_t note : *notes) {
      if (!seen[note]) {
        seen[note] = true;
        out.push_back(note);
      }
    }
  }
  return out;
}

/** Whether every slot a span covers lies outside the dirty run (`spanIsClean`). */
bool span_is_clean(const SlotGrid& grid, const BoundarySpan& span, double dirty_from,
                   double dirty_to) {
  double first = js::round(slot_of_beat(grid, span.startBeat));
  double last_exclusive = js::round(slot_of_beat(grid, span.endBeat));
  return last_exclusive <= dirty_from || first >= dirty_to;
}

/** Whether previous evidence describes the same grid as this analysis (`evidenceFits`). */
bool evidence_fits(const TimelineEvidence& previous, const SlotGrid& grid, double slot_count,
                   double total_beats, ChordSegmentation segmentation, double harmonic_rhythm,
                   bool key_given) {
  return previous.grid.origin == grid.origin && previous.grid.slotBeats == grid.slotBeats &&
         previous.slotCount == slot_count && previous.totalBeats == total_beats &&
         previous.segmentation == segmentation && previous.harmonicRhythm == harmonic_rhythm &&
         previous.keyGiven == key_given;
}

}  // namespace

//--------------------------------------------------------------------------------------------
// Public and internal entry points

std::string_view to_string(ChordSegmentation segmentation) {
  return kSegmentationNames[static_cast<std::size_t>(segmentation)];
}

std::optional<ChordSegmentation> parse_chord_segmentation(std::string_view name) {
  return parse_named<ChordSegmentation>(kSegmentationNames, name);
}

std::size_t lexicon_size() { return lexicon().size; }

bool WindowKey::operator<(const WindowKey& other) const {
  if (startBeat != other.startBeat) {
    return startBeat < other.startBeat;
  }
  if (endBeat != other.endBeat) {
    return endBeat < other.endBeat;
  }
  if (rootPc != other.rootPc) {
    return rootPc < other.rootPc;
  }
  return modeMask12 < other.modeMask12;
}

Nullable<Chord> chord_at_beat(const std::vector<ChordSegment>& segments, double beat) {
  assert_finite_number(beat, "timeline query beat");
  std::size_t after = count_starting_at_or_before(segments, beat);
  if (after == 0) {
    return std::nullopt;
  }
  const ChordSegment& candidate = segments[after - 1];
  if (beat >= candidate.startBeat && beat < candidate.endBeat) {
    return candidate.chord;
  }
  return std::nullopt;
}

const ChordSegment* segment_starting_at(const std::vector<ChordSegment>& segments, double beat) {
  return starting_at(segments, beat);
}

const SegmentSpan* segment_span_starting_at(const std::vector<SegmentSpan>& segments, double beat) {
  return starting_at(segments, beat);
}

Nullable<Chord> ChordTimeline::at(double beat) const { return chord_at_beat(segments, beat); }

const ChordTimeline& assert_chord_timeline(const ChordTimeline& timeline, std::string_view name) {
  for (std::size_t index = 0; index < timeline.segments.size(); ++index) {
    std::string label = join_name(name, ".segments[") + index_text(index) + "]";
    assert_finite_number(timeline.segments[index].startBeat, label + ".startBeat");
    assert_finite_number(timeline.segments[index].endBeat, label + ".endBeat");
  }
  assert_spans_in_order(timeline.segments, join_name(name, ".segments"));
  return timeline;
}

void assert_span_in_order(double start_beat, double end_beat, const double* previous_end,
                          std::size_t index, std::string_view name) {
  std::string label = std::string(name) + "[" + index_text(index) + "]";
  if (!(end_beat > start_beat)) {
    throw InvalidInputError(label + " must end after it starts; received [" +
                            js::to_string(start_beat) + ", " + js::to_string(end_beat) + ")");
  }
  if (previous_end != nullptr && start_beat < *previous_end) {
    throw InvalidInputError(label + " must not start before " + std::string(name) + "[" +
                            index_text(index - 1) + "] ends; received " +
                            js::to_string(start_beat) + " before " + js::to_string(*previous_end));
  }
}

std::vector<KeyRegion> stated_key_regions(const ResolvedKey& key, double start_beat,
                                          double end_beat) {
  if (!(end_beat > start_beat)) {
    return {};
  }
  // A stated key is not a measurement, so it carries full confidence.
  KeyRegion region;
  region.startBeat = start_beat;
  region.endBeat = end_beat;
  region.key = key;
  region.confidence = STATED_KEY_CONFIDENCE;
  return {region};
}

ChordTimeline chord_timeline_from_chords(const std::vector<ChordSpan>& chords, double total_beats) {
  assert_range(total_beats, 0, kMaxSafeInteger, "timeline totalBeats");
  assert_generation_budget(static_cast<double>(chords.size()), "timeline chords");
  for (std::size_t index = 0; index < chords.size(); ++index) {
    // Unbounded below, like a note onset: a chord may sound in the pickup.
    assert_range(chords[index].startBeat, -kMaxSafeInteger, kMaxSafeInteger,
                 "chords[" + index_text(index) + "].startBeat");
  }
  std::vector<const ChordSpan*> sorted;
  for (const ChordSpan& chord : chords) {
    if (chord.startBeat < total_beats) {
      sorted.push_back(&chord);
    }
  }
  std::stable_sort(sorted.begin(), sorted.end(), [](const ChordSpan* a, const ChordSpan* b) {
    return a->startBeat - b->startBeat < 0;
  });
  ChordTimeline timeline;
  for (std::size_t i = 0; i < sorted.size(); ++i) {
    double next_beat = i + 1 < sorted.size() ? sorted[i + 1]->startBeat : total_beats;
    double end_beat = js::min(total_beats, js::max(sorted[i]->startBeat, next_beat));
    ChordSegment segment;
    segment.startBeat = sorted[i]->startBeat;
    segment.endBeat = end_beat;
    segment.chord = chord_from_span(*sorted[i]);
    if (segment.endBeat > segment.startBeat) {
      timeline.segments.push_back(std::move(segment));
    }
  }
  return timeline;
}

BoundaryTables create_boundary_tables(double slot_count, std::optional<double> budget) {
  const auto size = static_cast<double>(lexicon().size);
  BoundaryTables tables;
  tables.scores = allocate_candidate_table(slot_count, size, "timeline window scores", budget);
  tables.back = allocate_choice_table(slot_count, size, "timeline window choices", budget);
  tables.costs = allocate_candidate_table(1, size, "timeline window costs", budget);
  tables.spare = allocate_candidate_table(1, size, "timeline window costs", budget);
  tables.path = allocate_choice_table(slot_count, 1, "timeline window path", budget);
  return tables;
}

void score_slot(BoundaryTables& tables, const WindowWeights& slot, std::size_t index) {
  const std::size_t lex_size = lexicon().size;
  std::size_t base = index * lex_size;
  if (slot.totalWeight <= BEAT_EPS) {
    std::fill(tables.scores.begin() + static_cast<std::ptrdiff_t>(base),
              tables.scores.begin() + static_cast<std::ptrdiff_t>(base + lex_size), 0.0);
    return;
  }
  for (std::size_t c = 0; c < lex_size; ++c) {
    tables.scores[base + c] = candidate_score(c, slot.weights, slot.totalWeight);
  }
}

DirtySlots dirty_slots_for(const TimelineEvidence& evidence, double start_beat, double end_beat) {
  double first = std::floor(slot_of_beat(evidence.grid, start_beat)) - DIRTY_SLOT_MARGIN;
  double last_exclusive = std::ceil(slot_of_beat(evidence.grid, end_beat)) + DIRTY_SLOT_MARGIN;
  return DirtySlots{js::max(0, js::min(evidence.slotCount, first)),
                    js::max(0, js::min(evidence.slotCount, last_exclusive))};
}

TimelineAnalysis analyze_timeline(const std::vector<NoteEvent>& notes,
                                  const ChordTimelineOptions& opts, TimelineEvidence* previous,
                                  const DirtySlots* dirty) {
  MeterMap meters_map = resolve_meters({opts.ts, opts.meters}, "timeline meters");
  const MeterArg meters(meters_map);
  double harmonic_rhythm = opts.harmonicRhythm.value_or(beats_per_bar_at(0, meters));
  assert_range(harmonic_rhythm, kMinValue, kMaxSafeInteger, "harmonic rhythm");
  const ChordSegmentation mode = opts.segmentation.value_or(ChordSegmentation::kDynamic);
  // One pulse by default, whatever the pulse of this meter is.
  double grid_unit = metric_grid_unit(meters);
  double min_chord_beats = opts.minChordBeats.value_or(grid_unit);
  assert_range(min_chord_beats, kMinValue, kMaxSafeInteger, "minChordBeats");
  std::optional<double> budget = opts.budget;
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = budget;
  if (opts.pickupBeats) {
    assert_range(*opts.pickupBeats, 0, kMaxSafeInteger, "timeline pickupBeats");
    note_options.minStartBeat = -*opts.pickupBeats;
  }
  assert_note_events(notes, "timeline notes", note_options);
  // Zero/negative-length notes never sound; drop them before any inference.
  std::vector<NoteEvent> sounding = sorted_note_events(drop_silent_notes(notes));
  double total_beats = opts.totalBeats.value_or(latest_sounding_end(sounding));
  assert_range(total_beats, js::min(0, first_sounding_beat(sounding)), kMaxSafeInteger,
               "timeline totalBeats");
  double slot_beats = mode == ChordSegmentation::kGrid
                          ? harmonic_rhythm
                          : slot_beats_within(grid_unit, min_chord_beats, harmonic_rhythm);
  GridOrigin placed = grid_for_notes(sounding, slot_beats);
  double music_start = placed.startBeat;
  SlotGrid grid{placed.origin, slot_beats};
  double slot_count = js::max(0, std::ceil((total_beats - grid.origin) / slot_beats - BEAT_EPS));
  bool dynamic = mode == ChordSegmentation::kDynamic;
  // The boundary search fills one lexicon row per slot, so what the budget has to bound is the
  // table about to be built; a grid builds none.
  assert_generation_budget(dynamic ? slot_count * static_cast<double>(lexicon().size) : slot_count,
                           "timeline windows", budget);
  // A given key is taken as read across the whole span, from where the music starts.
  std::vector<KeyRegion> keys;
  if (opts.key) {
    keys = stated_key_regions(resolve_key(*opts.key), music_start, total_beats);
  } else {
    KeyTimelineOptions key_options;
    key_options.meters = meters;
    key_options.totalBeats = total_beats;
    key_options.budget = budget;
    keys = key_timeline_from_notes(sounding, key_options);
  }
  ResolvedKey prevailing_key = prevailing_key_or_default(keys);
  KeyLookup key_at(keys, prevailing_key);

  std::vector<ChordSegment> segments;
  std::vector<double> segment_confidence;
  std::vector<ChordObject> segment_objects;
  std::vector<std::vector<std::size_t>> slot_notes = bucket_notes_by_slot(
      sounding, grid, slot_count, BucketOptions{"timeline note-to-window memberships", budget});

  TimelineEvidence* carried = nullptr;
  if (previous != nullptr && dirty != nullptr && previous->tables &&
      evidence_fits(*previous, grid, slot_count, total_beats, mode, harmonic_rhythm,
                    opts.key.has_value())) {
    carried = previous;
  }
  double dirty_from = carried == nullptr ? 0 : js::max(0, dirty->from);
  double dirty_to = carried == nullptr ? slot_count : js::min(slot_count, dirty->to);

  // A grid cuts its segments from the grid alone, so it needs no row per slot. A carried-over
  // table is taken over rather than copied.
  std::unique_ptr<BoundaryTables> tables;
  if (carried != nullptr) {
    tables = std::move(carried->tables);
  } else {
    tables =
        std::make_unique<BoundaryTables>(create_boundary_tables(dynamic ? slot_count : 0, budget));
  }
  const auto total_slots = static_cast<std::size_t>(slot_count);
  std::vector<WindowWeights> slot_weights;
  slot_weights.reserve(total_slots);
  for (std::size_t i = 0; i < total_slots; ++i) {
    auto at = static_cast<double>(i);
    if (carried != nullptr && (at < dirty_from || at >= dirty_to) &&
        i < carried->slotWeights.size()) {
      slot_weights.push_back(carried->slotWeights[i]);
      continue;
    }
    double start = beat_of_slot(grid, at);
    slot_weights.push_back(window_weights(sounding, &slot_notes[i], start,
                                          js::min(start + slot_beats, total_beats), meters));
    if (dynamic) {
      score_slot(*tables, slot_weights.back(), i);
    }
  }

  std::vector<BoundarySpan> spans =
      mode == ChordSegmentation::kGrid
          ? grid_spans(total_slots, grid)
          : dynamic_spans(slot_weights, *tables, grid, harmonic_rhythm, meters);

  std::map<WindowKey, std::optional<WindowChord>> windows;
  // The chord of every settled span, read before any of them is reported: an augmented sixth is
  // told from the bVI7 it sounds like by where the harmony goes next.
  std::vector<std::optional<WindowChord>> readings;
  std::vector<KeyScale> reading_keys;
  std::vector<BoundarySpan> reading_bounds;
  for (const BoundarySpan& span : spans) {
    // The slot before the pickup is analyzed, but the stretch of it that precedes the first note
    // holds nothing, so the segment is reported from where the music starts.
    double start = js::max(span.startBeat, music_start);
    double end = js::min(span.endBeat, total_beats);
    const ResolvedKey& span_key_whole = key_at(start);
    KeyScale span_key = scale_of(span_key_whole);
    WindowKey id{start, end, span_key.rootPc, span_key.modeMask12};
    // A span whose slots are all clean holds exactly the notes it held before.
    const std::optional<WindowChord>* cached = nullptr;
    if (carried != nullptr && span_is_clean(grid, span, dirty_from, dirty_to)) {
      auto found = carried->windows.find(id);
      if (found != carried->windows.end()) {
        cached = &found->second;
      }
    }
    std::optional<WindowChord> inferred =
        cached != nullptr
            ? *cached
            : analyze_window(sounding, notes_of_span(slot_notes, span, grid, sounding.size()),
                             start, end, meters, span_key_whole, harmonic_rhythm);
    windows[id] = inferred;
    readings.push_back(std::move(inferred));
    reading_keys.push_back(span_key);
    reading_bounds.push_back(BoundarySpan{start, end});
  }

  // Root the diminished sevenths by where they resolve, last first, so each is read against the
  // settled chord after it.
  for (std::size_t i = readings.size(); i-- > 0;) {
    std::optional<int> root = settled_diminished_root(readings, i, reading_keys[i]);
    if (!root || *root == readings[i]->chord.rootPc) {
      continue;
    }
    for (const WindowReading& rooting : readings[i]->rootings) {
      if (rooting.chord.rootPc == *root) {
        WindowChord settled;
        static_cast<WindowReading&>(settled) = rooting;
        readings[i] = std::move(settled);
        break;
      }
    }
  }

  // Settle the augmented sixths against what follows them, in the key each was read in.
  for (std::size_t i = 0; i < readings.size(); ++i) {
    if (readings[i] && readings[i]->augmented &&
        resolves_onto_dominant(readings, i, reading_keys[i])) {
      WindowChord offered;
      static_cast<WindowReading&>(offered) = *readings[i]->augmented;
      readings[i] = std::move(offered);
    }
  }

  for (std::size_t i = 0; i < readings.size(); ++i) {
    if (!readings[i]) {
      continue;
    }
    const WindowChord& inferred = *readings[i];
    double start = reading_bounds[i].startBeat;
    double end = reading_bounds[i].endBeat;
    if (!segments.empty() && same_chord(segments.back().chord, inferred.chord) &&
        std::fabs(segments.back().endBeat - start) < BEAT_EPS) {
      // Merge into the previous segment, blending confidence by duration.
      ChordSegment& last = segments.back();
      double last_length = last.endBeat - last.startBeat;
      double length = end - start;
      double last_confidence = segment_confidence.back();
      segment_confidence.back() =
          (last_confidence * last_length + inferred.confidence * length) / (last_length + length);
      last.endBeat = end;
    } else {
      ChordSegment segment;
      segment.startBeat = start;
      segment.endBeat = end;
      segment.chord = inferred.chord;
      segments.push_back(std::move(segment));
      segment_confidence.push_back(inferred.confidence);
      segment_objects.push_back(inferred.object);
    }
  }

  attach_pivots(keys, segments);
  TimelineAnalysis out;
  out.result.timeline.segments = std::move(segments);
  out.result.keys = std::move(keys);
  out.result.prevailingKey = std::move(prevailing_key);
  out.result.segmentConfidence = std::move(segment_confidence);
  out.segment_objects = std::move(segment_objects);
  out.evidence.grid = grid;
  out.evidence.slotCount = slot_count;
  out.evidence.totalBeats = total_beats;
  out.evidence.segmentation = mode;
  out.evidence.harmonicRhythm = harmonic_rhythm;
  out.evidence.keyGiven = opts.key.has_value();
  out.evidence.slotWeights = std::move(slot_weights);
  out.evidence.tables = std::move(tables);
  out.evidence.windows = std::move(windows);
  return out;
}

ChordTimelineResult chord_timeline_from_notes(const std::vector<NoteEvent>& notes,
                                              const ChordTimelineOptions& opts) {
  return analyze_timeline(notes, opts).result;
}

std::vector<CadenceHit> detect_cadences_over(const std::vector<SegmentSpan>& segments,
                                             const ChordReads& chords, const KeyAtBeat& key_at,
                                             std::vector<std::size_t>* arrivals) {
  std::vector<CadenceHit> hits;
  for (std::size_t i = 1; i < segments.size(); ++i) {
    const SegmentSpan& prev = segments[i - 1];
    const SegmentSpan& cur = segments[i];
    if (!same_instant(prev.endBeat, cur.startBeat)) {
      continue;  // A rest separates the chords; no cadential motion across it.
    }
    // The chord before the pair, when it sounded straight into it: a six-four across a rest was
    // not still sounding when the dominant arrived.
    std::optional<std::size_t> before;
    if (i >= 2 && same_instant(segments[i - 2].endBeat, prev.startBeat)) {
      before = i - 2;
    }
    KeyScale key = key_at(cur.startBeat);
    CadenceOptions options;
    const Chord& from = chords.checked(i - 1);
    const Chord& to = chords.checked(i);
    if (before) {
      options.approach = chords.checked(*before);
    }
    CadenceResult cadence = cadence_between(from, to, key, options);
    if (!cadence.type) {
      continue;
    }
    // A cadential six-four comes to rest on the dominant it stands on; where that dominant goes on
    // to resolve, the six-four opened the cadence the resolution names, so the pair is reported
    // once, at the arrival.
    if (*cadence.type == CadenceType::kHalf &&
        is_cadential_six_four(chords.raw(i - 1), chords.raw(i), key)) {
      if (i + 1 < segments.size() && same_instant(cur.endBeat, segments[i + 1].startBeat)) {
        KeyScale onward_key = key_at(segments[i + 1].startBeat);
        const Chord& onward_from = chords.checked(i);
        const Chord& onward_to = chords.checked(i + 1);
        Nullable<CadenceType> onward = cadence_between(onward_from, onward_to, onward_key).type;
        if (onward == CadenceType::kAuthentic || onward == CadenceType::kDeceptive) {
          continue;
        }
      }
    }
    CadenceHit hit;
    hit.atBeat = cur.startBeat;
    hit.cadence = std::move(cadence);
    hit.from = chords.raw(i - 1);
    hit.to = chords.raw(i);
    hits.push_back(std::move(hit));
    if (arrivals != nullptr) {
      arrivals->push_back(i);
    }
  }
  return hits;
}

std::vector<CadenceHit> detect_cadences(const ChordTimeline& timeline, const KeyContext& key) {
  assert_chord_timeline(timeline);
  // A cadence belongs to the key it arrives in, so a modulating piece is asked for the key at the
  // arrival beat rather than for one key for the whole span.
  KeyAtBeat key_at = key_scale_at(key);
  std::vector<SegmentSpan> spans = spans_of(timeline.segments);
  ChordSource chord_at = [&](std::size_t index) -> const Chord& {
    return timeline.segments[index].chord;
  };
  return detect_cadences_over(spans, ChordReads{chord_at, chord_at, {}, {}, {}, {}}, key_at);
}

}  // namespace cantus
