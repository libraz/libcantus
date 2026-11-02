// The key as it changes over time: ts/src/analyze/keys/index.ts.

#include "analyze/keys/keys.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <memory>

#include "analyze/adjacency.h"
#include "analyze/detect/profiles.h"
#include "analyze/functional/pivot.h"
#include "analyze/grid.h"
#include "analyze/histogram.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

constexpr std::size_t kPitchClasses = static_cast<std::size_t>(PITCH_CLASSES);

/** Semitones above the root a third may sit at: minor, then major (`THIRD_SEMITONES`, tendency). */
constexpr int kThirdSemitones[] =
#include "analyze/keys/third_semitones.gen.inc"
    ;

/** Semitones above the root a fifth may sit at: diminished, perfect, augmented. */
constexpr int kFifthSemitones[] =
#include "analyze/keys/fifth_semitones.gen.inc"
    ;

/** `Number.MIN_VALUE`. */

/** One of the 24 major and minor keys the search indexes (`KEY_CANDIDATES`). */
struct KeyCandidate {
  KeyScale key;
  int rootPc;
  bool minor;
};

/** Position of a key on the circle of fifths, as a signed count of accidentals (`fifthsOf`). */
int fifths_of(int root_pc, bool minor) {
  // A minor key carries its relative major's signature, three semitones up.
  int major_root = pitch_class_of(minor ? root_pc + 3 : root_pc);
  int raw = (major_root * 7) % 12;
  return raw > 6 ? raw - 12 : raw;
}

/** Steps around the circle of fifths between two candidates, 0 to 6 (`fifthsDistance`). */
int fifths_distance(int a, int b) {
  int diff = std::abs(a - b) % 12;
  return std::min<int>(diff, 12 - diff);
}

const std::vector<KeyCandidate>& key_candidates() {
  static const std::vector<KeyCandidate> candidates = [] {
    std::vector<KeyCandidate> out;
    for (int root_pc = 0; root_pc < 12; ++root_pc) {
      out.push_back(KeyCandidate{major_key(root_pc).scale(), root_pc, false});
      out.push_back(KeyCandidate{minor_key(root_pc).scale(), root_pc, true});
    }
    return out;
  }();
  return candidates;
}

/** Circle-of-fifths distance between every ordered pair of candidates (`CANDIDATE_DISTANCE`). */
const std::vector<std::vector<int>>& candidate_distance() {
  static const std::vector<std::vector<int>> distance = [] {
    std::vector<std::vector<int>> out;
    for (const KeyCandidate& from : key_candidates()) {
      std::vector<int> row;
      for (const KeyCandidate& to : key_candidates()) {
        row.push_back(
            fifths_distance(fifths_of(from.rootPc, from.minor), fifths_of(to.rootPc, to.minor)));
      }
      out.push_back(std::move(row));
    }
    return out;
  }();
  return distance;
}

/** A slot of the search: what sounds in it, and how strongly (`KeySlot`). */
struct KeySlot {
  double startBeat = 0;
  double endBeat = 0;
  /** Score of each candidate over this slot, already weighted by prominence. */
  std::vector<double> scores;
  /** Total prominence of the slot, used to calibrate the modulation cost. */
  double weight = 0;
  /** Runs when the search first reads this slot's start beat; empty for a numeric start. */
  std::function<void()> assert_start;
};

/**
 * Choose one key per slot, trading each slot's fit against a cost per modulation
 * (`chooseKeys`). The cost depends on which key is left as well as which is entered, so every
 * pair is considered.
 */
