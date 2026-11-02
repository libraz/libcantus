// Playability of ts/src/core/instrument/playability.ts.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/validation.h"
#include "core/event_index/order.h"
#include "core/instrument/limits.gen.h"
#include "core/instrument/profile.h"
#include "core/meter/limits.gen.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** Working state shared by both instrument families. */
struct Analysis {
  const std::vector<NoteEvent>& notes;
  /** Note indices in onset order, ties broken by pitch. */
  std::vector<std::size_t> order;
  std::vector<NotePlacement> placements;
  std::vector<PlayabilityIssue> issues;
  /** Accumulated movement, in frets or strokes. */
  double movement = 0;
  /** Seconds per quarter-note beat, or nullopt when no tempo was given. */
  std::optional<double> secondsPerBeat;
};

struct Group {
  double startBeat = 0;
  std::vector<std::size_t> members;
};

std::string num(double x) { return js::to_string(x); }

std::vector<std::size_t> sorted(std::vector<std::size_t> indices) {
  std::stable_sort(indices.begin(), indices.end());
  return indices;
}

/** Layer 1: the instrument has no position for the note, or no such technique. */
template <class Sounds>
void check_existence(Analysis& state, const std::string& name,
                     const std::vector<Articulation>& articulations, Sounds sounds) {
  for (std::size_t index : state.order) {
    const NoteEvent& note = state.notes[index];
    if (!sounds(note.pitch)) {
      state.issues.push_back(PlayabilityIssue{PlayabilityIssueType::kNoteOutOfRange,
                                              1,
                                              {index},
                                              note.startBeat,
                                              true,
                                              name + " cannot sound MIDI " + num(note.pitch)});
    }
    if (note.articulation && std::find(articulations.begin(), articulations.end(),
                                       *note.articulation) == articulations.end()) {
      state.issues.push_back(
          PlayabilityIssue{PlayabilityIssueType::kArticulationUnavailable,
                           1,
                           {index},
                           note.startBeat,
                           true,
                           name + " cannot play " + std::string(to_string(*note.articulation))});
    }
  }
}

/** One sounding note as every layer-2 and layer-3 check reads it (`TimedNote`). */
struct TimedNote {
  std::size_t index = 0;
  double startBeat = 0;
  double endBeat = 0;
  /** Onset of the attack the note is struck in. */
  double attackBeat = 0;
};

/** The sounding notes struck together, and the earlier ones still held under them (`Attack`). */
struct Attack {
  double startBeat = 0;
  /** The notes struck, by pitch and then by index. */
  std::vector<TimedNote> members;
  /** Notes of earlier attacks not yet released when this one lands. */
  std::vector<TimedNote> held;
};

/** Whether a note ending at `end_beat` has let go by `beat`; a legato overlap releases it. */
bool is_released(double end_beat, double beat) {
  return end_beat <= beat + LEGATO_OVERLAP_BEATS + BEAT_EPS;
}

/** The passage as a timeline of attacks, built once for every check (`timelineOf`). */
std::vector<Attack> timeline_of(const Analysis& state) {
  std::vector<std::size_t> sounding_list = sounding_indices(state.notes);
  std::set<std::size_t> sounding(sounding_list.begin(), sounding_list.end());
  std::vector<Attack> attacks;
  std::vector<TimedNote> active;
  for (std::size_t index : state.order) {
    if (sounding.count(index) == 0) {
      continue;
    }
    const NoteEvent& note = state.notes[index];
    if (attacks.empty() ||
        note.startBeat - attacks.back().startBeat > SIMULTANEITY_BEATS + BEAT_EPS) {
      double at = note.startBeat;
      std::vector<TimedNote> still_held;
      for (const TimedNote& held : active) {
        if (!is_released(held.endBeat, at)) {
          still_held.push_back(held);
        }
      }
      active = std::move(still_held);
      attacks.push_back(Attack{at, {}, active});
    }
    TimedNote timed{index, note.startBeat, note.startBeat + note.durationBeat,
                    attacks.back().startBeat};
    attacks.back().members.push_back(timed);
    active.push_back(timed);
  }
  for (Attack& attack : attacks) {
    std::stable_sort(attack.members.begin(), attack.members.end(),
                     [&](const TimedNote& a, const TimedNote& b) {
                       int left = state.notes[a.index].pitch;
                       int right = state.notes[b.index].pitch;
                       return left != right ? left < right : a.index < b.index;
                     });
  }
  return attacks;
}

