// Harmonic reduction: ts/src/analyze/reduction/index.ts.

#include "analyze/reduction/reduction.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <numeric>

#include "analyze/adjacency.h"
#include "analyze/functional/cadence.h"
#include "analyze/functional/tonicization.h"
#include "analyze/voice/voice.h"
#include "cantus/core/pitch.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

/** REDUCTION_LEVELS. */
constexpr std::string_view kReductionLevelNames[] =
#include "analyze/reduction/reduction_levels.gen.inc"
    ;

/** REDUCTION_BASES: the readings BASIS_READINGS holds. */
constexpr std::string_view kReductionBasisNames[] =
#include "analyze/reduction/reduction_bases.gen.inc"
    ;

/** TONIC_ARRIVING_CADENCES: cadences whose arrival is the tonic or the substitute for it. */
constexpr std::string_view kTonicArrivingCadenceNames[] =
#include "analyze/reduction/tonic_arriving_cadences.gen.inc"
    ;

static_assert(std::size(kReductionLevelNames) == 3, "REDUCTION_LEVELS and ReductionLevel disagree");
static_assert(std::size(kReductionBasisNames) == 2, "REDUCTION_BASES and ReductionBasis disagree");

/** Why a chord was kept in the frame, or which figure demoted it (`ReductionReason`). */
enum class ReasonKind : std::uint8_t {
  kTonic,
  kDominant,
  kCadentialSixFour,
  kCadenceArrival,
  kCadenceAgent,
  kSalient,
  kFirst,
  kLast,
  kUnfigured,
  kPassing,
  kNeighbor,
};

struct Reason {
  ReasonKind kind;
  /** The cadence of an arrival or an agent. */
  CadenceType cadence = CadenceType::kAuthentic;
};

/** The root pitch class of segment `i`'s chord as the reduction reads it. */
int root_of(const ChordReads& chords, std::size_t i) {
  return chords.root_pc ? chords.root_pc(i) : pitch_class_of(chords.raw(i).rootPc);
}

/** Signed semitone distance between two pitch classes, in [-6, 5] (`signedStep`). */
double signed_step(const ChordReads& chords, std::size_t from, std::size_t to) {
  // The destination is converted first, as the subtraction is written.
  int to_pc = root_of(chords, to);
  int from_pc = root_of(chords, from);
  return std::fmod(to_pc - from_pc + 18, 12) - 6;
}

/** Whether a root motion is a step: a semitone or a whole tone, either way (`isStep`). */
bool is_step(double distance) {
  double size = std::fabs(distance);
  return size == 1 || size == 2;
}

/** The length each segment has to beat to count as salient (`salienceFloors`). */
std::vector<double> salience_floors(const std::vector<double>& durations) {
  std::vector<std::size_t> order(durations.size());
  std::iota(order.begin(), order.end(), 0);
  std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
    double by_length = durations[a] - durations[b];
    return (by_length != 0 && !std::isnan(by_length) ? by_length : static_cast<double>(a) - b) < 0;
  });
  std::vector<std::size_t> rank_of(durations.size(), 0);
  for (std::size_t rank = 0; rank < order.size(); ++rank) {
    rank_of[order[rank]] = rank;
  }
  std::vector<double> floors;
  const std::size_t n = durations.size();
  for (std::size_t index = 0; index < n; ++index) {
    if (n - 1 == 0) {
      floors.push_back(0);
      continue;
    }
    std::size_t remaining = n - 1;
    std::size_t skipped = rank_of[index];
    auto at = [&](std::size_t position) {
      return durations[order[position < skipped ? position : position + 1]];
    };
    std::size_t middle = remaining >> 1;
    floors.push_back(remaining % 2 == 1 ? at(middle) : (at(middle - 1) + at(middle)) / 2);
  }
  return floors;
}

bool is_tonic_arriving(CadenceType type) {
  for (std::string_view name : kTonicArrivingCadenceNames) {
    if (name == to_string(type)) {
      return true;
    }
  }
  return false;
}

/** What a reading is given to decide whether a chord holds the frame (`FrameContext`). */
struct Frame {
  std::size_t index;
  const SegmentSpan* segment;
  /** The neighbours whose bounds touch this one's, or null. */
  const SegmentSpan* before;
  const SegmentSpan* after;
  std::size_t before_index;
  std::size_t after_index;
  double salience_floor;
};

/** Why a chord belongs to the frame under the functional reading, or nullopt (`functionalReason`).
 */
