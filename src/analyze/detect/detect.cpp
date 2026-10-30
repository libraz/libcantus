// Recognition, the inverse of the chord and scale builders: ts/src/analyze/detect/index.ts.

#include "analyze/detect/detect.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <string>
#include <utility>

#include "analyze/detect/modes.h"
#include "analyze/detect/profiles.h"
#include "analyze/histogram.h"
#include "cantus/analyze/detect.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** One scale form a candidate may report, as the tables write it (`MINOR_VARIANTS`). */
struct VariantRow {
  std::string_view variant;
  int mask;
  std::string_view scaleName;
};

/**
 * Minor-scale variants a minor-key candidate may report. Ranking does not consult them: the
 * variant is chosen afterwards as the mask that covers the most input weight.
 */
constexpr VariantRow kMinorVariants[] =
#include "analyze/detect/minor_variants.gen.inc"
    ;

/** The single major form, kept in the same shape as the minor variants (`MAJOR_VARIANTS`). */
constexpr VariantRow kMajorVariants[] =
#include "analyze/detect/major_variants.gen.inc"
    ;

/** Tie-break order over the scales a candidate can report (`SCALE_NAME_ORDER`). */
constexpr std::string_view kScaleNameOrder[] =
#include "analyze/detect/scale_name_order.gen.inc"
    ;

/** Rank of a reported scale in the tie-break order (`scaleNameRank`); -1 when it is not listed. */
int scale_name_rank(std::string_view name) {
  const std::string_view* found =
      std::find(std::begin(kScaleNameOrder), std::end(kScaleNameOrder), name);
  return found == std::end(kScaleNameOrder) ? -1
                                            : static_cast<int>(found - std::begin(kScaleNameOrder));
}

constexpr std::size_t kInputKindCount = static_cast<std::size_t>(ChordInputKind::kPitchClass) + 1;
constexpr std::array<std::string_view, kInputKindCount> kInputKindNames = {"auto", "midi",
                                                                           "pitchClass"};

