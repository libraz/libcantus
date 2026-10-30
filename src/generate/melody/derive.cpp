// Derived motif statements: ts/src/generate/melody/derive.ts.

#include "generate/melody/derive.h"

#include <algorithm>
#include <cmath>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/generate/motif.h"
#include "cantus/theory/scale.h"
#include "generate/melody/limits.gen.h"
#include "generate/melody/pitch_dp.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

MotifCell to_cell(const std::vector<MotifNote>& notes) {
  MotifCell cell;
  for (const MotifNote& note : notes) {
    NoteEvent event;
    event.pitch = static_cast<int>(note.pitch);
    event.startBeat = note.startBeat;
    event.durationBeat = note.durationBeat;
    cell.notes.push_back(event);
  }
  return cell;
}

/** Scale a cell's timing about its first onset, unless the ratio leaves it as it is. */
MotifCell stretched(const MotifCell& cell, double time_ratio) {
  return time_ratio == 1 ? cell : transform_motif(cell, MotifTransform::kAugment, time_ratio);
}

/** The shape a relation gives a cell, before it is placed at any pitch level. */
MotifCell shaped(const MotifCell& cell, const MotifRelationSummary& relation) {
  switch (relation.kind) {
    case MotifRelationKind::kRepetition:
      return cell;
    case MotifRelationKind::kTransposition:
    case MotifRelationKind::kTonalTransposition:
      return stretched(cell, relation.timeRatio);
    case MotifRelationKind::kInversion:
      return stretched(transform_motif(cell, MotifTransform::kInvert), relation.timeRatio);
    case MotifRelationKind::kRetrograde:
      return stretched(transform_motif(cell, MotifTransform::kRetrograde), relation.timeRatio);
    case MotifRelationKind::kRetrogradeInversion:
      return stretched(transform_motif(transform_motif(cell, MotifTransform::kInvert),
                                       MotifTransform::kRetrograde),
                       relation.timeRatio);
    case MotifRelationKind::kAugmentation:
      return transform_motif(cell, MotifTransform::kAugment, relation.timeRatio);
    case MotifRelationKind::kDiminution:
      return transform_motif(cell, MotifTransform::kDiminish, 1 / relation.timeRatio);
  }
  return cell;
}

/** How many of a statement's notes fall outside the register. */
double outside_count(const std::vector<MotifNote>& notes, const PhraseFrame& frame) {
  double count = 0;
  for (const MotifNote& note : notes) {
    if (note.pitch < frame.low || note.pitch > frame.high) {
      count += 1;
    }
  }
  return count;
}

/** Whether `level` ranks before `best` by distance from the planned level, then by value. */
bool nearer_level(double level, double best, double planned) {
  double distance = std::abs(level - planned);
  double best_distance = std::abs(best - planned);
  return distance < best_distance || (distance == best_distance && level < best);
}

}  // namespace

std::vector<double> relation_levels(MotifRelationKind kind) {
  return relation_levels(kind, -MELODY_LEVEL_REACH, MELODY_LEVEL_REACH);
}

std::vector<double> relation_levels(MotifRelationKind kind, double low, double high) {
  auto between = [](double from, double to, bool skip_zero) {
    std::vector<double> levels;
    for (double level = std::ceil(from); level <= to; level += 1) {
      if (!(skip_zero && level == 0)) {
        levels.push_back(level);
      }
    }
    return levels;
  };
  switch (kind) {
    case MotifRelationKind::kRepetition:
    case MotifRelationKind::kAugmentation:
    case MotifRelationKind::kDiminution:
      return {-MELODY_OCTAVE, 0, MELODY_OCTAVE};
    case MotifRelationKind::kTransposition:
      return between(low, high, true);
    case MotifRelationKind::kTonalTransposition:
      return between(-MELODY_TONAL_LEVEL_REACH, MELODY_TONAL_LEVEL_REACH, true);
    case MotifRelationKind::kInversion:
    case MotifRelationKind::kRetrograde:
    case MotifRelationKind::kRetrogradeInversion:
      return between(low, high, false);
  }
  return {};
}

std::vector<MotifNote> replay_at(const std::vector<MotifNote>& source,
                                 const MotifRelationSummary& relation, double level,
                                 double start_beat, const KeyScale& key) {
  MotifCell cell = shaped(to_cell(source), relation);
  if (cell.notes.empty()) {
    throw js::TypeError("Cannot read properties of undefined (reading 'startBeat')");
  }
  const NoteEvent& first = cell.notes.front();
  double offset = start_beat - first.startBeat;
  double shift = source.front().pitch + level - first.pitch;
  std::vector<MotifNote> out;
  for (const NoteEvent& n : cell.notes) {
    MotifNote note;
    note.pitch = relation.kind == MotifRelationKind::kTonalTransposition
                     ? shift_by_scale_degrees(n.pitch, level, key)
                     : n.pitch + shift;
    note.startBeat = n.startBeat + offset;
    note.durationBeat = n.durationBeat;
    out.push_back(note);
  }
  return out;
}

std::vector<MotifNote> clip_statement(const std::vector<MotifNote>& notes, double end_beat) {
  std::vector<MotifNote> out;
  for (const MotifNote& n : notes) {
    if (n.startBeat < end_beat - BEAT_EPS) {
      MotifNote clipped = n;
      clipped.durationBeat = js::min(n.durationBeat, end_beat - n.startBeat);
      out.push_back(clipped);
    }
  }
  return out;
}

