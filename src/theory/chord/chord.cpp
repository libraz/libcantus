// Chord building and reading: ts/src/theory/chord/index.ts.

#include "theory/chord/chord.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <string>

#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/theory/spelling.h"
#include "core/pitch/pitch.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "theory/chord/spec.h"
#include "theory/spelling/limits.gen.h"

namespace cantus {

namespace {

/** One entry of a table keyed by name, with a name. */
struct NamedName {
  std::string_view name;
  std::string_view value;
};

/** One entry of a table keyed by name, with a number. */
struct NamedInt {
  std::string_view name;
  int value;
};

constexpr std::size_t kRoleCount = static_cast<std::size_t>(ChordToneRole::kSeventh) + 1;

/** The role a letter distance above the root names (`ROLE_BY_LETTER_OFFSET`). */
constexpr std::array<NamedName, kRoleCount> kRoleByLetterOffset = {
#include "theory/chord/role_by_letter_offset.gen.inc"
};

/** The degree each chord-tone role names, indexed by ChordToneRole (`DEGREE_BY_ROLE`). */
constexpr std::array<NamedInt, kRoleCount> kDegreeByRole = {
#include "theory/chord/degree_by_role.gen.inc"
};
static_assert(!kDegreeByRole.back().name.empty(), "DEGREE_BY_ROLE and ChordToneRole disagree");

/** The degree each interval class names as a tension (`TENSION_DEGREE`). */
constexpr std::array<int, 12> kTensionDegree = {
#include "theory/chord/tension_degree.gen.inc"
};

bool has_pitch_class(int mask, int pc) { return ((mask >> pc) & 1) == 1; }

/** `1 << n` as JS evaluates it: the count is taken modulo 32 and the result is an int32. */
std::int32_t bit(double n) { return static_cast<std::int32_t>(1U << (js::to_uint32(n) & 31U)); }

/** A chord's intervals as a mask of interval classes above its root (`chordIntervalMask`). */
int chord_interval_mask(const Chord& chord) {
  std::int32_t mask = 0;
  for (double interval : chord.intervals) {
    mask |= bit(js::floor_mod(interval, 12));
  }
  return mask;
}

/** The role a chord's own spelling gives a pitch, when it names one (`spelledToneRole`). */
std::optional<Nullable<ChordToneRole>> spelled_tone_role(double pitch, const Chord& chord) {
  std::optional<std::vector<int>> offsets = chord_tone_letter_offsets(chord);
  if (!offsets) {
    return std::nullopt;
  }
  std::size_t index = chord.intervals.size();
  for (std::size_t i = 0; i < chord.intervals.size(); ++i) {
    if (pitch_class_of(chord.rootPc + chord.intervals[i]) == pitch_class_of(pitch)) {
      index = i;
      break;
    }
  }
  if (index >= offsets->size()) {
    return std::nullopt;
  }
  std::string key = js::to_string((*offsets)[index]);
  for (const NamedName& row : kRoleByLetterOffset) {
    if (row.name == key) {
      return Nullable<ChordToneRole>(*parse_chord_tone_role(row.value));
    }
  }
  return Nullable<ChordToneRole>();
}

/** Classify a stacked-thirds triad into a chord quality (`classifyTriad`). */
ChordQuality classify_triad(int third_ic, int fifth_ic) {
  if (third_ic == 4 && fifth_ic == 8) {
    return ChordQuality::kAug;
  }
  if (third_ic == 4 && fifth_ic == 6) {
    return ChordQuality::kMajB5;
  }
  if (third_ic == 3 && fifth_ic == 6) {
    return ChordQuality::kDim;
  }
  if (third_ic == 3) {
    return ChordQuality::kMin;
  }
  return ChordQuality::kMaj;
}

/** Classify a stacked-thirds seventh chord into a chord quality (`classifySeventh`). */
ChordQuality classify_seventh(int third_ic, int fifth_ic, int seventh_ic) {
  if (third_ic == 3 && fifth_ic == 6 && seventh_ic == 9) {
    return ChordQuality::kDim7;
  }
  if (third_ic == 3 && fifth_ic == 6 && seventh_ic == 10) {
    return ChordQuality::kM7b5;
  }
  if (third_ic == 3 && seventh_ic == 11) {
    return ChordQuality::kMinMaj7;
  }
  if (third_ic == 3) {
    return ChordQuality::kMin7;
  }
  if (fifth_ic == 8 && seventh_ic == 10) {
    return ChordQuality::kAug7;
  }
  if (fifth_ic == 8 && seventh_ic == 11) {
    return ChordQuality::kAugMaj7;
  }
  if (fifth_ic == 6 && seventh_ic == 10) {
    return ChordQuality::k7b5;
  }
  if (seventh_ic == 11) {
    return ChordQuality::kMaj7;
  }
  return ChordQuality::kDom7;
}

/** Whether a quality's template is exactly these intervals (`matchesQualityIntervals`). */
bool matches_quality_intervals(ChordQuality quality, const std::vector<double>& intervals) {
  return quality_intervals(quality) == intervals;
}

/** Stack scale thirds from a 1-based degree into a chord of `size` notes (`stackThirds`). */
Chord stack_thirds(double degree, const ResolvedKey& resolved, std::size_t size) {
  // Degree 0 is rejected rather than wrapped onto the last degree.
  auto number = static_cast<int>(assert_degree(degree, "chord degree"));
  const KeyScale& key = resolved.scale;
  std::vector<int> tones = scale_tones_in_degree_order(key);
  auto length = static_cast<int>(tones.size());
  if (length != DIATONIC_LETTER_COUNT) {
    throw InvalidInputError("diatonic chord stacking requires a heptatonic scale (received " +
                            js::to_string(length) + " tones)");
  }
  auto idx = [&](int step) { return static_cast<std::size_t>((number - 1 + step) % length); };
  int root_pc = tones[idx(0)];
  std::vector<double> offsets;
  std::string text;
  for (std::size_t i = 0; i < size; ++i) {
    // Every other degree: the root, the third, the fifth and the seventh.
    int pc = tones[idx(static_cast<int>(2 * i))];
    offsets.push_back(pitch_class_of(pc - root_pc));
    text += (i > 0 ? ", " : "") + js::to_string(offsets.back());
  }
  auto third_ic = static_cast<int>(offsets[1]);
  auto fifth_ic = static_cast<int>(offsets[2]);
  ChordQuality quality = size == 3
                             ? classify_triad(third_ic, fifth_ic)
                             : classify_seventh(third_ic, fifth_ic, static_cast<int>(offsets[3]));
  if (!matches_quality_intervals(quality, offsets)) {
    throw InvalidInputError("scale thirds at degree " + js::to_string(number) +
                            " produce unsupported intervals [" + text + "]");
  }
  SpelledChordParts parts;
  parts.rootSpelling = key_spelling(root_pc, resolved);
  return make_spelled_chord(root_pc, quality, parts);
}

}  // namespace

std::string_view to_string(ChordToneRole role) {
  return kDegreeByRole[static_cast<std::size_t>(role)].name;
}

std::optional<ChordToneRole> parse_chord_tone_role(std::string_view name) {
  return parse_named<ChordToneRole>(kDegreeByRole, name, &NamedInt::name);
}

std::vector<ChordQuality> chord_qualities() { return quality_order(); }

Chord chord_from_degree(double degree, ChordQuality ext, const KeyArg& key) {
  auto number = static_cast<int>(assert_degree(degree, "chord degree"));
  ResolvedKey resolved = resolve_key(key);
  std::vector<int> tones = scale_tones_in_degree_order(resolved.scale);
  auto length = static_cast<int>(tones.size());
  int index = length > 0 ? (number - 1) % length : 0;
  double root_pc = index < length ? tones[static_cast<std::size_t>(index)]
                                  : pitch_class_of(resolved.scale.rootPc);
  SpelledChordParts parts;
  parts.rootSpelling = key_spelling(root_pc, resolved);
  return make_spelled_chord(root_pc, ext, parts);
}

Chord make_chord(double root_pc, ChordQuality quality, std::optional<double> bass_pc) {
  SpelledChordParts parts;
  parts.bassPc = bass_pc;
  return make_spelled_chord(root_pc, quality, parts);
}

Chord make_spelled_chord(double root_pc, ChordQuality quality, const SpelledChordParts& parts) {
  // A NaN root formats as 'C', so it is rejected where the chord is built.
  assert_finite_number(root_pc, "chord rootPc");
  if (parts.bassPc) {
    assert_finite_number(*parts.bassPc, "chord bassPc");
  }
  Chord chord;
  chord.rootPc = pitch_class_of(root_pc);
  chord.quality = quality;
  chord.intervals = quality_intervals(quality);
  if (parts.bassPc) {
    chord.bassPc = pitch_class_of(*parts.bassPc);
  }
  if (parts.rootSpelling) {
    chord.rootSpelling = PitchSpelling{parts.rootSpelling->letter, parts.rootSpelling->alter};
  }
  if (parts.bassSpelling) {
    chord.bassSpelling = PitchSpelling{parts.bassSpelling->letter, parts.bassSpelling->alter};
  } else if (chord.rootSpelling && chord.bassPc) {
    auto found = std::find_if(chord.intervals.begin(), chord.intervals.end(), [&](double interval) {
      return pitch_class_of(chord.rootPc + interval) == *chord.bassPc;
    });
    if (found != chord.intervals.end()) {
      auto index = static_cast<std::size_t>(found - chord.intervals.begin());
      std::vector<NoteData> tones = spell_chord_from_root(
          chord, NoteData{chord.rootSpelling->letter, chord.rootSpelling->alter, std::nullopt});
      if (index < tones.size()) {
        chord.bassSpelling = PitchSpelling{tones[index].letter, tones[index].alter};
      }
    }
  }
  if (parts.toneSpellings) {
    std::vector<PitchSpelling> tones;
    for (const PitchSpelling& tone : *parts.toneSpellings) {
      tones.push_back(PitchSpelling{tone.letter, tone.alter});
    }
    chord.toneSpellings = std::move(tones);
  }
  return chord;
}

PitchSpelling key_spelling(double pc, const ResolvedKey& key) {
  NoteData note = spell_pitch_class(pc, key.tonic, key.scale);
  return PitchSpelling{note.letter, note.alter};
}

Chord chord_from_spec(const ChordSpec& spec) {
  ChordSpec checked = assert_chord_spec(spec);
  Chord chord;
  chord.rootPc = pitch_class_of(checked.rootPc);
  chord.quality = chord_spec_quality(checked);
  chord.intervals = chord_spec_intervals(checked);
  if (checked.bassPc) {
    chord.bassPc = pitch_class_of(*checked.bassPc);
  }
  return chord;
}

ChordSpec chord_spec_of(const Chord& chord) {
  assert_finite_number(chord.rootPc, "chord rootPc");
  double root_pc = pitch_class_of(chord.rootPc);
  std::optional<double> bass_pc;
  if (chord.bassPc) {
    bass_pc = pitch_class_of(*chord.bassPc);
  }
  // A chord with no tones says nothing about its own structure, so its name is all that is left.
  std::optional<ChordSpec> read =
      chord.intervals.empty() ? std::nullopt : chord_spec_from_intervals(chord.intervals);
  if (!read) {
    return chord_spec_for_quality(chord.quality, root_pc, bass_pc);
  }
  read->rootPc = root_pc;
  if (bass_pc) {
    read->bassPc = bass_pc;
  }
  return *read;
}

Chord chord_from_span(const ChordSpan& span) {
  SpelledChordParts parts;
  parts.bassPc = span.bassPc;
  Chord chord = make_spelled_chord(span.rootPc, span.quality, parts);
  if (span.intervals) {
    const char* name = "chord span intervals";
    if (span.intervals->empty()) {
      throw InvalidInputError(std::string(name) + " must name at least one interval");
    }
    std::vector<double> copy;
    for (std::size_t index = 0; index < span.intervals->size(); ++index) {
      copy.push_back(assert_integer((*span.intervals)[index],
                                    std::string(name) + "[" + index_text(index) + "]",
                                    -MAX_CHORD_INTERVAL, MAX_CHORD_INTERVAL));
    }
    chord.intervals = std::move(copy);
  }
  return chord;
}

ChordSpan span_from_chord(const Chord& chord, double start_beat) {
  assert_finite_number(start_beat, "chord span startBeat");
  assert_finite_number(chord.rootPc, "chord.rootPc");
  ChordSpan span;
  span.rootPc = chord.rootPc;
  span.quality = chord.quality;
  span.startBeat = start_beat;
  span.bassPc = chord.bassPc;
  if (!matches_quality_intervals(chord.quality, chord.intervals)) {
    span.intervals = chord.intervals;
  }
  return span;
}

Chord transpose_chord(const Chord& chord, double semitones) {
  assert_finite_number(chord.rootPc, "chord.rootPc");
  assert_finite_number(semitones, "semitones");
  double steps = js::round(semitones);
  Chord moved;
  moved.rootPc = pitch_class_of(chord.rootPc + steps);
  moved.quality = chord.quality;
  moved.intervals = chord.intervals;
  if (chord.bassPc) {
    moved.bassPc = pitch_class_of(*chord.bassPc + steps);
  }
  return moved;
}

std::optional<std::vector<PitchSpelling>> chord_tone_spellings(const Chord& chord) {
  if (!chord.toneSpellings || chord.toneSpellings->size() != chord.intervals.size()) {
    return std::nullopt;
  }
  std::vector<PitchSpelling> usable;
  for (std::size_t index = 0; index < chord.toneSpellings->size(); ++index) {
    const PitchSpelling& hint = (*chord.toneSpellings)[index];
    NoteData note = assert_note_values(hint.letter, hint.alter, std::nullopt, "note");
    if (note_to_pitch_class(note) != pitch_class_of(chord.rootPc + chord.intervals[index])) {
      return std::nullopt;
    }
    usable.push_back(
        PitchSpelling{static_cast<double>(diatonic_letter_of(hint.letter)), hint.alter});
  }
  return usable;
}

std::optional<std::vector<int>> chord_tone_letter_offsets(const Chord& chord) {
  std::optional<std::vector<PitchSpelling>> hints = chord_tone_spellings(chord);
  if (!hints) {
    return std::nullopt;
  }
  std::optional<PitchSpelling> root_hint;
  for (std::size_t i = 0; i < chord.intervals.size(); ++i) {
    if (pitch_class_of(chord.intervals[i]) == 0) {
      if (i < hints->size()) {
        root_hint = (*hints)[i];
      }
      break;
    }
  }
  if (!root_hint) {
    return std::nullopt;
  }
  std::vector<int> offsets;
  for (const PitchSpelling& hint : *hints) {
    offsets.push_back(diatonic_letter_of(hint.letter - root_hint->letter));
  }
  return offsets;
}

int chord_pc_mask(const Chord& chord, const ChordPitchClassOptions& opts) {
  std::int32_t mask = 0;
  for (double interval : chord.intervals) {
    mask |= bit(pitch_class_of(chord.rootPc + interval));
  }
  if (opts.includeBass != false && chord.bassPc) {
    mask |= bit(pitch_class_of(*chord.bassPc));
  }
  return mask;
}

std::vector<int> chord_pitch_classes(const Chord& chord, const ChordPitchClassOptions& opts) {
  assert_finite_number(chord.rootPc, "chord.rootPc");
  int mask = chord_pc_mask(chord, opts);
  std::vector<int> pcs;
  for (int pc = 0; pc < 12; ++pc) {
    if (has_pitch_class(mask, pc)) {
      pcs.push_back(pc);
    }
  }
  return pcs;
}

int interval_above_root(double pitch, const Chord& chord) {
  int pc = pitch_class_of(pitch);
  assert_finite_number(chord.rootPc, "chord.rootPc");
  return pitch_class_of(pc - pitch_class_of(chord.rootPc));
}

bool is_chord_member(double pitch, const Chord& chord) {
  int mask = chord_pc_mask(chord);
  return has_pitch_class(mask, pitch_class_of(pitch));
}

Nullable<ChordToneRole> chord_tone_role(double pitch, const Chord& chord) {
  if (std::optional<Nullable<ChordToneRole>> spelled = spelled_tone_role(pitch, chord)) {
    return *spelled;
  }
  int interval = (pitch_class_of(pitch) - pitch_class_of(chord.rootPc) + 12) % 12;
  int tones = chord_interval_mask(chord);
  auto sounds = [tones](int ic) { return has_pitch_class(tones, ic); };
  auto role = [](bool yes, ChordToneRole r) {
    return yes ? Nullable<ChordToneRole>(r) : Nullable<ChordToneRole>();
  };
  switch (interval) {
    case 0:
      // A chord that leaves its root out does not sound one.
      return role(sounds(0), ChordToneRole::kRoot);
    case 3:
    case 4:
      return role(sounds(interval) && (interval != 3 || !sounds(4)), ChordToneRole::kThird);
    case 7:
      return role(sounds(7), ChordToneRole::kFifth);
    case 6:
    case 8:
      // An altered fifth is the chord's fifth only without a perfect fifth beside it.
      return role(sounds(interval) && !sounds(7), ChordToneRole::kFifth);
    case 9: {
      bool has_higher_seventh = sounds(10) || sounds(11);
      bool is_diminished_seventh = sounds(3) && sounds(6) && !has_higher_seventh;
      if (sounds(9) && is_diminished_seventh) {
        return ChordToneRole::kSeventh;
      }
      return role(sounds(9) && !has_higher_seventh, ChordToneRole::kSixth);
    }
    case 10:
    case 11:
      return role(sounds(interval), ChordToneRole::kSeventh);
    default:
      return Nullable<ChordToneRole>();
  }
}

std::optional<int> degree_of_interval(double interval, const Chord& chord) {
  Nullable<ChordToneRole> role = chord_tone_role(pitch_class_of(chord.rootPc + interval), chord);
  if (role) {
    return kDegreeByRole[static_cast<std::size_t>(*role)].value;
  }
  double ic = js::floor_mod(interval, 12);
  if (std::floor(ic) != ic) {
    return std::nullopt;
  }
  return kTensionDegree[static_cast<std::size_t>(ic)];
}

ThirdSlot third_slot_of(const Chord& chord) {
  int tones = chord_interval_mask(chord);
  if (has_pitch_class(tones, 4)) {
    return ThirdSlot{ThirdSlot::Kind::kThird, 4};
  }
  if (has_pitch_class(tones, 3)) {
    return ThirdSlot{ThirdSlot::Kind::kThird, 3};
  }
  ChordSpec spec = chord_spec_of(chord);
  if (spec.base == ChordBase::kSus2) {
    return has_pitch_class(tones, 2) ? ThirdSlot{ThirdSlot::Kind::kSuspension, 2} : ThirdSlot{};
  }
  // An eleventh chord states its suspension by omitting the third, so it reads like a sus4.
  bool omits_third =
      std::find(spec.omissions.begin(), spec.omissions.end(), 3) != spec.omissions.end();
  if (spec.base == ChordBase::kSus4 || omits_third) {
    return has_pitch_class(tones, 5) ? ThirdSlot{ThirdSlot::Kind::kSuspension, 5} : ThirdSlot{};
  }
  return ThirdSlot{};
}

std::vector<int> displaced_thirds(const Chord& chord) {
  if (third_slot_of(chord).kind != ThirdSlot::Kind::kSuspension) {
    return {};
  }
  return {pitch_class_of(chord.rootPc + 3), pitch_class_of(chord.rootPc + 4)};
}

Chord diatonic_triad(double degree, const KeyArg& key) {
  return stack_thirds(degree, resolve_key(key), 3);
}

Chord diatonic_seventh(double degree, const KeyArg& key) {
  return stack_thirds(degree, resolve_key(key), 4);
}

}  // namespace cantus
