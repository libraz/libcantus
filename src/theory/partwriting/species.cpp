// Mark a two-voice species counterpoint exercise: ts/src/theory/partwriting/species.ts.

#include <algorithm>
#include <cmath>
#include <iterator>
#include <limits>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/interval.h"
#include "cantus/theory/counterpoint.h"
#include "cantus/theory/partwriting.h"
#include "core/meter/limits.gen.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "theory/counterpoint/internal.h"
#include "theory/partwriting/internal.h"
#include "theory/partwriting/limits.gen.h"

namespace cantus {

namespace {

using Kind = PartWritingViolationKind;
using Violations = std::vector<PartWritingViolation>;

struct SpeciesRatio {
  std::string_view name;
  int ratio;
};

/** Notes of counterpoint per cantus-firmus note, by species. */
constexpr SpeciesRatio kSpeciesRatio[] =
#include "theory/partwriting/species_ratio.gen.inc"
    ;

int ratio_of(int species) {
  std::string name = js::to_string(species);
  for (const SpeciesRatio& row : kSpeciesRatio) {
    if (row.name == name) {
      return row.ratio;
    }
  }
  return 0;
}

/**
 * One counterpoint note against one cantus-firmus note. A note still sounding when the next
 * cantus-firmus note is struck meets both, and so has one entry per measure it sounds in: the
 * first struck, the rest held.
 */
struct Entry {
  /** The counterpoint note itself. */
  NoteData note;
  /** Its index in the counterpoint array. */
  int index = 0;
  /** Whether the note is sounding on from an earlier attack rather than being struck here. */
  bool held = false;
  /** The cantus-firmus note sounding under it. */
  NoteData against;
  /** Index of that cantus-firmus note. */
  int againstIndex = 0;
  /** Whether the note falls on the downbeat of its measure. */
  bool downbeat = false;
  /** The interval between the two voices, read from the lower note upward. */
  SpelledInterval interval;
  /** How that interval sounds in two-voice counterpoint. */
  ConsonanceClass consonance = ConsonanceClass::kPerfectConsonance;
};

/** Mean sounding pitch of a line, for deciding which voice lies above (`meanPitch`). */
double mean_pitch(const std::vector<NoteData>& notes) {
  if (notes.empty()) {
    return 0;
  }
  double sum = 0;
  for (const NoteData& note : notes) {
    sum += note_to_midi(note);
  }
  return sum / static_cast<double>(notes.size());
}

/** Note lengths implied by the species when the caller gives none (`impliedDurations`). */
std::vector<double> implied_durations(std::size_t count, double measures, double ratio) {
  double full = ratio * js::max(measures - 1, 0);
  double closing = js::max(static_cast<double>(count) - full, 1);
  std::vector<double> out;
  for (std::size_t index = 0; index < count; ++index) {
    out.push_back(static_cast<double>(index) < full ? 1 / ratio : 1 / closing);
  }
  return out;
}

/** Whether a melodic interval is a diatonic step (`isStep`). */
bool is_step(const SpelledInterval& interval) { return interval.number == 2; }

/** The direction a melodic interval moves: 1 up, -1 down, 0 for a repetition (`direction`). */
double direction(const SpelledInterval& interval) { return js::sign(interval.semitones); }

/** Whether two spelled notes are the same note, so a tie joins them (`sameNote`). */
bool same_note(const NoteData& a, const NoteData& b) {
  return a.letter == b.letter && a.alter == b.alter && a.octave == b.octave;
}

/** Whether a dissonance is passed through: approached and left by step in one direction, or by
 * step and back (`isPassedThrough`). */
bool is_passed_through(const std::vector<Entry>& entries, std::size_t position, int species) {
  if (position == 0 || position + 1 >= entries.size()) {
    return false;
  }
  const Entry& previous = entries[position - 1];
  const Entry& current = entries[position];
  const Entry& next = entries[position + 1];
  SpelledInterval incoming = spelled_interval(previous.note, current.note);
  SpelledInterval outgoing = spelled_interval(current.note, next.note);
  if (!is_step(incoming) || !is_step(outgoing)) {
    return false;
  }
  if (direction(incoming) == direction(outgoing)) {
    return true;
  }
  return same_note(previous.note, next.note) && (species == 3 || species == 5);
}

/** Whether a melodic interval leaps a third, the only leap the figures write (`isThird`). */
bool is_third(const SpelledInterval& interval) { return interval.number == 3; }

/** The four entries of a figure starting at a position, when the line has them (`figureAt`). */
const Entry* figure_at(const std::vector<Entry>& entries, long start) {
  if (start < 0 || static_cast<std::size_t>(start) + 3 >= entries.size()) {
    return nullptr;
  }
  return &entries[static_cast<std::size_t>(start)];
}

/** Whether four notes spell the *nota cambiata* (`isCambiata`). */
bool is_cambiata(const std::vector<Entry>& entries, long start) {
  const Entry* figure = figure_at(entries, start);
  if (figure == nullptr) {
    return false;
  }
  if (figure[0].consonance == ConsonanceClass::kDissonance ||
      figure[2].consonance == ConsonanceClass::kDissonance) {
    return false;
  }
  SpelledInterval approach = spelled_interval(figure[0].note, figure[1].note);
  SpelledInterval leap = spelled_interval(figure[1].note, figure[2].note);
  SpelledInterval answer = spelled_interval(figure[2].note, figure[3].note);
  return is_step(approach) && direction(approach) < 0 && is_third(leap) && direction(leap) < 0 &&
         is_step(answer) && direction(answer) > 0;
}

/** Whether four notes spell the double neighbour (`isDoubleNeighbour`). */
bool is_double_neighbour(const std::vector<Entry>& entries, long start) {
  const Entry* figure = figure_at(entries, start);
  if (figure == nullptr) {
    return false;
  }
  if (figure[0].consonance == ConsonanceClass::kDissonance ||
      !same_note(figure[0].note, figure[3].note)) {
    return false;
  }
  SpelledInterval away = spelled_interval(figure[0].note, figure[1].note);
  SpelledInterval across = spelled_interval(figure[1].note, figure[2].note);
  SpelledInterval back = spelled_interval(figure[2].note, figure[3].note);
  return is_step(away) && is_third(across) && is_step(back) && direction(away) != 0 &&
         direction(across) == -direction(away);
}

/** Whether a dissonance stands inside a figure that quits a dissonance by leap
 * (`isFiguredDissonance`). */
bool is_figured_dissonance(const std::vector<Entry>& entries, std::size_t position, int species) {
  if (species != 3 && species != 5) {
    return false;
  }
  long at = static_cast<long>(position);
  return is_cambiata(entries, at - 1) || is_double_neighbour(entries, at - 1) ||
         is_double_neighbour(entries, at - 2);
}

/** Where a species allows a dissonance to fall (`DissonanceLicence`). */
enum class Licence { kNone, kPassing, kSuspension };

/** The licence a species grants at one metric position (`licenceFor`). */
Licence licence_for(int species, bool downbeat) {
  if (species == 1) {
    return Licence::kNone;
  }
  if (species == 4) {
    return downbeat ? Licence::kSuspension : Licence::kNone;
  }
  if (species == 5) {
    return downbeat ? Licence::kSuspension : Licence::kPassing;
  }
  return downbeat ? Licence::kNone : Licence::kPassing;
}

/** The rules judged on a dissonant downbeat where the species writes suspensions
 * (`suspensionViolations`). */
Violations suspension_violations(const std::vector<Entry>& entries, std::size_t position) {
  const Entry& entry = entries[position];
  const Entry* previous = position > 0 ? &entries[position - 1] : nullptr;
  const Entry* next = position + 1 < entries.size() ? &entries[position + 1] : nullptr;
  bool prepared = previous != nullptr && same_note(previous->note, entry.note) &&
                  previous->consonance != ConsonanceClass::kDissonance;
  if (!prepared) {
    return {violation(Kind::kUnpreparedDissonance, {0, 1}, entry.index, entry.index,
                      "The suspended dissonance is not tied over from a consonance")};
  }
  std::optional<SpelledInterval> resolution;
  if (next != nullptr) {
    resolution = spelled_interval(entry.note, next->note);
  }
  if (next == nullptr || !resolution || !is_step(*resolution) || direction(*resolution) >= 0) {
    return {violation(Kind::kUnresolvedSuspension, {0, 1}, entry.index,
                      next == nullptr ? entry.index : next->index,
                      "The suspension does not fall by step onto its resolution")};
  }
  // The step down is only half of the resolution: what it falls onto has to be the consonance the
  // ear was waiting for.
  if (next->consonance == ConsonanceClass::kDissonance) {
    return {violation(Kind::kUnresolvedSuspension, {0, 1}, entry.index, next->index,
                      "The suspension falls onto a " + next->interval.quality +
                          js::to_string(next->interval.number) + ", which is no resolution")};
  }
  return {};
}

/** The rules judged on one counterpoint note: the vertical interval it forms, and whether the
 * voices have crossed (`verticalViolations`). */
Violations vertical_violations(const std::vector<Entry>& entries, std::size_t position, int species,
                               bool counterpoint_above, std::set<int>& crossed) {
  const Entry& entry = entries[position];
  Violations found;
  const NoteData& upper = counterpoint_above ? entry.note : entry.against;
  const NoteData& lower = counterpoint_above ? entry.against : entry.note;
  // Once per written note, not once per measure it sounds in: a note carried across the bar line
  // has an entry in each measure, and a second record would be a duplicate of the first.
  if (crossed.count(entry.index) == 0 && creates_voice_crossing(upper, lower)) {
    crossed.insert(entry.index);
    found.push_back(violation(Kind::kVoiceCrossing, {0, 1}, entry.index, entry.index,
                              "The counterpoint crosses to the wrong side of the cantus firmus"));
  }
  if (entry.consonance != ConsonanceClass::kDissonance) {
    return found;
  }
  Licence licence = licence_for(species, entry.downbeat);
  if (licence == Licence::kPassing && (is_passed_through(entries, position, species) ||
                                       is_figured_dissonance(entries, position, species))) {
    return found;
  }
  if (licence == Licence::kSuspension) {
    Violations more = suspension_violations(entries, position);
    found.insert(found.end(), more.begin(), more.end());
    return found;
  }
  found.push_back(violation(Kind::kUnpreparedDissonance, {0, 1}, entry.index, entry.index,
                            licence == Licence::kNone
                                ? "A " + entry.interval.quality +
                                      js::to_string(entry.interval.number) +
                                      " falls where this species allows only a consonance"
                                : "The dissonance is not passed through by step"));
  return found;
}

/** The rules judged along the counterpoint line itself (`melodicViolations`). */
Violations melodic_violations(const Entry& from, const Entry& to) {
  SpelledInterval interval = spelled_interval(from.note, to.note);
  if (is_augmented_melodic_interval(from.note, to.note)) {
    return {violation(Kind::kAugmentedMelodicInterval, {1}, from.index, to.index,
                      "The counterpoint moves by an augmented " + interval_word(interval.number))};
  }
  if (is_forbidden_melodic_leap(from.note, to.note)) {
    return {violation(
        Kind::kIllegalLeap, {1}, from.index, to.index,
        "The counterpoint leaps by a " + interval.quality + js::to_string(interval.number))};
  }
  return {};
}

/** One melodic move of the counterpoint, as the shape rules read it (`Move`). */
struct Move {
  const Entry* from;
  const Entry* to;
  SpelledInterval interval;
};

/** Whether a melodic interval leaps rather than steps or repeats the note (`isLeap`). */
bool is_leap(const SpelledInterval& interval) { return interval.number > 2; }

/** Every move of the counterpoint, in order (`melodicMoves`). */
std::vector<Move> melodic_moves(const std::vector<Entry>& entries) {
  std::vector<Move> moves;
  for (std::size_t position = 1; position < entries.size(); ++position) {
    const Entry& from = entries[position - 1];
    const Entry& to = entries[position];
    moves.push_back(Move{&from, &to, spelled_interval(from.note, to.note)});
  }
  return moves;
}

/** The one high point: the line reaches its highest note once and does not return to it
 * (`climaxViolations`). */
Violations climax_violations(const std::vector<Entry>& entries) {
  std::vector<const Entry*> body;
  for (std::size_t i = 0; i + 1 < entries.size(); ++i) {
    body.push_back(&entries[i]);
  }
  double peak = -std::numeric_limits<double>::infinity();
  for (const Entry* entry : body) {
    peak = js::max(peak, note_to_midi(entry->note));
  }
  std::vector<const Entry*> arrivals;
  for (std::size_t position = 0; position < body.size(); ++position) {
    bool at_peak = note_to_midi(body[position]->note) == peak;
    if (at_peak && (position == 0 || note_to_midi(body[position - 1]->note) != peak)) {
      arrivals.push_back(body[position]);
    }
  }
  if (arrivals.size() < 2) {
    return {};
  }
  return {violation(Kind::kMelodicShape, {1}, arrivals[0]->index, arrivals[1]->index,
                    "The line reaches its highest note more than once, so it has no one climax")};
}

/** Leaps taken one after another the same way: two at most, spanning an octave at most
 * (`leapChainViolations`). */
Violations leap_chain_violations(const std::vector<Move>& moves) {
  Violations found;
  std::vector<const Move*> run;
  auto close = [&]() {
    if (!run.empty()) {
      double span = 0;
      for (const Move* move : run) {
        span += std::fabs(move->interval.semitones);
      }
      const Move* first = run.front();
      const Move* last = run.back();
      if (static_cast<int>(run.size()) > MAX_LEAPS_IN_ONE_DIRECTION) {
        found.push_back(violation(Kind::kMelodicShape, {1}, first->from->index, last->to->index,
                                  "The counterpoint leaps " + js::to_string(run.size()) +
                                      " times in a row in the same direction"));
      } else if (run.size() > 1 && span > MAX_LEAP_CHAIN_SPAN) {
        found.push_back(
            violation(Kind::kMelodicShape, {1}, first->from->index, last->to->index,
                      "Two leaps in the same direction carry the line further than an octave"));
      }
    }
    run.clear();
  };
  for (const Move& move : moves) {
    if (!is_leap(move.interval)) {
      close();
      continue;
    }
    if (!run.empty() && direction(run.back()->interval) != direction(move.interval)) {
      close();
    }
    run.push_back(&move);
  }
  close();
  return found;
}

/** A wide leap is answered by a step the other way (`leapAnswerViolations`). */
Violations leap_answer_violations(const std::vector<Move>& moves) {
  Violations found;
  for (std::size_t position = 0; position + 1 < moves.size(); ++position) {
    const Move& leap = moves[position];
    const Move& answer = moves[position + 1];
    if (leap.interval.number < LEAP_NEEDING_ANSWER) {
      continue;
    }
    if (is_step(answer.interval) && direction(answer.interval) == -direction(leap.interval)) {
      continue;
    }
    std::string word = interval_word(leap.interval.number);
    found.push_back(violation(Kind::kMelodicShape, {1}, leap.from->index, answer.to->index,
                              "The leap of " + std::string(interval_article(word)) + " " + word +
                                  " is not answered by a step the other way"));
  }
  return found;
}

/** The tritone the line may not leap is also the tritone it may not draw
 * (`tritoneOutlineViolations`). */
Violations tritone_outline_violations(const std::vector<Entry>& entries) {
  Violations found;
  std::vector<Move> moves = melodic_moves(entries);
  std::vector<const Move*> run;
  auto close = [&]() {
    if (run.size() > 1) {
      SpelledInterval outline = spelled_interval(run.front()->from->note, run.back()->to->note);
      if (std::fabs(outline.semitones) == TRITONE_SEMITONES) {
        found.push_back(violation(
            Kind::kMelodicShape, {1}, run.front()->from->index, run.back()->to->index,
            "The line turns around on a tritone, outlining the interval it may not leap"));
      }
    }
    run.clear();
  };
  for (const Move& move : moves) {
    if (direction(move.interval) == 0) {
      continue;
    }
    if (!run.empty() && direction(run.back()->interval) != direction(move.interval)) {
      close();
    }
    run.push_back(&move);
  }
  close();
  return found;
}

/** The moving species do not repeat a note (`repeatedNoteViolations`). */
Violations repeated_note_violations(const std::vector<Move>& moves, int closing_measure) {
  Violations found;
  for (const Move& move : moves) {
    if (same_note(move.from->note, move.to->note) && move.from->againstIndex < closing_measure) {
      found.push_back(
          violation(Kind::kMelodicShape, {1}, move.from->index, move.to->index,
                    "The counterpoint repeats a note where this species keeps the line moving"));
    }
  }
  return found;
}

void append(Violations& to, Violations from) {
  to.insert(to.end(), std::make_move_iterator(from.begin()), std::make_move_iterator(from.end()));
}

/** The rules judged on the shape of the counterpoint rather than on any one of its intervals
 * (`melodicShapeViolations`). */
Violations melodic_shape_violations(const std::vector<Entry>& entries, int species) {
  std::vector<Move> moves = melodic_moves(entries);
  int closing_measure = entries.empty() ? 0 : entries.back().againstIndex;
  Violations found;
  append(found, climax_violations(entries));
  append(found, leap_chain_violations(moves));
  append(found, leap_answer_violations(moves));
  append(found, tritone_outline_violations(entries));
  if (species == 2 || species == 3) {
    append(found, repeated_note_violations(moves, closing_measure));
  }
  std::stable_sort(found.begin(), found.end(),
                   [](const PartWritingViolation& left, const PartWritingViolation& right) {
                     return left.fromIndex < right.fromIndex;
                   });
  return found;
}

/** The violations in the order the exercise commits them (`inTimeOrder`). */
Violations in_time_order(Violations violations) {
  std::stable_sort(violations.begin(), violations.end(),
                   [](const PartWritingViolation& left, const PartWritingViolation& right) {
                     return left.fromIndex != right.fromIndex ? left.fromIndex < right.fromIndex
                                                              : left.toIndex < right.toIndex;
                   });
  return violations;
}

/** The rules judged between two voices moving together (`motionViolations`). */
Violations motion_violations(const Entry& from, const Entry& to, bool counterpoint_above) {
  Violations found;
  const NoteData& upper_prev = counterpoint_above ? from.note : from.against;
  const NoteData& upper_cur = counterpoint_above ? to.note : to.against;
  const NoteData& lower_prev = counterpoint_above ? from.against : from.note;
  const NoteData& lower_cur = counterpoint_above ? to.against : to.note;
  if (creates_parallel_perfect(upper_prev, upper_cur, lower_prev, lower_cur)) {
    bool fifth = simple_interval_number(to.interval.number) == 5;
    found.push_back(violation(fifth ? Kind::kParallelFifth : Kind::kParallelOctave, {0, 1},
                              from.index, to.index,
                              fifth ? "The two voices move into consecutive perfect fifths"
                                    : "The two voices move into consecutive perfect octaves"));
  }
  // Two voices and nothing between them: the sixteenth-century rule forbids the arrival however
  // the upper voice reached it, so the step exception of the four-part chorale is not applied.
  if (creates_hidden_parallel_perfect(upper_prev, upper_cur, lower_prev, lower_cur,
                                      HiddenParallelReading::kTwoVoice)) {
    found.push_back(violation(Kind::kHiddenPerfect, {0, 1}, from.index, to.index,
                              "The voices move into a perfect interval by similar motion"));
  }
  if (creates_battuta(upper_prev, upper_cur, lower_prev, lower_cur)) {
    found.push_back(violation(Kind::kBattuta, {0, 1}, from.index, to.index,
                              "The upper voice leaps down into an octave against the lower voice"));
  }
  return found;
}

/** The last counterpoint note sounding against an earlier cantus-firmus note than the given one
 * (`lastEntryBefore`). */
const Entry* last_entry_before(const std::vector<Entry>& entries, int against_index) {
  for (std::size_t position = entries.size(); position > 0; --position) {
    if (entries[position - 1].againstIndex < against_index) {
      return &entries[position - 1];
    }
  }
  return nullptr;
}

/** The opening and closing formulas (`cadenceViolations`). */
Violations cadence_violations(const std::vector<Entry>& entries, const KeyScale& mode,
                              bool counterpoint_above) {
  Violations found;
  if (entries.empty()) {
    return found;
  }
  const Entry& first = entries.front();
  const Entry& last = entries.back();
  if (classify_spelled_interval(first.interval) != ConsonanceClass::kPerfectConsonance) {
    found.push_back(violation(Kind::kMissingCadence, {0, 1}, first.index, first.index,
                              "The exercise does not begin on a perfect consonance"));
  }
  if (note_to_pitch_class(last.note) != pitch_class_of(mode.rootPc)) {
    found.push_back(violation(Kind::kMissingCadence, {0, 1}, last.index, last.index,
                              "The counterpoint does not close on the final of the mode"));
  }
  const SpelledInterval& closing = last.interval;
  if (closing.quality != "P" || simple_interval_number(closing.number) != 1) {
    found.push_back(violation(Kind::kMissingCadence, {0, 1}, last.index, last.index,
                              "The exercise does not close on an octave or unison"));
    return found;
  }
  const Entry* penultimate = last_entry_before(entries, last.againstIndex);
  if (penultimate == nullptr) {
    return found;
  }
  const Entry* arrival = &last;
  for (const Entry& entry : entries) {
    if (entry.againstIndex == last.againstIndex) {
      arrival = &entry;
      break;
    }
  }
  SpelledInterval approach = spelled_interval(penultimate->note, arrival->note);
  std::string_view expected_quality = counterpoint_above ? "M" : "m";
  int expected_number = counterpoint_above ? 6 : 3;
  if (penultimate->interval.quality != expected_quality ||
      simple_interval_number(penultimate->interval.number) != expected_number ||
      !is_step(approach)) {
    found.push_back(violation(Kind::kMissingCadence, {0, 1}, penultimate->index, arrival->index,
                              counterpoint_above
                                  ? "The close is not the major sixth stepping out to the octave"
                                  : "The close is not the minor third stepping in to the unison"));
  }
  return found;
}

/** Place every counterpoint note against the cantus-firmus notes it sounds with
 * (`buildEntries`). */
std::vector<Entry> build_entries(const std::vector<NoteData>& cantus_firmus,
                                 const std::vector<NoteData>& counterpoint,
                                 const std::vector<double>& durations, bool counterpoint_above) {
  std::vector<Entry> entries;
  for (const SpeciesEntryPair& pair : species_entry_pairs(cantus_firmus.size(), durations)) {
    const NoteData& note = counterpoint[pair.note];
    const NoteData& against = cantus_firmus[pair.against];
    SpelledInterval interval =
        counterpoint_above ? spelled_interval(against, note) : spelled_interval(note, against);
    Entry entry;
    entry.note = note;
    entry.index = static_cast<int>(pair.note);
    entry.held = pair.held;
    entry.against = against;
    entry.againstIndex = static_cast<int>(pair.against);
    entry.downbeat = std::fabs(pair.begins - js::round(pair.begins)) < BEAT_EPS;
    entry.interval = interval;
    entry.consonance = classify_spelled_interval(interval);
    entries.push_back(std::move(entry));
  }
  return entries;
}

/** The pairs of struck notes the motion rules are judged over: successive attacks that cross a
 * bar line (`motionPairs`). */
std::vector<std::pair<std::size_t, std::size_t>> motion_pairs(const std::vector<Entry>& entries) {
  std::vector<std::pair<std::size_t, std::size_t>> pairs;
  for (std::size_t position = 1; position < entries.size(); ++position) {
    if (entries[position - 1].againstIndex != entries[position].againstIndex) {
      pairs.emplace_back(position - 1, position);
    }
  }
  return pairs;
}

}  // namespace

SpeciesDurations resolve_species_durations(std::size_t notes, std::size_t measures, int species,
                                           const SpeciesOptions& opts) {
  SpeciesDurations out;
  if (opts.durations) {
    const std::vector<double>& given = *opts.durations;
    if (given.size() != notes) {
      out.problem = "The exercise gives " + js::to_string(given.size()) + " durations for " +
                    js::to_string(notes) + " notes";
      return out;
    }
    for (double duration : given) {
      double units = duration / MIN_FLORID_VALUE;
      if (!(duration > 0) || duration > 1 || std::fabs(units - js::round(units)) > BEAT_EPS) {
        out.problem = "A note lasts " + js::to_string(duration) +
                      " of a measure, which this style does not write";
        return out;
      }
    }
    double total = 0;
    for (double duration : given) {
      total += duration;
    }
    if (std::fabs(total - static_cast<double>(measures)) > BEAT_EPS) {
      out.problem = "The counterpoint fills " + js::to_string(total) + " of the " +
                    js::to_string(measures) + " measures";
      return out;
    }
    out.durations = given;
    return out;
  }
  if (species == 5) {
    throw InvalidInputError(
        "checkSpecies needs durations for the fifth species, whose note values are not fixed");
  }
  int ratio = ratio_of(species);
  double full = static_cast<double>(ratio) * static_cast<double>(measures);
  // A closing measure written as one whole note is the convention rather than an exception, so
  // both note counts read as the correct ratio.
  double length = static_cast<double>(notes);
  if (length != full && length != full - ratio + 1) {
    out.problem = "Species " + js::to_string(species) + " sets " + js::to_string(ratio) +
                  " notes against each of the " + js::to_string(measures) +
                  " cantus firmus notes, and the counterpoint has " + js::to_string(notes);
    return out;
  }
  out.durations = implied_durations(notes, static_cast<double>(measures), ratio);
  return out;
}

std::vector<SpeciesEntryPair> species_entry_pairs(std::size_t cantus_firmus,
                                                  const std::vector<double>& durations) {
  std::vector<SpeciesEntryPair> pairs;
  double onset = 0;
  double last_cantus = static_cast<double>(cantus_firmus) - 1;
  for (std::size_t index = 0; index < durations.size(); ++index) {
    double duration = durations[index];
    double struck_over = js::min(std::floor(onset + BEAT_EPS), last_cantus);
    double last_over =
        js::min(js::max(std::ceil(onset + duration - BEAT_EPS) - 1, struck_over), last_cantus);
    for (double against_index = struck_over; against_index <= last_over; against_index += 1) {
      bool held = against_index > struck_over;
      // A held stretch begins where the measure does; the first begins wherever the note was
      // struck, which is what makes it a weak-beat note or not.
      pairs.push_back(SpeciesEntryPair{index, static_cast<std::size_t>(against_index), held,
                                       held ? against_index : onset});
    }
    onset += duration;
  }
  return pairs;
}

std::vector<PartWritingViolation> check_species(const std::vector<NoteData>& cantus_firmus,
                                                const std::vector<NoteData>& counterpoint,
                                                int species, const KeyArg& mode_like,
                                                const SpeciesOptions& opts) {
  KeyScale mode = to_key_scale(mode_like);
  if (!is_species_number(species)) {
    throw species_rejected(json::Value(static_cast<double>(species)));
  }
  if (cantus_firmus.empty() || counterpoint.empty()) {
    throw InvalidInputError("checkSpecies needs both a cantus firmus and a counterpoint");
  }
  SpeciesDurations resolved =
      resolve_species_durations(counterpoint.size(), cantus_firmus.size(), species, opts);
  if (resolved.problem) {
    return in_time_order({violation(Kind::kWrongRhythmicRatio, {1}, 0,
                                    static_cast<int>(counterpoint.size()) - 1, *resolved.problem)});
  }
  bool counterpoint_above = false;
  if (opts.counterpointAbove) {
    counterpoint_above = *opts.counterpointAbove;
  } else {
    double counterpoint_mean = mean_pitch(counterpoint);
    counterpoint_above = counterpoint_mean >= mean_pitch(cantus_firmus);
  }
  std::vector<Entry> entries =
      build_entries(cantus_firmus, counterpoint, resolved.durations, counterpoint_above);
  // Every interval the exercise sounds is judged, including the ones a held note forms in the
  // measure it is carried into. The line itself is read from the attacks alone: a note going on
  // sounding was not sung a second time.
  std::vector<Entry> struck;
  for (const Entry& entry : entries) {
    if (!entry.held) {
      struck.push_back(entry);
    }
  }

  Violations violations;
  std::set<int> crossed;
  for (std::size_t position = 0; position < entries.size(); ++position) {
    append(violations,
           vertical_violations(entries, position, species, counterpoint_above, crossed));
  }
  for (std::size_t position = 1; position < struck.size(); ++position) {
    append(violations, melodic_violations(struck[position - 1], struck[position]));
  }
  append(violations, melodic_shape_violations(struck, species));
  for (const auto& [from, to] : motion_pairs(struck)) {
    append(violations, motion_violations(struck[from], struck[to], counterpoint_above));
  }
  append(violations, cadence_violations(struck, mode, counterpoint_above));
  return in_time_order(std::move(violations));
}

}  // namespace cantus