/** Unique pitch classes of the input, sorted ascending (`uniquePitchClasses`). */
std::vector<int> unique_pitch_classes(const std::vector<int>& pitches) {
  std::vector<int> out;
  for (int pitch : pitches) {
    out.push_back(pitch_class_of(pitch));
  }
  std::stable_sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

/** The pitch list guard of the detectors (`assertPitches`). */
void assert_pitches(const std::vector<int>& pitches, std::string_view name,
                    std::optional<double> budget) {
  assert_generation_budget(static_cast<double>(pitches.size()), name, budget);
  for (std::size_t index = 0; index < pitches.size(); ++index) {
    assert_midi_pitch(pitches[index], "pitches[" + js::to_string(static_cast<double>(index)) + "]");
  }
}

bool contains(const std::vector<int>& values, int value) {
  return std::find(values.begin(), values.end(), value) != values.end();
}

/** The order matches are ranked in, as the TS comparator returns it (negative: `a` first). */
double compare_matches(const ChordMatch& a, const ChordMatch& b,
                       const std::vector<std::size_t>& tone_counts,
                       const std::vector<ChordQuality>& qualities) {
  if (a.extraPcs.size() != b.extraPcs.size()) {
    return static_cast<double>(a.extraPcs.size()) - static_cast<double>(b.extraPcs.size());
  }
  if (a.missingPcs.size() != b.missingPcs.size()) {
    return static_cast<double>(a.missingPcs.size()) - static_cast<double>(b.missingPcs.size());
  }
  // Prefer root position (the bass is the chord root) on a tie.
  bool a_root = a.inversion && *a.inversion == 0;
  bool b_root = b.inversion && *b.inversion == 0;
  if (a_root != b_root) {
    return a_root ? -1 : 1;
  }
  std::size_t a_size = tone_counts[static_cast<std::size_t>(a.quality)];
  std::size_t b_size = tone_counts[static_cast<std::size_t>(b.quality)];
  if (a_size != b_size) {
    return static_cast<double>(b_size) - static_cast<double>(a_size);
  }
  // Past size, two readings of the same pitches are told apart by the chord they name and by
  // nothing else: the canonical quality order decides, and only a chord symmetrical under
  // transposition reaches the root below it.
  auto rank = [&](ChordQuality q) {
    return static_cast<double>(std::find(qualities.begin(), qualities.end(), q) -
                               qualities.begin());
  };
  double a_rank = rank(a.quality);
  double b_rank = rank(b.quality);
  if (a_rank != b_rank) {
    return a_rank - b_rank;
  }
  return static_cast<double>(a.rootPc) - static_cast<double>(b.rootPc);
}

/** The key a match names, spelled the way its signature would be written (`keyLabel`). */
std::string key_label(const KeyMatch& match) {
  std::string tonic = format_note(spelled_key_of(match.key).tonic);
  // Scale names are camelCase identifiers; a rationale reads them as prose.
  std::string scale;
  for (char c : match.scaleName) {
    if (c >= 'A' && c <= 'Z') {
      scale += ' ';
      scale += static_cast<char>(c - 'A' + 'a');
    } else {
      scale += c;
    }
  }
  return tonic + " " + scale;
}

/** Two correlations, quoted to enough digits to tell them apart (`quoteScores`). */
std::string quote_scores(double rival, double winner) {
  int digits = SCORE_DIGITS;
  while (digits < MAX_SCORE_DIGITS && js::to_fixed(rival, digits) == js::to_fixed(winner, digits)) {
    digits += 1;
  }
  return js::to_fixed(rival, digits) + " against " + js::to_fixed(winner, digits);
}

/** Why a candidate scored what it did: the correlation and the coverage (`describeKeyMatch`). */
std::string describe_key_match(const KeyMatch& match, double input_size) {
  // `fit` is the coverage share; the count behind it is what a reader checks.
  double in_scale = js::round(match.fit * input_size);
  return key_label(match) + ": profile correlation " + js::to_fixed(match.score, SCORE_DIGITS) +
         ", with " + js::to_string(in_scale) + " of " + js::to_string(input_size) +
         " input pitch classes in the scale";
}

/** Which link of the documented tie-break chain put a rival below the winner. */
std::string key_rival_reason(const KeyMatch& winner, const KeyMatch& rival) {
  if (rival.score != winner.score) {
    return "Ranked below on profile correlation (" + quote_scores(rival.score, winner.score) + ")";
  }
  if (rival.fit != winner.fit) {
    return "Tied on correlation, ranked below on the share of the input its scale covers";
  }
  if (rival.key.rootPc != winner.key.rootPc) {
    return "Tied on correlation and coverage, ranked below by tonic pitch class";
  }
  return "Tied on correlation and coverage on the same tonic, ranked below by scale, which takes "
         "major before the minor forms and the modes last";
}

/** Attach the rationale to every candidate and the rivals to the winner (`explainMatches`). */
void explain_matches(std::vector<KeyMatch>& results, double input_size) {
  for (KeyMatch& match : results) {
    match.rationale = describe_key_match(match, input_size);
  }
  if (results.empty()) {
    return;
  }
  std::vector<RejectedCandidate> rivals;
  for (std::size_t i = 1; i < results.size() && i <= static_cast<std::size_t>(EXPLAINED_RIVALS);
       ++i) {
    rivals.push_back(
        RejectedCandidate{key_label(results[i]), key_rival_reason(results[0], results[i])});
  }
  results[0].alternatives = std::move(rivals);
}

/** A modal candidate with the profile vector derived for it. */
struct ModalEntry {
  ModalCandidate candidate;
  std::array<double, 12> vector;
};

}  // namespace

std::string_view to_string(ChordInputKind kind) {
  return kInputKindNames[static_cast<std::size_t>(kind)];
}

