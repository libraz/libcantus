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
#include "core/instrument/profile.h"
#include "core/meter/limits.gen.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

// The constants of ts/src/core/instrument/playability.ts, which does not export them; the corpus
// replay of playability pins every one through the difficulty and the issues it reports.
/** Tempo the difficulty is measured at when the caller gives none. */
constexpr double REFERENCE_BPM = 120;
/** Fastest the fretting hand shifts along the neck, in frets per second. */
constexpr double MAX_FRET_SHIFT_PER_SECOND = 100;
/** Shortest gap between two strokes of one limb, in seconds. */
constexpr double MIN_LIMB_STROKE_SECONDS = 0.06;
/** Movement rate, in units per second, that reads as a demanding passage. */
constexpr double DIFFICULTY_SCALE = 12;
constexpr double MIN_DIFFICULTY = 1;
constexpr double MAX_DIFFICULTY = 5;
/** Cost of crossing one string, relative to moving one fret. */
constexpr double STRING_CROSSING_COST = 2;
/** Onsets no further apart than this many beats count as simultaneous. */
constexpr double SIMULTANEITY_BEATS = 1.0 / 128;

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

/** Whether an onset falls inside the simultaneity window opened by an earlier one. */
bool is_simultaneous(double anchor_beat, double start_beat) {
  return start_beat - anchor_beat <= SIMULTANEITY_BEATS + BEAT_EPS;
}

/** Note indices sounding at each distinct onset, in onset order. */
std::vector<Group> sounding_groups(const Analysis& state) {
  std::vector<Group> groups;
  std::vector<std::size_t> active;
  std::size_t cursor = 0;
  std::optional<double> anchor;
  for (std::size_t index : state.order) {
    const NoteEvent& note = state.notes[index];
    if (anchor && is_simultaneous(*anchor, note.startBeat)) {
      continue;
    }
    double at = note.startBeat;
    anchor = at;
    std::vector<std::size_t> held;
    for (std::size_t member : active) {
      const NoteEvent& m = state.notes[member];
      if (m.startBeat + m.durationBeat > at + BEAT_EPS) {
        held.push_back(member);
      }
    }
    active = std::move(held);
    while (cursor < state.order.size()) {
      std::size_t candidate_index = state.order[cursor];
      const NoteEvent& candidate = state.notes[candidate_index];
      if (!is_simultaneous(at, candidate.startBeat)) {
        break;
      }
      if (candidate.startBeat + candidate.durationBeat > at + BEAT_EPS) {
        active.push_back(candidate_index);
      }
      cursor += 1;
    }
    groups.push_back(Group{at, active});
  }
  return groups;
}

/** Cost of taking a position, counting a string crossing as several frets. */
double fingering_cost(const StringFingering& candidate,
                      const std::optional<StringFingering>& previous) {
  double string = static_cast<double>(candidate.string);
  if (!previous) {
    // With nothing to move from, the low frets are the resting position.
    return candidate.fret + string / 100;
  }
  return std::fabs(static_cast<double>(candidate.fret - previous->fret)) +
         STRING_CROSSING_COST * std::fabs(string - static_cast<double>(previous->string)) +
         string / 100;
}

/** Layer 3: the fretting hand cannot travel that far in the time available. */
void check_shift_speed(Analysis& state, const std::string& name,
                       std::optional<std::size_t> from_index, std::size_t to_index,
                       const StringFingering& from, const StringFingering& to) {
  if (!state.secondsPerBeat || !from_index) {
    return;
  }
  const NoteEvent& previous_note = state.notes[*from_index];
  const NoteEvent& note = state.notes[to_index];
  double seconds = (note.startBeat - previous_note.startBeat) * *state.secondsPerBeat;
  double shift = std::fabs(static_cast<double>(to.fret - from.fret));
  if (seconds <= BEAT_EPS || shift == 0) {
    return;
  }
  if (shift / seconds > MAX_FRET_SHIFT_PER_SECOND) {
    state.issues.push_back(PlayabilityIssue{
        PlayabilityIssueType::kTooFast, 3, sorted({*from_index, to_index}), note.startBeat, false,
        "a " + num(shift) + "-fret shift in " + js::to_fixed(seconds, 3) + "s is beyond " + name});
  }
}

