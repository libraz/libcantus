// Chord substitution, modal-interchange palettes and negative harmony:
// ts/src/generate/reharmony/index.ts.

#include "generate/reharmony/reharmony.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <string>
#include <utility>

#include "analyze/functional/function.h"
#include "cantus/analyze/detect.h"
#include "cantus/analyze/functional.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/spelling.h"
#include "generate/reharmony/limits.gen.h"
#include "js/math.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

constexpr int kThirdOffsets[] =
#include "generate/reharmony/third_offsets.gen.inc"
    ;

constexpr std::string_view kTypeNames[] = {"tritone", "relative", "borrowed", "chromaticMediant"};

int mod12(double value) { return pitch_class_of(value); }

/** Count the pitch classes shared between two pitch-class sets. */
int common_tone_count(const std::vector<int>& a, const std::vector<int>& b) {
  std::set<int> set(b.begin(), b.end());
  int count = 0;
  for (int pc : a) {
    count += set.count(pc) > 0 ? 1 : 0;
  }
  return count;
}

/** The plain triad quality underlying a chord's own quality. */
ChordQuality triad_quality_of(const Chord& chord) {
  std::set<int> semis;
  for (double interval : chord.intervals) {
    semis.insert(mod12(interval));
  }
  bool has_major = semis.count(4) > 0;
  bool has_minor = semis.count(3) > 0;
  if (!has_major && !has_minor) {
    return chord.quality;  // sus, power, and other non-tertian chords stand alone
  }
  if (semis.count(6) > 0 && semis.count(7) == 0) {
    return has_major ? ChordQuality::kMajB5 : ChordQuality::kDim;
  }
  if (semis.count(8) > 0 && semis.count(7) == 0) {
    return ChordQuality::kAug;
  }
  return has_major ? ChordQuality::kMaj : ChordQuality::kMin;
}

/** The diatonic triads of a key, one per scale degree. */
std::vector<Chord> diatonic_triads_of(const KeyScale& key) {
  std::size_t degrees = scale_tones_in_degree_order(key).size();
  std::vector<Chord> triads;
  for (std::size_t degree = 1; degree <= degrees; ++degree) {
    triads.push_back(diatonic_triad(static_cast<double>(degree), key));
  }
  return triads;
}

/** Whether two chords share the same root pitch class and quality. */
bool same_chord(const Chord& a, const Chord& b) {
  return mod12(a.rootPc) == mod12(b.rootPc) && a.quality == b.quality;
}

/** Reduce a spelled note to the bare letter/alter a chord records as a hint. */
PitchSpelling bare_spelling(const NoteData& note) {
  return PitchSpelling{static_cast<double>(note.letter), static_cast<double>(note.alter)};
}

/**
 * Copy a chord with `root` recorded as its root spelling, plus the key's own spelling of the bass
 * when one is set. A root spelling that no longer names the chord's pitch class, or would need more
 * than a double accidental, gives way to the key's spelling of that pitch class.
 */
Chord spelled_on_root(const Chord& chord, const NoteData& root, const NoteData& tonic,
                      const KeyScale& key) {
  bool usable = note_to_pitch_class(root) == mod12(chord.rootPc) &&
                std::abs(root.alter) <= REHARMONY_MAX_HINT_ALTER;
  Chord spelled = chord;
  spelled.rootSpelling = bare_spelling(usable ? root : spell_pitch_class(chord.rootPc, tonic, key));
  if (chord.bassPc) {
    spelled.bassSpelling = bare_spelling(spell_pitch_class(*chord.bassPc, tonic, key));
  }
  return spelled;
}

/** Copy a chord with the key's own spelling of its root and bass attached. */
Chord spelled_in_key(const Chord& chord, const NoteData& tonic, const KeyScale& key) {
  return spelled_on_root(chord, spell_pitch_class(chord.rootPc, tonic, key), tonic, key);
}

/**
 * The root spelling of a tritone substitute: the flattened supertonic of the chord the substituted
 * dominant resolves to. A pitch class the key already spells as a scale degree keeps that letter.
 */