std::vector<ChordMatch> detect_chord(const std::vector<int>& pitches,
                                     const DetectChordOptions& opts) {
  assert_pitches(pitches, "chord detection pitches", std::nullopt);
  if (opts.bassPc) {
    assert_finite_number(*opts.bassPc, "bassPc");
  }
  std::vector<int> input = unique_pitch_classes(pitches);
  if (input.empty()) {
    return {};
  }
  ChordInputKind kind = opts.input.value_or(ChordInputKind::kAuto);
  if (kind == ChordInputKind::kAuto) {
    bool all_pitch_classes = std::all_of(pitches.begin(), pitches.end(),
                                         [](int pitch) { return pitch >= 0 && pitch <= 11; });
    kind = all_pitch_classes ? ChordInputKind::kPitchClass : ChordInputKind::kMidi;
  }
  std::optional<int> bass_pc;
  if (opts.bassPc) {
    bass_pc = pitch_class_of(*opts.bassPc);
  } else if (kind == ChordInputKind::kMidi) {
    double lowest = std::numeric_limits<double>::infinity();
    for (int pitch : pitches) {
      lowest = js::min(lowest, pitch);
    }
    bass_pc = pitch_class_of(lowest);
  }
  std::vector<ChordMatch> matches;
  std::vector<ChordQuality> qualities = chord_qualities();
  std::vector<std::size_t> tone_counts(qualities.size());
  for (ChordQuality quality : qualities) {
    tone_counts[static_cast<std::size_t>(quality)] =
        chord_pitch_classes(make_chord(0, quality)).size();
  }
  for (int root_pc : input) {
    for (ChordQuality quality : qualities) {
      Chord chord = make_chord(root_pc, quality);
      std::vector<int> tones = chord_pitch_classes(chord);
      std::vector<int> missing;
      for (int pc : tones) {
        if (!contains(input, pc)) {
          missing.push_back(pc);
        }
      }
      // Accept an exact-tone match, or one whose only absent tone is the perfect fifth; any other
      // missing tone rejects.
      int fifth_pc = pitch_class_of(root_pc + 7);
      if (missing.size() > 1 || (missing.size() == 1 && missing[0] != fifth_pc)) {
        continue;
      }
      // A chord needs two of its own tones sounding: a lone root is not a power chord.
      if (tones.size() - missing.size() < 2) {
        continue;
      }
      std::vector<int> extra;
      for (int pc : input) {
        if (!contains(tones, pc)) {
          extra.push_back(pc);
        }
      }
      std::ptrdiff_t bass_index = -1;
      if (bass_pc) {
        for (std::size_t i = 0; i < chord.intervals.size(); ++i) {
          if (pitch_class_of(root_pc + chord.intervals[i]) == *bass_pc) {
            bass_index = static_cast<std::ptrdiff_t>(i);
            break;
          }
        }
      }
      ChordMatch match;
      match.rootPc = root_pc;
      match.quality = quality;
      match.exact = extra.empty() && missing.empty();
      match.missingPcs = std::move(missing);
      match.extraPcs = std::move(extra);
      // A bass that is not a chord tone names no inversion; reporting it as 0 would be
      // indistinguishable from root position.
      if (bass_pc && bass_index >= 0) {
        match.inversion = static_cast<int>(bass_index);
      }
      if (bass_pc && *bass_pc != root_pc) {
        match.bassPc = *bass_pc;
      }
      matches.push_back(std::move(match));
    }
  }
  std::stable_sort(matches.begin(), matches.end(), [&](const ChordMatch& a, const ChordMatch& b) {
    return compare_matches(a, b, tone_counts, qualities) < 0;
  });
  return matches;
}

Nullable<Chord> detect_chord_best(const std::vector<int>& pitches, const DetectChordOptions& opts) {
  std::vector<ChordMatch> matches = detect_chord(pitches, opts);
  if (matches.empty()) {
    return std::nullopt;
  }
  const ChordMatch& best = matches.front();
  std::optional<double> bass;
  if (best.bassPc) {
    bass = *best.bassPc;
  }
  return make_chord(best.rootPc, best.quality, bass);
}

std::vector<KeyMatch> detect_key(const std::vector<int>& pitches, const DetectKeyOptions& opts) {
  return detect_key_over(pitches, opts, typed_profile_source(opts.profile));
}

