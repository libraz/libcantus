// The chords the harmonizer may place: ts/src/generate/harmonize/candidates.ts.

#include "generate/harmonize/candidates.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <utility>

#include "analyze/functional/function.h"
#include "cantus/analyze/functional.h"
#include "cantus/core/pitch.h"
#include "generate/harmonize/limits.gen.h"
#include "js/math.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

constexpr double kRootWeightBySemitone[] =
#include "generate/harmonize/root_weight_by_semitone.gen.inc"
    ;

constexpr std::string_view kUnstableQualityNames[] =
#include "generate/harmonize/unstable_quality_names.gen.inc"
    ;

constexpr int kSecondaryDominantTargets[] =
#include "generate/harmonize/secondary_dominant_targets.gen.inc"
    ;

constexpr int kSecondaryDominantEntryOrder[] =
#include "generate/harmonize/secondary_dominant_entry_order.gen.inc"
    ;

constexpr int kBorrowedEntryOrder[] =
#include "generate/harmonize/borrowed_entry_order.gen.inc"
    ;

constexpr std::string_view kReharmonizeStrengths[] =
#include "generate/harmonize/reharmonize_strengths.gen.inc"
    ;

/** A generated dial row: the strength's name and its position on the harmonic dial. */
struct ReharmonizeDialRow {
  std::string_view name;
  double dial;
};

constexpr ReharmonizeDialRow kReharmonizeDial[] =
#include "generate/harmonize/reharmonize_dial.gen.inc"
    ;

/** Whether a quality is one of the unstable triads, charged for what it is wherever it sits. */
bool is_unstable(ChordQuality quality) {
  return std::any_of(
      std::begin(kUnstableQualityNames), std::end(kUnstableQualityNames),
      [quality](std::string_view name) { return parse_chord_quality(name) == quality; });
}

/** What a root costs to build a chord on, by the semitones it sits above the tonic. */
double vocabulary_base(int root_pc, ChordQuality quality, int tonic_pc) {
  int above = (pitch_class_of(root_pc) - tonic_pc + 12) % 12;
  double root = static_cast<std::size_t>(above) < std::size(kRootWeightBySemitone)
                    ? kRootWeightBySemitone[above]
                    : HARMONIZE_UNSTABLE_TRIAD;
  return is_unstable(quality) ? js::max(root, HARMONIZE_UNSTABLE_TRIAD) : root;
}

/** Those degrees the key at hand can actually make a local tonic. */
std::vector<TonicizableDegree> secondary_dominant_targets(const KeyScale& key) {
  std::vector<TonicizableDegree> tonicizable = tonicizable_degrees(key);
  std::vector<TonicizableDegree> out;
  for (int degree : kSecondaryDominantTargets) {
    for (const TonicizableDegree& found : tonicizable) {
      if (found.degreeNumber == degree) {
        out.push_back(found);
        break;
      }
    }
  }
  return out;
}

/** How many members of a vocabulary family a dial fraction opens. */
double admitted_count(double fraction, double size) {
  return js::max(0.0, js::min(size, std::ceil(fraction * size)));
}

Candidate candidate_of(int root_pc, ChordQuality quality, double base) {
  Candidate out;
  out.rootPc = root_pc;
  out.quality = quality;
  out.base = base;
  out.pcs = chord_pitch_classes(make_chord(root_pc, quality));
  return out;
}

}  // namespace

std::vector<std::string_view> reharmonize_strength_names() {
  return std::vector<std::string_view>(std::begin(kReharmonizeStrengths),
                                       std::end(kReharmonizeStrengths));
}

double reharmonize_dial(ReharmonizeStrength strength) {
  for (const ReharmonizeDialRow& row : kReharmonizeDial) {
    if (row.name == to_string(strength)) {
      return row.dial;
    }
  }
  return 0;
}