/** Every note sounding once an attack has landed: the held ones, then the struck ones. */
std::vector<std::size_t> sounding_at(const Attack& attack) {
  std::vector<std::size_t> out;
  for (const TimedNote& held : attack.held) {
    out.push_back(held.index);
  }
  for (const TimedNote& member : attack.members) {
    out.push_back(member.index);
  }
  return out;
}

/**
 * Where the hands are before a note (`Origin`): the string last played, and the fret the
 * fretting hand last stopped. An open string moves the picking hand only.
 */
struct Origin {
  std::optional<std::size_t> string;
  std::optional<int> fret;
};

/** The origin after playing `chosen` (`movedTo`). */
Origin moved_to(const Origin& origin, const StringFingering& chosen) {
  return Origin{chosen.string, chosen.fret > 0 ? std::optional<int>(chosen.fret) : origin.fret};
}

/** Cost of taking a position, counting a string crossing as several frets. */
double fingering_cost(const StringFingering& candidate, const Origin& origin) {
  // With no fret stopped yet, the low frets are the resting position; an open string asks
  // nothing of the fretting hand.
  double stopped = candidate.fret == 0 ? 0
                   : !origin.fret      ? static_cast<double>(candidate.fret)
                                  : std::fabs(static_cast<double>(candidate.fret - *origin.fret));
  double string = static_cast<double>(candidate.string);
  double crossing = !origin.string ? 0
                                   : STRING_CROSSING_COST *
                                         std::fabs(string - static_cast<double>(*origin.string));
  return stopped + crossing + string / 100;
}

/** Where the fretting hand stands: the last note stopped at a fret (`HandPosition`). */
struct HandPosition {
  TimedNote note;
  StringFingering fingering;
};

/** Layer 3: the fretting hand cannot travel that far between two attacks. */
void check_shift_speed(Analysis& state, const std::string& name, const HandPosition& from,
                       const HandPosition& to) {
  if (!state.secondsPerBeat) {
    return;
  }
  double seconds = (to.note.attackBeat - from.note.attackBeat) * *state.secondsPerBeat;
  double shift = std::fabs(static_cast<double>(to.fingering.fret - from.fingering.fret));
  if (seconds <= BEAT_EPS || shift == 0) {
    return;
  }
  if (shift / seconds > MAX_FRET_SHIFT_PER_SECOND) {
    state.issues.push_back(PlayabilityIssue{
        PlayabilityIssueType::kTooFast, 3, sorted({from.note.index, to.note.index}),
        to.note.startBeat, false,
        "a " + num(shift) + "-fret shift in " + js::to_fixed(seconds, 3) + "s is beyond " + name});
  }
}

/** Layer 2: one hand cannot span that many frets at once. */
void check_stretch(Analysis& state, const StringedProfile& profile, const Attack& attack) {
  std::vector<std::size_t> sounding = sounding_at(attack);
  std::vector<double> frets;
  for (std::size_t member : sounding) {
    const std::optional<StringFingering>& fingering = state.placements[member].fingering;
    if (fingering && fingering->fret > 0) {
      frets.push_back(fingering->fret);
    }
  }
  if (frets.size() < 2) {
    return;
  }
  double span = js::max(frets) - js::min(frets);
  if (span > profile.maxStretch) {
    state.issues.push_back(PlayabilityIssue{PlayabilityIssueType::kStretchTooWide, 2,
                                            sorted(std::move(sounding)), attack.startBeat, true,
                                            "a " + num(span) + "-fret stretch exceeds the " +
                                                num(profile.maxStretch) +
                                                " frets one hand spans on " + profile.name});
  }
}

