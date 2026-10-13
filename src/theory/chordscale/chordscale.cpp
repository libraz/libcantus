// Scales that fit over a chord: ts/src/theory/chordscale/index.ts.

#include "cantus/theory/chordscale.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/theory/scale.h"
#include "core/validation/validation.h"
#include "js/utf16.h"
#include "theory/chord/chord.h"
#include "theory/chordscale/chordscale.h"
#include "theory/chordscale/limits.gen.h"

namespace cantus {

namespace {

/** The chord quality an idiomatic scale list is keyed by. */
struct IdiomaticRow {
  std::string_view name;
  std::vector<std::string_view> scales;
};

constexpr std::string_view kAliasedScaleNames[] =
#include "theory/chordscale/aliased_scale_name_list.gen.inc"
    ;

constexpr std::string_view kScalePreference[] =
#include "theory/chordscale/scale_preference.gen.inc"
    ;

const std::vector<IdiomaticRow> kIdiomaticScales =
#include "theory/chordscale/idiomatic_scales.gen.inc"
    ;

constexpr int kMinorResolutionTensions[] =
#include "theory/chordscale/minor_resolution_tensions.gen.inc"
    ;

/** The scale the chord quality takes in the altered form. */
constexpr std::string_view kAlteredScale = "altered";

/** The chromatic scale, which stands in when no other scale contains the chord. */
constexpr std::string_view kChromaticScale = "chromatic";

constexpr int kScaleTones = 12;

/** Whether `name` is one of the built-in Western scales (`Object.hasOwn(NAMED_SCALES, name)`). */
bool is_named_scale(std::string_view name) {
  return std::any_of(NAMED_SCALES.begin(), NAMED_SCALES.end(),
                     [&](const NamedScaleMask& entry) { return entry.name == name; });
}

/** Count the set bits (scale tones) in a 12-bit mode mask (`popcount12`). */
int popcount12(int mask) {
  int count = 0;
  for (int n = 0; n < kScaleTones; ++n) {
    count += (mask >> n) & 1;
  }
  return count;
}

/** Test whether a pitch class belongs to a mode mask rooted on `scale_root_pc`
 * (`maskHasPitchClass`). */
bool mask_has_pitch_class(int mask, int scale_root_pc, int pc) {
  int offset = pitch_class_of(pc - scale_root_pc);
  return ((mask >> offset) & 1) == 1;
}

bool matches_chord(const std::vector<int>& chord_pcs, int scale_mask, int scale_root_pc) {
  return std::all_of(chord_pcs.begin(), chord_pcs.end(),
                     [&](int pc) { return mask_has_pitch_class(scale_mask, scale_root_pc, pc); });
}

bool includes(const std::vector<int>& list, int value) {
  return std::find(list.begin(), list.end(), value) != list.end();
}

/** Position of a scale in SCALE_PREFERENCE, or last when unlisted (`conventionalRank`). */
int conventional_rank(std::string_view name) {
  const auto* end = std::end(kScalePreference);
  const auto* found = std::find(std::begin(kScalePreference), end, name);
  return static_cast<int>(found - std::begin(kScalePreference));
}

/** Whether this scale is an idiomatic colour choice for the chord quality (`idiomaticRank`). */
int idiomatic_rank(const Chord& chord, std::string_view name) {
  for (const IdiomaticRow& row : kIdiomaticScales) {
    if (row.name == to_string(chord.quality)) {
      auto found = std::find(row.scales.begin(), row.scales.end(), name);
      return found == row.scales.end() ? static_cast<int>(row.scales.size()) + 1
                                       : static_cast<int>(found - row.scales.begin());
    }
  }
  return 0;
}

/** An ordinary dominant seventh may use altered colours (`isAlteredDominant`). */
bool is_altered_dominant(const Chord& chord, std::string_view scale_name) {
  return chord.quality == ChordQuality::kDom7 && scale_name == kAlteredScale;
}

/** The avoid notes of a scale over a normalized chord (`avoidNotes` past its coercions). */
std::vector<int> avoid_notes_of(const Chord& data, std::string_view scale_name, int mask,
                                const AvoidNotesOptions& opts) {
  int root_pc = pitch_class_of(data.rootPc);
  std::vector<int> chord_pcs = chord_pitch_classes(data);
  bool altered_dominant = is_altered_dominant(data, scale_name);
  if (!matches_chord(chord_pcs, mask, root_pc) && !altered_dominant) {
    return {};
  }
  // Both thirds a suspension may have displaced end it when sounded.
  std::vector<int> displaced = displaced_thirds(data);
  bool melodic = opts.use == AvoidNoteUse::kMelodic;
  int semitone_above_root = pitch_class_of(root_pc + 1);
  std::vector<int> avoid;
  for (int pc = 0; pc < kScaleTones; ++pc) {
    if (!mask_has_pitch_class(mask, root_pc, pc) || includes(chord_pcs, pc)) {
      continue;
    }
    if (melodic && pc != semitone_above_root) {
      continue;
    }
    if (!altered_dominant &&
        (includes(chord_pcs, pitch_class_of(pc - 1)) || includes(displaced, pc))) {
      avoid.push_back(pc);
    }
  }
  std::stable_sort(avoid.begin(), avoid.end());
  return avoid;
}

std::vector<ChordScaleMatch> chord_scales_of(const Chord& data) {
  std::vector<int> chord_pcs = chord_pitch_classes(data);
  int root_pc = pitch_class_of(data.rootPc);
  struct Ranked {
    std::string name;
    int extra;
    int size;
    int avoid;
  };
  std::vector<Ranked> ranked;
  std::vector<int> seen_masks;
  for (const NamedScaleMask& entry : NAMED_SCALES) {
    std::string_view name = entry.name;
    if (name == kChromaticScale ||
        std::find(std::begin(kAliasedScaleNames), std::end(kAliasedScaleNames), name) !=
            std::end(kAliasedScaleNames)) {
      continue;
    }
    std::optional<int> mask = named_scale_mask(name);
    if (!mask || includes(seen_masks, *mask)) {
      continue;
    }
    seen_masks.push_back(*mask);
    if (matches_chord(chord_pcs, *mask, root_pc) || is_altered_dominant(data, name)) {
      int size = popcount12(*mask);
      ranked.push_back(Ranked{std::string(name), size - static_cast<int>(chord_pcs.size()), size,
                              static_cast<int>(avoid_notes_of(data, name, *mask, {}).size())});
    }
  }
  if (ranked.empty()) {
    // No diatonic-style scale contains the chord; the chromatic scale trivially does.
    return {ChordScaleMatch{std::string(kChromaticScale), root_pc}};
  }
  bool prefer_heptatonic = chord_pcs.size() <= 3;
  std::stable_sort(ranked.begin(), ranked.end(), [&](const Ranked& a, const Ranked& b) {
    int idiomatic_a = idiomatic_rank(data, a.name);
    int idiomatic_b = idiomatic_rank(data, b.name);
    if (idiomatic_a != idiomatic_b) {
      return idiomatic_a < idiomatic_b;
    }
    if (prefer_heptatonic && (a.size == HEPTATONIC_SIZE) != (b.size == HEPTATONIC_SIZE)) {
      return a.size == HEPTATONIC_SIZE;
    }
    if (a.extra != b.extra) {
      return a.extra < b.extra;
    }
    int rank_a = conventional_rank(a.name);
    int rank_b = conventional_rank(b.name);
    if (rank_a != rank_b) {
      return rank_a < rank_b;
    }
    // Among scales the modal preference does not name, the one that clashes least wins.
    if (a.avoid != b.avoid) {
      return a.avoid < b.avoid;
    }
    return js::utf16_compare(a.name, b.name) < 0;
  });
  std::vector<ChordScaleMatch> out;
  for (Ranked& entry : ranked) {
    out.push_back(ChordScaleMatch{std::move(entry.name), root_pc});
  }
  return out;
}

/** Whether this chord is a dominant seventh resolving down a fifth to minor
 * (`resolvesToMinorTonic`). */
bool resolves_to_minor_tonic(const Chord& chord, const std::vector<int>& chord_pcs,
                             const std::optional<Chord>& target) {
  if (!target) {
    return false;
  }
  int root_pc = pitch_class_of(chord.rootPc);
  auto sounds = [&](int semitones) {
    return includes(chord_pcs, pitch_class_of(root_pc + semitones));
  };
  if (!sounds(4) || !sounds(10)) {
    return false;
  }
  int target_root_pc = pitch_class_of(target->rootPc);
  if (target_root_pc != pitch_class_of(root_pc + 5)) {
    return false;
  }
  return includes(chord_pitch_classes(*target), pitch_class_of(target_root_pc + 3));
}

/** The pitch-class set of a named scale rooted on `root_pc`, as a twelve-bit mask. */
int scale_pitch_class_set(std::string_view name, int root_pc) {
  std::optional<int> mask = named_scale_mask(name);
  int set = 0;
  if (!mask) {
    return set;
  }
  for (int n = 0; n < kScaleTones; ++n) {
    if (((*mask >> n) & 1) == 1) {
      set |= 1 << pitch_class_of(root_pc + n);
    }
  }
  return set;
}

}  // namespace

int require_chord_scale_mask(std::string_view name) {
  std::optional<std::string_view> canonical = resolve_scale_name(name);
  if (canonical && !is_named_scale(*canonical)) {
    throw InvalidInputError("scale must name a scale chord-scale theory ranks; " +
                            std::string(name) + " is a world scale");
  }
  return require_scale_mask(name, "scale");
}

std::string_view to_string(AvoidNoteUse use) {
  return use == AvoidNoteUse::kHarmonic ? "harmonic" : "melodic";
}

std::optional<AvoidNoteUse> parse_avoid_note_use(std::string_view name) {
  if (name == "harmonic") {
    return AvoidNoteUse::kHarmonic;
  }
  if (name == "melodic") {
    return AvoidNoteUse::kMelodic;
  }
  return std::nullopt;
}

bool scale_matches_chord(const std::vector<double>& chord_pcs, double scale_mask,
                         double scale_root_pc) {
  // The mask is read with bit operations and a pitch class shifts it, so both coerce.
  int mask = assert_mode_mask(scale_mask, "scaleMask");
  int root = static_cast<int>(assert_pitch_class(scale_root_pc, "scaleRootPc"));
  for (std::size_t index = 0; index < chord_pcs.size(); ++index) {
    int pc = static_cast<int>(
        assert_pitch_class(chord_pcs[index], "chord pitch classes[" + index_text(index) + "]"));
    if (!mask_has_pitch_class(mask, root, pc)) {
      return false;
    }
  }
  return true;
}

std::vector<ChordScaleMatch> chord_scales(const ChordArg& chord) {
  return chord_scales_of(to_chord_data(chord));
}

std::vector<int> avoid_notes(const ChordArg& chord, std::string_view scale_name,
                             const AvoidNotesOptions& opts) {
  int mask = require_chord_scale_mask(scale_name);
  return avoid_notes_of(to_chord_data(chord), scale_name, mask, opts);
}

std::vector<int> available_tensions(const ChordArg& chord, std::string_view scale_name,
                                    const AvailableTensionsOptions& opts) {
  int mask = require_chord_scale_mask(scale_name);
  Chord data = to_chord_data(chord);
  int root_pc = pitch_class_of(data.rootPc);
  std::vector<int> chord_pcs = chord_pitch_classes(data);
  bool altered_dominant = is_altered_dominant(data, scale_name);
  if (!matches_chord(chord_pcs, mask, root_pc) && !altered_dominant) {
    return {};
  }
  std::vector<int> avoid_set;
  if (!altered_dominant) {
    avoid_set = avoid_notes_of(data, scale_name, mask, {});
  }
  std::optional<Chord> target;
  if (opts.resolvesTo) {
    target = to_chord_data(*opts.resolvesTo);
  }
  std::vector<int> functional;
  if (resolves_to_minor_tonic(data, chord_pcs, target)) {
    for (int semitones : kMinorResolutionTensions) {
      functional.push_back(pitch_class_of(root_pc + semitones));
    }
  }
  std::vector<int> tensions;
  for (int pc = 0; pc < kScaleTones; ++pc) {
    if (!mask_has_pitch_class(mask, root_pc, pc) || includes(chord_pcs, pc)) {
      continue;
    }
    if (includes(avoid_set, pc) && !includes(functional, pc)) {
      continue;
    }
    tensions.push_back(pc);
  }
  std::stable_sort(tensions.begin(), tensions.end());
  return tensions;
}

std::vector<ChordScaleReportEntry> chord_scale_report(const ChordArg& chord,
                                                      std::optional<double> limit) {
  if (limit) {
    assert_positive_int(*limit, "chord-scale report limit");
  }
  Chord data = to_chord_data(chord);
  std::vector<ChordScaleMatch> matches = chord_scales_of(data);
  std::size_t count = limit
                          ? std::min<std::size_t>(matches.size(), static_cast<std::size_t>(*limit))
                          : matches.size();
  std::vector<ChordScaleReportEntry> report;
  AvoidNotesOptions melodic_use;
  melodic_use.use = AvoidNoteUse::kMelodic;
  for (std::size_t i = 0; i < count; ++i) {
    const ChordScaleMatch& match = matches[i];
    int mask = require_chord_scale_mask(match.name);
    std::vector<int> harmonic = avoid_notes_of(data, match.name, mask, {});
    std::vector<int> melodic = avoid_notes_of(data, match.name, mask, melodic_use);
    ChordScaleReportEntry entry;
    entry.name = match.name;
    entry.rootPc = match.rootPc;
    for (int pc : harmonic) {
      (includes(melodic, pc) ? entry.avoid : entry.passing).push_back(pc);
    }
    entry.tensions = available_tensions(data, match.name);
    report.push_back(std::move(entry));
  }
  return report;
}

std::vector<ScaleChoice> scales_for_changes(const std::vector<Chord>& chords) {
  assert_generation_budget(static_cast<double>(chords.size()), "chord-scale changes");
  if (chords.empty()) {
    return {};
  }
  std::vector<std::vector<ChordScaleMatch>> candidate_lists;
  for (const Chord& chord : chords) {
    candidate_lists.push_back(chord_scales_of(to_chord_data(chord)));
  }
  std::vector<std::vector<int>> pc_sets;
  for (const auto& candidates : candidate_lists) {
    std::vector<int> sets;
    for (const ChordScaleMatch& match : candidates) {
      sets.push_back(scale_pitch_class_set(match.name, match.rootPc));
    }
    pc_sets.push_back(std::move(sets));
  }

  const std::vector<ChordScaleMatch>& first = candidate_lists[0];
  std::vector<std::vector<double>> dp(1);
  std::vector<std::vector<int>> back(1);
  for (std::size_t j = 0; j < first.size(); ++j) {
    dp[0].push_back(static_cast<double>(j) * RANK_PENALTY);
    back[0].push_back(-1);
  }

  for (std::size_t i = 1; i < candidate_lists.size(); ++i) {
    const std::vector<ChordScaleMatch>& candidates = candidate_lists[i];
    const std::vector<double>& prev_costs = dp[i - 1];
    const std::vector<int>& prev_sets = pc_sets[i - 1];
    const std::vector<int>& cur_sets = pc_sets[i];
    std::vector<double> stage_costs;
    std::vector<int> stage_back;
    for (std::size_t j = 0; j < candidates.size(); ++j) {
      double best_cost = std::numeric_limits<double>::infinity();
      int best_prev = -1;
      for (std::size_t k = 0; k < prev_costs.size(); ++k) {
        int transition = popcount12(prev_sets[k] ^ cur_sets[j]);
        double cost = prev_costs[k] + transition;
        if (cost < best_cost) {
          best_cost = cost;
          best_prev = static_cast<int>(k);
        }
      }
      stage_costs.push_back(best_cost + static_cast<double>(j) * RANK_PENALTY);
      stage_back.push_back(best_prev);
    }
    dp.push_back(std::move(stage_costs));
    back.push_back(std::move(stage_back));
  }

  const std::vector<double>& last_costs = dp.back();
  std::size_t best_final = 0;
  for (std::size_t j = 1; j < last_costs.size(); ++j) {
    if (last_costs[j] < last_costs[best_final]) {
      best_final = j;
    }
  }

  std::vector<int> chosen(candidate_lists.size());
  int current = static_cast<int>(best_final);
  for (std::size_t i = candidate_lists.size(); i-- > 0;) {
    chosen[i] = current;
    current = back[i][static_cast<std::size_t>(current)];
  }

  std::vector<ScaleChoice> out;
  for (std::size_t i = 0; i < chords.size(); ++i) {
    out.push_back(ScaleChoice{chords[i], candidate_lists[i][static_cast<std::size_t>(chosen[i])]});
  }
  return out;
}

}  // namespace cantus
