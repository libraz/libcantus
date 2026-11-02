// Checking a candidate melody against the plan it was written for:
// ts/src/generate/plan/evaluate.ts.

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <string>

#include "analyze/form/internal.h"
#include "analyze/melody/limits.gen.h"
#include "analyze/reference/internal.h"
#include "analyze/reference/measures.h"
#include "cantus/analyze/melody.h"
#include "cantus/analyze/rhythm.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/generate/plan.h"
#include "cantus/theory/scale.h"
#include "generate/melody/derive.h"
#include "generate/plan/harmony.h"
#include "generate/plan/internal.h"
#include "generate/plan/limits.gen.h"
#include "generate/plan/timeline.h"
#include "generate/plan/types.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

std::string_view to_string(ViolationKind kind) {
  switch (kind) {
    case ViolationKind::kSpan:
      return "span";
    case ViolationKind::kPhraseBoundary:
      return "phraseBoundary";
    case ViolationKind::kCadence:
      return "cadence";
    case ViolationKind::kHarmony:
      return "harmony";
    case ViolationKind::kMotifDerivation:
      return "motifDerivation";
    case ViolationKind::kMotifDisplaced:
      return "motifDisplaced";
    case ViolationKind::kRegister:
      return "register";
    case ViolationKind::kPeakPosition:
      return "peakPosition";
  }
  return "span";
}

std::string_view to_string(ViolationSeverity severity) {
  return severity == ViolationSeverity::kError ? "error" : "warning";
}

