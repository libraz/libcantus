// The harmonizer's dynamic program: ts/src/generate/harmonize/search.ts.

#include "generate/harmonize/search.h"

#include <limits>

#include "cantus/core/pitch.h"
#include "generate/harmonize/cost.h"

namespace cantus {

namespace {

constexpr double kInfinity = std::numeric_limits<double>::infinity();

/** Whether two candidates are the same harmony, which is what holding a chord means. */
bool same_harmony(const Candidate& a, const Candidate& b) {
  return a.rootPc == b.rootPc && a.quality == b.quality;
}

}  // namespace

HarmonizePass harmonize_once(const std::vector<NoteEvent>& melody, const KeyScale& key,
                             const std::vector<Candidate>& candidates,
                             const std::vector<Segment>& segments,
                             const std::vector<double>& jitter,
                             const std::set<std::size_t>& phrase_ends,
                             const std::set<std::size_t>& articulated) {
  int tonic_pc = pitch_class_of(key.rootPc);
  std::size_t n = candidates.size();
  auto cand_at = [&](std::size_t i) -> const Candidate& {
    return i < candidates.size() ? candidates[i] : fallback_candidate();
  };
  auto jitter_at = [&](std::size_t i) { return i < jitter.size() ? jitter[i] : 0.0; };
  const Segment* seg0 = segments.empty() ? nullptr : &segments[0];

  // A phrase one segment long has no approach chord, so its close is judged on the chord alone.
  std::vector<double> dp;
  for (std::size_t ci = 0; ci < n; ++ci) {
    const Candidate& c = candidates[ci];
    double value = (seg0 != nullptr ? emission_cost(*seg0, c, melody, key) : 0) +
                   (seg0 != nullptr && phrase_ends.count(0) > 0
                        ? phrase_end_bonus(nullptr, c, tonic_pc, *seg0, melody)
                        : 0) +
                   jitter_at(ci);
    dp.push_back(value);
  }
  std::vector<std::vector<std::size_t>> back;

  for (std::size_t s = 1; s < segments.size(); ++s) {
    const Segment& seg = segments[s];
    bool closes = phrase_ends.count(s) > 0;
    // A beat the caller named as a phrase end is a cadence point: harmonic motion into the close.
    bool articulates = articulated.count(s) > 0;
    std::vector<double> next(n, 0);
    std::vector<std::size_t> ptr(n, 0);
    for (std::size_t c = 0; c < n; ++c) {
      double best = kInfinity;
      std::size_t best_prev = 0;
      for (std::size_t p = 0; p < n; ++p) {
        if (articulates && same_harmony(cand_at(p), cand_at(c))) {
          continue;
        }
        double cost =
            (p < dp.size() ? dp[p] : kInfinity) +
            transition_cost(cand_at(p), cand_at(c), tonic_pc) * seg.beats +
            (closes ? phrase_end_bonus(&cand_at(p), cand_at(c), tonic_pc, seg, melody) : 0);
        if (cost < best) {
          best = cost;
          best_prev = p;
        }
      }
      next[c] = best + emission_cost(seg, cand_at(c), melody, key) + jitter_at(c);
      ptr[c] = best_prev;
    }
    dp = std::move(next);
    back.push_back(std::move(ptr));
  }

  double best_cost = kInfinity;
  std::size_t best_end = 0;
  for (std::size_t c = 0; c < n; ++c) {
    double total = c < dp.size() ? dp[c] : kInfinity;
    if (total < best_cost) {
      best_cost = total;
      best_end = c;
    }
  }

  HarmonizePass out;
  out.cost = best_cost;
  out.path.assign(segments.size(), best_end);
  for (std::size_t s = segments.size(); s >= 2; --s) {
    std::size_t at = s - 2;
    std::size_t next_idx = out.path[at + 1];
    out.path[at] = at < back.size() && next_idx < back[at].size() ? back[at][next_idx] : best_end;
  }
  return out;
}

}  // namespace cantus
