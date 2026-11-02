// Line spelling: ts/src/analyze/spelling/index.ts.

#include "analyze/spelling/spelling.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/spelling.h"
#include "js/math.h"
#include "theory/spelling/spelling.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

/** CONVENTIONAL_LETTER_STEPS: the letter distances an interval of each size is written with. */
const std::vector<std::vector<int>>& conventional_letter_steps() {
  static const std::vector<std::vector<int>> steps =
#include "analyze/spelling/conventional_letter_steps.gen.inc"
      ;
  return steps;
}

/** The octave that reproduces `pitch` from a letter and its alteration (`octaveFor`). */
double octave_for(double pitch, int letter, int alter) {
  return (pitch - natural_pitch_class_of(letter) - alter) / 12 - 1;
}

/** Whether two spellings name the same letter with the same alteration. */
bool same_spelling(const NoteData& a, const NoteData& b) {
  return a.letter == b.letter && a.alter == b.alter;
}

/** Every spelling of `pitch` within a double accidental, `preferred` first (`candidatesFor`). */
std::vector<NoteData> candidates_for(int pitch, const NoteData& preferred) {
  int pc = pitch_class_of(pitch);
  std::vector<NoteData> rest;
  for (int letter = 0; letter < 7; ++letter) {
    int alter = alter_for(letter, pc);
    if (std::abs(alter) > SPELLING_MAX_ALTER || letter == preferred.letter) {
      continue;
    }
    rest.push_back(NoteData{static_cast<double>(letter), static_cast<double>(alter),
                            octave_for(pitch, letter, alter)});
  }
  std::stable_sort(rest.begin(), rest.end(), [](const NoteData& a, const NoteData& b) {
    int by_alter = std::abs(a.alter) - std::abs(b.alter);
    return (by_alter != 0 ? by_alter : a.letter - b.letter) < 0;
  });
  std::vector<NoteData> out;
  out.push_back(NoteData{preferred.letter, preferred.alter,
                         octave_for(pitch, preferred.letter, preferred.alter)});
  out.insert(out.end(), rest.begin(), rest.end());
  return out;
}

/**
 * The chord's own spelling of a pitch class, or nullopt when the chord does not sound it
 * (`chordSpellingOf`).
 */
std::optional<NoteData> chord_spelling_of(int pc, const Chord& chord, const NoteData& tonic,
                                          const KeyScale& key) {
  for (const NoteData& tone : spell_chord(chord, tonic, key)) {
    if (pitch_class_of(natural_pitch_class_of(tone.letter) + tone.alter) == pc) {
      return tone;
    }
  }
  if (!chord.bassPc || pitch_class_of(*chord.bassPc) != pc) {
    return std::nullopt;
  }
  const std::optional<PitchSpelling>& hint = chord.bassSpelling;
  if (hint && pitch_class_of(natural_pitch_class_of(hint->letter) + hint->alter) == pc) {
    return NoteData{static_cast<double>(diatonic_letter_of(hint->letter)), hint->alter,
                    std::nullopt};
  }
  return spell_pitch_class(pc, tonic, key);
}

/**
 * The key's spelling of a pitch class it counts as its own: a scale tone, or in a minor key the
 * raised sixth and seventh of its melodic and harmonic forms; nullopt for a chromatic one
 * (`keyToneSpelling`).
 */
std::optional<NoteData> key_tone_spelling(int pc, const NoteData& tonic, const KeyScale& key) {
  bool own =
      is_scale_tone(pc, key) || (cadences_through_raised_seventh(key) &&
                                 is_scale_tone(pc, KeyScale{key.rootPc, MELODIC_MINOR_MASK}));
  if (!own) {
    return std::nullopt;
  }
  return spell_pitch_class(pc, tonic, key);
}

/** One note of the line, with the spellings open to it and what each costs (`LineState`). */
struct LineState {
  int pitch = 0;
  /** True when the key does not already spell this pitch, so direction may decide. */
  bool chromatic = false;
  /** The key's spelling of the pitch when it is one of the key's own tones. */
  std::optional<NoteData> key_tone;
  std::vector<NoteData> candidates;
  std::vector<double> emissions;
  /** The spelling the note-by-note path would have chosen, used as the fallback. */
  NoteData reference;
};

/** Weigh every spelling open to one note against what the chord and the key say (`stateFor`). */
LineState state_for(int pitch, const std::optional<Chord>& chord, const NoteData& tonic,
                    const KeyScale& key) {
  int pc = pitch_class_of(pitch);
  std::optional<NoteData> from_chord;
  if (chord) {
    from_chord = chord_spelling_of(pc, *chord, tonic, key);
  }
  std::optional<NoteData> key_tone = key_tone_spelling(pc, tonic, key);
  NoteData reference = from_chord ? *from_chord
                       : key_tone ? *key_tone
                                  : spell_pitch_class(pc, tonic, key);
  double mismatch = from_chord ? CHORD_MISMATCH : (key_tone ? SCALE_TONE_MISMATCH : KEY_MISMATCH);
  LineState state;
  state.pitch = pitch;
  state.chromatic = !key_tone;
  state.key_tone = key_tone;
  state.candidates = candidates_for(pitch, reference);
  for (const NoteData& candidate : state.candidates) {
    state.emissions.push_back((same_spelling(candidate, reference) ? 0 : mismatch) +
                              ACCIDENTAL * std::abs(candidate.alter));
  }
  state.reference = std::move(reference);
  return state;
}

/** A spelling's position on the diatonic ladder, octave included (`diatonicIndex`). */
double diatonic_index(const NoteData& note) {
  return note.letter + 7 * (note.octave ? *note.octave : 0);
}

