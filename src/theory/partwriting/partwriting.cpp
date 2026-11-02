// Grade a finished four-part exercise: ts/src/theory/partwriting/index.ts.

#include "cantus/theory/partwriting.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <set>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/theory/counterpoint.h"
#include "cantus/theory/spelling.h"
#include "core/validation/validation.h"
#include "js/number.h"
#include "theory/counterpoint/internal.h"
#include "theory/partwriting/cross_relation.h"
#include "theory/partwriting/internal.h"
#include "theory/tendency/tendency.h"
#include "theory/voicing/satb.h"

namespace cantus {

namespace {

constexpr std::array<std::string_view, 18> kViolationKinds = {
    "parallelFifth",
    "parallelOctave",
    "hiddenPerfect",
    "crossRelation",
    "voiceCrossing",
    "overlap",
    "spacing",
    "range",
    "unresolvedLeadingTone",
    "unresolvedSeventh",
    "augmentedMelodicInterval",
    "wrongRhythmicRatio",
    "unpreparedDissonance",
    "unresolvedSuspension",
    "illegalLeap",
    "battuta",
    "missingCadence",
    "melodicShape",
};

using Kind = PartWritingViolationKind;

/** A note without its octave, for naming it in a rationale (`bare`). */
NoteData bare(const NoteData& note) { return NoteData{note.letter, note.alter, std::nullopt}; }

/** The sounding pitch of a spelled note, located for the error message (`midiOf`). */
int midi_of(const NoteData& note, std::size_t index, std::size_t voice) {
  if (!note.octave) {
    throw InvalidInputError("voicings[" + index_text(index) + "][" + index_text(voice) +
                            "] must carry an octave");
  }
  return note_to_midi(note);
}

/** One chord of the exercise, and everything the rules read off it (`Moment`). */
struct Moment {
  const SpelledVoicing* notes;
  std::vector<int> pitches;
  const Chord* chord;
  int index;
};

/** The rules judged inside one chord: crossing, spacing, and range (`verticalViolations`). */
std::vector<PartWritingViolation> vertical_violations(const Moment& moment,
                                                      const std::vector<VoiceRange>* ranges,
                                                      double max_spacing) {
  std::vector<PartWritingViolation> found;
  const std::vector<int>& pitches = moment.pitches;
  int index = moment.index;
  for (std::size_t voice = 1; voice < pitches.size(); ++voice) {
    int upper = pitches[voice];
    int lower = pitches[voice - 1];
    std::vector<int> pair = {static_cast<int>(voice) - 1, static_cast<int>(voice)};
    if (creates_voice_crossing(upper, lower)) {
      found.push_back(violation(Kind::kVoiceCrossing, pair, index, index,
                                "The upper voice lies below the voice beneath it"));
    }
    // The bass-tenor pair is conventionally allowed to open up further than the upper voices, so
    // the spacing rule starts one pair above it.
    if (voice >= 2 && exceeds_spacing(upper, lower, max_spacing)) {
      found.push_back(violation(Kind::kSpacing, pair, index, index,
                                "Adjacent upper voices lie more than " +
                                    js::to_string(max_spacing) + " semitones apart"));
    }
  }
  if (ranges == nullptr) {
    return found;
  }
  for (std::size_t voice = 0; voice < pitches.size() && voice < ranges->size(); ++voice) {
    const VoiceRange& range = (*ranges)[voice];
    if (pitches[voice] < range.min || pitches[voice] > range.max) {
      found.push_back(violation(Kind::kRange, {static_cast<int>(voice)}, index, index,
                                "The voice sings outside its range"));
    }
  }
  return found;
}

/** Two consecutive chords of the exercise, the key they sound in, and the chords on either side
 * (`Transition`). */
struct Transition {
  const Moment& from;
  const Moment& to;
  KeyScale key;
  const Moment* before;
  const Moment* after;
};

/** The rules judged between two voices moving together: parallels and overlap
 * (`pairViolations`). */
std::vector<PartWritingViolation> pair_violations(const Transition& transition) {
  std::vector<PartWritingViolation> found;
  const Moment& from = transition.from;
  const Moment& to = transition.to;
  std::size_t voices = std::min<std::size_t>(from.pitches.size(), to.pitches.size());
  for (std::size_t lower = 0; lower < voices; ++lower) {
    for (std::size_t upper = lower + 1; upper < voices; ++upper) {
      int upper_prev = from.pitches[upper];
      int upper_cur = to.pitches[upper];
      int lower_prev = from.pitches[lower];
      int lower_cur = to.pitches[lower];
      std::vector<int> pair = {static_cast<int>(lower), static_cast<int>(upper)};
      if (creates_parallel_perfect(upper_prev, upper_cur, lower_prev, lower_cur)) {
        bool fifth = pitch_class_of(std::abs(upper_cur - lower_cur)) == 7;
        found.push_back(violation(fifth ? Kind::kParallelFifth : Kind::kParallelOctave, pair,
                                  from.index, to.index,
                                  fifth ? "The two voices move into consecutive perfect fifths"
                                        : "The two voices move into consecutive perfect octaves"));
      }
      if (upper == lower + 1 &&
          creates_voice_overlap(upper_prev, upper_cur, lower_prev, lower_cur)) {
        found.push_back(violation(Kind::kOverlap, pair, from.index, to.index,
                                  "The voice moves past where its neighbour just was"));
      }
    }
  }
  // The hidden perfect is judged on the outer voices alone, where the bare fifth or octave is
  // exposed; between inner voices it is covered by the others.
  if (voices >= 2) {
    int bass_prev = from.pitches[0];
    int bass_cur = to.pitches[0];
    int top_prev = from.pitches[voices - 1];
    int top_cur = to.pitches[voices - 1];
    if (creates_hidden_parallel_perfect(top_prev, top_cur, bass_prev, bass_cur)) {
      found.push_back(
          violation(Kind::kHiddenPerfect, {0, static_cast<int>(voices) - 1}, from.index, to.index,
                    "The outer voices reach a perfect interval by similar motion, the upper one "
                    "by leap"));
    }
  }
  return found;
}

/** Cross relations reported as broken rules (`crossRelationViolations`). */
std::vector<PartWritingViolation> cross_relation_violations(const Transition& transition) {
  const Moment& from = transition.from;
  const Moment& to = transition.to;
  ChromaticContext context;
  context.before = transition.before != nullptr ? transition.before->notes : nullptr;
  context.after = transition.after != nullptr ? transition.after->chord : nullptr;
  std::vector<PartWritingViolation> found;
  for (const CrossRelation& clash :
       cross_relations(ChromaticMoment{*from.notes, *from.chord},
                       ChromaticMoment{*to.notes, *to.chord}, transition.key, context)) {
    found.push_back(violation(Kind::kCrossRelation, {clash.earlierVoice, clash.laterVoice},
                              from.index, to.index,
                              format_note(bare(clash.earlier)) + " is contradicted by " +
                                  format_note(bare(clash.later)) + " in another voice"));
  }
  return found;
}

/** The rules judged along one line: augmented melodic intervals, and the tendency tones that must
 * go somewhere in particular (`melodicViolations`). */
std::vector<PartWritingViolation> melodic_violations(const Transition& transition) {
  std::vector<PartWritingViolation> found;
  const Moment& from = transition.from;
  const Moment& to = transition.to;
  const KeyScale& key = transition.key;
  std::optional<int> seventh_pc = seventh_pc_of(*from.chord);
  std::vector<int> next_list = chord_pitch_classes(*to.chord);
  std::set<int> next_pcs(next_list.begin(), next_list.end());
  int leading_tone_pc = leading_tone_pc_of(key);
  int tonic_pc = pitch_class_of(key.rootPc);
  std::size_t voices = std::min<std::size_t>(from.notes->size(), to.notes->size());
  for (std::size_t voice = 0; voice < voices; ++voice) {
    const NoteData& earlier = (*from.notes)[voice];
    const NoteData& later = (*to.notes)[voice];
    int earlier_pitch = from.pitches[voice];
    int later_pitch = to.pitches[voice];
    SpelledInterval interval = spelled_interval(earlier, later);
    std::vector<int> line = {static_cast<int>(voice)};
    if (is_augmented_spelled_interval(interval)) {
      found.push_back(
          violation(Kind::kAugmentedMelodicInterval, line, from.index, to.index,
                    "The voice moves by an augmented " + interval_word(interval.number)));
    }
    int earlier_pc = note_to_pitch_class(earlier);
    if (seventh_pc && earlier_pc == *seventh_pc && next_pcs.count(earlier_pc) == 0 &&
        !is_descending_step(interval)) {
      found.push_back(violation(Kind::kUnresolvedSeventh, line, from.index, to.index,
                                "The chordal seventh does not fall by step"));
    }
    bool inner = !is_outer_voice(static_cast<int>(voice), *from.notes) &&
                 !is_outer_voice(static_cast<int>(voice), *to.notes);
    if (earlier_pc == leading_tone_pc && is_functioning_leading_tone(*from.chord, key) &&
        next_pcs.count(tonic_pc) != 0 && next_pcs.count(earlier_pc) == 0 &&
        !is_leading_tone_resolution(earlier_pitch, later_pitch, key) &&
        !(inner && is_frustrated_leading_tone(earlier_pitch, later_pitch, *to.chord))) {
      found.push_back(violation(Kind::kUnresolvedLeadingTone, line, from.index, to.index,
                                "The leading tone does not rise to the tonic"));
    }
  }
  return found;
}

}  // namespace

std::string_view to_string(PartWritingViolationKind kind) {
  return kViolationKinds[static_cast<std::size_t>(kind)];
}

std::optional<PartWritingViolationKind> parse_part_writing_violation_kind(std::string_view name) {
  auto it = std::find(kViolationKinds.begin(), kViolationKinds.end(), name);
  if (it == kViolationKinds.end()) {
    return std::nullopt;
  }
  return static_cast<PartWritingViolationKind>(it - kViolationKinds.begin());
}

SpelledVoicing spell_voicing(const std::vector<double>& voicing, const Chord& chord,
                             const KeyArg& key) {
  assert_finite_number(chord.rootPc, "chord.rootPc");
  // Read whole rather than reduced: a voicing in Ab minor is written on flats, and a key handed
  // in spelled that way must keep its spelling here.
  ResolvedKey resolved = resolve_key(key);
  SpellingContext context;
  context.chord = chord;
  SpelledVoicing out;
  for (double pitch : voicing) {
    out.push_back(spell_pitch(pitch, resolved.tonic, resolved.scale, context));
  }
  return out;
}

std::vector<PartWritingViolation> check_part_writing(const std::vector<SpelledVoicing>& voicings,
                                                     const std::vector<Chord>& chords,
                                                     const KeyArg& key_like,
                                                     const PartWritingOptions& opts) {
  KeyScale key = to_key_scale(key_like);
  if (voicings.size() != chords.size()) {
    throw InvalidInputError("checkPartWriting needs one chord per voicing; received " +
                            js::to_string(voicings.size()) + " voicings and " +
                            js::to_string(chords.size()) + " chords");
  }
  // The limits are resolved before any rule runs: a NaN limit would silently switch the spacing
  // rule off, and ranges too short for the texture would leave the top voices unjudged.
  VoicingOptions limits;
  limits.maxSpacing = opts.maxSpacing;
  double max_spacing = resolve_max_spacing(limits);
  std::size_t voice_count = 0;
  for (const SpelledVoicing& voicing : voicings) {
    voice_count = std::max<std::size_t>(voice_count, voicing.size());
  }
  std::optional<std::vector<VoiceRange>> ranges;
  if (!opts.ranges) {
    // Four voices are the SATB exercise the default ranges were written for; any other count has
    // no conventional compass, so an unasked-for range check would invent one.
    if (voice_count == 4) {
      ranges = SATB_RANGES;
    }
  } else {
    limits.ranges = opts.ranges;
    ranges = resolve_ranges(limits);
    if (ranges->size() < voice_count) {
      throw InvalidInputError("checkPartWriting needs one range per voice; received " +
                              js::to_string(ranges->size()) + " ranges for " +
                              js::to_string(voice_count) + " voices");
    }
  }

  std::vector<Moment> moments;
  for (std::size_t index = 0; index < voicings.size(); ++index) {
    Moment moment{&voicings[index], {}, &chords[index], static_cast<int>(index)};
    for (std::size_t voice = 0; voice < voicings[index].size(); ++voice) {
      moment.pitches.push_back(midi_of(voicings[index][voice], index, voice));
    }
    moments.push_back(std::move(moment));
  }

  std::vector<PartWritingViolation> violations;
  const std::vector<VoiceRange>* range_rule = ranges ? &*ranges : nullptr;
  for (std::size_t position = 0; position < moments.size(); ++position) {
    const Moment& moment = moments[position];
    if (position > 0) {
      Transition transition{moments[position - 1], moment, key,
                            position > 1 ? &moments[position - 2] : nullptr,
                            position + 1 < moments.size() ? &moments[position + 1] : nullptr};
      append(violations, pair_violations(transition));
      append(violations, cross_relation_violations(transition));
      append(violations, melodic_violations(transition));
    }
    append(violations, vertical_violations(moment, range_rule, max_spacing));
  }
  return violations;
}

}  // namespace cantus
