// Candidate enumeration and move scoring: ts/src/theory/voicing/internal.ts.

#include "theory/voicing/internal.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "cantus/core/errors.h"
#include "cantus/theory/counterpoint.h"
#include "js/math.h"
#include "theory/partwriting/cross_relation.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

/**
 * All MIDI pitches of a pitch class inside an inclusive range, ordered from the centre of the
 * range outward, ties toward the lower pitch (`pitchesForPc`).
 */
std::vector<double> pitches_for_pc(int pc, const VoiceRange& range) {
  std::vector<double> result;
  for (double midi = std::ceil(range.min); midi <= range.max; midi += 1) {
    if (pitch_class_of(midi) == pc) {
      result.push_back(midi);
    }
  }
  double center = (range.min + range.max) / 2;
  std::stable_sort(result.begin(), result.end(), [center](double a, double b) {
    double da = std::fabs(a - center);
    double db = std::fabs(b - center);
    return (da == db ? a - b : da - db) < 0;
  });
  return result;
}

/** The depth-first search of enumerate_voicings(). */
struct Search {
  const std::vector<std::vector<double>>& by_voice;
  double max_spacing;
  double max_candidates;
  double max_search_nodes;
  VoicingCandidates& into;
  std::vector<std::int32_t> current;
  double nodes = 0;

  void build(std::size_t voice) {
    nodes += 1;
    if (static_cast<double>(into.count) >= max_candidates || nodes > max_search_nodes) {
      return;
    }
    if (voice == into.voices) {
      for (std::int32_t pitch : current) {
        into.pitches.push_back(static_cast<double>(pitch));
      }
      into.count += 1;
      return;
    }
    for (double pitch : by_voice[voice]) {
      if (voice > 0) {
        double prev = current[voice - 1];
        if (pitch < prev) {
          continue;  // would cross below the next lower voice
        }
        double spacing_limit = voice == 1 ? max_spacing + 12 : max_spacing;
        if (pitch - prev > spacing_limit) {
          continue;
        }
      }
      current[voice] = js::to_int32(pitch);
      build(voice + 1);
    }
  }
};

/** Spell one candidate voicing, so the letters can be put to the written rules (`spellRow`). */
std::vector<NoteData> spell_row(const SpellingTable& table, const double* pitches,
                                std::size_t offset, std::size_t voices) {
  std::vector<NoteData> notes;
  for (std::size_t voice = 0; voice < voices; ++voice) {
    notes.push_back(spelled_at(table, pitches[offset + voice]));
  }
  return notes;
}

/** Whether any letter is written two ways across the move (`contradictsALetter`). */
bool contradicts_a_letter(const MelodicSpelling& spelling, const double* prev,
                          std::size_t prev_offset, const double* cur, std::size_t cur_offset,
                          std::size_t voices) {
  for (std::size_t voice = 0; voice < voices; ++voice) {
    const NoteData& earlier =
        spelling.from.notes[static_cast<std::size_t>(pitch_class_of(prev[prev_offset + voice]))];
    for (std::size_t other = 0; other < voices; ++other) {
      if (other == voice) {
        continue;
      }
      const NoteData& later =
          spelling.to.notes[static_cast<std::size_t>(pitch_class_of(cur[cur_offset + other]))];
      if (earlier.alter != later.alter &&
          diatonic_letter_of(earlier.letter) == diatonic_letter_of(later.letter)) {
        return true;
      }
    }
  }
  return false;
}

/** Count the cross relations two consecutive voicings write (`crossRelationCount`). */
int cross_relation_count(const MelodicSpelling& spelling, const CrossRelationTables& tables,
                         const double* prev, std::size_t prev_offset, const double* cur,
                         std::size_t cur_offset, std::size_t voices) {
  if (!contradicts_a_letter(spelling, prev, prev_offset, cur, cur_offset, voices)) {
    return 0;
  }
  std::vector<NoteData> from_notes = spell_row(spelling.from, prev, prev_offset, voices);
  std::vector<NoteData> to_notes = spell_row(spelling.to, cur, cur_offset, voices);
  ChromaticContext context;
  context.after = tables.afterChord ? &*tables.afterChord : nullptr;
  return static_cast<int>(cross_relations(ChromaticMoment{from_notes, tables.fromChord},
                                          ChromaticMoment{to_notes, tables.toChord}, tables.key,
                                          context)
                              .size());
}

/** Count the voices that move by an augmented interval (`augmentedMelodicCount`). */
int augmented_melodic_count(const MelodicSpelling& spelling, const double* prev,
                            std::size_t prev_offset, const double* cur, std::size_t cur_offset,
                            std::size_t voices) {
  int count = 0;
  for (std::size_t voice = 0; voice < voices; ++voice) {
    if (moves_by_augmented_interval(spelling.from, prev[prev_offset + voice], spelling.to,
                                    cur[cur_offset + voice])) {
      count += 1;
    }
  }
  return count;
}

/** Whether the outermost voices reach a hidden perfect fifth or octave
 * (`createsOuterHiddenPerfect`).
 */