NoteData tritone_substitute_root(const Chord& dominant, const NoteData& tonic,
                                 const KeyScale& key) {
  int substitute_root_pc = mod12(dominant.rootPc + 6);
  if (is_scale_tone(substitute_root_pc, key)) {
    return spell_pitch_class(substitute_root_pc, tonic, key);
  }
  NoteData resolution = spell_pitch_class(mod12(dominant.rootPc + 5), tonic, key);
  return transpose_note(resolution, 1);
}

struct Candidate {
  Chord chord;
  SubstitutionType type;
};

}  // namespace

std::string_view to_string(SubstitutionType type) {
  return kTypeNames[static_cast<std::size_t>(type)];
}

std::optional<SubstitutionType> parse_substitution_type(std::string_view name) {
  for (std::size_t index = 0; index < std::size(kTypeNames); ++index) {
    if (kTypeNames[index] == name) {
      return static_cast<SubstitutionType>(index);
    }
  }
  return std::nullopt;
}

std::vector<Substitution> substitute_chord(const ChordArg& chord, const KeyArg& key,
                                           const SubstituteOptions& opts) {
  // Chord and key are read once, here at the boundary.
  Chord source = to_chord_data(chord);
  ResolvedKey resolved = resolve_key(key);
  return substitute_chord_with(
      source, resolved, [] {},
      [&opts]() -> std::optional<std::vector<int>> {
        if (!opts.melodyPcs) {
          return std::nullopt;
        }
        std::vector<int> pcs;
        for (double pc : *opts.melodyPcs) {
          pcs.push_back(mod12(pc));
        }
        return pcs;
      });
}

std::vector<Substitution> substitute_chord_with(
    const Chord& source, const ResolvedKey& resolved, const std::function<void()>& settle_source,
    const std::function<std::optional<std::vector<int>>()>& read_melody_pcs) {
  // The key keeps the tonic it was named with: everything below spells from that tonic.
  const KeyScale& scale = resolved.scale;
  const NoteData& tonic = resolved.tonic;
  // The relative test counts common tones against the chord's triad, not its full pitch-class set.
  std::vector<int> original_triad =
      chord_pitch_classes(make_chord(source.rootPc, triad_quality_of(source)));
  std::vector<Candidate> candidates;

  // Tritone substitution: only for dominant-type chords.
  if (sounds_dominant_seventh(source)) {
    Chord substitute = make_chord(mod12(source.rootPc + 6), ChordQuality::kDom7);
    candidates.push_back(Candidate{
        spelled_on_root(substitute, tritone_substitute_root(source, tonic, scale), tonic, scale),
        SubstitutionType::kTritone});
  }

  // Relative: a diatonic triad a third away sharing two common tones.
  for (const Chord& triad : diatonic_triads_of(scale)) {
    int offset = mod12(triad.rootPc - source.rootPc);
    if (std::find(std::begin(kThirdOffsets), std::end(kThirdOffsets), offset) !=
            std::end(kThirdOffsets) &&
        common_tone_count(original_triad, chord_pitch_classes(triad)) == 2) {
      candidates.push_back(
          Candidate{spelled_in_key(triad, tonic, scale), SubstitutionType::kRelative});
    }
  }

  // Borrowed: a parallel-mode triad sharing the original's harmonic function. It is written the way
  // the mode it comes from writes it.
  settle_source();
  HarmonicFunction target_function = function_of(source, resolved);
  KeyScale parallel = parallel_key(scale);
  for (const Chord& triad : diatonic_triads_of(parallel)) {
    if (function_of(triad, resolved) == target_function && !is_diatonic(triad, resolved)) {
      candidates.push_back(
          Candidate{spelled_in_key(triad, tonic, parallel), SubstitutionType::kBorrowed});
    }
  }

  // Chromatic mediants: major/minor triads a third away sharing one common tone.
  for (int offset : kThirdOffsets) {
    for (ChordQuality quality : {ChordQuality::kMaj, ChordQuality::kMin}) {
      Chord mediant = make_chord(mod12(source.rootPc + offset), quality);
      if (common_tone_count(original_triad, chord_pitch_classes(mediant)) == 1 &&
          !is_diatonic(mediant, resolved)) {
        candidates.push_back(
            Candidate{spelled_in_key(mediant, tonic, scale), SubstitutionType::kChromaticMediant});
      }
    }
  }

  std::optional<std::vector<int>> melody_pcs = read_melody_pcs();
  std::set<std::pair<int, ChordQuality>> seen;
  std::vector<Substitution> results;
  for (Candidate& candidate : candidates) {
    if (same_chord(candidate.chord, source)) {
      continue;
    }
    if (!seen.insert({mod12(candidate.chord.rootPc), candidate.chord.quality}).second) {
      continue;
    }
    if (melody_pcs) {
      std::vector<int> pcs = chord_pitch_classes(candidate.chord);
      bool all = std::all_of(melody_pcs->begin(), melody_pcs->end(), [&pcs](int pc) {
        return std::find(pcs.begin(), pcs.end(), pc) != pcs.end();
      });
      if (!all) {
        continue;
      }
    }
    Substitution out;
    out.roman = chord_to_roman(candidate.chord, resolved);
    out.function = function_of(candidate.chord, resolved);
    out.chord = std::move(candidate.chord);
    out.type = candidate.type;
    results.push_back(std::move(out));
  }
  return results;
}