/** Layer 2: more notes sounding at once than the instrument has voices. */
void check_polyphony(Analysis& state, const std::string& name, int polyphony, const Group& group) {
  if (group.members.size() <= static_cast<std::size_t>(polyphony)) {
    return;
  }
  state.issues.push_back(PlayabilityIssue{
      PlayabilityIssueType::kPolyphonyExceeded, 2, sorted(group.members), group.startBeat, true,
      num(static_cast<double>(group.members.size())) + " notes sound at once; " + name + " has " +
          num(polyphony)});
}

/** Most notes of one attack that are placed jointly; a larger group keeps its greedy picks. */
constexpr std::size_t kMaxJointPlacementNotes = 12;
/** Most search nodes spent on one attack before the best placement found so far stands. */
constexpr std::size_t kMaxPlacementSearchNodes = 20000;

/** One note of an attack waiting for a string. */
struct NeckMember : TimedNote {
  std::vector<StringFingering> candidates;
};

/** A note that found no free string, with the notes holding the strings it could use. */
struct NeckConflict {
  std::size_t member = 0;
  std::vector<std::size_t> blocked;
};

struct AttackPlacement {
  std::vector<StringFingering> picks;
  std::vector<NeckConflict> conflicts;
};

/** Whether the fretted notes of a hand fit one maxStretch. */
bool fits_hand(const std::vector<int>& frets, double max_stretch) {
  int low = 0;
  int high = 0;
  std::size_t count = 0;
  for (int fret : frets) {
    if (fret > 0) {
      low = count == 0 ? fret : std::min<int>(low, fret);
      high = count == 0 ? fret : std::max<int>(high, fret);
      count += 1;
    }
  }
  return count < 2 || static_cast<double>(high - low) <= max_stretch;
}

/**
 * Each member takes the cheapest free string in turn; members with no free one are reported.
 * `free_at` is the beat each string is released at; a string taken inside the attack stays taken.
 */
AttackPlacement place_greedily(const std::vector<NeckMember>& members, const Origin& previous,
                               const std::vector<double>& free_at,
                               const std::vector<std::optional<std::size_t>>& held_by) {
  std::vector<double> free = free_at;
  std::vector<std::optional<std::size_t>> held = held_by;
  AttackPlacement out;
  Origin from = previous;
  for (std::size_t m = 0; m < members.size(); ++m) {
    const NeckMember& member = members[m];
    std::vector<StringFingering> open;
    for (const StringFingering& candidate : member.candidates) {
      if (is_released(free[candidate.string], member.attackBeat)) {
        open.push_back(candidate);
      }
    }
    if (open.empty()) {
      NeckConflict conflict{m, {}};
      for (const StringFingering& candidate : member.candidates) {
        if (held[candidate.string]) {
          conflict.blocked.push_back(*held[candidate.string]);
        }
      }
      out.conflicts.push_back(std::move(conflict));
    }
    const std::vector<StringFingering>& pool = open.empty() ? member.candidates : open;
    StringFingering chosen = pool.front();
    for (std::size_t k = 1; k < pool.size(); ++k) {
      if (fingering_cost(pool[k], from) < fingering_cost(chosen, from)) {
        chosen = pool[k];
      }
    }
    out.picks.push_back(chosen);
    free[chosen.string] = std::numeric_limits<double>::infinity();
    held[chosen.string] = member.index;
    from = moved_to(from, chosen);
  }
  return out;
}

/** Depth-first search state for the cheapest assignment to distinct free strings. */
struct PlacementSearch {
  const std::vector<NeckMember>& members;
  std::vector<double> free;
  /** Frets of the hand so far; engaged only when the span is limited. */
  std::optional<std::vector<int>> frets;
  double max_stretch;
  std::vector<StringFingering> picks;
  std::optional<std::vector<StringFingering>> best;
  double best_cost = std::numeric_limits<double>::infinity();
  std::size_t nodes = 0;

