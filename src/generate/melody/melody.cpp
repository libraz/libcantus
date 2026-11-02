// Melody generation from a composition plan: ts/src/generate/melody/index.ts.

#include "generate/melody/melody.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <unordered_map>
#include <utility>

#include "analyze/form/internal.h"
#include "analyze/rhythm/internal.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/generate/melody.h"
#include "cantus/generate/motif.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "core/validation/validation.h"
#include "generate/melody/derive.h"
#include "generate/melody/limits.gen.h"
#include "generate/melody/pitch_dp.h"
#include "generate/plan/harmony.h"
#include "generate/plan/internal.h"
#include "generate/plan/timeline.h"
#include "generate/plan/types.h"
#include "js/math.h"
#include "js/number.h"
#include "js/sort.h"

namespace cantus {

namespace {

/** A note held by reference: TS repairs a closing note in place, in every statement sharing it. */
using NotePtr = std::shared_ptr<MotifNote>;
using Statement = std::vector<NotePtr>;

/** One stretch of a phrase: a motif statement or a span no motif covers. */
struct Segment {
  double startBeat = 0;
  double endBeat = 0;
  /** The motif's index, or -1 for a span no motif covers. */
  int motif = -1;
};

/** Everything a phrase's generation reads, resolved once per call. */
struct Scene {
  const CompositionPlan* plan = nullptr;
  ResolvedContext ctx;
  std::optional<double> budget;
  ChordTimeline timeline;
  HarmonyMisfits harmony_misfits;
  std::vector<KeyScale> scales;
  /** The scale index at each beat asked for, so the plan's chords are searched once per beat. */
  mutable std::unordered_map<double, std::size_t> scale_at_beat;
  std::vector<std::vector<int>> members;
  std::vector<PhraseFrame> frames;
  std::map<int, Statement> statements;
  std::map<std::pair<int, double>, Statement> free;
  std::set<int> in_progress;
};

std::vector<MotifNote> values_of(const Statement& statement) {
  std::vector<MotifNote> out;
  for (const NotePtr& note : statement) {
    out.push_back(*note);
  }
  return out;
}

Statement statement_of_values(const std::vector<MotifNote>& notes) {
  Statement out;
  for (const MotifNote& note : notes) {
    out.push_back(std::make_shared<MotifNote>(note));
  }
  return out;
}

const PlannedPhrase& phrase_of(const Scene& scene, int index) {
  return scene.plan->phrases[static_cast<std::size_t>(index)];
}

/** The scale of the key the chord at a beat is named in; the home key where no chord sounds. */
const KeyScale& scale_at(const Scene& scene, double beat) {
  auto found = scene.scale_at_beat.find(beat);
  if (found == scene.scale_at_beat.end()) {
    const PlannedChord* entry = chord_entry_at(*scene.plan, beat);
    found = scene.scale_at_beat
                .emplace(beat, entry != nullptr ? static_cast<std::size_t>(entry->key) : 0)
                .first;
  }
  return scene.scales[found->second];
}

/** The pitch a phrase's target curve asks for at a beat. */
double target_pitch(const PlannedPhrase& phrase, double beat) {
  double length = phrase.endBeat - phrase.startBeat;
  double t = length > 0 ? js::min(js::max((beat - phrase.startBeat) / length, 0.0), 1.0) : 0;
  const PlannedRegister& range = phrase.register_;
  return range.mean +
         ((range.high - range.low) / 2) * planned_contour_at(phrase.shape, phrase.peakPosition, t);
}

/** Every pitch of a phrase's register, ascending. */
std::vector<double> register_pitches(const PlannedPhrase& phrase) {
  std::vector<double> pitches;
  for (double pitch = phrase.register_.low; pitch <= phrase.register_.high; pitch += 1) {
    pitches.push_back(pitch);
  }
  return pitches;
}

/** The search and placement view of one phrase. */
PhraseFrame frame_of(Scene* scene, int index) {
  const PlannedPhrase& phrase = phrase_of(*scene, index);
  PhraseFrame frame;
  frame.low = phrase.register_.low;
  frame.high = phrase.register_.high;
  frame.at = phrase.startBeat;
  frame.budget = scene->budget;
  std::vector<double> register_list = register_pitches(phrase);
  Draw draw = scene->ctx.part("melody");
  double low = frame.low;
  double high = frame.high;
  frame.candidatesAt = [scene, &phrase, register_list, low, high](double beat) {
    PositionClass position = position_class(beat, scene->plan->meters);
    Nullable<Chord> chord = scene->timeline.at(beat);
    std::optional<std::vector<int>> tones;
    if (position == PositionClass::kStrong && chord) {
      tones = chord_pitch_classes(*chord);
    }
    const KeyScale& scale = scale_at(*scene, beat);
    std::vector<double> candidates;
    if (position == PositionClass::kOff) {
      candidates = register_list;
    } else if (tones) {
      for (double pitch : register_list) {
        if (std::find(tones->begin(), tones->end(), pitch_class_of(pitch)) != tones->end()) {
          candidates.push_back(pitch);
        }
      }
    } else {
      for (double pitch : register_list) {
        if (is_scale_tone(pitch, scale)) {
          candidates.push_back(pitch);
        }
      }
    }
    if (candidates.empty()) {
      throw NoSolutionError("no " + std::string(position_class_name(position)) + " pitch at beat " +
                                js::to_string(beat) + " fits the register " + js::to_string(low) +
                                ".." + js::to_string(high),
                            phrase.startBeat);
    }
    return candidates;
  };
  frame.costAt = [scene, &phrase, draw, index](double beat) {
    bool off = position_class(beat, scene->plan->meters) == PositionClass::kOff;
    const KeyScale* scale = &scale_at(*scene, beat);
    double target = target_pitch(phrase, beat);
    return std::function<double(double)>([off, scale, target, draw, index, beat](double pitch) {
      double cost = MELODY_TARGET_COST * std::abs(pitch - target);
      if (off && !is_scale_tone(pitch, *scale)) {
        cost += MELODY_OFF_SCALE_COST;
      }
      return cost + draw.float_(0, MELODY_TIE_BREAK,
                                {static_cast<double>(index), std::string("tie"), beat, pitch});
    });
  };
  frame.targetAt = [&phrase](double beat) { return target_pitch(phrase, beat); };
  frame.misfits = [scene](const std::vector<MotifNote>& notes,
                          const std::vector<MotifNote>& before) {
    std::vector<MotifNote> joined = before;
    joined.insert(joined.end(), notes.begin(), notes.end());
    auto read = scene->harmony_misfits(to_cell(joined).notes);
    double count = 0;
    for (std::size_t i = before.size(); i < read.size(); ++i) {
      if (read[i]) {
        count += 1;
      }
    }
    return count;
  };
  return frame;
}

/** The motifs placed in each phrase, listed by the phrase or naming it, in onset order. */
std::vector<std::vector<int>> members_of(const CompositionPlan& plan) {
  std::vector<std::vector<int>> out;
  for (std::size_t index = 0; index < plan.phrases.size(); ++index) {
    std::set<int> found(plan.phrases[index].motifs.begin(), plan.phrases[index].motifs.end());
    for (std::size_t m = 0; m < plan.motifs.size(); ++m) {
      if (plan.motifs[m].phrase == static_cast<int>(index)) {
        found.insert(static_cast<int>(m));
      }
    }
    std::vector<int> sorted(found.begin(), found.end());
    // A phrase may name a motif the plan does not hold; it sorts as if it started at beat 0.
    auto start_of = [&plan](int m) {
      return static_cast<std::size_t>(m) < plan.motifs.size()
                 ? plan.motifs[static_cast<std::size_t>(m)].startBeat
                 : 0.0;
    };
    std::stable_sort(sorted.begin(), sorted.end(), [&start_of](int a, int b) {
      double by_start = start_of(a) - start_of(b);
      return by_start != 0 ? by_start < 0 : a < b;
    });
    out.push_back(std::move(sorted));
  }
  return out;
}

/** A phrase cut into its motif statements and the spans between them. */
std::vector<Segment> segments_of(const Scene& scene, int index) {
  const PlannedPhrase& phrase = phrase_of(scene, index);
  std::vector<Segment> segments;
  double cursor = phrase.startBeat;
  for (int m : scene.members[static_cast<std::size_t>(index)]) {
    if (static_cast<std::size_t>(m) >= scene.plan->motifs.size()) {
      continue;
    }
    const PlannedMotif& motif = scene.plan->motifs[static_cast<std::size_t>(m)];
    if (motif.startBeat > cursor + BEAT_EPS) {
      segments.push_back(Segment{cursor, motif.startBeat, -1});
    }
    segments.push_back(Segment{motif.startBeat, motif.endBeat, m});
    cursor = js::max(cursor, motif.endBeat);
  }
  if (phrase.endBeat > cursor + BEAT_EPS) {
    segments.push_back(Segment{cursor, phrase.endBeat, -1});
  }
  return segments;
}

/** Pitchless notes at the given onsets, each lasting to the next and the last to `end_beat`. */
Statement notes_at(const std::vector<double>& onsets, double end_beat) {
  Statement out;
  for (std::size_t i = 0; i < onsets.size(); ++i) {
    MotifNote note;
    note.pitch = 0;
    note.startBeat = onsets[i];
    note.durationBeat = (i + 1 < onsets.size() ? onsets[i + 1] : end_beat) - onsets[i];
    out.push_back(std::make_shared<MotifNote>(note));
  }
  return out;
}

/** The sixteenth-note grid, counted from each bar line, inside `[start_beat, end_beat)`. */
std::vector<double> onset_slots(const Scene& scene, double start_beat, double end_beat) {
  const MeterMap& meters = scene.plan->meters;
  std::vector<double> slots{start_beat};
  double bar = bar_start_beat(start_beat, meters);
  while (bar < end_beat - BEAT_EPS) {
    double bar_end = bar + beats_per_bar_at(bar, meters);
    for (double k = 0; bar + k / MELODY_RHYTHM_SUBDIVISION < bar_end - BEAT_EPS; k += 1) {
      double beat = bar + k / MELODY_RHYTHM_SUBDIVISION;
      if (beat > start_beat + BEAT_EPS && beat < end_beat - BEAT_EPS) {
        slots.push_back(beat);
      }
    }
    // A span no bar line bounds is refused here rather than after its grid is built.
    assert_generation_budget(static_cast<double>(slots.size()), "melody onset slots", scene.budget);
    bar = bar_end;
  }
  return slots;
}

/** Draw `count` onsets over `[start_beat, end_beat)`: the first on `start_beat`. */
Statement draw_onsets(const Scene& scene, int phrase_index, double start_beat, double end_beat,
                      double count) {
  std::vector<double> slots = onset_slots(scene, start_beat, end_beat);
  assert_generation_budget(static_cast<double>(slots.size()) * js::max(1.0, count - 1),
                           "melody onset slots", scene.budget);
  if (count - 1 > static_cast<double>(slots.size()) - 1) {
    throw NoSolutionError(js::to_string(count) + " onsets do not fit the sixteenth grid of beats " +
                              js::to_string(start_beat) + ".." + js::to_string(end_beat),
                          phrase_of(scene, phrase_index).startBeat);
  }
  const PlannedRhythm& target = scene.plan->rhythm;
  std::vector<int> levels;
  std::map<int, double> per_level;
  for (double beat : slots) {
    int level = rhythm_level(beat, scene.plan->meters);
    levels.push_back(level);
    per_level[level] += 1;
  }
  std::vector<double> level_weight;
  for (int level : levels) {
    double share = static_cast<std::size_t>(level) < target.onsetLevels.size()
                       ? target.onsetLevels[static_cast<std::size_t>(level)]
                       : 0;
    level_weight.push_back(share / per_level[level]);
  }
  Draw draw = scene.ctx.part("melody");
  std::vector<double> onsets{start_beat};
  std::size_t current = 0;
  for (double k = 1; k < count; k += 1) {
    // The last slot this onset may take and still leave one for each note after it.
    std::size_t last = slots.size() - 1 - static_cast<std::size_t>(count - 1 - k);
    std::vector<std::size_t> candidates;
    for (std::size_t j = current + 1; j <= last; ++j) {
      candidates.push_back(j);
    }
    auto gap_share = [&](std::size_t j) {
      int bin = ioi_bin_index(slots[j] - slots[current]);
      return bin >= 0 && static_cast<std::size_t>(bin) < target.interOnsetShares.size()
                 ? target.interOnsetShares[static_cast<std::size_t>(bin)]
                 : 0;
    };
    std::vector<double> weights;
    for (std::size_t j : candidates) {
      weights.push_back(level_weight[j] * gap_share(j));
    }
    auto any_positive = [](const std::vector<double>& list) {
      return std::any_of(list.begin(), list.end(), [](double w) { return w > 0; });
    };
    if (!any_positive(weights)) {
      weights.clear();
      for (std::size_t j : candidates) {
        weights.push_back(level_weight[j]);
      }
    }
    if (!any_positive(weights)) {
      weights.assign(candidates.size(), 1.0);
    }
    double total = 0;
    for (double w : weights) {
      total += w;
    }
    double drawn =
        draw.float_(0, 1, {static_cast<double>(phrase_index), std::string("onset"), start_beat, k});
    double pick_target = drawn * total;
    std::size_t pick = candidates.size() - 1;
    for (std::size_t c = 0; c < candidates.size(); ++c) {
      pick_target -= weights[c];
      if (pick_target < 0) {
        pick = c;
        break;
      }
    }
    current = candidates[pick];
    onsets.push_back(slots[current]);
  }
  return notes_at(onsets, end_beat);
}

/** A root's rhythm: its plan's onset gaps laid from the statement's start, or onsets drawn. */
Statement place_rhythm(const Scene& scene, const PlannedMotif& motif) {
  if (!motif.rhythm) {
    return draw_onsets(scene, motif.phrase, motif.startBeat, motif.endBeat, motif.notes);
  }
  std::vector<double> onsets{motif.startBeat};
  for (double gap : *motif.rhythm) {
    onsets.push_back(onsets.back() + gap);
  }
  return notes_at(onsets, motif.endBeat);
}

/** Choose pitches for a rhythm by the chain search over each note's candidates. */
Statement searched_line(const Statement& rhythm, const PhraseFrame& frame) {
  std::vector<PitchSlot> slots;
  for (const NotePtr& note : rhythm) {
    slots.push_back(
        PitchSlot{frame.candidatesAt(note->startBeat), frame.costAt(note->startBeat), false});
  }
  std::optional<std::vector<double>> pitches = search_pitches(slots, frame.budget);
  if (!pitches) {
    throw NoSolutionError("no pitch line fits the register " + js::to_string(frame.low) + ".." +
                              js::to_string(frame.high),
                          frame.at);
  }
  Statement out;
  for (std::size_t i = 0; i < rhythm.size(); ++i) {
    MotifNote note = *rhythm[i];
    note.pitch = (*pitches)[i];
    out.push_back(std::make_shared<MotifNote>(note));
  }
  return out;
}

Statement line_before(Scene& scene, int index, double beat);

/** A motif statement's notes: written for a root, placed from its source otherwise. */
Statement statement_of(Scene& scene, int m) {
  auto known = scene.statements.find(m);
  if (known != scene.statements.end()) {
    return known->second;
  }
  scene.in_progress.insert(m);
  const PlannedMotif& motif = scene.plan->motifs[static_cast<std::size_t>(m)];
  const PhraseFrame& frame = scene.frames[static_cast<std::size_t>(motif.phrase)];
  Statement notes;
  if (!motif.from) {
    if (motif.endBeat - motif.startBeat <= BEAT_EPS) {
      throw NoSolutionError(
          "root motif " + js::to_string(m) + " spans no time to place its notes in", frame.at);
    }
    notes = searched_line(place_rhythm(scene, motif), frame);
  } else {
    Statement source = statement_of(scene, *motif.from);
    if (!motif.relation) {
      notes = statement_of_values(vary_statement(values_of(source), motif.startBeat, frame));
    } else {
      const KeyScale& scale = scale_at(scene, motif.startBeat);
      Statement before = line_before(scene, motif.phrase, motif.startBeat);
      notes = statement_of_values(place_derived(values_of(source), *motif.relation, motif.startBeat,
                                                motif.endBeat, scale, frame, values_of(before)));
    }
  }
  scene.in_progress.erase(m);
  scene.statements[m] = notes;
  return notes;
}

/** How many notes a span no motif covers carries: the phrase's density over its bars, at least one.
 */
double free_note_count(const Scene& scene, int index, const Segment& segment) {
  const PlannedPhrase& phrase = phrase_of(scene, index);
  double bars = bar_span_of(segment.startBeat, segment.endBeat, scene.plan->meters);
  return js::max(1.0, js::round(phrase.onsetDensity * bars));
}

/** Fill a span no motif covers with drawn onsets and searched pitches. */
Statement free_span(Scene& scene, int index, const Segment& segment) {
  std::pair<int, double> key{index, segment.startBeat == 0 ? 0.0 : segment.startBeat};
  auto known = scene.free.find(key);
  if (known != scene.free.end()) {
    return known->second;
  }
  Statement rhythm = draw_onsets(scene, index, segment.startBeat, segment.endBeat,
                                 free_note_count(scene, index, segment));
  Statement notes = searched_line(rhythm, scene.frames[static_cast<std::size_t>(index)]);
  scene.free[key] = notes;
  return notes;
}

/** A phrase's notes in the segments that end by `beat`: the line a statement starting there
 * follows. */
Statement line_before(Scene& scene, int index, double beat) {
  Statement line;
  for (const Segment& segment : segments_of(scene, index)) {
    if (segment.endBeat > beat + BEAT_EPS) {
      break;
    }
    if (segment.motif < 0) {
      Statement span = free_span(scene, index, segment);
      line.insert(line.end(), span.begin(), span.end());
    } else if (scene.in_progress.count(segment.motif) == 0) {
      Statement statement = statement_of(scene, segment.motif);
      line.insert(line.end(), statement.begin(), statement.end());
    }
  }
  js::array_sort(line,
                 [](const NotePtr& a, const NotePtr& b) { return a->startBeat - b->startBeat; });
  return line;
}

/** The note a phrase closes on: the one sounding at its final bar's downbeat, else the first after.
 */
int held_note_index(const Scene& scene, int index, const Statement& line, double downbeat) {
  const PlannedPhrase& phrase = phrase_of(scene, index);
  for (std::size_t i = 0; i < line.size(); ++i) {
    if (line[i]->startBeat <= downbeat + BEAT_EPS &&
        line[i]->startBeat + line[i]->durationBeat > downbeat + BEAT_EPS) {
      return static_cast<int>(i);
    }
  }
  for (std::size_t i = 0; i < line.size(); ++i) {
    if (line[i]->startBeat >= downbeat - BEAT_EPS &&
        line[i]->startBeat < phrase.endBeat - BEAT_EPS) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

/** A line with every note held at its pitch but the one at `free`, which takes `slot`. */
std::vector<PitchSlot> pinned_slots(const Statement& line, std::size_t free,
                                    const PitchSlot& slot) {
  std::vector<PitchSlot> slots;
  for (std::size_t i = 0; i < line.size(); ++i) {
    slots.push_back(i == free ? slot : pinned_slot(line[i]->pitch));
  }
  return slots;
}

/** Bend a phrase's closing note onto its cadence, holding every other note (in place). */
void repair_cadence(Scene& scene, int index, Statement& line, int held) {
  const PlannedPhrase& phrase = phrase_of(scene, index);
  if (!phrase.cadence) {
    return;
  }
  int target = held;
  for (int i = static_cast<int>(line.size()) - 1; target < 0 && i >= 0; --i) {
    if (position_class(line[static_cast<std::size_t>(i)]->startBeat, scene.plan->meters) !=
        PositionClass::kOff) {
      target = i;
    }
  }
  if (target < 0) {
    return;
  }
  const NotePtr& note = line[static_cast<std::size_t>(target)];
  std::optional<std::vector<int>> allowed =
      cadence_pitch_classes(*scene.plan, scene.timeline, *phrase.cadence, note->startBeat);
  if (!allowed) {
    return;
  }
  const PhraseFrame& frame = scene.frames[static_cast<std::size_t>(index)];
  std::vector<double> candidates;
  for (double pitch : register_pitches(phrase)) {
    if (std::find(allowed->begin(), allowed->end(), pitch_class_of(pitch)) != allowed->end()) {
      candidates.push_back(pitch);
    }
  }
  if (candidates.empty()) {
    throw NoSolutionError("no pitch in the register " + js::to_string(frame.low) + ".." +
                              js::to_string(frame.high) + " can end the " +
                              std::string(to_string(*phrase.cadence)) + " cadence",
                          frame.at);
  }
  if (std::find(allowed->begin(), allowed->end(), pitch_class_of(note->pitch)) != allowed->end()) {
    return;
  }
  std::vector<PitchSlot> slots =
      pinned_slots(line, static_cast<std::size_t>(target),
                   PitchSlot{candidates, frame.costAt(note->startBeat), false});
  std::optional<std::vector<double>> pitches = search_pitches(slots, frame.budget);
  if (!pitches) {
    throw NoSolutionError("no cadence pitch joins its neighbours without an augmented step",
                          frame.at);
  }
  note->pitch = (*pitches)[static_cast<std::size_t>(target)];
}

/** Re-choose the onset a phrase-final hold cut at the downbeat from the pitches its position
 * admits. */
void repick_cut_onset(Scene& scene, int index, Statement& line, int held) {
  const NotePtr note = line[static_cast<std::size_t>(held)];
  bool derived = false;
  for (const PlannedMotif& motif : scene.plan->motifs) {
    if (motif.from && note->startBeat >= motif.startBeat - BEAT_EPS &&
        note->startBeat < motif.endBeat - BEAT_EPS) {
      derived = true;
      break;
    }
  }
  if (phrase_of(scene, index).cadence || derived) {
    return;
  }
  const PhraseFrame& frame = scene.frames[static_cast<std::size_t>(index)];
  std::vector<double> candidates = frame.candidatesAt(note->startBeat);
  if (std::find(candidates.begin(), candidates.end(), note->pitch) != candidates.end()) {
    return;
  }
  std::vector<PitchSlot> slots =
      pinned_slots(line, static_cast<std::size_t>(held),
                   PitchSlot{candidates, frame.costAt(note->startBeat), false});
  std::optional<std::vector<double>> pitches = search_pitches(slots, frame.budget);
  if (!pitches) {
    throw NoSolutionError("no pitch at the final downbeat joins its neighbours", frame.at);
  }
  MotifNote repicked = *note;
  repicked.pitch = (*pitches)[static_cast<std::size_t>(held)];
  line[static_cast<std::size_t>(held)] = std::make_shared<MotifNote>(repicked);
}

/** A phrase's notes before cadence repair, in time order. */
Statement phrase_line(Scene& scene, int index) {
  Statement line;
  for (const Segment& segment : segments_of(scene, index)) {
    Statement part =
        segment.motif < 0 ? free_span(scene, index, segment) : statement_of(scene, segment.motif);
    line.insert(line.end(), part.begin(), part.end());
  }
  js::array_sort(line,
                 [](const NotePtr& a, const NotePtr& b) { return a->startBeat - b->startBeat; });
  return line;
}

/** Charge the pitch search against the budget before any search runs. */
void charge_pitch_search(const Scene& scene) {
  const CompositionPlan& plan = *scene.plan;
  double estimate = 0;
  for (std::size_t index = 0; index < plan.phrases.size(); ++index) {
    const PlannedPhrase& phrase = plan.phrases[index];
    double searched = 0;
    for (const Segment& segment : segments_of(scene, static_cast<int>(index))) {
      if (segment.motif < 0) {
        searched += free_note_count(scene, static_cast<int>(index), segment);
        continue;
      }
      const PlannedMotif& motif = plan.motifs[static_cast<std::size_t>(segment.motif)];
      if (!motif.relation) {
        searched += motif.notes;
      } else {
        estimate += motif.notes * static_cast<double>(relation_levels(motif.relation->kind).size());
      }
    }
    double range = js::max(0.0, phrase.register_.high - phrase.register_.low + 1);
    estimate += searched * MELODY_SEARCH_STATES_SQUARED * range * range;
  }
  assert_generation_budget(estimate, "melody pitch search", scene.budget);
}

}  // namespace

ResolvedContext melody_context(const CompositionPlan& plan,
                               const std::optional<GenerationContextInput>& input) {
  GenerationContext from_plan;
  from_plan.seed = static_cast<std::uint32_t>(plan.seed);
  from_plan.algorithmVersion = plan.algorithmVersion;
  if (!input) {
    return resolve_context(GenerationContextInput(from_plan));
  }
  if (const std::uint32_t* seed = std::get_if<std::uint32_t>(&input->value())) {
    from_plan.seed = *seed;
    return resolve_context(GenerationContextInput(from_plan));
  }
  GenerationContext read = std::get<GenerationContext>(input->value());
  if (read.rng) {
    throw InvalidInputError(
        "ctx.rng cannot drive a melody: every onset and tie-break is drawn at an address of phrase "
        "and beat under a seed; pass a seed instead");
  }
  if (!read.seed) {
    read.seed = static_cast<std::uint32_t>(plan.seed);
  }
  if (!read.algorithmVersion) {
    read.algorithmVersion = plan.algorithmVersion;
  }
  return resolve_context(GenerationContextInput(read));
}

std::vector<NoteEvent> generate_melody_with(const CompositionPlan& plan,
                                            std::optional<double> budget,
                                            const ResolvedContext& resolved) {
  Scene scene;
  scene.plan = &plan;
  scene.budget = budget;
  scene.timeline = plan_chord_timeline(plan);
  scene.ctx = resolved;
  scene.harmony_misfits = plan_harmony_misfits(plan, scene.timeline);
  for (const ResolvedKey& key : plan.keys) {
    scene.scales.push_back(scale_of(key));
  }
  scene.members = members_of(plan);
  for (std::size_t index = 0; index < plan.phrases.size(); ++index) {
    scene.frames.push_back(frame_of(&scene, static_cast<int>(index)));
  }
  charge_pitch_search(scene);
  Statement melody;
  for (std::size_t phrase_index = 0; phrase_index < plan.phrases.size(); ++phrase_index) {
    int index = static_cast<int>(phrase_index);
    Statement line = phrase_line(scene, index);
    double downbeat = final_downbeat(phrase_of(scene, index), plan.meters);
    int held = held_note_index(scene, index, line, downbeat);
    if (held >= 0) {
      line.resize(static_cast<std::size_t>(held) + 1);
      MotifNote note = *line[static_cast<std::size_t>(held)];
      if (note.startBeat < downbeat - BEAT_EPS) {
        // Cut at the downbeat, which becomes the onset the phrase is held on.
        double cut = downbeat - note.startBeat;
        MotifNote first = note;
        first.durationBeat = cut;
        line[static_cast<std::size_t>(held)] = std::make_shared<MotifNote>(first);
        MotifNote second = note;
        second.startBeat = downbeat;
        second.durationBeat = note.durationBeat - cut;
        line.push_back(std::make_shared<MotifNote>(second));
        held += 1;
        repick_cut_onset(scene, index, line, held);
      }
    }
    repair_cadence(scene, index, line, held);
    if (held >= 0) {
      // A copy, so the statements later derivations replay keep their own length.
      MotifNote note = *line[static_cast<std::size_t>(held)];
      note.durationBeat = plan.phrases[phrase_index].endBeat - note.startBeat;
      line[static_cast<std::size_t>(held)] = std::make_shared<MotifNote>(note);
    }
    melody.insert(melody.end(), line.begin(), line.end());
  }
  js::array_sort(melody,
                 [](const NotePtr& a, const NotePtr& b) { return a->startBeat - b->startBeat; });
  return motif_to_note_events(to_cell(values_of(melody)));
}

std::vector<NoteEvent> generate_melody(const CompositionPlan& plan, const MelodyOptions& opts) {
  assert_composition_plan(plan);
  if (opts.budget) {
    assert_positive_int(*opts.budget, "budget", kMaxSafeInteger);
  }
  return generate_melody_with(plan, opts.budget, melody_context(plan, opts.ctx));
}

}  // namespace cantus