std::vector<int> choose_keys(const std::vector<KeySlot>& slots, double change_cost,
                             const MeterArg& meter, std::optional<double> budget) {
  const std::vector<KeyCandidate>& candidates = key_candidates();
  const auto count = static_cast<int>(candidates.size());
  if (slots.empty()) {
    return {};
  }
  // One back-pointer row per slot, charged where it is allocated, and two cost rows the
  // recurrence alternates between.
  std::vector<std::int32_t> back =
      allocate_choice_table(static_cast<double>(slots.size()), count, "key search choices", budget);
  std::vector<double> costs = allocate_candidate_table(1, count, "key search costs", budget);
  std::vector<double> spare = allocate_candidate_table(1, count, "key search costs", budget);
  const auto& distances = candidate_distance();
  const std::vector<double>& opening = slots[0].scores;
  for (int c = 0; c < count; ++c) {
    costs[static_cast<std::size_t>(c)] = -opening[static_cast<std::size_t>(c)];
  }
  for (std::size_t i = 1; i < slots.size(); ++i) {
    const KeySlot& slot = slots[i];
    const std::vector<double>& previous = costs;
    std::vector<double>& next = spare;
    if (slot.assert_start) {
      slot.assert_start();
    }
    int accent = metric_weight(slot.startBeat, meter);
    double metric_factor = 1 - (STRONG_BEAT_DISCOUNT * accent) / MAX_METRIC_WEIGHT;
    double slot_change_cost = change_cost * metric_factor;
    std::size_t row_base = i * static_cast<std::size_t>(count);
    for (int to = 0; to < count; ++to) {
      // Holding the key is free; every other predecessor pays by distance.
      double best = previous[static_cast<std::size_t>(to)];
      int best_from = to;
      for (int from = 0; from < count; ++from) {
        if (from == to) {
          continue;
        }
        int distance = distances[static_cast<std::size_t>(from)][static_cast<std::size_t>(to)];
        double penalty = slot_change_cost * (1 + FIFTHS_DISTANCE_COST * distance);
        double cost = previous[static_cast<std::size_t>(from)] + penalty;
        if (cost < best) {
          best = cost;
          best_from = from;
        }
      }
      back[row_base + static_cast<std::size_t>(to)] = best_from;
      next[static_cast<std::size_t>(to)] = best - slot.scores[static_cast<std::size_t>(to)];
    }
    std::swap(costs, spare);
  }

  int best = 0;
  for (int c = 1; c < count; ++c) {
    if (costs[static_cast<std::size_t>(c)] < costs[static_cast<std::size_t>(best)]) {
      best = c;
    }
  }
  std::vector<int> path(slots.size());
  int current = best;
  for (std::size_t i = slots.size(); i-- > 0;) {
    path[i] = current;
    if (i > 0) {
      current = back[i * static_cast<std::size_t>(count) + static_cast<std::size_t>(current)];
    }
  }
  return path;
}

/** A run of slots the search gave one key, before relations and pivots (`SlotRegion`). */
struct SlotRegion {
  double startBeat = 0;
  double endBeat = 0;
  int candidate = 0;
  /** First slot of the run. */
  std::size_t from = 0;
  /** One past its last slot. */
  std::size_t toExclusive = 0;
};

/** Group a per-slot key choice into regions, without relations or pivots (`regionsFromPath`). */
std::vector<SlotRegion> regions_from_path(const std::vector<KeySlot>& slots,
                                          const std::vector<int>& path) {
  std::vector<SlotRegion> regions;
  for (std::size_t i = 0; i < slots.size(); ++i) {
    const KeySlot& slot = slots[i];
    if (!regions.empty() && regions.back().candidate == path[i]) {
      regions.back().endBeat = slot.endBeat;
      regions.back().toExclusive = i + 1;
      continue;
    }
    regions.push_back(SlotRegion{slot.startBeat, slot.endBeat, path[i], i, i + 1});
  }
  return regions;
}

constexpr std::size_t kNone = static_cast<std::size_t>(-1);

/** A region of the merge pass, in a list that shrinks as regions absorb others (`MergeNode`). */
struct MergeNode : SlotRegion {
  /** Index of the neighbour before / after, or kNone. */
  std::size_t previous = kNone;
  std::size_t next = kNone;
  /** Set when the region has been absorbed, so its heap entries are spent. */
  bool merged = false;
};

/** Fold a region's successor into it, and return the region that remains (`absorbNext`). */
std::size_t absorb_next(std::vector<MergeNode>& nodes, std::size_t region) {
  std::size_t next = nodes[region].next;
  if (next == kNone) {
    return region;
  }
  nodes[region].endBeat = nodes[next].endBeat;
  nodes[region].toExclusive = nodes[next].toExclusive;
  nodes[region].next = nodes[next].next;
  if (nodes[next].next != kNone) {
    nodes[nodes[next].next].previous = region;
  }
  nodes[next].merged = true;
  return region;
}

/**
 * The shortest region first, and the earlier of two of one length (`RegionHeap`).
 */
class RegionHeap {
 public:
  explicit RegionHeap(std::vector<MergeNode>& nodes) : nodes_(&nodes) {}

  void push(std::size_t region) {
    entries_.push_back(Entry{region, (*nodes_)[region].endBeat - (*nodes_)[region].startBeat});
    std::size_t index = entries_.size() - 1;
    while (index > 0) {
      std::size_t parent = (index - 1) >> 1;
      if (!before(entries_[index], entries_[parent])) {
        break;
      }
      std::swap(entries_[index], entries_[parent]);
      index = parent;
    }
  }

  /** The shortest region still worth merging, skipping entries since spent. */
  std::size_t pop() {
    for (;;) {
      if (entries_.empty()) {
        return kNone;
      }
      Entry top = entries_.front();
      Entry last = entries_.back();
      entries_.pop_back();
      if (!entries_.empty()) {
        entries_[0] = last;
        sink();
      }
      // An entry whose region has since absorbed a neighbour describes a length the region no
      // longer has; the merge that grew it pushed the new one.
      const MergeNode& node = (*nodes_)[top.region];
      if (!node.merged && node.endBeat - node.startBeat == top.length) {
        return top.region;
      }
    }
  }

