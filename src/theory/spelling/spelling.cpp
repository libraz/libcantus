// Spelling: letter-name notes for scales and chords from a spelled tonic, of
// ts/src/theory/spelling/index.ts.
//
// The joint reading of a gapped scale is worked out on every call; TS remembers it per tonic and
// scale, which changes nothing but the time it takes.

#include "theory/spelling/spelling.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <optional>
#include <string>
#include <vector>

#include "cantus/theory/spelling.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "theory/chord/chord.h"

namespace cantus {

namespace {

/** One entry of a table keyed by `String(n)` or by name, with a number. */
struct NamedInt {
  std::string_view name;
  int value;
};

/** Letter offset above the tonic of each chromatic offset (`CHROMATIC_SPELLING`). */
constexpr std::array<NamedInt, 11> kChromaticSpelling = {
#include "theory/spelling/chromatic_spelling.gen.inc"
};

/** The flat-side table for scales that are not heptatonic (`CHROMATIC_SPELLING_FLAT`). */
constexpr std::array<NamedInt, 11> kChromaticSpellingFlat = {
#include "theory/spelling/chromatic_spelling_flat.gen.inc"
};

/** The sharp-side table for scales that are not heptatonic (`CHROMATIC_SPELLING_SHARP`). */
constexpr std::array<NamedInt, 11> kChromaticSpellingSharp = {
#include "theory/spelling/chromatic_spelling_sharp.gen.inc"
};

/** Semitones above its tonic each degree of the major scale sounds (`MAJOR_SEMITONES`). */
constexpr std::array<int, DIATONIC_LETTER_COUNT> kMajorSemitones = {
#include "theory/spelling/major_semitones.gen.inc"
};

/** The degrees whose plain readings are major or minor (`IMPERFECT_DEGREES`). */
constexpr std::array<int, 4> kImperfectDegrees = {
#include "theory/spelling/imperfect_degree_list.gen.inc"
};

/** The offsets above the tonic of every diatonic mode, in degree order (`DIATONIC_MODE_OFFSETS`).
 */
constexpr std::array<std::array<int, DIATONIC_LETTER_COUNT>, DIATONIC_LETTER_COUNT>
    kDiatonicModeOffsets = {
#include "theory/spelling/diatonic_mode_offsets.gen.inc"
};

/** Letter distance above a chord root of the unambiguous chord tones (`CHORD_TONE_LETTER_STEPS`).
 */
constexpr std::array<NamedInt, 6> kChordToneLetterSteps = {
#include "theory/spelling/chord_tone_letter_steps.gen.inc"
};

/** The letter distance above the root each chord-tone role is written at (`LETTER_STEP_BY_ROLE`).
 */
constexpr std::array<NamedInt, 5> kLetterStepByRole = {
#include "theory/spelling/letter_step_by_role.gen.inc"
};

/** The natural letter at or below each pitch class (`LETTER_BELOW_PITCH_CLASS`). */
constexpr std::array<int, 12> kLetterBelowPitchClass = {
#include "theory/spelling/letter_below_pitch_class.gen.inc"
};

/** Letter distance above the root of each simple interval (`SIMPLE_LETTER_OFFSETS`). */
constexpr std::array<int, 12> kSimpleLetterOffsets = {
#include "theory/spelling/simple_letter_offsets.gen.inc"
};

/** `table[key] ?? undefined`: a property lookup by `String(key)`. */
template <std::size_t N>
std::optional<int> lookup(const std::array<NamedInt, N>& table, double key) {
  std::string name = js::to_string(key);
  for (const NamedInt& row : table) {
    if (row.name == name) {
      return row.value;
    }
  }
  return std::nullopt;
}

template <std::size_t N>
std::optional<int> lookup(const std::array<NamedInt, N>& table, std::string_view name) {
  for (const NamedInt& row : table) {
    if (row.name == name) {
      return row.value;
    }
  }
  return std::nullopt;
}

int mod7(double value) { return diatonic_letter_of(value); }

/** The pitch class a spelled note sounds (`notePitchClass`); NoteData or PitchSpelling. */
template <typename Spelled>
int note_pitch_class(const Spelled& note) {
  return pitch_class_of(natural_pitch_class_of(note.letter) + note.alter);
}

NoteData note(int letter, double alter) {
  return NoteData{static_cast<double>(letter), alter, std::nullopt};
}

/** Shortest signed alteration taking a letter's natural pitch class to `pc` (`alterFor`). */
int alter_for(int letter, double pc) {
  int d = pitch_class_of(pc - natural_pitch_class_of(letter));
  if (d > 6) {
    d -= 12;
  }
  return d;
}

/** Spell `pc` on the letter `degree_offset` steps above `tonic_letter` (`letterFor`). */
std::optional<NoteData> letter_for(double tonic_letter, std::optional<int> degree_offset,
                                   double pc) {
  if (!degree_offset) {
    return std::nullopt;
  }
  int letter = mod7(tonic_letter + *degree_offset);
  return note(letter, alter_for(letter, pc));
}

/** Which of two candidate spellings pickSpelling chose. */
enum class Side { kNone, kFlat, kSharp };

/** The lighter-accidental of two candidate spellings; ties go to `prefer_flat` (`pickSpelling`). */
Side pick_spelling(const std::optional<NoteData>& flat, const std::optional<NoteData>& sharp,
                   bool prefer_flat) {
  if (!flat || !sharp) {
    return flat ? Side::kFlat : (sharp ? Side::kSharp : Side::kNone);
  }
  if (std::abs(flat->alter) != std::abs(sharp->alter)) {
    return std::abs(flat->alter) < std::abs(sharp->alter) ? Side::kFlat : Side::kSharp;
  }
  return prefer_flat ? Side::kFlat : Side::kSharp;
}

/** Keep a chromatic degree unless it costs two more accidentals (`capChromaticAccidentals`). */
NoteData cap_chromatic_accidentals(const NoteData& preferred,
                                   const std::optional<NoteData>& alternative) {
  return alternative && std::abs(preferred.alter) - std::abs(alternative->alter) >= 2 ? *alternative
                                                                                      : preferred;
}

/** How far a tone's reading strays from a plain degree above the tonic (`degreeStrain`). */
int degree_strain(const NoteData& tonic, const NoteData& spelled) {
  int letter_offset = mod7(spelled.letter - tonic.letter);
  int offset = pitch_class_of(note_pitch_class(spelled) - note_pitch_class(tonic));
  int deviation = pitch_class_of(offset - kMajorSemitones[static_cast<std::size_t>(letter_offset)]);
  if (deviation > 6) {
    deviation -= 12;
  }
  bool imperfect = std::find(kImperfectDegrees.begin(), kImperfectDegrees.end(), letter_offset) !=
                   kImperfectDegrees.end();
  int strain = imperfect && deviation < 0 ? std::abs(deviation + 1) : std::abs(deviation);
  return std::min<int>(strain, 2);
}

/** Whether the scale has a minor third and no major third (`hasMinorThird`). */
bool has_minor_third(const KeyScale& key) {
  std::vector<int> tones = scale_tones_in_degree_order(key);
  int root = pitch_class_of(key.rootPc);
  auto has = [&tones](int pc) { return std::find(tones.begin(), tones.end(), pc) != tones.end(); };
  return has(pitch_class_of(root + 3)) && !has(pitch_class_of(root + 4));
}

/** Which way a scale leans: a flat tonic and a minor third both mean flats (`leansFlat`). */
bool leans_flat(const NoteData& tonic, const KeyScale& key) {
  return tonic.alter < 0 || has_minor_third(key);
}

/** The conventional spellings of the tone `offset` above the tonic (`gappedCandidates`). */
std::vector<NoteData> gapped_candidates(const NoteData& tonic, int offset, double pc,
                                        bool prefer_flat) {
  std::optional<NoteData> flat =
      letter_for(tonic.letter, lookup(kChromaticSpellingFlat, offset), pc);
  std::optional<NoteData> sharp =
      letter_for(tonic.letter, lookup(kChromaticSpellingSharp, offset), pc);
  Side side = pick_spelling(flat, sharp, prefer_flat);
  if (side == Side::kNone) {
    return {};
  }
  const NoteData& preferred = side == Side::kFlat ? *flat : *sharp;
  const std::optional<NoteData>& alternative = side == Side::kFlat ? sharp : flat;
  if (!alternative || alternative->letter == preferred.letter) {
    return {preferred};
  }
  return {preferred, *alternative};
}

/** Spell a gapped scale by the degrees of a diatonic mode holding it (`spellByParentMode`). */
std::optional<std::vector<NoteData>> spell_by_parent_mode(const NoteData& tonic,
                                                          const std::vector<int>& pcs,
                                                          bool prefer_flat) {
  int tonic_pc = note_pitch_class(tonic);
  std::optional<std::vector<NoteData>> best;
  int best_alter = 0;
  int best_signed = 0;
  for (const auto& offsets : kDiatonicModeOffsets) {
    std::vector<NoteData> notes;
    int alter = 0;
    int signed_alter = 0;
    for (int pc : pcs) {
      auto found = std::find(offsets.begin(), offsets.end(), pitch_class_of(pc - tonic_pc));
      std::optional<int> degree;
      if (found != offsets.end()) {
        degree = static_cast<int>(found - offsets.begin());
      }
      std::optional<NoteData> spelled = letter_for(tonic.letter, degree, pc);
      if (!spelled) {
        break;
      }
      notes.push_back(*spelled);
      alter += std::abs(spelled->alter);
      signed_alter += spelled->alter;
    }
    if (notes.size() != pcs.size()) {
      continue;
    }
    bool evenly_light = alter == best_alter &&
                        (prefer_flat ? signed_alter < best_signed : signed_alter > best_signed);
    bool lighter = alter < best_alter || evenly_light;
    if (!best || lighter) {
      best = std::move(notes);
      best_alter = alter;
      best_signed = signed_alter;
    }
  }
  return best;
}

/** One candidate per tone, so the letters run out no faster than allowed (`assignDistinctLetters`).
 */
std::optional<std::vector<NoteData>> assign_distinct_letters(
    const std::vector<std::vector<NoteData>>& candidates, const NoteData& tonic, int duplicates) {
  int reserved = 1 << mod7(tonic.letter);
  std::optional<std::vector<NoteData>> best;
  int best_strain = 0;
  int best_alter = 0;
  int best_deviations = 0;
  for (std::size_t choice = 0; choice < (std::size_t{1} << candidates.size()); ++choice) {
    std::vector<NoteData> picked;
    int letters = reserved;
    int spare = duplicates;
    int strain = 0;
    int alter = 0;
    int deviations = 0;
    for (std::size_t index = 0; index < candidates.size(); ++index) {
      const std::vector<NoteData>& options = candidates[index];
      if (options.empty()) {
        break;
      }
      std::size_t pick = (choice >> index) & 1U;
      bool alternative = pick < options.size() && pick == 1;
      const NoteData& spelled = alternative ? options[1] : options[0];
      bool taken = (letters & (1 << static_cast<int>(spelled.letter))) != 0;
      if (taken && (spare == 0 || (reserved & (1 << static_cast<int>(spelled.letter))) != 0)) {
        break;
      }
      spare -= taken ? 1 : 0;
      letters |= 1 << static_cast<int>(spelled.letter);
      strain += degree_strain(tonic, spelled);
      alter += std::abs(spelled.alter);
      deviations += alternative ? 1 : 0;
      picked.push_back(spelled);
    }
    if (picked.size() != candidates.size()) {
      continue;
    }
    bool better = duplicates > 0 && strain != best_strain ? strain < best_strain
                  : alter != best_alter                   ? alter < best_alter
                                                          : deviations < best_deviations;
    if (!best || better) {
      best = std::move(picked);
      best_strain = strain;
      best_alter = alter;
      best_deviations = deviations;
    }
  }
  return best;
}

/** A spelling per scale pitch class. */
using JointSpelling = std::array<std::optional<NoteData>, 12>;

/** Spell every tone of a scale that is not heptatonic, one letter per tone (`spellGappedScale`). */
std::optional<JointSpelling> spell_gapped_scale(const NoteData& tonic, const KeyScale& key) {
  std::vector<int> tones = scale_tones_in_degree_order(key);
  if (tones.size() > MAX_JOINT_TONE_COUNT) {
    return std::nullopt;
  }
  int tonic_pc = note_pitch_class(tonic);
  NoteData tonic_note = note(mod7(tonic.letter), tonic.alter);
  bool prefer_flat = leans_flat(tonic, key);
  std::vector<int> rest;
  for (int pc : tones) {
    if (pitch_class_of(pc - tonic_pc) != 0) {
      rest.push_back(pc);
    }
  }
  std::vector<std::vector<NoteData>> candidates;
  for (int pc : rest) {
    candidates.push_back(gapped_candidates(tonic, pitch_class_of(pc - tonic_pc), pc, prefer_flat));
  }
  std::optional<std::vector<NoteData>> chosen = spell_by_parent_mode(tonic_note, rest, prefer_flat);
  if (!chosen) {
    // A scale that can hold a letter per tone does; only one that cannot writes a letter twice.
    chosen = assign_distinct_letters(candidates, tonic_note, 0);
  }
  if (!chosen) {
    chosen = assign_distinct_letters(candidates, tonic_note, 1);
  }
  if (!chosen) {
    return std::nullopt;
  }
  JointSpelling spellings;
  spellings[static_cast<std::size_t>(tonic_pc)] = tonic_note;
  for (std::size_t index = 0; index < rest.size() && index < chosen->size(); ++index) {
    spellings[static_cast<std::size_t>(pitch_class_of(rest[index]))] = (*chosen)[index];
  }
  return spellings;
}

/** Spell a single pitch class from the key alone (`spellByKey`). */
NoteData spell_by_key(double pc, const NoteData& tonic, const KeyScale& key) {
  int tonic_pc = note_pitch_class(tonic);
  int offset = pitch_class_of(pc - tonic_pc);
  // The tonic spells as itself, whatever the scale.
  if (offset == 0) {
    return note(mod7(tonic.letter), tonic.alter);
  }
  std::vector<int> tones = scale_tones_in_degree_order(key);
  if (tones.size() == DIATONIC_LETTER_COUNT) {
    auto found = std::find(tones.begin(), tones.end(), pitch_class_of(pc));
    if (found != tones.end()) {
      int letter = mod7(tonic.letter + static_cast<int>(found - tones.begin()));
      return note(letter, alter_for(letter, pc));
    }
    std::optional<NoteData> preferred =
        letter_for(tonic.letter, lookup(kChromaticSpelling, offset), pc);
    if (preferred) {
      std::optional<NoteData> flat =
          letter_for(tonic.letter, lookup(kChromaticSpellingFlat, offset), pc);
      std::optional<NoteData> sharp =
          letter_for(tonic.letter, lookup(kChromaticSpellingSharp, offset), pc);
      // The conventional degree is usually the flat-side candidate; the other side is used only
      // when it avoids a double (or worse) accidental.
      std::optional<NoteData> alternative;
      if (flat && flat->letter == preferred->letter) {
        alternative = sharp;
      } else if (sharp && sharp->letter == preferred->letter) {
        alternative = flat;
      }
      return cap_chromatic_accidentals(*preferred, alternative);
    }
  } else {
    // A scale that is not heptatonic spells its own tones together, one letter each.
    if (is_scale_tone(pc, key)) {
      if (std::optional<JointSpelling> joint = spell_gapped_scale(tonic, key)) {
        if (const std::optional<NoteData>& assigned =
                (*joint)[static_cast<std::size_t>(pitch_class_of(pc))]) {
          return *assigned;
        }
      }
    }
    std::vector<NoteData> candidates = gapped_candidates(tonic, offset, pc, leans_flat(tonic, key));
    if (!candidates.empty()) {
      return candidates.front();
    }
  }
  int below_letter = mod7(kLetterBelowPitchClass[static_cast<std::size_t>(pitch_class_of(pc))]);
  return note(below_letter, alter_for(below_letter, pc));
}

NoteData spelled_pitch_class(double pc, const NoteData& tonic, const KeyScale& key,
                             const SpellingContext* context);

/** The root spelling to use for a chord: its own hint when it still matches (`chordRootSpelling`).
 */
PitchSpelling chord_root_spelling(const Chord& chord, const NoteData& tonic, const KeyScale& key) {
  if (const std::optional<PitchSpelling>& hint = chord.rootSpelling) {
    if (note_pitch_class(*hint) == pitch_class_of(chord.rootPc)) {
      return PitchSpelling{static_cast<double>(mod7(hint->letter)), hint->alter};
    }
  }
  NoteData spelled = spelled_pitch_class(chord.rootPc, tonic, key, nullptr);
  return PitchSpelling{static_cast<double>(spelled.letter), static_cast<double>(spelled.alter)};
}

/** The letter distance above its root a sounding chord gives a pitch class (`chordToneLetterStep`).
 */
std::optional<int> chord_tone_letter_step(double pc, double root_pc, const Chord* chord) {
  if (chord != nullptr) {
    std::optional<std::vector<int>> offsets = chord_tone_letter_offsets(*chord);
    std::size_t index = chord->intervals.size();
    for (std::size_t i = 0; i < chord->intervals.size(); ++i) {
      if (pitch_class_of(chord->rootPc + chord->intervals[i]) == pitch_class_of(pc)) {
        index = i;
        break;
      }
    }
    if (offsets && index < offsets->size()) {
      return (*offsets)[index];
    }
    Nullable<ChordToneRole> role = chord_tone_role(pc, *chord);
    if (role) {
      return lookup(kLetterStepByRole, to_string(*role));
    }
  }
  return lookup(kChordToneLetterSteps, pitch_class_of(pc - root_pc));
}

/** Spell `pc` as a chord tone, on the letter its degree above the root implies (`spellChordTone`).
 */
std::optional<NoteData> spell_chord_tone(double pc, const SpellingContext& context,
                                         const NoteData& tonic, const KeyScale& key) {
  const Chord* chord = context.chord ? &*context.chord : nullptr;
  std::optional<double> chord_root = chord != nullptr ? chord->rootPc : context.chordRoot;
  if (!chord_root) {
    return std::nullopt;
  }
  double root_letter = chord == nullptr
                           ? spell_by_key(pitch_class_of(*chord_root), tonic, key).letter
                           : chord_root_spelling(*chord, tonic, key).letter;
  return letter_for(root_letter, chord_tone_letter_step(pc, *chord_root, chord), pc);
}

/** Spell `pc` relative to a neighbour `gap` semitones away from it (`neighbourSpelling`). */
std::optional<NoteData> neighbour_spelling(std::optional<double> neighbour, std::optional<int> away,
                                           int gap, int letter_step, double pc,
                                           const NoteData& tonic, const KeyScale& key) {
  if (!neighbour || away != pitch_class_of(gap)) {
    return std::nullopt;
  }
  return letter_for(spell_by_key(pitch_class_of(*neighbour), tonic, key).letter, letter_step, pc);
}

/** Refine a key spelling with the surrounding evidence, in rule priority order (`refineByContext`).
 */
NoteData refine_by_context(double pc, const NoteData& tonic, const KeyScale& key,
                           const SpellingContext& context, const NoteData& key_spelling) {
  int tonic_pc = note_pitch_class(tonic);
  if (pitch_class_of(pc) == tonic_pc || is_scale_tone(pc, key)) {
    return key_spelling;
  }
  std::optional<NoteData> chord_tone = spell_chord_tone(pc, context, tonic, key);
  // Read before any rule is tried, so a malformed neighbour is rejected whichever rule wins.
  std::optional<int> next_away;
  if (context.next) {
    next_away = pitch_class_of(*context.next - pc);
  }
  std::optional<int> previous_away;
  if (context.previous) {
    previous_away = pitch_class_of(*context.previous - pc);
  }
  auto fits = [](const std::optional<NoteData>& candidate) {
    return candidate && std::abs(candidate->alter) <= MAX_CONTEXT_ALTER;
  };
  if (fits(chord_tone)) {
    return *chord_tone;
  }
  std::optional<NoteData> candidate =
      neighbour_spelling(context.next, next_away, 1, -1, pc, tonic, key);
  if (fits(candidate)) {
    return *candidate;
  }
  candidate = neighbour_spelling(context.previous, previous_away, -1, 0, pc, tonic, key);
  if (fits(candidate)) {
    return *candidate;
  }
  candidate = neighbour_spelling(context.next, next_away, -1, 1, pc, tonic, key);
  if (fits(candidate)) {
    return *candidate;
  }
  candidate = neighbour_spelling(context.previous, previous_away, 1, 0, pc, tonic, key);
  return fits(candidate) ? *candidate : key_spelling;
}

/** Spell a pitch class from an already-resolved tonic and key (`spelledPitchClass`). */
NoteData spelled_pitch_class(double pc, const NoteData& tonic, const KeyScale& key,
                             const SpellingContext* context) {
  NoteData key_spelling = spell_by_key(pc, tonic, key);
  return context == nullptr ? key_spelling
                            : refine_by_context(pc, tonic, key, *context, key_spelling);
}

/** Diatonic letter distance implied by a chord interval (`chordLetterOffset`). */
int chord_letter_offset(double interval, const Chord& chord) {
  if (std::floor(interval) == interval && interval >= 0 && interval <= 23) {
    switch (static_cast<int>(interval)) {
      case 0:
      case 12:
        return 0;
      case 1:
      case 2:
      case 13:
      case 14:
        return 1;
      case 3:
      case 4:
        return 2;
      case 15:
        // The spec reads 15 as a raised ninth whatever else the chord holds.
        return 1;
      case 5:
      case 16:
      case 17:
      case 18:
        return 3;
      case 6:
      case 7:
      case 8:
      case 19:
        return 4;
      case 9:
        return chord.quality == ChordQuality::kDim7 ? 6 : 5;
      case 20:
      case 21:
      case 22:
        return 5;
      case 10:
      case 11:
      case 23:
        return 6;
      default:
        break;
    }
  }
  // Unknown or custom interval data gets the nearest conventional diatonic distance.
  double octaves = std::floor(js::max(0, interval) / 12);
  int simple = pitch_class_of(interval);
  return static_cast<int>(octaves * 7 + kSimpleLetterOffsets[static_cast<std::size_t>(simple)]);
}

/** Spell chord tones from an already-resolved root spelling (`chordTonesFromRoot`). */
std::vector<NoteData> chord_tones_from_root(const Chord& chord, const PitchSpelling& root) {
  if (note_pitch_class(root) != pitch_class_of(chord.rootPc)) {
    throw InvalidInputError("chord root spelling must match chord.rootPc");
  }
  std::optional<std::vector<int>> hinted = chord_tone_letter_offsets(chord);
  std::vector<NoteData> out;
  for (std::size_t index = 0; index < chord.intervals.size(); ++index) {
    double interval = chord.intervals[index];
    int offset =
        hinted && index < hinted->size() ? (*hinted)[index] : chord_letter_offset(interval, chord);
    int letter = mod7(root.letter + offset);
    double pc = pitch_class_of(chord.rootPc + interval);
    out.push_back(note(letter, alter_for(letter, pc)));
  }
  return out;
}

void assert_chord_root(const Chord& chord) { assert_finite_number(chord.rootPc, "chord.rootPc"); }

}  // namespace

bool is_heptatonic(const KeyScale& key) {
  return scale_tones_in_degree_order(key).size() == DIATONIC_LETTER_COUNT;
}

void assert_tonic_of(const NoteData& tonic, const KeyScale& key, std::string_view source) {
  int tonic_pc = note_pitch_class(tonic);
  int root_pc = pitch_class_of(key.rootPc);
  if (tonic_pc != root_pc) {
    std::string name = format_note(note(mod7(tonic.letter), tonic.alter));
    throw InvalidInputError(std::string(source) + ": tonic " + name + " sounds pitch class " +
                            js::to_string(tonic_pc) + ", not the key root " +
                            js::to_string(root_pc) +
                            "; pass a tonic that spells the key root, or take one from "
                            "spelledKeyOf");
  }
}

NoteData spell_pitch_class(double pc, const NoteArg& tonic, const KeyArg& key,
                           const SpellingContext& context) {
  NoteData note_data = to_note_data(tonic);
  KeyScale scale = to_key_scale(key);
  assert_tonic_of(note_data, scale, "spellPitchClass");
  return spelled_pitch_class(pc, note_data, scale, &context);
}

std::vector<NoteData> spell_scale(const NoteArg& tonic, const KeyArg& key) {
  NoteData note_data = to_note_data(tonic);
  KeyScale scale = to_key_scale(key);
  assert_tonic_of(note_data, scale, "spellScale");
  std::vector<NoteData> out;
  for (int pc : scale_tones_in_degree_order(scale)) {
    out.push_back(spelled_pitch_class(pc, note_data, scale, nullptr));
  }
  return out;
}

std::vector<NoteData> spell_pitch_classes(const std::vector<double>& pcs, const NoteArg& tonic,
                                          const KeyArg& key) {
  NoteData note_data = to_note_data(tonic);
  KeyScale scale = to_key_scale(key);
  assert_tonic_of(note_data, scale, "spellPitchClasses");
  std::vector<NoteData> out;
  for (std::size_t index = 0; index < pcs.size(); ++index) {
    double pc = assert_pitch_class(pcs[index], "pcs[" + index_text(index) + "]");
    out.push_back(spelled_pitch_class(pc, note_data, scale, nullptr));
  }
  return out;
}

std::vector<NoteData> spell_chord_from_root(const Chord& chord, const NoteArg& root) {
  assert_chord_root(chord);
  NoteData spelled = to_note_data(root);
  return chord_tones_from_root(chord, PitchSpelling{static_cast<double>(spelled.letter),
                                                    static_cast<double>(spelled.alter)});
}

std::vector<NoteData> spell_chord(const Chord& chord, const NoteArg& tonic, const KeyArg& key) {
  assert_chord_root(chord);
  NoteData note_data = to_note_data(tonic);
  KeyScale scale = to_key_scale(key);
  assert_tonic_of(note_data, scale, "spellChord");
  return chord_tones_from_root(chord, chord_root_spelling(chord, note_data, scale));
}

NoteData spell_pitch(double pitch, const NoteArg& tonic, const KeyArg& key,
                     const SpellingContext& context) {
  NoteData note_data = to_note_data(tonic);
  KeyScale scale = to_key_scale(key);
  assert_tonic_of(note_data, scale, "spellPitch");
  double rounded = js::round(assert_finite_number(pitch, "pitch"));
  NoteData spelled = spelled_pitch_class(pitch_class_of(rounded), note_data, scale, &context);
  spelled.octave = (rounded - natural_pitch_class_of(spelled.letter) - spelled.alter) / 12 - 1;
  return spelled;
}

std::vector<std::string> note_names(const std::vector<NoteArg>& notes) {
  std::vector<std::string> out;
  for (const NoteArg& value : notes) {
    out.push_back(format_note(to_note_data(value)));
  }
  return out;
}

}  // namespace cantus