  void visit(std::size_t depth, const Origin& from, double cost) {
    if (cost >= best_cost || nodes >= kMaxPlacementSearchNodes) {
      return;
    }
    if (depth >= members.size()) {
      best = picks;
      best_cost = cost;
      return;
    }
    const NeckMember& member = members[depth];
    for (const StringFingering& candidate : member.candidates) {
      double previous_free = free[candidate.string];
      if (!is_released(previous_free, member.attackBeat)) {
        continue;
      }
      nodes += 1;
      if (frets) {
        frets->push_back(candidate.fret);
        if (!fits_hand(*frets, max_stretch)) {
          frets->pop_back();
          continue;
        }
      }
      free[candidate.string] = std::numeric_limits<double>::infinity();
      picks.push_back(candidate);
      visit(depth + 1, moved_to(from, candidate), cost + fingering_cost(candidate, from));
      picks.pop_back();
      free[candidate.string] = previous_free;
      if (frets) {
        frets->pop_back();
      }
    }
  }
};

/**
 * Cheapest assignment of the members to distinct free strings, found by a bounded depth-first
 * search; nullopt when none exists within the budget. With `held_frets` the fretted span, held
 * notes included, must fit `max_stretch`.
 */
std::optional<std::vector<StringFingering>> search_placement(
    const std::vector<NeckMember>& members, const Origin& previous,
    const std::vector<double>& free_at, const std::optional<std::vector<int>>& held_frets,
    double max_stretch) {
  PlacementSearch search{members, free_at, held_frets, max_stretch, {}, std::nullopt};
  search.visit(0, previous, 0);
  return search.best;
}

/**
 * Pick a string for each note of one attack. The greedy picks stand when they are free and fit the
 * hand; otherwise the notes are placed jointly, and the greedy picks and their issues remain only
 * when no assignment exists.
 */
AttackPlacement place_attack(const std::vector<NeckMember>& members, const Origin& previous,
                             const std::vector<double>& free_at,
                             const std::vector<std::optional<std::size_t>>& held_by,
                             const std::vector<int>& held_frets, double max_stretch) {
  AttackPlacement greedy = place_greedily(members, previous, free_at, held_by);
  std::vector<int> frets = held_frets;
  for (const StringFingering& pick : greedy.picks) {
    frets.push_back(pick.fret);
  }
  if (greedy.conflicts.empty() && fits_hand(frets, max_stretch)) {
    return greedy;
  }
  if (members.size() > kMaxJointPlacementNotes) {
    return greedy;
  }
  std::optional<std::vector<StringFingering>> fitted =
      search_placement(members, previous, free_at, held_frets, max_stretch);
  if (fitted) {
    return AttackPlacement{std::move(*fitted), {}};
  }
  if (!greedy.conflicts.empty()) {
    std::optional<std::vector<StringFingering>> loose =
        search_placement(members, previous, free_at, std::nullopt, max_stretch);
    if (loose) {
      return AttackPlacement{std::move(*loose), {}};
    }
  }
  return greedy;
}

/**
 * Layers 2 and 3 for a string instrument, and the fingering that goes with them. The fretting hand
 * moves once per attack, between stopped notes.
 */