 private:
  struct Entry {
    std::size_t region;
    double length;
  };

  bool before(const Entry& a, const Entry& b) const {
    return a.length == b.length ? (*nodes_)[a.region].from < (*nodes_)[b.region].from
                                : a.length < b.length;
  }

  void sink() {
    std::size_t index = 0;
    for (;;) {
      std::size_t left = index * 2 + 1;
      std::size_t right = left + 1;
      std::size_t smallest = index;
      if (left < entries_.size() && before(entries_[left], entries_[smallest])) {
        smallest = left;
      }
      if (right < entries_.size() && before(entries_[right], entries_[smallest])) {
        smallest = right;
      }
      if (smallest == index) {
        return;
      }
      std::swap(entries_[index], entries_[smallest]);
      index = smallest;
    }
  }

  std::vector<MergeNode>* nodes_;
  std::vector<Entry> entries_;
};

/**
 * Fold every region shorter than `min_beats` into the neighbour that explains it best, and return
 * the amended per-slot choice (`enforceMinimumRegion`).
 */
std::vector<int> enforce_minimum_region(const std::vector<KeySlot>& slots,
                                        const std::vector<int>& path, double min_beats,
                                        std::optional<double> budget) {
  std::vector<int> chosen = path;
  std::vector<SlotRegion> initial = regions_from_path(slots, chosen);
  if (initial.size() < 2) {
    return chosen;
  }
  const std::size_t candidates = key_candidates().size();
  // Running totals of every slot's candidate scores. The evidence a region gives a neighbour's key
  // is the difference of two of these, so it is read in constant time however many slots the
  // region has grown to hold.
  std::vector<double> totals =
      allocate_candidate_table(static_cast<double>(slots.size()), static_cast<double>(candidates),
                               "key region scores", budget);
  for (std::size_t i = 0; i < slots.size(); ++i) {
    std::size_t base = i * candidates;
    std::size_t previous = base - candidates;
    for (std::size_t c = 0; c < candidates; ++c) {
      totals[base + c] = (i == 0 ? 0 : totals[previous + c]) + slots[i].scores[c];
    }
  }
  std::vector<MergeNode> nodes;
  for (const SlotRegion& region : initial) {
    MergeNode node;
    static_cast<SlotRegion&>(node) = region;
    nodes.push_back(node);
  }
  auto score_over = [&](const MergeNode& region, int candidate) {
    auto c = static_cast<std::size_t>(candidate);
    return totals[(region.toExclusive - 1) * candidates + c] -
           (region.from == 0 ? 0 : totals[(region.from - 1) * candidates + c]);
  };
  for (std::size_t i = 0; i < nodes.size(); ++i) {
    nodes[i].previous = i == 0 ? kNone : i - 1;
    nodes[i].next = i + 1 < nodes.size() ? i + 1 : kNone;
  }

  // A region only ever grows, so a region already too long to merge stays too long, and the
  // neighbour a region adjoins keeps the edge it adjoins on until one of the two is absorbed.
  RegionHeap pending(nodes);
  for (std::size_t i = 0; i < nodes.size(); ++i) {
    pending.push(i);
  }
  for (;;) {
    std::size_t index = pending.pop();
    if (index == kNone) {
      return chosen;
    }
    double length = nodes[index].endBeat - nodes[index].startBeat;
    if (nodes[index].merged || length >= min_beats - BEAT_EPS) {
      continue;
    }
    std::size_t previous = nodes[index].previous;
    std::size_t next = nodes[index].next;
    bool has_before =
        previous != kNone && std::fabs(nodes[previous].endBeat - nodes[index].startBeat) < BEAT_EPS;
    bool has_after =
        next != kNone && std::fabs(nodes[next].startBeat - nodes[index].endBeat) < BEAT_EPS;
    if (!has_before && !has_after) {
      continue;
    }
    // The shorter region joins the neighbouring key that reads its chords best, so a tonicization
    // is absorbed by the key it decorates rather than by whichever side happens to come first.
    int winner;
    if (!has_before) {
      winner = nodes[next].candidate;
    } else if (!has_after) {
      winner = nodes[previous].candidate;
    } else {
      int left = nodes[previous].candidate;
      int right = nodes[next].candidate;
      winner = score_over(nodes[index], left) >= score_over(nodes[index], right) ? left : right;
    }
    for (std::size_t i = nodes[index].from; i < nodes[index].toExclusive; ++i) {
      chosen[i] = winner;
    }
    nodes[index].candidate = winner;
    // Two consecutive runs of one key are one region whether or not they adjoin, which is the
    // grouping regions_from_path() would give the amended path.
    std::size_t grown = index;
    if (previous != kNone && nodes[previous].candidate == winner) {
      grown = absorb_next(nodes, previous);
    }
    if (nodes[grown].next != kNone && nodes[nodes[grown].next].candidate == winner) {
      grown = absorb_next(nodes, grown);
    }
    pending.push(grown);
  }
}

