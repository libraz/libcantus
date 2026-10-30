// Augmented-sixth chords, the Italian, French and German sixths:
// ts/src/analyze/functional/augmented-sixth.ts.

#include "analyze/functional/augmented_sixth.h"

#include <algorithm>
#include <array>
#include <stdexcept>
#include <string>

#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/spelling.h"
#include "theory/chord/chord.h"

namespace cantus {

namespace {

constexpr std::size_t kKindCount = static_cast<std::size_t>(AugmentedSixthKind::kGerman) + 1;

/** KINDS, indexed by AugmentedSixthKind. */
constexpr std::array<std::string_view, kKindCount> kAugmentedSixthKindNames = {
#include "analyze/functional/kinds.gen.inc"
};
static_assert(!kAugmentedSixthKindNames.back().empty(), "KINDS and AugmentedSixthKind disagree");

/** A name and the text it stands for. */
struct NamedText {
  std::string_view name;
  std::string_view text;
};

/** The semitone offsets above the bass of one kind's tones (`TONES_ABOVE_BASS`). */
struct KindTones {
  std::string_view name;
  std::vector<int> tones;
};

/** One spelled interval above the bass as the table writes it. */
struct SpelledIntervalRow {
  int number;
  std::string_view quality;
  double semitones;
  bool descending;
};

/** The spelled intervals above the bass of one kind (`SPELLED_ABOVE_BASS`). */
struct KindIntervals {
  std::string_view name;
  std::vector<SpelledIntervalRow> intervals;
};

/** How one kind is carried by the pitch-class Chord type (`CHORD_SHAPE`). */
struct KindShape {
  std::string_view name;
  struct Shape {
    int rootAboveBass;
    std::string_view quality;
    std::vector<int> intervals;
  } shape;
};

/** A table keyed by kind must list the kinds in the order of AugmentedSixthKind. */
template <class Row>
const std::array<Row, kKindCount>& by_kind(const std::array<Row, kKindCount>& rows) {
  for (std::size_t i = 0; i < kKindCount; ++i) {
    if (rows[i].name != kAugmentedSixthKindNames[i]) {
      throw std::logic_error("an augmented-sixth table disagrees with AugmentedSixthKind");
    }
  }
  return rows;
}

const std::array<KindTones, kKindCount>& tones_above_bass() {
  static const std::array<KindTones, kKindCount> rows = by_kind(std::array<KindTones, kKindCount>{
#include "analyze/functional/tones_above_bass.gen.inc"
  });
  return rows;
}

const std::array<KindIntervals, kKindCount>& spelled_above_bass() {
  static const std::array<KindIntervals, kKindCount> rows =
      by_kind(std::array<KindIntervals, kKindCount>{
#include "analyze/functional/spelled_above_bass.gen.inc"
      });
  return rows;
}

const std::array<KindShape, kKindCount>& chord_shape() {
  static const std::array<KindShape, kKindCount> rows = by_kind(std::array<KindShape, kKindCount>{
#include "analyze/functional/chord_shape.gen.inc"
  });
  return rows;
}

/** SYMBOL_BY_KIND: the symbol emitted for each kind. */
const std::array<NamedText, kKindCount>& symbol_by_kind() {
  static const std::array<NamedText, kKindCount> rows = by_kind(std::array<NamedText, kKindCount>{
#include "analyze/functional/symbol_by_kind.gen.inc"
  });
  return rows;
}

/** KIND_SYMBOLS: the symbols accepted for each kind, including the figured variant. */
constexpr NamedText kKindSymbols[] =
#include "analyze/functional/kind_symbols.gen.inc"
    ;

/** BASS_INTERVAL: the minor sixth from the tonic up to the bass every kind stands on. */
constexpr SpelledIntervalRow kBassInterval =
#include "analyze/functional/bass_interval.gen.inc"
    ;

SpelledInterval interval_of(const SpelledIntervalRow& row) {
  return SpelledInterval{row.number, std::string(row.quality), row.semitones, row.descending};
}

std::size_t index_of(AugmentedSixthKind kind) { return static_cast<std::size_t>(kind); }

/** Reduce a spelled note to the bare letter/alter a chord records as a hint (`bareSpelling`). */
PitchSpelling bare_spelling(const NoteData& note) {
  return PitchSpelling{static_cast<double>(note.letter), static_cast<double>(note.alter)};
}

/** The kind's spelled tones, bass first (`spelledFromTonic`). */
std::vector<NoteData> spelled_from_tonic(AugmentedSixthKind kind, const NoteData& tonic) {
  NoteData bass = transpose_by_interval(tonic, interval_of(kBassInterval));
  std::vector<NoteData> out;
  for (const SpelledIntervalRow& row : spelled_above_bass()[index_of(kind)].intervals) {
    out.push_back(transpose_by_interval(bass, interval_of(row)));
  }
  return out;
}

/** The kind's spelled tones in the order its own interval template names them. */
std::vector<NoteData> spelled_in_chord_order(AugmentedSixthKind kind, const NoteData& tonic) {
  std::vector<NoteData> tones = spelled_from_tonic(kind, tonic);
  const std::vector<int>& template_tones = tones_above_bass()[index_of(kind)].tones;
  int root_above_bass = chord_shape()[index_of(kind)].shape.rootAboveBass;
  auto root_index = std::find(template_tones.begin(), template_tones.end(), root_above_bass) -
                    template_tones.begin();
  std::rotate(tones.begin(), tones.begin() + root_index, tones.end());
  return tones;
}

/** Build an augmented-sixth chord in a key (`augmentedSixthOn`). */
Chord augmented_sixth_on(AugmentedSixthKind kind, const KeyArg& key_like) {
  const KindShape::Shape& shape = chord_shape()[index_of(kind)].shape;
  ResolvedKey resolved = resolve_key(key_like);
  int bass_pc = augmented_sixth_bass_pc(resolved.scale);
  NoteData bass = transpose_by_interval(resolved.tonic, interval_of(kBassInterval));
  std::vector<NoteData> tones = spelled_in_chord_order(kind, resolved.tonic);
  SpelledChordParts parts;
  parts.bassPc = bass_pc;
  // The rotation starts on the tone the template is measured from, so the first spelling is the
  // root's own.
  parts.rootSpelling = bare_spelling(tones.empty() ? bass : tones.front());
  parts.bassSpelling = bare_spelling(bass);
  std::vector<PitchSpelling> spellings;
  for (const NoteData& tone : tones) {
    spellings.push_back(bare_spelling(tone));
  }
  parts.toneSpellings = std::move(spellings);
  Chord chord = make_spelled_chord(pitch_class_of(bass_pc + shape.rootAboveBass),
                                   *parse_chord_quality(shape.quality), parts);
  chord.intervals.assign(shape.intervals.begin(), shape.intervals.end());
  return chord;
}

/** The kind whose tones over `bass` are exactly `pcs`, or null (`kindOfPitchClasses`). */
Nullable<AugmentedSixthKind> kind_of_pitch_classes(const std::vector<int>& pcs, int bass) {
  for (std::size_t i = 0; i < kKindCount; ++i) {
    const std::vector<int>& tones = tones_above_bass()[i].tones;
    bool all_present = std::all_of(tones.begin(), tones.end(), [&](int tone) {
      return std::find(pcs.begin(), pcs.end(), pitch_class_of(bass + tone)) != pcs.end();
    });
    if (pcs.size() == tones.size() && all_present) {
      return static_cast<AugmentedSixthKind>(i);
    }
  }
  return std::nullopt;
}

/** A spelled note reduced to the letter/alter pair spellings compare by (`spellingId`). */
std::pair<int, int> spelling_id(const NoteData& note) {
  return {diatonic_letter_of(note.letter), note.alter};
}

/** Whether a chord's own letters are the kind's (`spellsAugmentedSixth`). */
bool spells_augmented_sixth(const Chord& chord, AugmentedSixthKind kind, const ResolvedKey& key) {
  std::vector<std::pair<int, int>> written;
  for (const NoteData& note : spell_chord(chord, key.tonic, key.scale)) {
    std::pair<int, int> id = spelling_id(note);
    if (std::find(written.begin(), written.end(), id) == written.end()) {
      written.push_back(id);
    }
  }
  std::vector<std::pair<int, int>> tones;
  for (const NoteData& note : spelled_from_tonic(kind, key.tonic)) {
    tones.push_back(spelling_id(note));
  }
  return written.size() == tones.size() &&
         std::all_of(tones.begin(), tones.end(), [&](const std::pair<int, int>& tone) {
           return std::find(written.begin(), written.end(), tone) != written.end();
         });
}

/** `new Set(values)`, ascending-insensitive: the distinct values in first-seen order. */
std::vector<int> distinct(const std::vector<int>& values) {
  std::vector<int> out;
  for (int value : values) {
    if (std::find(out.begin(), out.end(), value) == out.end()) {
      out.push_back(value);
    }
  }
  return out;
}

}  // namespace

std::string_view to_string(AugmentedSixthKind kind) {
  return kAugmentedSixthKindNames[index_of(kind)];
}

std::optional<AugmentedSixthKind> parse_augmented_sixth_kind(std::string_view name) {
  for (std::size_t i = 0; i < kKindCount; ++i) {
    if (kAugmentedSixthKindNames[i] == name) {
      return static_cast<AugmentedSixthKind>(i);
    }
  }
  return std::nullopt;
}

int augmented_sixth_bass_pc(const KeyScale& key) {
  return pitch_class_of(key.rootPc + BASS_ABOVE_TONIC);
}

Chord augmented_sixth_chord(AugmentedSixthKind kind, const KeyArg& key) {
  return augmented_sixth_on(kind, key);
}

namespace {

/** The kind a chord sounds over the key's lowered submediant, before its letters are read. */
Nullable<AugmentedSixthKind> sounded_kind(const Chord& chord, const ResolvedKey& key) {
  int bass = augmented_sixth_bass_pc(key.scale);
  if (pitch_class_of(chord.bassPc ? *chord.bassPc : chord.rootPc) != bass) {
    return std::nullopt;
  }
  return kind_of_pitch_classes(chord_pitch_classes(chord), bass);
}

}  // namespace

bool reads_augmented_sixth_spelling(const Chord& chord, const KeyArg& key) {
  return sounded_kind(chord, resolve_key(key)).has_value();
}

Nullable<AugmentedSixthKind> augmented_sixth_kind_of(const Chord& chord, const KeyArg& key_like) {
  ResolvedKey resolved = resolve_key(key_like);
  Nullable<AugmentedSixthKind> kind = sounded_kind(chord, resolved);
  if (!kind || !spells_augmented_sixth(chord, *kind, resolved)) {
    return std::nullopt;
  }
  return kind;
}

Nullable<AugmentedSixthKind> augmented_sixth_kind(const ChordArg& chord, const KeyArg& key) {
  Chord data = to_chord_data(chord);
  return augmented_sixth_kind_of(data, key);
}

Nullable<Chord> augmented_sixth_over_bass(const std::vector<double>& pcs, double bass_pc,
                                          const KeyArg& key_like) {
  ResolvedKey resolved = resolve_key(key_like);
  int bass = augmented_sixth_bass_pc(resolved.scale);
  if (pitch_class_of(bass_pc) != bass) {
    return std::nullopt;
  }
  std::vector<int> reduced;
  for (double pc : pcs) {
    reduced.push_back(pitch_class_of(pc));
  }
  Nullable<AugmentedSixthKind> kind = kind_of_pitch_classes(distinct(reduced), bass);
  if (!kind) {
    return std::nullopt;
  }
  return augmented_sixth_on(*kind, resolved);
}

Nullable<Chord> augmented_sixth_from_pitch_classes(const std::vector<double>& pcs, double bass_pc,
                                                   const KeyArg& key) {
  return augmented_sixth_over_bass(pcs, bass_pc, key);
}

std::vector<NoteData> spell_augmented_sixth(AugmentedSixthKind kind, const NoteArg& tonic) {
  return spelled_from_tonic(kind, to_note_data(tonic));
}

Nullable<Chord> augmented_sixth_from_symbol(std::string_view symbol, const KeyArg& key) {
  // A Map keeps the last value of a repeated key.
  std::optional<AugmentedSixthKind> kind;
  for (const NamedText& row : kKindSymbols) {
    if (row.name == symbol) {
      kind = parse_augmented_sixth_kind(row.text);
    }
  }
  if (!kind) {
    return std::nullopt;
  }
  return augmented_sixth_on(*kind, key);
}

Nullable<std::string_view> augmented_sixth_symbol(const Chord& chord, const KeyArg& key) {
  Nullable<AugmentedSixthKind> kind = augmented_sixth_kind_of(chord, key);
  if (!kind) {
    return std::nullopt;
  }
  return symbol_by_kind()[index_of(*kind)].text;
}

}  // namespace cantus