std::vector<Candidate> build_candidates(const KeyScale& key, double harmonic) {
  int tonic_pc = pitch_class_of(key.rootPc);
  // A key with some other number of tones than seven is read against its parallel major.
  KeyScale frame = heptatonic_frame_of(key);
  std::vector<int> tones = scale_tones_in_degree_order(frame);
  std::vector<Candidate> candidates;
  for (std::size_t index = 0; index < tones.size(); ++index) {
    int root_pc = tones[index];
    // Scale degrees are 1-based across the library, while the array index is not.
    int degree = static_cast<int>(index) + 1;
    ChordQuality quality = diatonic_triad(degree, frame).quality;
    Candidate candidate =
        candidate_of(root_pc, quality, vocabulary_base(root_pc, quality, tonic_pc));
    candidate.degree = degree;
    candidates.push_back(std::move(candidate));
  }

  // A minor key cadences through the harmonic-minor dominant, so the major triad a fifth above the
  // tonic belongs to the key's own vocabulary.
  if (cadences_through_raised_seventh(key)) {
    int root_pc = (tonic_pc + 7) % 12;
    Candidate candidate = candidate_of(root_pc, ChordQuality::kMaj,
                                       vocabulary_base(root_pc, ChordQuality::kMaj, tonic_pc));
    candidate.degree = 5;
    candidates.push_back(std::move(candidate));
  }

  std::vector<TonicizableDegree> targets = secondary_dominant_targets(key);
  std::vector<int> entry_order;
  for (int degree : kSecondaryDominantEntryOrder) {
    if (std::any_of(targets.begin(), targets.end(), [degree](const TonicizableDegree& target) {
          return target.degreeNumber == degree;
        })) {
      entry_order.push_back(degree);
    }
  }
  double secondary_open = admitted_count(harmonic / HARMONIZE_SECONDARY_DOMINANT_BAND,
                                         static_cast<double>(targets.size()));
  for (const TonicizableDegree& target : targets) {
    auto at = std::find(entry_order.begin(), entry_order.end(), target.degreeNumber);
    double rank = at == entry_order.end() ? -1 : static_cast<double>(at - entry_order.begin());
    if (rank >= secondary_open) {
      continue;
    }
    int root_pc = (target.rootPc + 7) % 12;
    Candidate candidate =
        candidate_of(root_pc, ChordQuality::kDom7, HARMONIZE_SECONDARY_DOMINANT_BASE);
    candidate.secondaryDominant = true;
    candidate.targetDegree = target.degreeNumber;
    candidates.push_back(std::move(candidate));
  }

  KeyScale parallel = parallel_key(key);
  std::vector<int> parallel_tones = scale_tones_in_degree_order(parallel);
  std::vector<Chord> borrowed;
  for (std::size_t degree = 1; degree <= parallel_tones.size(); ++degree) {
    Chord chord = diatonic_triad(static_cast<double>(degree), parallel);
    if (!is_diatonic(chord, key)) {
      borrowed.push_back(std::move(chord));
    }
  }
  // Usefulness, not degree order, decides which borrowing the next notch of the dial buys.
  auto borrowed_rank = [tonic_pc](const Chord& chord) {
    int pc = pitch_class_of(chord.rootPc - tonic_pc);
    auto at = std::find(std::begin(kBorrowedEntryOrder), std::end(kBorrowedEntryOrder), pc);
    return at == std::end(kBorrowedEntryOrder)
               ? static_cast<int>(std::size(kBorrowedEntryOrder))
               : static_cast<int>(at - std::begin(kBorrowedEntryOrder));
  };
  std::stable_sort(borrowed.begin(), borrowed.end(),
                   [&borrowed_rank](const Chord& a, const Chord& b) {
                     return borrowed_rank(a) < borrowed_rank(b);
                   });
  double borrowed_open = admitted_count(
      (harmonic - HARMONIZE_SECONDARY_DOMINANT_BAND) / (1 - HARMONIZE_SECONDARY_DOMINANT_BAND),
      static_cast<double>(borrowed.size()));
  for (std::size_t index = 0; index < borrowed.size() && static_cast<double>(index) < borrowed_open;
       ++index) {
    const Chord& chord = borrowed[index];
    Candidate candidate;
    candidate.rootPc = static_cast<int>(chord.rootPc);
    candidate.quality = chord.quality;
    // A diminished or augmented triad is charged for what it is wherever it comes from.
    candidate.base = is_unstable(chord.quality)
                         ? js::max(HARMONIZE_BORROWED_BASE, HARMONIZE_UNSTABLE_TRIAD)
                         : HARMONIZE_BORROWED_BASE;
    candidate.pcs = chord_pitch_classes(chord);
    candidates.push_back(std::move(candidate));
  }

  std::set<std::pair<int, ChordQuality>> seen;
  std::vector<Candidate> unique;
  for (Candidate& candidate : candidates) {
    if (seen.insert({candidate.rootPc, candidate.quality}).second) {
      unique.push_back(std::move(candidate));
    }
  }
  return unique;
}

}  // namespace cantus