/**
 * Attach each region's relation to the one before it (`withRelations`); a key standing in the
 * `same` relation is no modulation, so it is not written.
 */
void with_relations(std::vector<KeyRegion>& regions) {
  for (std::size_t i = 1; i < regions.size(); ++i) {
    Nullable<KeyRelation> relation = key_relation_between(regions[i - 1].key, regions[i].key);
    if (relation && *relation != KeyRelation::kSame) {
      regions[i].modulation = *relation;
    }
  }
}

/** The assert_range() bounds an option duration holds to. */
double positive_beats(double value, std::string_view name) {
  return assert_range(value, kMinValue, kMaxSafeInteger, name);
}

/** The meters and the two slot lengths a key search reads from its options (`resolveKeySearch`). */
struct KeySearchOptions {
  MeterMap meters;
  double expectedKeyBeats;
  double minKeyBeats;
};

KeySearchOptions resolve_key_search(const KeyTimelineOptions& opts, std::string_view meters_name) {
  ResolveMetersOptions meter_options;
  meter_options.ts = opts.ts;
  meter_options.meters = opts.meters;
  MeterMap meters = resolve_meters(meter_options, meters_name);
  double bar = beats_per_bar_at(0, MeterArg(meters));
  double expected_key_beats =
      positive_beats(opts.expectedKeyBeats.value_or(bar * 4), "expectedKeyBeats");
  double min_key_beats = positive_beats(opts.minKeyBeats.value_or(bar), "minKeyBeats");
  return KeySearchOptions{std::move(meters), expected_key_beats, min_key_beats};
}

/** The chords sounding over a span of the analysis, with the beats the search reads them over. */
struct OrderedSegment {
  std::size_t index;
  double startBeat;
  double endBeat;
};

/** Score how strongly one chord argues for one key (`chordFitsKey`). */
double chord_fits_key(const Chord& chord, const std::vector<int>& tones,
                      const KeyCandidate& candidate) {
  if (tones.empty()) {
    return 0;
  }
  int in_key = 0;
  for (int pc : tones) {
    if (is_scale_tone(pc, candidate.key)) {
      in_key += 1;
    }
  }
  // A tone outside the key counts against it rather than merely failing to count for it.
  auto size = static_cast<double>(tones.size());
  double score = CHORD_TONE_CREDIT * ((in_key - (size - in_key)) / size);
  // A dominant seventh names its key almost by itself; a bare major triad a fifth up has no
  // tritone and earns half of the credit.
  int root_degree = pitch_class_of(chord.rootPc - candidate.rootPc);
  if (root_degree == 7) {
    if (sounds_dominant_seventh(chord)) {
      score += DOMINANT_CREDIT;
    } else if (chord.quality == ChordQuality::kMaj) {
      score += DOMINANT_CREDIT * 0.5;
    }
  }
  if (root_degree == 0) {
    score += TONIC_CREDIT;
  }
  return score;
}

/** The triad a chord is heard as, or nullopt when it is heard as none (`triadCore`). */
std::optional<std::array<int, 3>> triad_core(const Chord& chord) {
  int root = pitch_class_of(chord.rootPc);
  std::optional<double> third;
  std::optional<double> fifth;
  auto includes = [](const auto& list, double value) {
    return std::find(std::begin(list), std::end(list), value) != std::end(list);
  };
  for (double interval : chord.intervals) {
    if (interval < 0 || interval >= 12) {
      continue;
    }
    if (!third && includes(kThirdSemitones, interval)) {
      third = interval;
    } else if (!fifth && includes(kFifthSemitones, interval)) {
      fifth = interval;
    }
  }
  if (!third || !fifth) {
    return std::nullopt;
  }
  std::array<int, 3> core = {root, pitch_class_of(root + *third), pitch_class_of(root + *fifth)};
  std::stable_sort(core.begin(), core.end());
  return core;
}

/**
 * The index of the last chord to have stopped by a beat, "last" being last in the order the
 * chords were given (`lastChordFinishedBy`).
 */
class LastChordFinishedBy {
 public:
  explicit LastChordFinishedBy(const std::vector<OrderedSegment>& chords) : chords_(&chords) {
    for (std::size_t i = 0; i < chords.size(); ++i) {
      by_end_.push_back(i);
    }
    std::stable_sort(by_end_.begin(), by_end_.end(), [&](std::size_t a, std::size_t b) {
      return chords[a].endBeat - chords[b].endBeat < 0;
    });
    std::size_t running = 0;
    for (std::size_t i = 0; i < by_end_.size(); ++i) {
      running = std::max<std::size_t>(running, by_end_[i]);
      latest_.push_back(running);
    }
  }

