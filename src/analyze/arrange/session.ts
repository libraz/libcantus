/**
 * Incremental arrangement analysis: an analysis held open across edits, so a
 * host that re-analyses on every keystroke pays for the beats that changed
 * rather than for the whole piece.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { NoteEvent } from '../../core/types.js';
import { assertGenerationBudget, assertNoteEvents } from '../../core/validation/index.js';
import type { DirtySlots, TimelineEvidence } from '../timeline/index.js';
import { dirtySlotsFor } from '../timeline/index.js';
import type { ArrangementAnalysis, ArrangementOptions, ArrangementTrack } from './tracks.js';
import { analyzeArrangementWith } from './tracks.js';

/**
 * One track's notes as they stand after an edit.
 *
 * The whole note array is given rather than a description of what moved: a host
 * always has the track's current contents, and working out what actually
 * changed is this module's job, not the caller's.
 *
 * @category Arrangement & Analysis
 */
export type TrackEdit = {
  /** Index of the track in the session's track array. */
  trackIndex: number;
  /** The track's notes after the edit. */
  notes: readonly NoteEvent[];
};

/**
 * An arrangement analysis held open for editing.
 *
 * @category Arrangement & Analysis
 */
export type ArrangementSession = {
  /** The tracks the current analysis was made from. */
  readonly tracks: readonly ArrangementTrack[];
  /** The analysis of those tracks. */
  readonly analysis: ArrangementAnalysis;
  /**
   * Re-analyse after replacing the notes of one or more tracks, reusing
   * everything the edit provably cannot reach.
   *
   * The result equals {@link analyzeArrangement} over the edited tracks — the
   * same segments, confidences, key regions, cadences, annotations and
   * conflicts — so a host may hold a session for as long as it likes without
   * the analysis drifting from what a fresh pass would say.
   */
  update: (edits: readonly TrackEdit[]) => ArrangementSession;
};

/** Identity of one note, for telling an edited note array from an unedited one. */
function noteId(note: NoteEvent): string {
  return `${note.pitch}|${note.startBeat}|${note.durationBeat}|${note.velocity ?? ''}`;
}

/** The beats an edit touched, or null when the two note arrays agree. */
type EditedSpan = { startBeat: number; endBeat: number };

/**
 * The beats covered by the notes that `before` and `after` disagree on.
 *
 * Notes are compared as values and by multiplicity, so re-ordering a track's
 * array — which no analysis here is sensitive to — counts as no edit at all,
 * while adding a second copy of a note counts as one.
 */
function editedSpan(before: readonly NoteEvent[], after: readonly NoteEvent[]): EditedSpan | null {
  const counts = new Map<string, { count: number; startBeat: number; endBeat: number }>();
  const tally = (notes: readonly NoteEvent[], sign: number): void => {
    for (const note of notes) {
      const id = noteId(note);
      const entry = counts.get(id);
      if (entry === undefined) {
        counts.set(id, {
          count: sign,
          startBeat: note.startBeat,
          endBeat: note.startBeat + note.durationBeat,
        });
      } else {
        entry.count += sign;
      }
    }
  };
  tally(before, 1);
  tally(after, -1);
  let startBeat = Number.POSITIVE_INFINITY;
  let endBeat = Number.NEGATIVE_INFINITY;
  for (const entry of counts.values()) {
    if (entry.count === 0) {
      continue;
    }
    startBeat = Math.min(startBeat, entry.startBeat);
    // A note of zero or negative length never sounds, but its onset still marks
    // where the caller edited, so the span is never empty for a real change.
    endBeat = Math.max(endBeat, entry.endBeat, entry.startBeat);
  }
  return startBeat <= endBeat ? { startBeat, endBeat } : null;
}

/** Merge two edited spans into the one covering both. */
function unionSpan(a: EditedSpan | null, b: EditedSpan | null): EditedSpan | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return {
    startBeat: Math.min(a.startBeat, b.startBeat),
    endBeat: Math.max(a.endBeat, b.endBeat),
  };
}