/** What the letters of a melodic interval cost when they do not match the sounding one. */
double letter_step_cost(const NoteData& from, const NoteData& to, int semitones) {
  double written = diatonic_index(to) - diatonic_index(from);
  int size = std::abs(semitones);
  int octaves = size / 12;
  int direction = semitones < 0 ? -1 : 1;
  double deviation = std::numeric_limits<double>::infinity();
  for (int steps : conventional_letter_steps()[static_cast<std::size_t>(size % 12)]) {
    deviation = js::min(deviation, std::fabs(written - direction * (octaves * 7 + steps)));
  }
  if (!std::isfinite(deviation)) {
    return 0;
  }
  return LETTER_STEP_DEVIATION * js::min(deviation, MAX_COUNTED_DEVIATION);
}

/** What an accidental costs for leaning the wrong way in a stepwise line (`directionCost`). */
double direction_cost(const NoteData& note, bool chromatic, int semitones) {
  if (!chromatic || semitones == 0 || std::abs(semitones) > MAX_STEP) {
    return 0;
  }
  bool rising = semitones > 0;
  return (rising && note.alter < 0) || (!rising && note.alter > 0) ? AGAINST_DIRECTION : 0;
}

/**
 * The cost of following one spelling with another (`transitionCost`); two of the key's own tones
 * spelled as the key spells them cost nothing for their letters.
 */
double transition_cost(const LineState& from, const NoteData& source, const LineState& to,
                       const NoteData& target) {
  int semitones = to.pitch - from.pitch;
  bool key_interval = from.key_tone && to.key_tone && same_spelling(source, *from.key_tone) &&
                      same_spelling(target, *to.key_tone);
  return (key_interval ? 0 : letter_step_cost(source, target, semitones)) +
         direction_cost(target, to.chromatic, semitones) +
         direction_cost(source, from.chromatic, semitones);
}

}  // namespace

std::vector<NoteData> spell_line(const std::vector<NoteEvent>& notes,
                                 const Nullable<ChordTimeline>& timeline, const KeyArg& key,
                                 const SpellLineOptions& opts) {
  ChordLookup lookup;
  if (timeline) {
    lookup = [&timeline](double beat) -> std::optional<Chord> {
      Nullable<Chord> chord = timeline->at(beat);
      if (!chord) {
        return std::nullopt;
      }
      return *chord;
    };
  }
  return spell_line_over(notes, lookup, key, opts);
}

std::vector<NoteData> spell_line_over(const std::vector<NoteEvent>& notes,
                                      const ChordLookup& chord_at, const KeyArg& key,
                                      const SpellLineOptions& opts) {
  // Read whole rather than reduced: a line in Ab minor is written on flats.
  ResolvedKey resolved = resolve_key(key);
  KeyScale scale = resolved.scale;
  std::optional<NoteData> given;
  if (opts.tonic) {
    given = to_note_data(*opts.tonic);
  }
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = opts.budget;
  assert_note_events(notes, "line notes", note_options);
  // The dynamic program compares every spelling of a note with every spelling of the one before
  // it, so the work is bounded before any of it is done.
  assert_generation_budget(
      static_cast<double>(notes.size()) * SPELLINGS_PER_PITCH * SPELLINGS_PER_PITCH,
      "line spelling states", opts.budget);
  if (given) {
    assert_tonic_of(*given, scale, "spellLine");
  }
  if (notes.empty()) {
    return {};
  }
  NoteData tonic = given ? *given : resolved.tonic;
  std::vector<LineState> states;
  for (const NoteEvent& note : notes) {
    std::optional<Chord> chord;
    if (chord_at) {
      chord = chord_at(note.startBeat);
    }
    states.push_back(state_for(note.pitch, chord, tonic, scale));
  }

  // Viterbi across the line: `costs` holds the cheapest path reaching each spelling of the current
  // note, and `back` remembers which spelling of the previous note that path came through.
  std::vector<double> costs;
  const LineState* previous = nullptr;
  std::vector<std::vector<std::size_t>> back;
  for (const LineState& current : states) {
    if (previous == nullptr) {
      costs = current.emissions;
      back.emplace_back(current.candidates.size(), 0);
      previous = &current;
      continue;
    }
    std::vector<double> reached;
    std::vector<std::size_t> chosen;
    for (std::size_t target = 0; target < current.candidates.size(); ++target) {
      double best = std::numeric_limits<double>::infinity();
      std::size_t best_source = 0;
      for (std::size_t source = 0; source < previous->candidates.size(); ++source) {
        double total = costs[source] + transition_cost(*previous, previous->candidates[source],
                                                       current, current.candidates[target]);
        if (total < best) {
          best = total;
          best_source = source;
        }
      }
      reached.push_back(best + current.emissions[target]);
      chosen.push_back(best_source);
    }
    costs = std::move(reached);
    back.push_back(std::move(chosen));
    previous = &current;
  }

  std::size_t cursor = 0;
  for (std::size_t index = 0; index < costs.size(); ++index) {
    if (costs[index] < costs[cursor]) {
      cursor = index;
    }
  }
  std::vector<std::size_t> picked(states.size(), 0);
  for (std::size_t index = states.size(); index-- > 0;) {
    picked[index] = cursor;
    cursor = back[index][cursor];
  }
  std::vector<NoteData> out;
  for (std::size_t index = 0; index < states.size(); ++index) {
    out.push_back(states[index].candidates[picked[index]]);
  }
  return out;
}

}  // namespace cantus