  /** The chord, or kNone before the first chord ends. */
  std::size_t operator()(double beat) const {
    std::size_t low = 0;
    std::size_t high = by_end_.size();
    while (low < high) {
      std::size_t mid = (low + high) >> 1;
      if ((*chords_)[by_end_[mid]].endBeat <= beat) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low == 0 ? kNone : latest_[low - 1];
  }

 private:
  const std::vector<OrderedSegment>* chords_;
  std::vector<std::size_t> by_end_;
  std::vector<std::size_t> latest_;
};

/** Name the chord each modulation turned on, where the chords support one (`attachPivots`). */
void attach_pivots(std::vector<KeyRegion>& regions, const std::vector<OrderedSegment>& chords,
                   const ChordSource& chord_at) {
  if (regions.size() < 2 || chords.empty()) {
    return;
  }
  LastChordFinishedBy finished(chords);
  for (std::size_t i = 1; i < regions.size(); ++i) {
    std::size_t last = finished(regions[i].startBeat + BEAT_EPS);
    if (last == kNone) {
      continue;
    }
    const Chord& chord = chord_at(chords[last].index);
    std::optional<std::array<int, 3>> core = triad_core(chord);
    if (!core) {
      continue;
    }
    int root = pitch_class_of(chord.rootPc);
    for (const PivotChord& entry : pivots_between(regions[i - 1].key, regions[i].key)) {
      std::vector<int> tones = chord_pitch_classes(entry.chord);
      if (entry.chord.rootPc == root && tones.size() == core->size() &&
          std::equal(tones.begin(), tones.end(), core->begin())) {
        regions[i].pivot = entry;
        break;
      }
    }
  }
}

/** A region's key, owned by it: the candidate resolved whole. */
ResolvedKey region_key(const KeyCandidate& candidate) { return resolve_key(candidate.key); }

/** How well a pitch-class histogram fits a candidate key, as a correlation with its profile. */
double candidate_fit(const std::array<double, 12>& weights, const KeyProfilePair& profile,
                     const KeyCandidate& candidate) {
  return profile_score(weights, candidate.minor ? profile.minor : profile.major, candidate.rootPc);
}

/** The region a candidate holds over `[start_beat, end_beat)` (`regionFor`). */
KeyRegion region_for(const KeyCandidate& candidate, double start_beat, double end_beat,
                     const std::array<double, 12>& weights, const KeyProfilePair& profile) {
  KeyRegion out;
  out.startBeat = start_beat;
  out.endBeat = end_beat;
  out.key = region_key(candidate);
  out.confidence = js::max(0, candidate_fit(weights, profile, candidate));
  return out;
}

}  // namespace

std::vector<KeyRegion> key_timeline_from_notes(const std::vector<NoteEvent>& notes,
                                               const KeyTimelineOptions& opts) {
  return key_timeline_over(notes, opts, typed_profile_source(opts.profile));
}