void place_on_neck(Analysis& state, const StringedProfile& profile,
                   const std::vector<Attack>& attacks) {
  std::vector<double> string_free_at(profile.tuning.size(),
                                     -std::numeric_limits<double>::infinity());
  std::vector<std::optional<std::size_t>> string_held_by(profile.tuning.size());
  Origin origin;
  std::optional<HandPosition> hand;

  for (const Attack& attack : attacks) {
    std::vector<NeckMember> members;
    for (const TimedNote& timed : attack.members) {
      std::vector<StringFingering> candidates =
          fingerings_in(profile, state.notes[timed.index].pitch);
      if (!candidates.empty()) {
        NeckMember member;
        static_cast<TimedNote&>(member) = timed;
        member.candidates = std::move(candidates);
        members.push_back(std::move(member));
      }
    }
    std::vector<int> held_frets;
    for (const TimedNote& held : attack.held) {
      const std::optional<StringFingering>& fingering = state.placements[held.index].fingering;
      if (fingering) {
        held_frets.push_back(fingering->fret);
      }
    }
    AttackPlacement placed = place_attack(members, origin, string_free_at, string_held_by,
                                          held_frets, profile.maxStretch);
    std::optional<HandPosition> shifted = hand;
    bool moved = false;
    for (std::size_t m = 0; m < members.size(); ++m) {
      const NeckMember& member = members[m];
      const NoteEvent& note = state.notes[member.index];
      const StringFingering& chosen = placed.picks[m];
      for (const NeckConflict& conflict : placed.conflicts) {
        if (conflict.member != m) {
          continue;
        }
        // [...new Set([...blocked, index])].sort()
        std::vector<std::size_t> involved;
        std::set<std::size_t> seen;
        for (std::size_t blocked : conflict.blocked) {
          if (seen.insert(blocked).second) {
            involved.push_back(blocked);
          }
        }
        if (seen.insert(member.index).second) {
          involved.push_back(member.index);
        }
        state.issues.push_back(PlayabilityIssue{
            PlayabilityIssueType::kStringConflict, 2, sorted(std::move(involved)), member.startBeat,
            true,
            "MIDI " + num(note.pitch) + " needs a string already sounding on " + profile.name});
      }
      state.placements[member.index].fingering = chosen;
      string_free_at[chosen.string] = member.endBeat;
      string_held_by[chosen.string] = member.index;

      state.movement += 1;
      if (origin.string) {
        state.movement +=
            std::fabs(static_cast<double>(chosen.string) - static_cast<double>(*origin.string));
      }
      origin = moved_to(origin, chosen);
      if (chosen.fret > 0) {
        shifted = HandPosition{member, chosen};
        moved = true;
      }
    }
    if (hand && moved) {
      state.movement +=
          std::fabs(static_cast<double>(shifted->fingering.fret - hand->fingering.fret));
      check_shift_speed(state, profile.name, *hand, *shifted);
    }
    hand = shifted;
  }

  for (const Attack& attack : attacks) {
    check_stretch(state, profile, attack);
    check_polyphony(state, profile.name, profile.polyphony,
                    Group{attack.startBeat, sounding_at(attack)});
  }
}

/** One take a percussion part is recorded on: the kit, or a voice dubbed over it. */
struct KitPass {
  std::string id;
  std::vector<TimedNote> members;
};

/** The kit read out of the profile once per call. */
struct Kit {
  const PercussionProfile& profile;
  /** Limbs the player has that reach each voice, in preference order. */
  std::map<int, std::vector<Limb>> limbs;
  /** Voices played on a pass of their own. */
  std::set<int> overdub;
};

Kit read_kit(const PercussionProfile& profile) {
  Kit kit{profile, {}, {}};
  for (const auto& [pitch, reach] : profile.reach) {
    kit.limbs[pitch] = reach_of(profile, pitch);
  }
  if (profile.overdub) {
    kit.overdub.insert(profile.overdub->begin(), profile.overdub->end());
  }
  return kit;
}

const std::vector<Limb>& limbs_for(const Kit& kit, int pitch) {
  static const std::vector<Limb> kNoLimbs;
  auto it = kit.limbs.find(pitch);
  return it == kit.limbs.end() ? kNoLimbs : it->second;
}

/** What the limbs were last doing, carried from one onset to the next. */
struct KitMemory {
  /** Limb that last struck each voice, so a voice keeps its stick. */
  std::map<int, Limb> limbForVoice;
  /** Last stroke of each limb on each pass. */
  std::map<std::string, TimedNote> lastStroke;
};

/** The passes one onset is played on: the kit, then each overdubbed voice in order met. */
std::vector<KitPass> passes_at(const Analysis& state, const Kit& kit,
                               const std::vector<TimedNote>& members) {
  std::vector<KitPass> passes{KitPass{"kit", {}}};
  std::map<int, std::size_t> overdub_pass;
  for (const TimedNote& member : members) {
    int pitch = state.notes[member.index].pitch;
    if (kit.overdub.count(pitch) == 0) {
      passes[0].members.push_back(member);
      continue;
    }
    auto it = overdub_pass.find(pitch);
    if (it == overdub_pass.end()) {
      it = overdub_pass.emplace(pitch, passes.size()).first;
      passes.push_back(KitPass{"overdub " + num(pitch), {}});
    }
    passes[it->second].members.push_back(member);
  }
  return passes;
}

