// Lead-sheet chord symbol parsing and formatting: ts/src/theory/symbol/index.ts.

#include "theory/symbol/symbol.h"

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

#include "cantus/theory/symbol.h"
#include "core/errors/errors.h"
#include "core/validation/validation.h"
#include "js/utf16.h"
#include "theory/chord/chord.h"
#include "theory/chord/spec.h"
#include "theory/symbol/grammar.h"
#include "theory/symbol/spelling.h"
#include "theory/symbol/suffix.h"

namespace cantus {

namespace {

/** Replace every occurrence of `from` in `text` (`replaceAll`). */
void replace_all(std::string& text, std::string_view from, std::string_view to) {
  std::size_t at = 0;
  while ((at = text.find(from, at)) != std::string::npos) {
    text.replace(at, from.size(), to);
    at += to.size();
  }
}

/** The text of a chord symbol with its typographic glyphs written the way the grammar reads. */
std::string plain_symbol(std::string_view text) {
  std::string trimmed = js::trim(text);
  replace_all(trimmed, "♯", "#");
  replace_all(trimmed, "♭", "b");
  replace_all(trimmed, "\U0001D12A", "x");
  replace_all(trimmed, "\U0001D12B", "bb");
  // Both delta glyphs in circulation stand for the same major seventh.
  replace_all(trimmed, "∆", "Δ");
  return trimmed;
}

}  // namespace

ParseResult<Chord> try_parse_chord_symbol(std::string_view text, const NoteNameOptions& opts) {
  try {
    NoteNameSystem system = opts.system.value_or(kDefaultSystem);
    std::string trimmed = plain_symbol(text);
    std::vector<RootSplit> splits = root_splits(trimmed, system);
    if (splits.empty()) {
      throw InvalidInputError("Invalid chord symbol: " +
                              describe_rejected(json::Value(std::string(text))));
    }
    for (const RootSplit& split : splits) {
      if (std::optional<Chord> chord = chord_after_root(split.root, split.rest, system)) {
        return ParseResult<Chord>::success(std::move(*chord));
      }
    }
    throw InvalidInputError("Unrecognized chord quality: " +
                            describe_rejected(json::Value(std::string(text))));
  } catch (...) {
    return parse_failure<Chord>();
  }
}

Chord parse_chord_symbol(std::string_view text, const NoteNameOptions& opts) {
  return try_parse_chord_symbol(text, opts).unwrap();
}

std::string format_chord_symbol(const ChordArg& chord, const ChordSymbolOptions& opts) {
  // A chord rebuilt from JSON or arrived at through arithmetic can carry a non-finite root.
  Chord data = to_chord_data(chord);
  NoteNameSystem system = opts.system.value_or(kDefaultSystem);
  std::optional<bool> flats = opts.flats;
  int root_pc = pitch_class_of(data.rootPc);
  std::optional<NoteData> root_hint = hint_for(data.rootSpelling, root_pc);
  NoteData root_spelling = root_spelling_for(root_pc, root_hint, flats);
  std::string suffix = spec_suffix(chord_spec_of(data));
  std::string symbol = symbol_name(root_spelling, system) + suffix;
  if (data.bassPc && pitch_class_of(*data.bassPc) != root_pc) {
    int bass_pc = pitch_class_of(*data.bassPc);
    std::optional<NoteData> bass_hint = hint_for(data.bassSpelling, bass_pc);
    // How the chord itself writes the tone standing in the bass, when the bass is one of its tones.
    ChordPitchClassOptions without_bass;
    without_bass.includeBass = false;
    std::vector<int> tone_pcs = chord_pitch_classes(data, without_bass);
    std::optional<NoteData> own_spelling;
    if (std::find(tone_pcs.begin(), tone_pcs.end(), bass_pc) != tone_pcs.end()) {
      int degree = degree_of_interval(pitch_class_of(bass_pc - root_pc), data).value_or(1);
      own_spelling = spelling_above(root_spelling, degree - 1, bass_pc);
    }
    std::string bass_name;
    if (root_hint && bass_hint) {
      bass_name = symbol_name(carried_bass(*bass_hint, *root_hint, root_spelling,
                                           flats.value_or(root_spelling.alter < 0),
                                           [&](const NoteData& spelling) {
                                             return own_spelling &&
                                                    spelling.letter == own_spelling->letter &&
                                                    spelling.alter == own_spelling->alter;
                                           }),
                              system);
    } else {
      bass_name = pitch_class_name(bass_pc, bass_hint, system, flats, root_spelling.alter < 0);
    }
    symbol += "/" + bass_name;
  }
  return symbol;
}

ChordSpellings transpose_chord_spellings(const ChordSpellings& spellings, double semitones,
                                         std::optional<bool> flats) {
  auto bare = [](const NoteData& note) { return NoteData{note.letter, note.alter, std::nullopt}; };
  auto by_letter = [&](const std::optional<PitchSpelling>& spelling) -> std::optional<NoteData> {
    if (!spelling) {
      return std::nullopt;
    }
    return bare(transpose_note(spelling_note(*spelling), semitones));
  };
  std::optional<NoteData> moved_root = by_letter(spellings.rootSpelling);
  std::optional<NoteData> moved_bass = by_letter(spellings.bassSpelling);
  std::optional<NoteData> root;
  std::optional<NoteData> bass;
  if (spellings.rootSpelling) {
    root = spelling_note(*spellings.rootSpelling);
  }
  if (spellings.bassSpelling) {
    bass = spelling_note(*spellings.bassSpelling);
  }
  std::optional<NoteData> side;
  for (const std::optional<NoteData>* candidate : {&moved_root, &root, &moved_bass, &bass}) {
    if (*candidate && (*candidate)->alter != 0) {
      side = **candidate;
      break;
    }
  }
  bool prefer_flats = flats.value_or(side && side->alter < 0);
  bool octave_only = pitch_class_of(semitones) == 0;
  auto plain_name = [](const NoteData& spelling, bool as_flat) {
    return plain_spelling(note_to_pitch_class(spelling), as_flat);
  };
  auto writable = [&](const NoteData& spelling) {
    return octave_only || is_written_spelling(spelling) ? spelling
                                                        : plain_name(spelling, prefer_flats);
  };
  // Whether a candidate root leaves a bass the chart can still write, on the side asked for.
  auto carries_bass = [&](const NoteData& candidate) {
    if (!root || !bass || octave_only || !is_written_spelling(*bass)) {
      return true;
    }
    NoteData carried = by_same_step(*bass, *root, candidate);
    return is_written_spelling(carried) && on_accidental_side(carried, flats);
  };
  ChordSpellings moved;
  std::optional<NoteData> moved_root_spelling;
  if (moved_root) {
    bool asked = flats && !octave_only && !is_written_spelling(*moved_root);
    std::vector<NoteData> candidates;
    if (octave_only || is_written_spelling(*moved_root)) {
      candidates.push_back(*moved_root);
    }
    candidates.push_back(plain_name(*moved_root, prefer_flats));
    if (asked) {
      candidates.push_back(*moved_root);
    }
    candidates.push_back(plain_name(*moved_root, !prefer_flats));
    auto found = std::find_if(candidates.begin(), candidates.end(), carries_bass);
    moved_root_spelling =
        found != candidates.end() ? *found : plain_name(*moved_root, prefer_flats);
    moved.rootSpelling = bare_spelling(*moved_root_spelling);
  }
  // The one step the whole chord moves by: the root as written to the root as it comes out.
  std::optional<SpelledInterval> step;
  if (root && moved_root_spelling) {
    step = spelled_interval(*root, *moved_root_spelling);
  }
  auto by_step = [&](const PitchSpelling& spelling) {
    NoteData note = spelling_note(spelling);
    return bare(step ? transpose_by_interval(note, *step) : transpose_note(note, semitones));
  };
  if (spellings.bassSpelling) {
    moved.bassSpelling = bare_spelling(writable(by_step(*spellings.bassSpelling)));
  }
  if (spellings.toneSpellings) {
    std::vector<PitchSpelling> tones;
    for (const PitchSpelling& tone : *spellings.toneSpellings) {
      tones.push_back(bare_spelling(by_step(tone)));
    }
    moved.toneSpellings = std::move(tones);
  }
  return moved;
}

std::string transpose_chord_symbol(std::string_view text, double semitones,
                                   const ChordSymbolOptions& opts) {
  assert_finite_semitones(semitones);
  NoteNameOptions read;
  read.system = opts.system;
  Chord chord = parse_chord_symbol(text, read);
  Chord transposed = chord;
  transposed.rootPc = pitch_class_of(chord.rootPc + semitones);
  if (chord.bassPc) {
    transposed.bassPc = pitch_class_of(*chord.bassPc + semitones);
  }
  ChordSpellings carried{chord.rootSpelling, chord.bassSpelling, chord.toneSpellings};
  ChordSpellings spellings = transpose_chord_spellings(carried, semitones, opts.flats);
  if (spellings.rootSpelling) {
    transposed.rootSpelling = spellings.rootSpelling;
  }
  if (spellings.bassSpelling) {
    transposed.bassSpelling = spellings.bassSpelling;
  }
  if (spellings.toneSpellings) {
    transposed.toneSpellings = spellings.toneSpellings;
  }
  return format_chord_symbol(transposed, opts);
}

}  // namespace cantus