std::vector<KeyRegion> key_timeline_over(const std::vector<NoteEvent>& notes,
                                         const KeyTimelineOptions& opts,
                                         const ProfileSource& profile_source) {
  KeySearchOptions search = resolve_key_search(opts, "key timeline meters");
  const MeterArg meters(search.meters);
  double expected_key_beats = search.expectedKeyBeats;
  double min_key_beats = search.minKeyBeats;
  std::optional<double> budget = opts.budget;
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = budget;
  assert_note_events(notes, "key timeline notes", note_options);
  std::vector<NoteEvent> sounding = drop_silent_notes(notes);
  double total_beats = opts.totalBeats.value_or(latest_sounding_end(sounding));
  assert_range(total_beats, js::min(0, first_sounding_beat(sounding)), kMaxSafeInteger,
               "key timeline totalBeats");

  double slot_beats = js::min(min_key_beats, expected_key_beats);
  // The key slots are longer than the chord slots, so the two grids start on different beats, but
  // the music starts on one beat, and that is the beat both report.
  GridOrigin grid = grid_for_notes(sounding, slot_beats);
  double origin = grid.origin;
  double music_start = grid.startBeat;
  double slot_count = js::max(0, std::ceil((total_beats - origin) / slot_beats - BEAT_EPS));
  // Every slot is scored against the whole candidate list and keeps that row, so what the budget
  // has to bound is the table about to be built rather than the slot count alone.
  const std::vector<KeyCandidate>& candidates = key_candidates();
  assert_generation_budget(slot_count * static_cast<double>(candidates.size()),
                           "key timeline slots", budget);
  if (slot_count == 0 || sounding.empty()) {
    return {};
  }

  ResolvedProfile resolved_profile = profile_source();
  // Each note is sorted into its slots once.
  std::vector<std::vector<std::size_t>> slot_notes =
      bucket_notes_by_slot(sounding, SlotGrid{origin, slot_beats}, slot_count,
                           BucketOptions{"key timeline note-to-slot memberships", budget});
  // A slot's own histogram, which is also what its neighbours hear of it.
  std::vector<WindowWeights> slot_weights;
  auto slot_total = static_cast<std::size_t>(slot_count);
  for (std::size_t i = 0; i < slot_total; ++i) {
    double start_beat = origin + static_cast<double>(i) * slot_beats;
    slot_weights.push_back(window_weights(sounding, &slot_notes[i], start_beat,
                                          js::min(start_beat + slot_beats, total_beats), meters));
  }
  const KeyProfilePair& profile = resolved_profile.get();
  WindowWeights empty;
  std::vector<KeySlot> slots;
  double weight_sum = 0;
  int sounding_slots = 0;
  for (std::size_t i = 0; i < slot_total; ++i) {
    double start_beat = origin + static_cast<double>(i) * slot_beats;
    double end_beat = js::min(start_beat + slot_beats, total_beats);
    // One bar in isolation says very little, so the neighbouring bars are heard too, more quietly
    // than the bar itself.
    const WindowWeights& own = slot_weights[i];
    const WindowWeights& before = i > 0 ? slot_weights[i - 1] : empty;
    const WindowWeights& after = i + 1 < slot_total ? slot_weights[i + 1] : empty;
    std::array<double, 12> weights{};
    for (std::size_t pc = 0; pc < kPitchClasses; ++pc) {
      weights[pc] = own.weights[pc] + PAST_CONTEXT_SHARE * before.weights[pc] +
                    FUTURE_CONTEXT_SHARE * after.weights[pc];
    }
    // Prominence comes from the slot itself, so a sparse slot does not inherit the weight of its
    // loud neighbours when the modulation cost is calibrated.
    double total_weight = own.totalWeight;
    KeySlot slot;
    slot.startBeat = start_beat;
    slot.endBeat = end_beat;
    for (const KeyCandidate& candidate : candidates) {
      slot.scores.push_back(candidate_fit(weights, profile, candidate) * total_weight);
    }
    slot.weight = total_weight;
    slots.push_back(std::move(slot));
    if (total_weight > BEAT_EPS) {
      weight_sum += total_weight;
      sounding_slots += 1;
    }
  }
  if (sounding_slots == 0) {
    return {};
  }

  double mean_slot_weight = weight_sum / sounding_slots;
  double change_cost = MODULATION_COST * mean_slot_weight * (expected_key_beats / slot_beats);
  std::vector<int> path = choose_keys(slots, change_cost, meters, budget);
  std::vector<SlotRegion> grouped = regions_from_path(slots, path);
  // The reported span of the first region is clipped to where the music starts, and the slot
  // holding the first onset begins a whole slot before it wherever that onset is not on a slot
  // boundary. A sliver of a region in front of the piece is folded into the region after it.
  if (grouped.size() >= 2 &&
      grouped[0].endBeat - js::max(grouped[0].startBeat, music_start) < slot_beats - BEAT_EPS) {
    grouped[1].startBeat = grouped[0].startBeat;
    grouped[1].from = grouped[0].from;
    grouped.erase(grouped.begin());
  }
  std::vector<KeyRegion> regions;
  for (const SlotRegion& region : grouped) {
    const KeyCandidate& candidate = candidates[static_cast<std::size_t>(region.candidate)];
    // Only the first region can start before the music: the slot holding the pickup begins a
    // whole slot before beat 0, and nothing sounds in the part of it that precedes the upbeat.
    double start_beat = js::max(region.startBeat, music_start);
    // The histogram over a region is the histogram over its slots: a note's weight is its overlap
    // with the window, so the parts add up.
    std::array<double, 12> weights{};
    for (std::size_t i = region.from; i < region.toExclusive; ++i) {
      for (std::size_t pc = 0; pc < kPitchClasses; ++pc) {
        weights[pc] += slot_weights[i].weights[pc];
      }
    }
    regions.push_back(region_for(candidate, start_beat, region.endBeat, weights, profile));
  }
  with_relations(regions);
  return regions;
}