/** Layer 3: one limb cannot strike twice that close together. */
void check_stroke_speed(Analysis& state, const std::string& name, const TimedNote& from,
                        const TimedNote& to, Limb limb) {
  if (!state.secondsPerBeat) {
    return;
  }
  double seconds = (to.attackBeat - from.attackBeat) * *state.secondsPerBeat;
  if (seconds <= BEAT_EPS || seconds >= MIN_LIMB_STROKE_SECONDS) {
    return;
  }
  state.issues.push_back(PlayabilityIssue{PlayabilityIssueType::kTooFast, 3,
                                          sorted({from.index, to.index}), to.startBeat, false,
                                          std::string(to_string(limb)) + " strikes twice " +
                                              js::to_fixed(seconds, 3) + "s apart on " + name});
}

/** Hand every stroke of one pass to a limb; true when the pass wants more limbs than it has. */
bool place_pass(Analysis& state, const Kit& kit, const KitPass& pass, KitMemory& memory) {
  std::vector<Limb> taken;
  bool conflicted = false;
  // The most constrained voice picks first.
  std::vector<TimedNote> members = pass.members;
  std::stable_sort(members.begin(), members.end(), [&](const TimedNote& a, const TimedNote& b) {
    std::size_t left = limbs_for(kit, state.notes[a.index].pitch).size();
    std::size_t right = limbs_for(kit, state.notes[b.index].pitch).size();
    return left != right ? left < right : a.index < b.index;
  });
  for (const TimedNote& member : members) {
    const NoteEvent& note = state.notes[member.index];
    NotePlacement& placement = state.placements[member.index];
    const std::vector<Limb>& candidates = limbs_for(kit, note.pitch);
    if (candidates.empty()) {
      continue;
    }
    std::optional<Limb> preferred;
    if (auto it = memory.limbForVoice.find(note.pitch); it != memory.limbForVoice.end()) {
      preferred = it->second;
    }
    std::vector<Limb> free;
    for (Limb limb : candidates) {
      if (std::find(taken.begin(), taken.end(), limb) == taken.end()) {
        free.push_back(limb);
      }
    }
    Limb chosen = candidates.front();
    if (free.empty()) {
      conflicted = true;
    } else if (preferred && std::find(free.begin(), free.end(), *preferred) != free.end()) {
      chosen = *preferred;
    } else {
      chosen = free.front();
    }
    if (std::find(taken.begin(), taken.end(), chosen) == taken.end()) {
      taken.push_back(chosen);
    }
    placement.limb = chosen;
    memory.limbForVoice[note.pitch] = chosen;

    state.movement += 1;
    std::string stroke_key = pass.id + " " + std::string(to_string(chosen));
    auto last = memory.lastStroke.find(stroke_key);
    if (last != memory.lastStroke.end()) {
      TimedNote previous_stroke = last->second;
      if (state.notes[previous_stroke.index].pitch != note.pitch) {
        // The limb had to travel across the kit rather than repeat a voice.
        state.movement += 1;
      }
      check_stroke_speed(state, kit.profile.name, previous_stroke, member, chosen);
    }
    memory.lastStroke[stroke_key] = member;
  }
  return conflicted;
}

/** Layers 2 and 3 for a kit, and the limb assignment that goes with them. */
void place_on_kit(Analysis& state, const Kit& kit, const std::vector<Attack>& attacks) {
  KitMemory memory;
  for (const Attack& attack : attacks) {
    Group strokes{attack.startBeat, {}};
    for (const TimedNote& member : attack.members) {
      strokes.members.push_back(member.index);
    }
    bool conflicted = false;
    for (const KitPass& pass : passes_at(state, kit, attack.members)) {
      if (!place_pass(state, kit, pass, memory)) {
        continue;
      }
      conflicted = true;
      std::vector<std::size_t> struck;
      for (const TimedNote& member : pass.members) {
        struck.push_back(member.index);
      }
      state.issues.push_back(PlayabilityIssue{
          PlayabilityIssueType::kLimbConflict, 2, sorted(std::move(struck)), attack.startBeat, true,
          num(static_cast<double>(pass.members.size())) +
              " simultaneous strokes cannot be shared among the limbs of " + kit.profile.name});
    }
    if (!conflicted) {
      check_polyphony(state, kit.profile.name, kit.profile.polyphony, strokes);
    }
  }
}