std::optional<Reason> functional_reason(const Frame& frame, const ChordReads& chords,
                                        const KeyAtBeat& key_at) {
  KeyScale key = key_at(frame.segment->startBeat);
  // Asked before the tonic, because the cadential six-four is a tonic triad and would otherwise be
  // kept as one.
  if (frame.after != nullptr && chords.scan_six_four) {
    const Chord& stated = chords.raw(frame.index);
    if (pitch_class_of(stated.rootPc - key.rootPc) == 0 && stated.bassPc) {
      chords.scan_six_four(frame.index);
    }
  }
  if (frame.after != nullptr &&
      is_cadential_six_four(chords.raw(frame.index), chords.raw(frame.after_index), key)) {
    return Reason{ReasonKind::kCadentialSixFour};
  }
  const Chord& chord = chords.raw(frame.index);
  if (pitch_class_of(chord.rootPc - key.rootPc) == 0) {
    if (chords.pitch_classes) {
      chords.pitch_classes(frame.index);
    }
    if (!is_applied_dominant(chord, key)) {
      return Reason{ReasonKind::kTonic};
    }
  }
  if (chords.scan_dominant && pitch_class_of(chord.rootPc - key.rootPc) == DOMINANT_ABOVE_TONIC) {
    chords.scan_dominant(frame.index);
  }
  if (is_dominant_chord_of(chord, key)) {
    return Reason{ReasonKind::kDominant};
  }
  if (frame.before != nullptr) {
    const Chord& from = chords.checked(frame.before_index);
    const Chord& to = chords.checked(frame.index);
    Nullable<CadenceType> arrival = cadence_between(from, to, key).type;
    if (arrival) {
      return Reason{ReasonKind::kCadenceArrival, *arrival};
    }
  }
  if (frame.after != nullptr) {
    KeyScale after_key = key_at(frame.after->startBeat);
    const Chord& from = chords.checked(frame.index);
    const Chord& to = chords.checked(frame.after_index);
    Nullable<CadenceType> agent = cadence_between(from, to, after_key).type;
    if (agent && is_tonic_arriving(*agent)) {
      return Reason{ReasonKind::kCadenceAgent, *agent};
    }
  }
  return std::nullopt;
}

/** The figure a chord's root traces against its neighbours, or nullopt (`figureReason`). */
std::optional<Reason> figure_reason(const Frame& frame, const ChordReads& chords) {
  if (frame.before == nullptr || frame.after == nullptr) {
    return std::nullopt;
  }
  double incoming = signed_step(chords, frame.before_index, frame.index);
  double outgoing = signed_step(chords, frame.index, frame.after_index);
  if (!is_step(incoming) || !is_step(outgoing)) {
    return std::nullopt;
  }
  // A step in and a step on in the same direction passes through; a step away from a harmony that
  // comes back is a neighbour to it.
  if ((incoming > 0) == (outgoing > 0)) {
    return Reason{ReasonKind::kPassing};
  }
  if (root_of(chords, frame.before_index) == root_of(chords, frame.after_index)) {
    return Reason{ReasonKind::kNeighbor};
  }
  return std::nullopt;
}

/** The rationale for a reduction level, in the phrasing a note label uses (`describe`). */
std::string describe(const Reason& reason) {
  switch (reason.kind) {
    case ReasonKind::kTonic:
      return "Structural: the tonic of the key, which the progression is heard against";
    case ReasonKind::kDominant:
      return "Structural: the dominant of the key, the chord its tonic is approached from";
    case ReasonKind::kCadentialSixFour:
      return "Structural: a tonic six-four on the bass of the dominant that follows, which "
             "prolongs that dominant rather than framing the tonic";
    case ReasonKind::kCadenceArrival:
      return "Structural: the arrival of a " + std::string(to_string(reason.cadence)) + " cadence";
    case ReasonKind::kCadenceAgent:
      return "Structural: the chord that drives a " + std::string(to_string(reason.cadence)) +
             " cadence";
    case ReasonKind::kSalient:
      return "Structural: it holds the harmony longer than the chords around it";
    case ReasonKind::kFirst:
      return "Structural: the first chord of the progression frames it";
    case ReasonKind::kLast:
      return "Structural: the last chord of the progression frames it";
    case ReasonKind::kUnfigured:
      return "Structural: its root neither steps through to the next chord nor returns to the "
             "last, so it embellishes nothing";
    case ReasonKind::kPassing:
      return "Passing: its root steps in from the previous chord and on to the next in the same "
             "direction";
    case ReasonKind::kNeighbor:
      return "Neighbor: its root steps away from the surrounding harmony and returns to it";
  }
  return {};
}

/** The level a reason places a chord at (`levelOf`). */
ReductionLevel level_of(const Reason& reason) {
  if (reason.kind == ReasonKind::kPassing) {
    return ReductionLevel::kPassing;
  }
  return reason.kind == ReasonKind::kNeighbor ? ReductionLevel::kNeighbor
                                              : ReductionLevel::kStructural;
}