/** Layer 2: one hand cannot span that many frets at once. */
void check_stretch(Analysis& state, const StringedProfile& profile, const Group& group) {
  std::vector<double> frets;
  for (std::size_t member : group.members) {
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
    state.issues.push_back(PlayabilityIssue{
        PlayabilityIssueType::kStretchTooWide, 2, sorted(group.members), group.startBeat, true,
        "a " + num(span) + "-fret stretch exceeds the " + num(profile.maxStretch) +
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

/** Layers 2 and 3 for a string instrument, and the fingering that goes with them. */
void place_on_neck(Analysis& state, const StringedProfile& profile) {
  std::vector<double> string_free_at(profile.tuning.size(),
                                     -std::numeric_limits<double>::infinity());
  std::vector<std::optional<std::size_t>> string_held_by(profile.tuning.size());
  std::optional<StringFingering> previous;
  std::optional<std::size_t> previous_index;

  for (std::size_t index : state.order) {
    const NoteEvent& note = state.notes[index];
    NotePlacement& placement = state.placements[index];
    std::vector<StringFingering> candidates = fingerings_in(profile, note.pitch);
    if (candidates.empty()) {
      continue;
    }
    std::vector<StringFingering> free;
    for (const StringFingering& candidate : candidates) {
      if (string_free_at[candidate.string] <= note.startBeat + BEAT_EPS) {
        free.push_back(candidate);
      }
    }
    if (free.empty()) {
      // [...new Set([...blocked, index])].sort()
      std::vector<std::size_t> involved;
      std::set<std::size_t> seen;
      for (const StringFingering& candidate : candidates) {
        const std::optional<std::size_t>& held = string_held_by[candidate.string];
        if (held && seen.insert(*held).second) {
          involved.push_back(*held);
        }
      }
      if (seen.insert(index).second) {
        involved.push_back(index);
      }
      state.issues.push_back(PlayabilityIssue{
          PlayabilityIssueType::kStringConflict, 2, sorted(std::move(involved)), note.startBeat,
          true, "MIDI " + num(note.pitch) + " needs a string already sounding on " + profile.name});
    }
    const std::vector<StringFingering>& pool = free.empty() ? candidates : free;
    StringFingering chosen = pool.front();
    for (std::size_t k = 1; k < pool.size(); ++k) {
      if (fingering_cost(pool[k], previous) < fingering_cost(chosen, previous)) {
        chosen = pool[k];
      }
    }
    placement.fingering = chosen;
    string_free_at[chosen.string] = note.startBeat + note.durationBeat;
    string_held_by[chosen.string] = index;

    state.movement += 1;
    if (previous) {
      state.movement +=
          std::fabs(static_cast<double>(chosen.fret - previous->fret)) +
          std::fabs(static_cast<double>(chosen.string) - static_cast<double>(previous->string));
      check_shift_speed(state, profile.name, previous_index, index, *previous, chosen);
    }
    previous = chosen;
    previous_index = index;
  }

  for (const Group& group : sounding_groups(state)) {
    check_stretch(state, profile, group);
    check_polyphony(state, profile.name, profile.polyphony, group);
  }
}

/** One take a percussion part is recorded on: the kit, or a voice dubbed over it. */
struct KitPass {
  std::string id;
  std::vector<std::size_t> members;
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
  /** Last stroke of each limb on each pass, as a note index. */
  std::map<std::string, std::size_t> lastStroke;
};

/** The passes one onset is played on: the kit, then each overdubbed voice in order met. */
std::vector<KitPass> passes_at(const Analysis& state, const Kit& kit,
                               const std::vector<std::size_t>& members) {
  std::vector<KitPass> passes{KitPass{"kit", {}}};
  std::map<int, std::size_t> overdub_pass;
  for (std::size_t index : members) {
    int pitch = state.notes[index].pitch;
    if (kit.overdub.count(pitch) == 0) {
      passes[0].members.push_back(index);
      continue;
    }
    auto it = overdub_pass.find(pitch);
    if (it == overdub_pass.end()) {
      it = overdub_pass.emplace(pitch, passes.size()).first;
      passes.push_back(KitPass{"overdub " + num(pitch), {}});
    }
    passes[it->second].members.push_back(index);
  }
  return passes;
}

/** Layer 3: one limb cannot strike twice that close together. */
void check_stroke_speed(Analysis& state, const std::string& name, std::size_t from_index,
                        std::size_t to_index, Limb limb) {
  if (!state.secondsPerBeat) {
    return;
  }
  const NoteEvent& previous_note = state.notes[from_index];
  const NoteEvent& note = state.notes[to_index];
  double seconds = (note.startBeat - previous_note.startBeat) * *state.secondsPerBeat;
  if (seconds <= BEAT_EPS || seconds >= MIN_LIMB_STROKE_SECONDS) {
    return;
  }
  state.issues.push_back(PlayabilityIssue{PlayabilityIssueType::kTooFast, 3,
                                          sorted({from_index, to_index}), note.startBeat, false,
                                          std::string(to_string(limb)) + " strikes twice " +
                                              js::to_fixed(seconds, 3) + "s apart on " + name});
}

/** Hand every stroke of one pass to a limb; true when the pass wants more limbs than it has. */
bool place_pass(Analysis& state, const Kit& kit, const KitPass& pass, KitMemory& memory) {
  std::vector<Limb> taken;
  bool conflicted = false;
  // The most constrained voice picks first.
  std::vector<std::size_t> members = pass.members;
  std::stable_sort(members.begin(), members.end(), [&](std::size_t a, std::size_t b) {
    std::size_t left = limbs_for(kit, state.notes[a].pitch).size();
    std::size_t right = limbs_for(kit, state.notes[b].pitch).size();
    return left != right ? left < right : a < b;
  });
  for (std::size_t index : members) {
    const NoteEvent& note = state.notes[index];
    NotePlacement& placement = state.placements[index];
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
      std::size_t previous_index = last->second;
      if (state.notes[previous_index].pitch != note.pitch) {
        // The limb had to travel across the kit rather than repeat a voice.
        state.movement += 1;
      }
      check_stroke_speed(state, kit.profile.name, previous_index, index, chosen);
    }
    memory.lastStroke[stroke_key] = index;
  }
  return conflicted;
}

/** Note indices sharing each distinct onset, in onset order; silent notes take no limb. */
std::vector<Group> onset_groups(const Analysis& state) {
  std::vector<Group> groups;
  for (std::size_t index : state.order) {
    const NoteEvent& note = state.notes[index];
    if (note.durationBeat <= 0) {
      continue;
    }
    if (groups.empty() || !is_simultaneous(groups.back().startBeat, note.startBeat)) {
      groups.push_back(Group{note.startBeat, {}});
    }
    groups.back().members.push_back(index);
  }
  return groups;
}

/** Layers 2 and 3 for a kit, and the limb assignment that goes with them. */
void place_on_kit(Analysis& state, const Kit& kit) {
  KitMemory memory;
  for (const Group& group : onset_groups(state)) {
    bool conflicted = false;
    for (const KitPass& pass : passes_at(state, kit, group.members)) {
      if (!place_pass(state, kit, pass, memory)) {
        continue;
      }
      conflicted = true;
      state.issues.push_back(PlayabilityIssue{
          PlayabilityIssueType::kLimbConflict, 2, sorted(pass.members), group.startBeat, true,
          num(static_cast<double>(pass.members.size())) +
              " simultaneous strokes cannot be shared among the limbs of " + kit.profile.name});
    }
    if (!conflicted) {
      check_polyphony(state, kit.profile.name, kit.profile.polyphony, group);
    }
  }
}

/** Movement per unit time, on a saturating 1..5 scale. */
double difficulty_of(const Analysis& state, std::optional<double> bpm) {
  double first = std::numeric_limits<double>::infinity();
  double last = -std::numeric_limits<double>::infinity();
  for (const NoteEvent& note : state.notes) {
    first = js::min(first, note.startBeat);
    last = js::max(last, note.startBeat + js::max(0, note.durationBeat));
  }
  double span_beats = last - first;
  if (!std::isfinite(span_beats) || span_beats <= BEAT_EPS) {
    return MIN_DIFFICULTY;
  }
  double seconds = (span_beats * 60) / (bpm ? *bpm : REFERENCE_BPM);
  double rate = state.movement / seconds;
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
    assert_range(*bpm, std::numeric_limits<double>::denorm_min(), 1000, "playability bpm");
  }
  // The profile is read before answering, whether or not a note would expose a contradiction.
  InstrumentProfile instrument = to_instrument_profile(profile, "playability profile");

  Analysis state{notes, {}, {}, {}, 0, std::nullopt};
  state.order.resize(notes.size());
  state.placements.resize(notes.size());
  for (std::size_t i = 0; i < notes.size(); ++i) {
    state.order[i] = i;
    state.placements[i].note = i;
  }
  std::stable_sort(state.order.begin(), state.order.end(), [&](std::size_t a, std::size_t b) {
    // left.startBeat - right.startBeat || left.pitch - right.pitch || a - b
    double by_onset = notes[a].startBeat - notes[b].startBeat;
    if (by_onset != 0) {
      return by_onset < 0;
    }
    if (notes[a].pitch != notes[b].pitch) {
      return notes[a].pitch < notes[b].pitch;
    }
    return a < b;
  });
  if (bpm) {
    state.secondsPerBeat = 60 / *bpm;
  }

  if (const auto* stringed = std::get_if<StringedProfile>(&instrument)) {
    check_existence(state, stringed->name, stringed->articulations,
                    [&](int pitch) { return sounds_in(instrument, pitch); });
    place_on_neck(state, *stringed);
  } else {
    const auto& percussion = std::get<PercussionProfile>(instrument);
    // Read once, so the per-note stages below are lookups.
    Kit kit = read_kit(percussion);
    check_existence(state, percussion.name, percussion.articulations,
                    [&](int pitch) { return !limbs_for(kit, pitch).empty(); });
    place_on_kit(state, kit);
  }

  return PlayabilityReport{difficulty_of(state, bpm), std::move(state.issues),
                           std::move(state.placements)};
}

}  // namespace cantus