namespace {

using Notes = std::vector<NoteEvent>;
/** Positions in the time-ordered candidate. */
using Indices = std::vector<std::size_t>;

std::string number(double value) { return js::to_string(value); }

CompositionViolation violation(ViolationKind kind, ViolationSeverity severity, double at_beat,
                               std::string expected, std::string actual, std::string rationale) {
  CompositionViolation out;
  out.kind = kind;
  out.severity = severity;
  out.atBeat = at_beat;
  out.expected = std::move(expected);
  out.actual = std::move(actual);
  out.rationale = std::move(rationale);
  return out;
}

/** The plan's phrase boundaries strictly inside its span, ascending. */
std::vector<double> interior_boundaries(const CompositionPlan& plan) {
  std::set<double> beats;
  for (const PlannedPhrase& phrase : plan.phrases) {
    for (double beat : {phrase.startBeat, phrase.endBeat}) {
      if (beat > plan.span.startBeat + BEAT_EPS && beat < plan.span.endBeat - BEAT_EPS) {
        beats.insert(beat);
      }
    }
  }
  return std::vector<double>(beats.begin(), beats.end());
}

struct Rest {
  double startBeat = 0;
  double endBeat = 0;
};

/** Every stretch of silence in the candidate, from its span start to its span end. */
std::vector<Rest> rests_of(const Notes& melody, const CompositionPlan& plan) {
  std::vector<Rest> rests;
  double reach = plan.span.startBeat;
  for (const NoteEvent& note : melody) {
    if (note.startBeat > reach + BEAT_EPS) {
      rests.push_back(Rest{reach, note.startBeat});
    }
    reach = js::max(reach, note.startBeat + note.durationBeat);
  }
  if (plan.span.endBeat > reach + BEAT_EPS) {
    rests.push_back(Rest{reach, plan.span.endBeat});
  }
  return rests;
}

std::vector<CompositionViolation> phrase_boundary_violations(const Notes& melody,
                                                             const CompositionPlan& plan) {
  std::vector<Rest> rests = rests_of(melody, plan);
  std::vector<CompositionViolation> violations;
  for (double beat : interior_boundaries(plan)) {
    double pulse = pulse_beats(meter_at(beat, plan.meters));
    bool held = std::any_of(melody.begin(), melody.end(), [&](const NoteEvent& note) {
      return note.durationBeat >= PLAN_HELD_NOTE_BEATS - BEAT_EPS &&
             std::abs(note.startBeat + note.durationBeat - beat) <= pulse + BEAT_EPS;
    });
    bool rested = std::any_of(rests.begin(), rests.end(), [&](const Rest& rest) {
      return rest.endBeat - rest.startBeat >= pulse - BEAT_EPS &&
             rest.startBeat <= beat + pulse + BEAT_EPS && rest.endBeat >= beat - pulse - BEAT_EPS;
    });
    if (!held && !rested) {
      violations.push_back(violation(ViolationKind::kPhraseBoundary, ViolationSeverity::kError,
                                     beat,
                                     "a note of at least " + number(PLAN_HELD_NOTE_BEATS) +
                                         " beat(s) ending, or a rest of at least " + number(pulse) +
                                         " beat(s), within " + number(pulse) + " beat(s)",
                                     "neither",
                                     "the plan places a phrase boundary at beat " + number(beat) +
                                         ", which the candidate does not mark"));
    }
  }
  return violations;
}

std::vector<CompositionViolation> span_violation(const Notes& melody, const CompositionPlan& plan) {
  double end = 0;
  for (const NoteEvent& note : melody) {
    end = js::max(end, note.startBeat + note.durationBeat);
  }
  if (end <= plan.span.endBeat + BEAT_EPS) {
    return {};
  }
  return {violation(ViolationKind::kSpan, ViolationSeverity::kError, plan.span.endBeat,
                    "ending by beat " + number(plan.span.endBeat), "ending at beat " + number(end),
                    "the candidate's last note runs past the plan's span")};
}

/** The candidate's notes whose onsets fall in `[start_beat, end_beat)`, as positions. */
Indices notes_in_range(const Notes& melody, double start_beat, double end_beat) {
  Indices out;
  for (std::size_t index = 0; index < melody.size(); ++index) {
    if (melody[index].startBeat >= start_beat - BEAT_EPS &&
        melody[index].startBeat < end_beat - BEAT_EPS) {
      out.push_back(index);
    }
  }
  return out;
}

Notes pick(const Notes& melody, const Indices& indices) {
  Notes out;
  for (std::size_t index : indices) {
    out.push_back(melody[index]);
  }
  return out;
}

/** A phrase's notes, as indices into the time-ordered candidate, one list per planned phrase. */
std::vector<Indices> phrase_lines(const Notes& melody, const CompositionPlan& plan) {
  std::vector<Indices> lines;
  for (const PlannedPhrase& phrase : plan.phrases) {
    lines.push_back(notes_in_range(melody, phrase.startBeat, phrase.endBeat));
  }
  return lines;
}

std::vector<CompositionViolation> cadence_violations(const Notes& melody,
                                                     const CompositionPlan& plan,
                                                     const ChordTimeline& timeline,
                                                     const std::vector<Indices>& lines) {
  std::vector<CompositionViolation> violations;
  for (std::size_t index = 0; index < plan.phrases.size(); ++index) {
    const PlannedPhrase& phrase = plan.phrases[index];
    if (!phrase.cadence) {
      continue;
    }
    const NoteEvent* note = lines[index].empty() ? nullptr : &melody[lines[index].back()];
    std::optional<std::vector<int>> allowed = std::vector<int>{};
    if (note != nullptr) {
      allowed = cadence_pitch_classes(plan, timeline, *phrase.cadence, note->startBeat);
    }
    if (note != nullptr && (!allowed || std::find(allowed->begin(), allowed->end(),
                                                  pitch_class_of(note->pitch)) != allowed->end())) {
      continue;
    }
    std::string classes;
    if (allowed) {
      for (std::size_t at = 0; at < allowed->size(); ++at) {
        classes += (at > 0 ? " or " : "") + number((*allowed)[at]);
      }
    }
    std::string cadence(to_string(*phrase.cadence));
    violations.push_back(
        violation(ViolationKind::kCadence, ViolationSeverity::kError, phrase.endBeat,
                  "a closing note on pitch class " + classes + " for a " + cadence + " cadence",
                  note == nullptr ? "no note" : "pitch " + number(note->pitch),
                  "the phrase ending at beat " + number(phrase.endBeat) +
                      " is planned to close on a " + cadence + " cadence"));
  }
  return violations;
}

std::vector<CompositionViolation> harmony_violations(const Notes& melody,
                                                     const CompositionPlan& plan,
                                                     const ChordTimeline& timeline,
                                                     const std::vector<Indices>& lines) {
  HarmonyMisfits misfits = plan_harmony_misfits(plan, timeline);
  std::vector<CompositionViolation> violations;
  for (const Indices& line : lines) {
    auto read = misfits(pick(melody, line));
    for (std::size_t at = 0; at < read.size(); ++at) {
      if (!read[at]) {
        continue;
      }
      const std::vector<std::string>& kinds = *read[at];
      const NoteEvent& note = melody[line[at]];
      bool derived =
          std::any_of(plan.motifs.begin(), plan.motifs.end(), [&](const PlannedMotif& motif) {
            return motif.from && note.startBeat >= motif.startBeat - BEAT_EPS &&
                   note.startBeat < motif.endBeat - BEAT_EPS;
          });
      // A chord tone is asked for only on a strong pulse where the plan names a chord.
      bool strong = position_class(note.startBeat, plan.meters) == PositionClass::kStrong &&
                    timeline.at(note.startBeat).has_value();
      std::string actual;
      if (kinds.empty()) {
        actual = "no harmonic label";
      } else {
        for (std::size_t k = 0; k < kinds.size(); ++k) {
          actual += (k > 0 ? ", " : "") + kinds[k];
        }
      }
      violations.push_back(violation(
          ViolationKind::kHarmony,
          derived ? ViolationSeverity::kWarning : ViolationSeverity::kError, note.startBeat,
          strong ? "a chord tone or an ornamental tone"
                 : "a chord tone, an ornamental tone, or a scale tone",
          actual,
          derived ? "the note at beat " + number(note.startBeat) +
                        " sits in a derived statement, whose transformation takes precedence over "
                        "the harmony"
                  : "the note at beat " + number(note.startBeat) +
                        " does not fit the planned harmony"));
    }
  }
  return violations;
}

const PlannedPhrase* phrase_at(const CompositionPlan& plan, double beat) {
  for (const PlannedPhrase& phrase : plan.phrases) {
    if (beat >= phrase.startBeat - BEAT_EPS && beat < phrase.endBeat - BEAT_EPS) {
      return &phrase;
    }
  }
  return nullptr;
}

/**
 * Where a statement's notes stop counting as its own: the final downbeat of the phrase it sits in
 * when that phrase closes on a hold (a single onset from there on), which drops every later onset;
 * otherwise the statement's end (`keptEnd`).
 */
double kept_end(const PlannedMotif& statement, const Notes& melody, const CompositionPlan& plan) {
  const PlannedPhrase* phrase = phrase_at(plan, statement.startBeat);
  if (phrase == nullptr) {
    return statement.endBeat;
  }
  double downbeat = final_downbeat(*phrase, plan.meters);
  bool held = notes_in_range(melody, downbeat, phrase->endBeat).size() == 1;
  return held ? js::min(statement.endBeat, downbeat) : statement.endBeat;
}

/** A pitch level a derived statement replays its source at, and how many of its notes that excuses.
 */
struct Replay {
  double level = 0;
  double forced = 0;
};

double planned_level(const MotifRelationSummary& relation) {
  return relation.kind == MotifRelationKind::kTonalTransposition ? relation.degrees.value_or(0)
                                                                 : relation.semitones;
}

std::optional<Replay> replay_level(const Notes& melody, const Indices& source,
                                   const Indices& derived, const PlannedMotif& statement,
                                   double source_end, double derived_end, bool source_cut,
                                   const CompositionPlan& plan, const KeyScale& key,
                                   const std::set<std::size_t>& closing) {
  const MotifRelationSummary& relation = *statement.relation;
  double planned = planned_level(relation);
  if (static_cast<std::size_t>(statement.phrase) >= plan.phrases.size()) {
    // A statement may name phrase 0 of a plan that has none; TS reads `.register` off undefined.
    throw js::TypeError("Cannot read properties of undefined (reading 'register')");
  }
  const PlannedRegister& range = plan.phrases[static_cast<std::size_t>(statement.phrase)].register_;
  auto outside = [&](double pitch) { return pitch < range.low || pitch > range.high; };
  bool backward = relation.kind == MotifRelationKind::kRetrograde ||
                  relation.kind == MotifRelationKind::kRetrogradeInversion;
  std::vector<MotifNote> source_notes;
  for (std::size_t index : source) {
    source_notes.push_back(MotifNote{static_cast<double>(melody[index].pitch),
                                     melody[index].startBeat, melody[index].durationBeat});
  }
  std::vector<MotifNote> cell = clip_statement(source_notes, source_end);
  struct Candidate {
    double level;
    std::vector<MotifNote> notes;
    double outside;
  };
  std::vector<Candidate> replays;
  Replayer replayer(cell, relation);
  for (double level : relation_levels(relation.kind)) {
    std::vector<MotifNote> notes =
        clip_statement(replayer.at(level, statement.startBeat, key), derived_end);
    double away = 0;
    for (const MotifNote& note : notes) {
      if (outside(note.pitch)) {
        away += 1;
      }
    }
    replays.push_back(Candidate{level, std::move(notes), away});
  }
  double fewest_outside = std::numeric_limits<double>::infinity();
  for (const Candidate& replay : replays) {
    fewest_outside = js::min(fewest_outside, replay.outside);
  }
  std::optional<Replay> best;
  for (const Candidate& replay : replays) {
    const std::vector<MotifNote>& expected = replay.notes;
    Indices compared = derived;
    if (source_cut && compared.size() > expected.size()) {
      compared.resize(expected.size());
    }
    if (expected.size() != compared.size()) {
      continue;
    }
    double forced = 0;
    bool holds = true;
    for (std::size_t i = 0; holds && i < expected.size(); ++i) {
      const MotifNote& want = expected[i];
      const NoteEvent& got = melody[compared[i]];
      if (i > 0) {
        double gap = got.startBeat - melody[compared[i - 1]].startBeat;
        holds = std::abs(gap - (want.startBeat - expected[i - 1].startBeat)) <= BEAT_EPS;
      }
      if (!holds || static_cast<double>(got.pitch) == want.pitch) {
        continue;
      }
      std::size_t origin_at = backward ? cell.size() - 1 - i : i;
      forced += 1;
      holds = closing.count(compared[i]) > 0 ||
              (origin_at < source.size() && closing.count(source[origin_at]) > 0) ||
              (replay.outside == fewest_outside && outside(want.pitch));
    }
    double distance = std::abs(replay.level - planned);
    bool nearer = !best || distance < std::abs(best->level - planned) ||
                  (distance == std::abs(best->level - planned) && replay.level < best->level);
    if (holds && nearer) {
      best = Replay{replay.level, forced};
    }
  }
  return best;
}

struct DerivationViolations {
  std::vector<CompositionViolation> errors;
  std::vector<CompositionViolation> warnings;
};

DerivationViolations motif_derivation_violations(const Notes& melody, const CompositionPlan& plan,
                                                 const std::set<std::size_t>& closing) {
  auto key_at = plan_key_at(plan);
  DerivationViolations out;
  for (const PlannedMotif& statement : plan.motifs) {
    if (!statement.from) {
      continue;
    }
    const PlannedMotif& source = plan.motifs[static_cast<std::size_t>(*statement.from)];
    Indices source_notes = notes_in_range(melody, source.startBeat, source.endBeat);
    Indices derived_notes = notes_in_range(melody, statement.startBeat, statement.endBeat);
    const Nullable<MotifRelationSummary>& relation = statement.relation;
    std::string rationale = "the statement at beat " + number(statement.startBeat) +
                            " does not derive from its source the way the plan names";
    double source_kept = kept_end(source, melody, plan);
    double derived_kept = kept_end(statement, melody, plan);
    // A statement a closing hold dropped whole leaves nothing to compare.
    if (source_kept <= source.startBeat + BEAT_EPS ||
        derived_kept <= statement.startBeat + BEAT_EPS) {
      continue;
    }
    if (source_notes.empty() || derived_notes.empty()) {
      out.errors.push_back(
          violation(ViolationKind::kMotifDerivation, ViolationSeverity::kError, statement.startBeat,
                    !relation ? "a variation" : std::string(to_string(relation->kind)),
                    "no notes to compare", rationale));
      continue;
    }
    bool source_cut = source_kept < source.endBeat - BEAT_EPS;
    bool derived_cut = derived_kept < statement.endBeat - BEAT_EPS;
    if (!relation) {
      // A variation keeps its source's onsets, so a span one hold dropped is read in neither.
      double source_end =
          derived_cut ? js::min(source_kept, source.startBeat + derived_kept - statement.startBeat)
                      : source_kept;
      double derived_end =
          source_cut ? js::min(derived_kept, statement.startBeat + source_kept - source.startBeat)
                     : derived_kept;
      Indices source_line = notes_in_range(melody, source.startBeat, source_end);
      Indices derived_line = notes_in_range(melody, statement.startBeat, derived_end);
      if (source_line.empty() || derived_line.empty()) {
        continue;
      }
      double similarity = melodic_similarity(pick(melody, source_line), pick(melody, derived_line));
      if (similarity < DEFAULT_VARIATION_THRESHOLD) {
        out.errors.push_back(violation(
            ViolationKind::kMotifDerivation, ViolationSeverity::kError, statement.startBeat,
            "a variation (melodicSimilarity >= " + number(DEFAULT_VARIATION_THRESHOLD) + ")",
            "melodicSimilarity " + js::to_fixed(similarity, 3), rationale));
      }
      continue;
    }
    Indices kept = notes_in_range(melody, source.startBeat, source_kept);
    bool backward = relation->kind == MotifRelationKind::kRetrograde ||
                    relation->kind == MotifRelationKind::kRetrogradeInversion;
    // Nothing of the source is left to replay, or a retrograde would replay the dropped tail first.
    if (kept.empty() || (source_cut && backward)) {
      continue;
    }
    std::optional<Replay> replay =
        replay_level(melody, kept, notes_in_range(melody, statement.startBeat, derived_kept),
                     statement, source_kept, derived_kept, source_cut, plan,
                     scale_of(key_at(statement.startBeat)), closing);
    double planned = planned_level(*relation);
    std::string kind(to_string(relation->kind));
    if (!replay) {
      out.errors.push_back(violation(ViolationKind::kMotifDerivation, ViolationSeverity::kError,
                                     statement.startBeat, kind, "no pitch level replays the source",
                                     rationale));
    } else if (replay->level != planned || replay->forced > 0) {
      out.warnings.push_back(violation(
          ViolationKind::kMotifDisplaced, ViolationSeverity::kWarning, statement.startBeat,
          kind + " at level " + number(planned) + " with every pitch replayed",
          "level " + number(replay->level) + ", " + number(replay->forced) + " excused note(s)",
          "the statement at beat " + number(statement.startBeat) +
              " carries out its planned derivation at another pitch level or with notes excused"));
    }
  }
  return out;
}

std::vector<CompositionViolation> register_violations(const Notes& melody,
                                                      const CompositionPlan& plan) {
  std::vector<CompositionViolation> violations;
  for (const NoteEvent& note : melody) {
    const PlannedPhrase* phrase = phrase_at(plan, note.startBeat);
    if (phrase == nullptr) {
      continue;
    }
    if (note.pitch < phrase->register_.low || note.pitch > phrase->register_.high) {
      violations.push_back(violation(ViolationKind::kRegister, ViolationSeverity::kError,
                                     note.startBeat,
                                     "a pitch within [" + number(phrase->register_.low) + ", " +
                                         number(phrase->register_.high) + "]",
                                     "pitch " + number(note.pitch),
                                     "the note at beat " + number(note.startBeat) +
                                         " falls outside its phrase's planned register"));
    }
  }
  return violations;
}

/** A phrase's outline as its own target curve would draw it. */
std::vector<double> plan_outline(const PlannedPhrase& phrase) {
  double amplitude = (phrase.register_.high - phrase.register_.low) / 2;
  std::vector<double> outline;
  for (int k = 0; k < PLAN_OUTLINE_POINTS; ++k) {
    double t = (k + 0.5) / PLAN_OUTLINE_POINTS;
    outline.push_back(phrase.register_.mean +
                      planned_contour_at(phrase.shape, phrase.peakPosition, t) * amplitude);
  }
  return outline;
}

ContourPhrase plan_contour_phrase(const PlannedPhrase& phrase) {
  ContourPhrase out;
  out.shape = phrase.shape;
  out.low = phrase.register_.low;
  out.high = phrase.register_.high;
  out.outline = plan_outline(phrase);
  return out;
}

RegisterPlan plan_register_plan(const CompositionPlan& plan) {
  RegisterPlan out;
  double weighted = 0;
  double weight = 0;
  for (const PlannedPhrase& phrase : plan.phrases) {
    out.phrases.push_back(RegisterPhrase{phrase.register_.low, phrase.register_.high,
                                         phrase.register_.mean, phrase.peakPosition});
  }
  for (const PlannedPhrase& phrase : plan.phrases) {
    double length = phrase.endBeat - phrase.startBeat;
    weighted += phrase.register_.mean * length;
    weight += length;
  }
  if (weight > 0) {
    out.mean = weighted / weight;
  }
  return out;
}

/** A plan's rhythmic target, read as a reading with no bar-position detail. */
RhythmAnalysis plan_rhythm_reading(const CompositionPlan& plan) {
  bool has_onsets = std::any_of(plan.rhythm.onsetLevels.begin(), plan.rhythm.onsetLevels.end(),
                                [](double share) { return share > 0; });
  RhythmAnalysis out;
  out.onsets = has_onsets ? 1 : 0;
  out.onsetLevels = plan.rhythm.onsetLevels;
  out.interOnsetShares = plan.rhythm.interOnsetShares;
  out.syncopation = plan.rhythm.syncopation;
  return out;
}

std::vector<CompositionViolation> peak_position_warnings(
    const CompositionPlan& plan, const std::vector<Nullable<ReferencePhraseMelody>>& readings) {
  std::vector<CompositionViolation> violations;
  for (std::size_t index = 0; index < plan.phrases.size(); ++index) {
    const PlannedPhrase& phrase = plan.phrases[index];
    if (!readings[index]) {
      continue;
    }
    double drift = std::abs(readings[index]->peakPosition - phrase.peakPosition);
    if (drift > PLAN_PEAK_POSITION_TOLERANCE) {
      violations.push_back(violation(
          ViolationKind::kPeakPosition, ViolationSeverity::kWarning, phrase.startBeat,
          "a peak position within " + number(PLAN_PEAK_POSITION_TOLERANCE) + " of " +
              number(phrase.peakPosition),
          number(readings[index]->peakPosition),
          "the phrase starting at beat " + number(phrase.startBeat) +
              " places its melodic peak further from the planned position than the tolerance "
              "allows"));
    }
  }
  return violations;
}

/** The candidate's duration-weighted mean pitch, or null when nothing sounds. */
Nullable<double> line_mean_of(const Notes& melody) {
  double weighted = 0;
  double total = 0;
  for (const NoteEvent& note : melody) {
    weighted += note.pitch * note.durationBeat;
    total += note.durationBeat;
  }
  if (total > 0) {
    return weighted / total;
  }
  return std::nullopt;
}

/** A plan's onset density, the phrases' targets weighted by their bar counts. */
RhythmAnalysis plan_density(const CompositionPlan& plan) {
  double weighted = 0;
  double bars = 0;
  for (const PlannedPhrase& phrase : plan.phrases) {
    double span = bar_span_of(phrase.startBeat, phrase.endBeat, plan.meters);
    weighted += phrase.onsetDensity * span;
    bars += span;
  }
  RhythmAnalysis out;
  out.onsets = 1;
  out.onsetDensity = bars > 0 ? weighted / bars : 0;
  return out;
}

}  // namespace