/** Whether two segments touch, so that the motion between them is heard (`touches`). */
bool touches(const SegmentSpan& before, const SegmentSpan& after) {
  return std::fabs(after.startBeat - before.endBeat) <= BEAT_EPS;
}

}  // namespace

std::string_view to_string(ReductionLevel level) {
  return kReductionLevelNames[static_cast<std::size_t>(level)];
}

std::optional<ReductionLevel> parse_reduction_level(std::string_view name) {
  for (std::size_t i = 0; i < std::size(kReductionLevelNames); ++i) {
    if (kReductionLevelNames[i] == name) {
      return static_cast<ReductionLevel>(i);
    }
  }
  return std::nullopt;
}

std::vector<ReductionLevel> reduction_levels() {
  std::vector<ReductionLevel> out;
  for (std::size_t i = 0; i < std::size(kReductionLevelNames); ++i) {
    out.push_back(static_cast<ReductionLevel>(i));
  }
  return out;
}

std::string_view to_string(ReductionBasis basis) {
  return kReductionBasisNames[static_cast<std::size_t>(basis)];
}

std::optional<ReductionBasis> parse_reduction_basis(std::string_view name) {
  for (std::size_t i = 0; i < std::size(kReductionBasisNames); ++i) {
    if (kReductionBasisNames[i] == name) {
      return static_cast<ReductionBasis>(i);
    }
  }
  return std::nullopt;
}

std::vector<ReductionVerdict> reduce_progression_over(const std::vector<SegmentSpan>& segments,
                                                      const ChordReads& chords,
                                                      const KeyAtBeat& key_at,
                                                      ReductionBasis basis) {
  std::vector<double> floors;
  if (basis == ReductionBasis::kDuration) {
    std::vector<double> durations;
    for (const SegmentSpan& segment : segments) {
      durations.push_back(segment.endBeat - segment.startBeat);
    }
    floors = salience_floors(durations);
  }
  std::vector<ReductionVerdict> result;
  for (std::size_t index = 0; index < segments.size(); ++index) {
    const SegmentSpan& segment = segments[index];
    Frame frame{index, &segment, nullptr, nullptr, 0, 0, index < floors.size() ? floors[index] : 0};
    if (index > 0 && touches(segments[index - 1], segment)) {
      frame.before = &segments[index - 1];
      frame.before_index = index - 1;
    }
    if (index + 1 < segments.size() && touches(segment, segments[index + 1])) {
      frame.after = &segments[index + 1];
      frame.after_index = index + 1;
    }

    std::optional<Reason> reason;
    if (basis == ReductionBasis::kFunction) {
      reason = functional_reason(frame, chords, key_at);
    } else if (segment.endBeat - segment.startBeat > frame.salience_floor) {
      reason = Reason{ReasonKind::kSalient};
    }
    if (!reason && index == 0) {
      reason = Reason{ReasonKind::kFirst};
    }
    if (!reason && index == segments.size() - 1) {
      reason = Reason{ReasonKind::kLast};
    }
    if (!reason) {
      reason = figure_reason(frame, chords);
    }
    if (!reason) {
      reason = Reason{ReasonKind::kUnfigured};
    }

    result.push_back(ReductionVerdict{level_of(*reason), describe(*reason)});
  }
  return result;
}

std::vector<ReducedChord> reduce_progression(const ChordTimeline& timeline, const KeyContext& key,
                                             const ReduceProgressionOptions& opts) {
  assert_chord_timeline(timeline);
  KeyAtBeat key_at = key_scale_at(key);
  ReductionBasis basis = opts.basis.value_or(ReductionBasis::kFunction);
  std::vector<SegmentSpan> spans;
  for (const ChordSegment& segment : timeline.segments) {
    spans.push_back(SegmentSpan{segment.startBeat, segment.endBeat});
  }
  ChordSource chord_at = [&](std::size_t index) -> const Chord& {
    return timeline.segments[index].chord;
  };
  std::vector<ReductionVerdict> verdicts =
      reduce_progression_over(spans, ChordReads{chord_at, chord_at, {}, {}, {}, {}}, key_at, basis);
  std::vector<ReducedChord> out;
  for (std::size_t i = 0; i < verdicts.size(); ++i) {
    ReducedChord entry;
    entry.chord = timeline.segments[i].chord;
    entry.startBeat = timeline.segments[i].startBeat;
    entry.endBeat = timeline.segments[i].endBeat;
    entry.level = verdicts[i].level;
    entry.rationale = std::move(verdicts[i].rationale);
    out.push_back(std::move(entry));
  }
  return out;
}

}  // namespace cantus