/** Movement per unit time, on a saturating 1..5 scale. */
double difficulty_of(const std::vector<Attack>& attacks, double movement,
                     std::optional<double> bpm) {
  double first = std::numeric_limits<double>::infinity();
  double last = -std::numeric_limits<double>::infinity();
  for (const Attack& attack : attacks) {
    for (const TimedNote& member : attack.members) {
      first = js::min(first, member.startBeat);
      last = js::max(last, member.endBeat);
    }
  }
  double span_beats = last - first;
  if (!std::isfinite(span_beats) || span_beats <= BEAT_EPS) {
    return MIN_DIFFICULTY;
  }
  double seconds = (span_beats * 60) / (bpm ? *bpm : REFERENCE_BPM);
  double rate = movement / seconds;
  double scaled =
      MIN_DIFFICULTY + (MAX_DIFFICULTY - MIN_DIFFICULTY) * (1 - js::exp(-rate / DIFFICULTY_SCALE));
  return js::round(scaled * 1e4) / 1e4;
}

/** PlayabilityIssueType names, indexed by the enum (a TS type, so there is no table to generate).
 */
constexpr std::array<std::string_view, 7> kIssueTypeNames = {
    "noteOutOfRange", "articulationUnavailable", "stringConflict", "stretchTooWide",
    "limbConflict",   "polyphonyExceeded",       "tooFast"};

}  // namespace

std::string_view to_string(PlayabilityIssueType type) {
  return kIssueTypeNames[static_cast<std::size_t>(type)];
}

std::optional<PlayabilityIssueType> parse_playability_issue_type(std::string_view name) {
  for (std::size_t i = 0; i < kIssueTypeNames.size(); ++i) {
    if (kIssueTypeNames[i] == name) {
      return static_cast<PlayabilityIssueType>(i);
    }
  }
  return std::nullopt;
}

PlayabilityReport playability(const std::vector<NoteEvent>& notes,
                              const InstrumentProfileArg& profile, std::optional<double> bpm) {
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  assert_note_events(notes, "playability notes", note_options);
  if (bpm) {
    assert_range(*bpm, kMinValue, 1000, "playability bpm");
  }
  // The profile is read before answering, whether or not a note would expose a contradiction.
  InstrumentProfile instrument = to_instrument_profile(profile, "playability profile");

  Analysis state{notes, {}, {}, {}, 0, std::nullopt};
  state.order = canonical_note_order(notes);
  state.placements.resize(notes.size());
  for (std::size_t i = 0; i < notes.size(); ++i) {
    state.placements[i].note = i;
  }
  if (bpm) {
    state.secondsPerBeat = 60 / *bpm;
  }

  std::vector<Attack> attacks = timeline_of(state);
  if (const auto* stringed = std::get_if<StringedProfile>(&instrument)) {
    check_existence(state, stringed->name, stringed->articulations,
                    [&](int pitch) { return sounds_in(instrument, pitch); });
    place_on_neck(state, *stringed, attacks);
  } else {
    const auto& percussion = std::get<PercussionProfile>(instrument);
    // Read once, so the per-note stages below are lookups.
    Kit kit = read_kit(percussion);
    check_existence(state, percussion.name, percussion.articulations,
                    [&](int pitch) { return !limbs_for(kit, pitch).empty(); });
    place_on_kit(state, kit, attacks);
  }

  return PlayabilityReport{difficulty_of(attacks, state.movement, bpm), std::move(state.issues),
                           std::move(state.placements)};
}

}  // namespace cantus