/** Build a session around one completed analysis. */
function sessionOf(
  tracks: readonly ArrangementTrack[],
  opts: ArrangementOptions,
  analysis: ArrangementAnalysis,
  evidence: TimelineEvidence | undefined,
): ArrangementSession {
  return {
    tracks,
    analysis,
    update(edits) {
      assertGenerationBudget(edits.length, 'arrangement edits', opts.budget);
      const next = [...tracks];
      let edited: EditedSpan | null = null;
      for (let index = 0; index < edits.length; index += 1) {
        const edit = edits[index];
        if (edit === undefined) {
          continue;
        }
        const target = next[edit.trackIndex];
        if (target === undefined) {
          throw new InvalidInputError(
            `edits[${index}].trackIndex ${edit.trackIndex} is outside the session's ${tracks.length} tracks`,
          );
        }
        if (!Array.isArray(edit.notes)) {
          throw new InvalidInputError(
            `edits[${index}].notes must be an array; received ${typeof edit.notes}`,
          );
        }
        assertNoteEvents(edit.notes, `edits[${index}].notes`, {
          allowNonPositiveDuration: true,
          budget: opts.budget,
        });
        edited = unionSpan(edited, editedSpan(target.notes, edit.notes));
        next[edit.trackIndex] = { ...target, notes: edit.notes };
      }
      // Nothing the analysis reads actually changed, so the analysis has not.
      if (edited === null) {
        return sessionOf(next, opts, analysis, evidence);
      }
      const dirty: DirtySlots | undefined =
        evidence === undefined
          ? undefined
          : dirtySlotsFor(evidence, edited.startBeat, edited.endBeat);
      const run = analyzeArrangementWith(next, opts, evidence, dirty);
      return sessionOf(next, opts, run.analysis, run.evidence);
    },
  };
}

/**
 * Open an arrangement analysis that can be updated a few beats at a time.
 *
 * The first pass is an ordinary {@link analyzeArrangement}; what the session
 * adds is the slot-level evidence behind it, so a later {@link
 * ArrangementSession.update} can work out which beats an edit could possibly
 * have changed and leave the rest of the harmony alone. An update returns a new
 * session, so the analysis before an edit stays valid and a host can keep it
 * for undo.
 *
 * What an update recomputes is derived rather than guessed at:
 *
 * - The edited beats are the beats covered by the notes the old and new track
 *   arrays disagree on, which is narrower than the track and usually far
 *   narrower than the piece.
 * - A slot's evidence sees exactly the notes overlapping it, so the slots to
 *   re-derive are the slots overlapping those beats — plus one either side, so
 *   that an onset sitting a floating-point hair off a slot boundary cannot
 *   leave a stale slot behind.
 * - The boundary search itself has no such margin. It is a shortest-path search
 *   over a whole run of slots, so a changed slot can move a boundary anywhere in
 *   the run, and its change cost is calibrated on the mean weight of every
 *   sounding slot in the piece, which couples the runs to one another. The
 *   search is therefore re-run over the whole piece — arithmetic over the
 *   carried-over evidence, with nothing allocated per slot — rather than being
 *   spliced at a margin that does not exist.
 * - Each settled segment's chord is carried over when its bounds, its key and
 *   its slots are all unchanged, since those are the only things chord
 *   inference reads.
 *
 * Key regions and the per-note annotations are recomputed in full. Both are
 * whole-piece passes — the key search is a shortest-path search with no reset
 * points, sub-voice lane assignment is greedy from the first note, and every
 * note is judged against the other voices sounding beneath it — so neither has
 * a sound local answer, and reporting one would mean an update that quietly
 * disagreed with a fresh analysis.
 *
 * An update falls back to a full analysis whenever the edit moves the ground the
 * evidence stands on: a changed piece length, a changed first onset (both of
 * which move the slot grid), or an edit to a session whose harmony was supplied
 * through {@link ArrangementOptions.timeline}. The answer is the same either
 * way; only the work differs.
 *
 * @param tracks The tracks to analyse.
 * @param opts Analysis options; see {@link ArrangementOptions}.
 * @returns A session holding the analysis and the evidence behind it.
 * @example
 * ```ts
 * import { createArrangementSession } from '@libraz/libcantus';
 * const melody = [{ pitch: 60, startBeat: 0, durationBeat: 4 }];
 * const session = createArrangementSession([{ role: 'melody', notes: melody }]);
 * const moved = [{ pitch: 62, startBeat: 0, durationBeat: 4 }];
 * const next = session.update([{ trackIndex: 0, notes: moved }]);
 * next.analysis.timeline.segments; // as if analyzed from scratch
 * ```
 * @category Arrangement & Analysis
 */
export function createArrangementSession(
  tracks: ArrangementTrack[],
  opts: ArrangementOptions = {},
): ArrangementSession {
  const run = analyzeArrangementWith(tracks, opts);
  return sessionOf([...tracks], opts, run.analysis, run.evidence);
}