std::vector<BorrowedChord> modal_interchange_palette(const KeyArg& key) {
  // The key is read once, here at the boundary, and keeps the tonic it was named with.
  ResolvedKey resolved = resolve_key(key);
  const KeyScale& scale = resolved.scale;
  const NoteData& tonic = resolved.tonic;
  std::vector<BorrowedChord> palette;
  std::set<std::pair<int, ChordQuality>> seen;
  auto add = [&](const Chord& chord) {
    if (!seen.insert({mod12(chord.rootPc), chord.quality}).second) {
      return;
    }
    BorrowedChord out;
    out.chord = chord;
    out.roman = chord_to_roman(chord, resolved);
    out.source = borrowed_source(chord, resolved);
    palette.push_back(std::move(out));
  };

  KeyScale parallel = parallel_key(scale);
  for (const Chord& triad : diatonic_triads_of(parallel)) {
    if (!is_diatonic(triad, resolved) && borrowed_source(triad, resolved).has_value()) {
      add(spelled_in_key(triad, tonic, parallel));
    }
  }
  // The Neapolitan sits outside both parallel modes, so it is added explicitly, unless b2 is
  // already diatonic.
  Chord neapolitan = make_chord(mod12(scale.rootPc + 1), ChordQuality::kMaj);
  if (!is_diatonic(neapolitan, resolved)) {
    add(spelled_on_root(neapolitan, transpose_note(tonic, 1), tonic, scale));
  }
  return palette;
}

Chord negative_harmony_mirror(const ChordArg& chord, const KeyArg& key) {
  Chord source = to_chord_data(chord);
  ResolvedKey resolved = resolve_key(key);
  const KeyScale& scale = resolved.scale;
  const NoteData& tonic = resolved.tonic;
  int tonic_pc = mod12(scale.rootPc);
  auto mirror = [tonic_pc](double p) { return mod12(2 * tonic_pc + 7 - p); };
  std::vector<int> pcs;
  for (int pc : chord_pitch_classes(source)) {
    pcs.push_back(mirror(pc));
  }
  std::optional<int> bass_pc;
  if (source.bassPc) {
    bass_pc = mirror(*source.bassPc);
  }
  // Place the mirrored bass below the rest so it is recognized as the lowest note.
  std::vector<int> pitches;
  if (bass_pc) {
    pitches.push_back(*bass_pc);
    for (int pc : pcs) {
      pitches.push_back(pc + 12);
    }
  } else {
    pitches = pcs;
  }
  Nullable<Chord> detected = detect_chord_best(pitches);
  if (detected) {
    // Without an input bass the mirrored tones are octave-less, so detection may read the lowest
    // pitch class as a slash bass; restore the recognized chord to root position in that case.
    if (!bass_pc && detected->bassPc) {
      return spelled_in_key(make_chord(detected->rootPc, detected->quality), tonic, scale);
    }
    return spelled_in_key(*detected, tonic, scale);
  }
  std::optional<double> bass;
  if (bass_pc) {
    bass = *bass_pc;
  }
  return spelled_in_key(make_chord(mirror(source.rootPc), source.quality, bass), tonic, scale);
}

}  // namespace cantus
