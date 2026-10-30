// Incremental arrangement analysis: ts/src/analyze/arrange/session.ts.

#include "analyze/arrange/session.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <string>

#include "analyze/arrange/tracks.h"
#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

struct ArrangementSession::State {
  std::vector<ArrangementTrack> tracks;
  ArrangementOptions opts;
  ArrangementAnalysis analysis;
  /** The slot-level evidence behind the analysis; null when the harmony was supplied. */
  std::shared_ptr<TimelineEvidence> evidence;
  /** Held by an update, which takes the evidence's tables over; shared along with the evidence. */
  std::shared_ptr<std::recursive_mutex> evidence_lock = std::make_shared<std::recursive_mutex>();
};

namespace {

/** Identity of one note, for telling an edited note array from an unedited one (`noteId`). */
std::string note_id(const NoteEvent& note) {
  return js::to_string(note.pitch) + "|" + js::to_string(note.startBeat) + "|" +
         js::to_string(note.durationBeat) + "|" +
         (note.velocity ? js::to_string(*note.velocity) : std::string());
}

}  // namespace

bool same_order(const std::vector<NoteEvent>& before, const std::vector<NoteEvent>& after) {
  if (before.size() != after.size()) {
    return false;
  }
  for (std::size_t index = 0; index < before.size(); ++index) {
    if (note_id(before[index]) != note_id(after[index])) {
      return false;
    }
  }
  return true;
}

std::optional<EditedSpan> edited_span(const std::vector<NoteEvent>& before,
                                      const std::vector<NoteEvent>& after) {
  struct Tally {
    double count;
    double startBeat;
    double endBeat;
  };
  std::map<std::string, Tally> counts;
  auto tally = [&counts](const std::vector<NoteEvent>& notes, double sign) {
    for (const NoteEvent& note : notes) {
      std::string id = note_id(note);
      auto entry = counts.find(id);
      if (entry == counts.end()) {
        counts.emplace(id, Tally{sign, note.startBeat, note.startBeat + note.durationBeat});
      } else {
        entry->second.count += sign;
      }
    }
  };
  tally(before, 1);
  tally(after, -1);
  double start_beat = std::numeric_limits<double>::infinity();
  double end_beat = -std::numeric_limits<double>::infinity();
  for (const auto& [id, entry] : counts) {
    if (entry.count == 0) {
      continue;
    }
    start_beat = js::min(start_beat, entry.startBeat);
    // A note of zero or negative length never sounds, but its onset still marks where the
    // caller edited, so the span is never empty for a real change.
    end_beat = js::max(end_beat, entry.endBeat, entry.startBeat);
  }
  if (start_beat <= end_beat) {
    return EditedSpan{start_beat, end_beat};
  }
  return std::nullopt;
}

std::optional<EditedSpan> union_span(const std::optional<EditedSpan>& a,
                                     const std::optional<EditedSpan>& b) {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return EditedSpan{js::min(a->startBeat, b->startBeat), js::max(a->endBeat, b->endBeat)};
}

std::optional<DirtySlots> dirty_slots_of(const TimelineEvidence* evidence,
                                         const std::optional<EditedSpan>& edited) {
  if (evidence == nullptr) {
    return std::nullopt;
  }
  if (!edited) {
    return DirtySlots{0, 0};
  }
  return dirty_slots_for(*evidence, edited->startBeat, edited->endBeat);
}

const std::vector<ArrangementTrack>& ArrangementSession::tracks() const { return state_->tracks; }

const ArrangementAnalysis& ArrangementSession::analysis() const { return state_->analysis; }

ArrangementSession ArrangementSession::update(const std::vector<TrackEdit>& edits) const {
  const State& current = *state_;
  assert_generation_budget(static_cast<double>(edits.size()), "arrangement edits",
                           current.opts.budget);
  std::vector<ArrangementTrack> next = current.tracks;
  std::optional<EditedSpan> edited;
  bool reordered = false;
  for (std::size_t index = 0; index < edits.size(); ++index) {
    const TrackEdit& edit = edits[index];
    double track = edit.trackIndex;
    // `next[edit.trackIndex]` finds a track only for a whole index inside the array.
    if (!(track >= 0 && track < static_cast<double>(next.size()) && track == std::floor(track))) {
      throw InvalidInputError("edits[" + index_text(index) + "].trackIndex " +
                              js::to_string(track) + " is outside the session's " +
                              js::to_string(static_cast<double>(current.tracks.size())) +
                              " tracks");
    }
    ArrangementTrack& target = next[static_cast<std::size_t>(track)];
    NoteEventAssertOptions note_options;
    note_options.allowNonPositiveDuration = true;
    note_options.budget = current.opts.budget;
    assert_note_events(edit.notes, "edits[" + index_text(index) + "].notes", note_options);
    edited = union_span(edited, edited_span(target.notes, edit.notes));
    reordered = reordered || !same_order(target.notes, edit.notes);
    target.notes = edit.notes;
  }
  auto state = std::make_shared<State>();
  state->tracks = std::move(next);
  state->opts = current.opts;
  // Nothing the analysis reads actually changed, so the analysis has not.
  if (!edited && !reordered) {
    state->analysis = current.analysis;
    state->evidence = current.evidence;
    state->evidence_lock = current.evidence_lock;
    return ArrangementSession(std::move(state));
  }
  // A pure re-ordering moves no note, so every slot of the harmony is clean and the whole
  // timeline is carried over; what it does move is the array position each annotation reports.
  // Sessions sharing one evidence update in turn: the first takes its tables, the rest start anew.
  std::lock_guard<std::recursive_mutex> taking(*current.evidence_lock);
  std::optional<DirtySlots> dirty = dirty_slots_of(current.evidence.get(), edited);
  ArrangementRun run = analyze_arrangement_with(state->tracks, state->opts, current.evidence.get(),
                                                dirty ? &*dirty : nullptr);
  state->analysis = std::move(run.analysis);
  state->evidence = std::move(run.evidence);
  return ArrangementSession(std::move(state));
}

ArrangementSession create_arrangement_session(const std::vector<ArrangementTrack>& tracks,
                                              const ArrangementOptions& opts) {
  ArrangementRun run = analyze_arrangement_with(tracks, opts);
  auto state = std::make_shared<ArrangementSession::State>();
  state->tracks = tracks;
  state->opts = opts;
  state->analysis = std::move(run.analysis);
  state->evidence = std::move(run.evidence);
  return ArrangementSession(std::move(state));
}

}  // namespace cantus