std::vector<KeyMatch> detect_key_over(const std::vector<int>& pitches, const DetectKeyOptions& opts,
                                      const ProfileSource& profile_source) {
  assert_pitches(pitches, "key detection pitches", opts.budget);
  if (opts.weights && opts.weights->size() != pitches.size()) {
    throw InvalidInputError("weights must have one entry per pitch");
  }
  ResolvedProfile resolved = profile_source();
  // Derived once per call: a mode's vector depends on the profile, not on which tonic it is being
  // rotated onto.
  std::vector<ModalEntry> modal_entries;
  for (const ModalCandidate& candidate : resolve_modal_candidates(opts.modes)) {
    modal_entries.push_back(
        ModalEntry{candidate, modal_profile_vector(resolved.for_modes(), candidate)});
  }
  // Insertion-ordered counts: the sums below add in the order each pitch class first sounded.
  std::vector<std::pair<int, double>> counts;
  double total = 0;
  for (std::size_t index = 0; index < pitches.size(); ++index) {
    double weight = opts.weights ? (*opts.weights)[index] : 1;
    assert_finite_number(weight, "weights[" + js::to_string(static_cast<double>(index)) + "]");
    if (weight <= 0) {
      continue;
    }
    int pc = pitch_class_of(pitches[index]);
    auto found =
        std::find_if(counts.begin(), counts.end(),
                     [&](const std::pair<int, double>& entry) { return entry.first == pc; });
    if (found == counts.end()) {
      counts.emplace_back(pc, weight);
    } else {
      found->second += weight;
    }
    total += weight;
  }
  if (total == 0) {
    return {};
  }
  const KeyProfilePair& profile = resolved.get();
  auto input_size = static_cast<double>(counts.size());
  // The distribution the profiles are correlated against: one bin per pitch class.
  std::array<double, 12> dist{};
  for (const auto& [pc, count] : counts) {
    dist[static_cast<std::size_t>(pc)] = count;
  }
  std::vector<KeyMatch> results;
  for (int tonic = 0; tonic < 12; ++tonic) {
    for (KeyNameMode mode : {KeyNameMode::kMajor, KeyNameMode::kMinor}) {
      const std::array<double, 12>& vector =
          mode == KeyNameMode::kMajor ? profile.major : profile.minor;
      double score = profile_score(dist, vector, tonic);
      // Ranking is settled; the variant only decides which scale the caller is handed, so it is
      // the mask covering the most input weight. Ties keep the earlier (more diatonic) variant.
      const VariantRow* begin =
          mode == KeyNameMode::kMajor ? std::begin(kMajorVariants) : std::begin(kMinorVariants);
      const VariantRow* end =
          mode == KeyNameMode::kMajor ? std::end(kMajorVariants) : std::end(kMinorVariants);
      double covered = -std::numeric_limits<double>::infinity();
      int in_scale = 0;
      const VariantRow* best = begin;
      for (const VariantRow* candidate = begin; candidate != end; ++candidate) {
        double candidate_covered = 0;
        int candidate_in_scale = 0;
        for (const auto& [pc, count] : counts) {
          int offset = (pc - tonic + 12) % 12;
          if (((candidate->mask >> offset) & 1) != 0) {
            candidate_covered += count;
            candidate_in_scale += 1;
          }
        }
        if (candidate_covered > covered) {
          covered = candidate_covered;
          in_scale = candidate_in_scale;
          best = candidate;
        }
      }
      KeyMatch match;
      match.key = KeyScale{tonic, best->mask};
      match.mode = mode;
      match.variant = *parse_key_variant(best->variant);
      match.scaleName = std::string(best->scaleName);
      match.fit = in_scale / input_size;
      match.score = score;
      results.push_back(std::move(match));
    }
    // A mode has one scale, so there is no variant to choose: it is ranked on its derived profile
    // and reports the mask it was ranked with.
    for (const ModalEntry& entry : modal_entries) {
      int in_scale = 0;
      for (const auto& [pc, count] : counts) {
        if (((entry.candidate.mask >> ((pc - tonic + 12) % 12)) & 1) != 0) {
          in_scale += 1;
        }
      }
      KeyMatch match;
      match.key = KeyScale{tonic, entry.candidate.mask};
      match.mode = entry.candidate.mode;
      match.variant = KeyVariant::kModal;
      match.scaleName = std::string(to_string(entry.candidate.scaleName));
      match.fit = in_scale / input_size;
      match.score = profile_score(dist, entry.vector, tonic);
      results.push_back(std::move(match));
    }
  }
  // Floating-point scores tie often enough that leaving the order to the sort's stability would
  // make construction order the contract. Rank on the reported fields instead.
  std::stable_sort(results.begin(), results.end(), [](const KeyMatch& a, const KeyMatch& b) {
    if (a.score != b.score) {
      return b.score - a.score < 0;
    }
    if (a.fit != b.fit) {
      return b.fit - a.fit < 0;
    }
    if (a.key.rootPc != b.key.rootPc) {
      return a.key.rootPc < b.key.rootPc;
    }
    return scale_name_rank(a.scaleName) < scale_name_rank(b.scaleName);
  });
  if (opts.explain == true) {
    // After the sort, so a rival's reason can name the link of the tie-break chain that actually
    // separated it from the winner.
    explain_matches(results, input_size);
  }
  return results;
}

std::vector<KeyMatch> detect_key_from_notes(const std::vector<NoteEvent>& notes,
                                            const DetectKeyFromNotesOptions& opts) {
  return detect_key_from_notes_over(notes, opts, typed_profile_source(opts.profile));
}

std::vector<KeyMatch> detect_key_from_notes_over(const std::vector<NoteEvent>& notes,
                                                 const DetectKeyFromNotesOptions& opts,
                                                 const ProfileSource& profile_source) {
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = opts.budget;
  assert_note_events(notes, "key detection notes", note_options);
  DetectKeyOptions key_options;
  std::vector<int> pitches;
  std::vector<double> weights;
  for (const NoteEvent& note : notes) {
    if (note.durationBeat > 0) {
      pitches.push_back(note.pitch);
      weights.push_back(note_weight(note, note.durationBeat));
    }
  }
  key_options.weights = std::move(weights);
  key_options.modes = opts.modes;
  key_options.explain = opts.explain;
  key_options.budget = opts.budget;
  return detect_key_over(pitches, key_options, profile_source);
}

Nullable<KeyMatch> detect_key_best(const std::vector<int>& pitches, const DetectKeyOptions& opts) {
  std::vector<KeyMatch> matches = detect_key(pitches, opts);
  if (matches.empty()) {
    return std::nullopt;
  }
  return std::move(matches.front());
}

}  // namespace cantus