bool creates_outer_hidden_perfect(const double* prev, std::size_t prev_offset, const double* cur,
                                  std::size_t cur_offset, std::size_t voices) {
  if (voices < 2) {
    return false;
  }
  return creates_hidden_parallel_perfect(prev[prev_offset + voices - 1],
                                         cur[cur_offset + voices - 1], prev[prev_offset],
                                         cur[cur_offset]);
}

/** Count counterpoint violations between two consecutive voicings (`violationCount`). */
int violation_count(const double* prev, std::size_t prev_offset, const double* cur,
                    std::size_t cur_offset, std::size_t voices) {
  int count = 0;
  for (std::size_t lower = 0; lower < voices; ++lower) {
    for (std::size_t upper = lower + 1; upper < voices; ++upper) {
      double prev_lower = prev[prev_offset + lower];
      double prev_upper = prev[prev_offset + upper];
      double cur_lower = cur[cur_offset + lower];
      double cur_upper = cur[cur_offset + upper];
      if (creates_parallel_perfect(prev_upper, cur_upper, prev_lower, cur_lower)) {
        count += 1;
      }
      if (upper == lower + 1) {
        if (creates_voice_overlap(prev_upper, cur_upper, prev_lower, cur_lower)) {
          count += 1;
        }
      }
    }
  }
  return count;
}

}  // namespace

void enumerate_voicings(const Chord& chord, const std::vector<VoiceRange>& ranges,
                        double max_spacing, double max_candidates, VoicingCandidates& into) {
  std::vector<int> chord_pcs = chord_pitch_classes(chord);
  int bass_pc = pitch_class_of(chord.bassPc.value_or(chord.rootPc));
  // Pitch-class-major order, matching the enumeration order of the search.
  std::vector<std::vector<double>> by_voice;
  for (std::size_t voice = 0; voice < ranges.size(); ++voice) {
    std::vector<double> pitches;
    std::vector<int> pcs = voice == 0 ? std::vector<int>{bass_pc} : chord_pcs;
    for (int pc : pcs) {
      std::vector<double> some = pitches_for_pc(pc, ranges[voice]);
      pitches.insert(pitches.end(), some.begin(), some.end());
    }
    by_voice.push_back(std::move(pitches));
  }
  for (const std::vector<double>& pitches : by_voice) {
    if (pitches.empty()) {
      throw NoSolutionError("no voicing satisfies the given ranges");
    }
  }
  into.voices = ranges.size();
  into.count = 0;
  into.pitches.clear();
  Search search{by_voice,       max_spacing,
                max_candidates, max_candidates * SEARCH_NODES_PER_CANDIDATE,
                into,           std::vector<std::int32_t>(ranges.size())};
  search.build(0);
}

StructuralTables structural_tables(const Chord& chord, const std::optional<KeyScale>& key) {
  StructuralTables out;
  out.tones = chord_pitch_classes(chord);
  std::array<bool, 12> is_fifth{};
  for (int pc = 0; pc < 12; ++pc) {
    Nullable<ChordToneRole> role = chord_tone_role(pc, chord);
    is_fifth[static_cast<std::size_t>(pc)] = role && *role == ChordToneRole::kFifth;
  }
  for (int pc : out.tones) {
    out.missing.push_back(is_fifth[static_cast<std::size_t>(pc)] ? MISSING_FIFTH_PENALTY
                                                                 : MISSING_TONE_PENALTY);
  }
  int root_pc = pitch_class_of(chord.rootPc);
  int leading_tone_pc =
      key && is_functioning_leading_tone(chord, *key) ? leading_tone_pc_of(*key) : -1;
  for (int pc = 0; pc < 12; ++pc) {
    if (pc == leading_tone_pc) {
      out.doubling[static_cast<std::size_t>(pc)] = LEADING_TONE_DOUBLING_PENALTY;
    } else if (pc != root_pc && !is_fifth[static_cast<std::size_t>(pc)]) {
      out.doubling[static_cast<std::size_t>(pc)] = POOR_DOUBLING_PENALTY;
    }
  }
  return out;
}

double structural_penalty(const StructuralTables& tables, const double* pitches, std::size_t offset,
                          std::size_t voices) {
  std::array<int, 12> counts{};
  double penalty = 0;
  for (std::size_t index = 0; index < voices; ++index) {
    double pitch = pitches[offset + index];
    counts[static_cast<std::size_t>(pitch_class_of(pitch))] += 1;
    if (index > 0 && pitch == pitches[offset + index - 1]) {
      penalty += UNISON_PENALTY;
    }
  }
  for (std::size_t index = 0; index < tables.tones.size(); ++index) {
    if (counts[static_cast<std::size_t>(tables.tones[index])] == 0) {
      penalty += tables.missing[index];
    }
  }
  for (std::size_t pc = 0; pc < 12; ++pc) {
    if (counts[pc] > 1) {
      penalty += (counts[pc] - 1) * tables.doubling[pc];
    }
  }
  return penalty;
}