std::vector<MotifNote> repair_statement(const std::vector<MotifNote>& notes,
                                        const std::vector<bool>& forced, const PhraseFrame& frame) {
  std::vector<PitchSlot> slots;
  for (std::size_t index = 0; index < notes.size(); ++index) {
    const MotifNote& n = notes[index];
    if (forced[index]) {
      slots.push_back(PitchSlot{frame.candidatesAt(n.startBeat), frame.costAt(n.startBeat), false});
    } else {
      slots.push_back(PitchSlot{{n.pitch}, [](double) { return 0.0; }, true});
    }
  }
  std::optional<std::vector<double>> pitches = search_pitches(slots, frame.budget);
  if (!pitches) {
    throw NoSolutionError("no repair fits the statement into the register " +
                              js::to_string(frame.low) + ".." + js::to_string(frame.high),
                          frame.at);
  }
  std::vector<MotifNote> out = notes;
  for (std::size_t index = 0; index < out.size(); ++index) {
    out[index].pitch = (*pitches)[index];
  }
  return out;
}

std::vector<MotifNote> place_derived(const std::vector<MotifNote>& source,
                                     const MotifRelationSummary& relation, double start_beat,
                                     double end_beat, const KeyScale& key, const PhraseFrame& frame,
                                     const std::vector<MotifNote>& before) {
  double planned = relation.kind == MotifRelationKind::kTonalTransposition
                       ? relation.degrees.value_or(0)
                       : relation.semitones;
  auto replay = [&](double level) {
    return clip_statement(replay_at(source, relation, level, start_beat, key), end_beat);
  };
  std::vector<double> base;
  for (const MotifNote& n : replay(0)) {
    base.push_back(n.pitch);
  }
  std::vector<double> levels =
      relation_levels(relation.kind, js::max(-MELODY_LEVEL_REACH, frame.low - js::min(base)),
                      js::min(MELODY_LEVEL_REACH, frame.high - js::max(base)));
  struct Best {
    double level;
    std::vector<MotifNote> notes;
    double cost;
  };
  std::optional<Best> best;
  for (double level : levels) {
    std::vector<MotifNote> notes = replay(level);
    if (outside_count(notes, frame) > 0) {
      continue;
    }
    double sum = 0;
    for (const MotifNote& n : notes) {
      sum += std::abs(n.pitch - frame.targetAt(n.startBeat));
    }
    double distance = sum / static_cast<double>(notes.size());
    double cost = frame.misfits(notes, before) + MELODY_LEVEL_TARGET_COST * distance +
                  MELODY_LEVEL_PLAN_COST * std::abs(level - planned);
    if (!best || cost < best->cost ||
        (cost == best->cost && nearer_level(level, best->level, planned))) {
      best = Best{level, std::move(notes), cost};
    }
  }
  if (best) {
    return best->notes;
  }
  struct Fallback {
    double level;
    std::vector<MotifNote> notes;
    double outside;
  };
  std::optional<Fallback> fallback;
  for (double level : relation_levels(relation.kind)) {
    std::vector<MotifNote> notes = replay(level);
    double outside = outside_count(notes, frame);
    if (!fallback || outside < fallback->outside ||
        (outside == fallback->outside && nearer_level(level, fallback->level, planned))) {
      fallback = Fallback{level, std::move(notes), outside};
    }
  }
  const std::vector<MotifNote>& notes = fallback->notes;
  std::vector<bool> forced;
  for (const MotifNote& n : notes) {
    forced.push_back(n.pitch < frame.low || n.pitch > frame.high);
  }
  return repair_statement(notes, forced, frame);
}

std::vector<MotifNote> vary_statement(const std::vector<MotifNote>& source, double start_beat,
                                      const PhraseFrame& frame) {
  if (source.empty()) {
    throw js::TypeError("Cannot read properties of undefined (reading 'startBeat')");
  }
  double offset = start_beat - source.front().startBeat;
  std::size_t last = source.size() - 1;
  auto inside = [&frame](double pitch) { return pitch >= frame.low && pitch <= frame.high; };
  double outer[2] = {source.front().pitch, source[last].pitch};
  std::optional<double> shift;
  for (double candidate :
       {0.0, static_cast<double>(MELODY_OCTAVE), -static_cast<double>(MELODY_OCTAVE)}) {
    if (inside(outer[0] + candidate) && inside(outer[1] + candidate)) {
      shift = candidate;
      break;
    }
  }
  std::vector<MotifNote> notes = source;
  for (MotifNote& n : notes) {
    n.startBeat += offset;
  }
  std::vector<PitchSlot> slots;
  for (std::size_t index = 0; index < notes.size(); ++index) {
    const MotifNote& n = notes[index];
    if ((index == 0 || index == last) && shift) {
      slots.push_back(PitchSlot{{n.pitch + *shift}, [](double) { return 0.0; }, true});
    } else {
      slots.push_back(PitchSlot{frame.candidatesAt(n.startBeat), frame.costAt(n.startBeat), false});
    }
  }
  std::optional<std::vector<double>> pitches =
      search_pitches(slots, frame.budget, [&source](std::size_t index, double from, double to) {
        return MELODY_VARIATION_STEP_COST *
               std::abs(to - from - (source[index].pitch - source[index - 1].pitch));
      });
  if (!pitches) {
    throw NoSolutionError("no variation line fits the register " + js::to_string(frame.low) + ".." +
                              js::to_string(frame.high),
                          frame.at);
  }
  for (std::size_t index = 0; index < notes.size(); ++index) {
    notes[index].pitch = (*pitches)[index];
  }
  return notes;
}

}  // namespace cantus