std::vector<KeyRegion> detect_modulations_over(const std::vector<SegmentBeats>& segments,
                                               const ChordSource& chord_at,
                                               const KeyTimelineOptions& opts,
                                               const ProfileSource& profile_source,
                                               std::vector<std::size_t>* first_segments) {
  KeySearchOptions search = resolve_key_search(opts, "modulation meters");
  const MeterArg meters(search.meters);
  double expected_key_beats = search.expectedKeyBeats;
  double min_key_beats = search.minKeyBeats;
  // One slot per chord, each holding a row of the candidate list: the search's table, not the
  // chord count, is what the budget stands for.
  const std::vector<KeyCandidate>& candidates = key_candidates();
  assert_generation_budget(static_cast<double>(segments.size() * candidates.size()),
                           "modulation chord segments", opts.budget);
  std::vector<OrderedSegment> sorted;
  for (std::size_t i = 0; i < segments.size(); ++i) {
    if (segments[i].sounds) {
      sorted.push_back(OrderedSegment{i, segments[i].startBeat, segments[i].endBeat});
    }
  }
  std::stable_sort(sorted.begin(), sorted.end(),
                   [](const OrderedSegment& a, const OrderedSegment& b) {
                     return a.startBeat - b.startBeat < 0;
                   });
  // Seeded below every beat, so a chart lying wholly before beat 0 ends at its last chord.
  double last_chord_end = 0;
  if (!sorted.empty()) {
    last_chord_end = -std::numeric_limits<double>::infinity();
    for (const OrderedSegment& segment : sorted) {
      last_chord_end = js::max(last_chord_end, segment.endBeat);
    }
  }
  double total_beats = opts.totalBeats.value_or(last_chord_end);
  // Only a span ending before beat 0 can be bounded by where the first chord starts.
  double lowest = total_beats < 0 ? js::min(0, sorted.empty() ? 0 : sorted.front().startBeat) : 0;
  assert_range(total_beats, lowest, kMaxSafeInteger, "modulation totalBeats");
  // The analyzed span ends where the caller says it does, so a chord held past the end of the
  // piece argues for its key only over the part that sounds.
  std::vector<OrderedSegment> ordered;
  for (const OrderedSegment& segment : sorted) {
    OrderedSegment clipped{segment.index, segment.startBeat, js::min(segment.endBeat, total_beats)};
    if (clipped.endBeat > clipped.startBeat) {
      ordered.push_back(clipped);
    }
  }
  if (ordered.empty()) {
    return {};
  }

  std::vector<KeySlot> slots;
  std::vector<std::vector<int>> tones;
  for (const OrderedSegment& segment : ordered) {
    double length = segment.endBeat - segment.startBeat;
    const Chord& chord = chord_at(segment.index);
    tones.push_back(chord_pitch_classes(chord));
    KeySlot slot;
    slot.startBeat = segment.startBeat;
    slot.endBeat = segment.endBeat;
    slot.assert_start = segments[segment.index].assert_start;
    // A chord that holds for two bars argues twice as hard as one that passes in half a bar.
    for (const KeyCandidate& candidate : candidates) {
      slot.scores.push_back(chord_fits_key(chord, tones.back(), candidate) * length);
    }
    slot.weight = length;
    slots.push_back(std::move(slot));
  }
  // A chord preceded by its own dominant is the clearest statement a key gets, and it is the pair
  // that makes it, so the cadential credit is folded into the arriving chord.
  for (std::size_t i = 1; i < slots.size(); ++i) {
    const Chord& arriving = chord_at(ordered[i].index);
    const Chord& approaching = chord_at(ordered[i - 1].index);
    // Only a dominant seventh earns this: what makes a cadence name its key is the tritone.
    bool is_dominant_motion = pitch_class_of(approaching.rootPc - arriving.rootPc) == 7 &&
                              sounds_dominant_seventh(approaching);
    if (!is_dominant_motion) {
      continue;
    }
    double length = slots[i].endBeat - slots[i].startBeat;
    for (std::size_t c = 0; c < candidates.size(); ++c) {
      if (pitch_class_of(arriving.rootPc - candidates[c].rootPc) == 0) {
        slots[i].scores[c] += CADENCE_CREDIT * length;
      }
    }
  }
  // Here a slot's weight is its length in beats outright, so one expected key area's worth of
  // evidence is just `expected_key_beats` and no mean is needed.
  double change_cost = CHORD_MODULATION_COST * expected_key_beats;
  std::vector<int> path = choose_keys(slots, change_cost, meters, opts.budget);
  // A shortest region longer than a key is expected to hold is a contradiction, and the prior is
  // the one to keep.
  std::vector<SlotRegion> grouped = regions_from_path(
      slots,
      enforce_minimum_region(slots, path, js::min(min_key_beats, expected_key_beats), opts.budget));

  ResolvedProfile resolved_profile = profile_source();
  const KeyProfilePair& profile = resolved_profile.get();
  std::vector<KeyRegion> regions;
  for (const SlotRegion& region : grouped) {
    const KeyCandidate& candidate = candidates[static_cast<std::size_t>(region.candidate)];
    // The confidence is the statistic the note path reports, not the chord fit the search ran on.
    // A chord sounds all of its tones for all of its length, so the distribution is its pitch
    // classes weighted by how much of the region it holds.
    std::array<double, 12> weights{};
    for (std::size_t i = region.from; i < region.toExclusive; ++i) {
      double overlap = ordered[i].endBeat - ordered[i].startBeat;
      if (overlap <= BEAT_EPS) {
        continue;
      }
      for (int pc : tones[i]) {
        weights[static_cast<std::size_t>(pc)] += overlap;
      }
    }
    regions.push_back(region_for(candidate, region.startBeat, region.endBeat, weights, profile));
    if (first_segments != nullptr) {
      first_segments->push_back(ordered[region.from].index);
    }
  }
  // The analyzed span runs to `total_beats`, so the last key holds to the end of it rather than to
  // the last chord: silence changes no key.
  if (!regions.empty() && total_beats > regions.back().endBeat) {
    regions.back().endBeat = total_beats;
  }
  with_relations(regions);
  attach_pivots(regions, ordered, chord_at);
  return regions;
}