ResolutionTables resolution_tables(const Chord& prev_chord, const Chord& next_chord,
                                   const std::optional<KeyScale>& key) {
  ResolutionTables out;
  for (int pc : chord_pitch_classes(next_chord)) {
    out.nextHas[static_cast<std::size_t>(pc)] = true;
  }
  out.seventhPc = seventh_pc_of(prev_chord).value_or(-1);
  out.leadingTonePc =
      key && is_functioning_leading_tone(prev_chord, *key) ? leading_tone_pc_of(*key) : -1;
  out.tonicPc = key ? pitch_class_of(key->rootPc) : -1;
  out.nextChord = next_chord;
  return out;
}

int resolution_violations(const ResolutionTables& tables,
                          const std::optional<MelodicSpelling>& spelling, const double* prev,
                          std::size_t prev_offset, const double* cur, std::size_t cur_offset,
                          std::size_t voices) {
  int count = 0;
  for (std::size_t voice = 0; voice < voices; ++voice) {
    double from = prev[prev_offset + voice];
    double to = cur[cur_offset + voice];
    int from_pc = pitch_class_of(from);
    double motion = to - from;
    bool resolved = spelling ? moves_by_descending_step(spelling->from, from, spelling->to, to)
                             : (motion == -1 || motion == -2);
    if (from_pc == tables.seventhPc && !tables.nextHas[static_cast<std::size_t>(from_pc)] &&
        !resolved) {
      count += 1;
    }
    bool inner = voice > 0 && voice + 1 < voices;
    if (from_pc == tables.leadingTonePc && tables.tonicPc >= 0 &&
        tables.nextHas[static_cast<std::size_t>(tables.tonicPc)] &&
        !tables.nextHas[static_cast<std::size_t>(from_pc)] && motion != 1 &&
        !(inner && is_frustrated_leading_tone(from, to, tables.nextChord))) {
      count += 1;
    }
  }
  return count;
}

double leading_cost(const double* prev, std::size_t prev_offset, const double* cur,
                    std::size_t cur_offset, std::size_t voices) {
  double total = 0;
  for (std::size_t voice = 0; voice < voices; ++voice) {
    total += std::fabs(cur[cur_offset + voice] - prev[prev_offset + voice]);
  }
  return total;
}

MoveScoring move_scoring(const std::optional<Chord>& prev_chord, const Chord& chord,
                         const std::optional<ResolvedKey>& key,
                         const std::optional<Chord>& next_chord,
                         const SpellingTable* prev_spelling) {
  // The pitch-class tables want the scale alone; the spelling table is handed the key whole,
  // since the letters it writes are the key's.
  std::optional<KeyScale> scale;
  if (key) {
    scale = key->scale;
  }
  MoveScoring out;
  out.structure = structural_tables(chord, scale);
  if (prev_chord) {
    out.resolution = resolution_tables(*prev_chord, chord, scale);
  }
  if (key) {
    out.spelling = MelodicSpelling{
        prev_spelling != nullptr ? *prev_spelling : spelling_table(KeyArg(*key), prev_chord),
        spelling_table(KeyArg(*key), chord)};
  }
  if (prev_chord && key) {
    out.crossRelation = CrossRelationTables{*prev_chord, chord, next_chord, key->scale};
  }
  return out;
}

double violation_weight(const MoveScoring& scoring, const double* prev, std::size_t prev_offset,
                        const double* cur, std::size_t cur_offset, std::size_t voices) {
  int unresolved = scoring.resolution
                       ? resolution_violations(*scoring.resolution, scoring.spelling, prev,
                                               prev_offset, cur, cur_offset, voices)
                       : 0;
  int augmented = scoring.spelling ? augmented_melodic_count(*scoring.spelling, prev, prev_offset,
                                                             cur, cur_offset, voices)
                                   : 0;
  int contradictions = scoring.spelling && scoring.crossRelation
                           ? cross_relation_count(*scoring.spelling, *scoring.crossRelation, prev,
                                                  prev_offset, cur, cur_offset, voices)
                           : 0;
  double violations =
      VIOLATION_PENALTY * violation_count(prev, prev_offset, cur, cur_offset, voices);
  double weight = violations + RESOLUTION_PENALTY * unresolved +
                  AUGMENTED_MELODIC_PENALTY * augmented + CROSS_RELATION_PENALTY * contradictions;
  if (creates_outer_hidden_perfect(prev, prev_offset, cur, cur_offset, voices)) {
    weight += HIDDEN_PERFECT_PENALTY;
  }
  return weight;
}

double move_score(const MoveScoring& scoring, const double* prev, std::size_t prev_offset,
                  const double* cur, std::size_t cur_offset, std::size_t voices) {
  double structure = structural_penalty(scoring.structure, cur, cur_offset, voices);
  double distance = leading_cost(prev, prev_offset, cur, cur_offset, voices);
  return structure + distance +
         violation_weight(scoring, prev, prev_offset, cur, cur_offset, voices);
}

}  // namespace cantus