CompositionEvaluation evaluate_composition(const std::vector<NoteEvent>& melody,
                                           const CompositionPlan& plan,
                                           const EvaluateCompositionOptions& opts) {
  assert_composition_plan(plan, "evaluated plan");
  NoteEventAssertOptions read;
  read.budget = opts.budget;
  read.allowNonPositiveDuration = true;
  Notes notes = assert_note_events(melody, "evaluated melody", read);
  std::stable_sort(notes.begin(), notes.end(), [](const NoteEvent& a, const NoteEvent& b) {
    return a.startBeat < b.startBeat;
  });
  ChordTimeline timeline = plan_chord_timeline(plan);
  std::vector<Indices> lines = phrase_lines(notes, plan);
  std::set<std::size_t> closing;
  for (const Indices& line : lines) {
    if (!line.empty()) {
      closing.insert(line.back());
    }
  }
  DerivationViolations derivations = motif_derivation_violations(notes, plan, closing);

  Nullable<double> line_mean = line_mean_of(notes);
  std::vector<Nullable<ReferencePhraseMelody>> readings;
  for (const PlannedPhrase& phrase : plan.phrases) {
    readings.push_back(phrase_melody(notes, phrase.startBeat, phrase.endBeat, line_mean.value_or(0),
                                     plan.meters, opts.budget));
  }
  CompositionEvaluation out;
  auto append = [&](std::vector<CompositionViolation> more) {
    out.violations.insert(out.violations.end(), std::make_move_iterator(more.begin()),
                          std::make_move_iterator(more.end()));
  };
  append(span_violation(notes, plan));
  append(phrase_boundary_violations(notes, plan));
  append(cadence_violations(notes, plan, timeline, lines));
  append(harmony_violations(notes, plan, timeline, lines));
  append(register_violations(notes, plan));
  append(std::move(derivations.errors));
  append(std::move(derivations.warnings));
  append(peak_position_warnings(plan, readings));

  RhythmAnalysisOptions rhythm_options;
  rhythm_options.meters = plan.meters;
  rhythm_options.totalBeats = plan.span.endBeat;
  rhythm_options.budget = opts.budget;
  RhythmAnalysis rhythm = analyze_rhythm(notes, rhythm_options);
  RhythmAnalysis target = plan_rhythm_reading(plan);

  std::vector<Nullable<ContourPhrase>> planned_contours;
  std::vector<Nullable<ContourPhrase>> read_contours;
  for (const PlannedPhrase& phrase : plan.phrases) {
    planned_contours.push_back(plan_contour_phrase(phrase));
  }
  RegisterPlan candidate_register;
  for (const Nullable<ReferencePhraseMelody>& reading : readings) {
    if (reading) {
      ContourPhrase contour;
      contour.shape = reading->shape;
      contour.low = reading->low;
      contour.high = reading->high;
      contour.outline = reading->outline;
      read_contours.push_back(contour);
      candidate_register.phrases.push_back(RegisterPhrase{static_cast<double>(reading->low),
                                                          static_cast<double>(reading->high),
                                                          reading->mean, reading->peakPosition});
    } else {
      read_contours.push_back(std::nullopt);
      candidate_register.phrases.push_back(std::nullopt);
    }
  }
  candidate_register.mean = line_mean;

  out.fit.contour = contour_similarity(planned_contours, read_contours);
  out.fit.register_ = register_similarity(plan_register_plan(plan), candidate_register);
  out.fit.onset = onset_similarity(target, rhythm);
  out.fit.duration = duration_similarity(target, rhythm);
  out.fit.syncopation = syncopation_similarity(target, rhythm);
  out.fit.density = density_similarity(plan_density(plan), rhythm);
  return out;
}

}  // namespace cantus