std::vector<KeyRegion> detect_modulations(const std::vector<ChordSegment>& chords,
                                          const KeyTimelineOptions& opts) {
  std::vector<SegmentBeats> beats;
  for (const ChordSegment& segment : chords) {
    beats.push_back(
        SegmentBeats{segment.startBeat, segment.endBeat, segment.endBeat > segment.startBeat, {}});
  }
  return detect_modulations_over(
      beats, [&](std::size_t index) -> const Chord& { return chords[index].chord; }, opts,
      typed_profile_source(opts.profile));
}

void attach_pivots_over(std::vector<KeyRegion>& regions, const std::vector<SegmentSpan>& chords,
                        const ChordSource& chord_at) {
  std::vector<OrderedSegment> ordered;
  for (std::size_t i = 0; i < chords.size(); ++i) {
    ordered.push_back(OrderedSegment{i, chords[i].startBeat, chords[i].endBeat});
  }
  attach_pivots(regions, ordered, chord_at);
}

void attach_pivots(std::vector<KeyRegion>& regions, const std::vector<ChordSegment>& chords) {
  attach_pivots_over(regions, spans_of(chords),
                     [&](std::size_t index) -> const Chord& { return chords[index].chord; });
}

std::optional<std::size_t> prevailing_key_index(
    const std::vector<std::pair<std::string, double>>& regions) {
  // Held time is summed per key, not per region: a key returned to after a digression prevails
  // over one stated once at length.
  struct Held {
    std::string id;
    std::size_t first;
    double length;
  };
  std::vector<Held> totals;
  for (std::size_t index = 0; index < regions.size(); ++index) {
    auto found = std::find_if(totals.begin(), totals.end(),
                              [&](const Held& held) { return held.id == regions[index].first; });
    if (found == totals.end()) {
      totals.push_back(Held{regions[index].first, index, regions[index].second});
    } else {
      found->length += regions[index].second;
    }
  }
  std::optional<std::size_t> best;
  double best_length = -1;
  for (const Held& held : totals) {
    // Ties keep the earlier key, which is the one the piece established first.
    if (held.length > best_length) {
      best_length = held.length;
      best = held.first;
    }
  }
  return best;
}

std::vector<SegmentSpan> spans_of(const std::vector<ChordSegment>& segments) {
  std::vector<SegmentSpan> spans;
  spans.reserve(segments.size());
  for (const ChordSegment& segment : segments) {
    spans.push_back(SegmentSpan{segment.startBeat, segment.endBeat});
  }
  return spans;
}

std::string key_id(const KeyScale& scale) {
  return js::to_string(static_cast<double>(pitch_class_of(scale.rootPc))) + ":" +
         js::to_string(static_cast<double>(scale.modeMask12));
}

Nullable<ResolvedKey> prevailing_key_of(const std::vector<KeyRegion>& regions) {
  std::vector<std::pair<std::string, double>> entries;
  for (const KeyRegion& region : regions) {
    entries.emplace_back(key_id(region.key.scale), js::max(0, region.endBeat - region.startBeat));
  }
  std::optional<std::size_t> best = prevailing_key_index(entries);
  if (!best) {
    return std::nullopt;
  }
  return regions[*best].key;
}

ResolvedKey prevailing_key_or_default(const std::vector<KeyRegion>& regions) {
  Nullable<ResolvedKey> prevailing = prevailing_key_of(regions);
  return prevailing ? *prevailing : resolve_key(major_key(0));
}

const ResolvedKey& KeyLookup::operator()(double beat) const {
  const std::vector<KeyRegion>& regions = *regions_;
  std::size_t low = 0;
  std::size_t high = regions.size();
  while (low < high) {
    std::size_t middle = (low + high) / 2;
    if (regions[middle].startBeat <= beat) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  if (low > 0 && beat < regions[low - 1].endBeat) {
    return regions[low - 1].key;
  }
  return fallback_;
}

}  // namespace cantus
