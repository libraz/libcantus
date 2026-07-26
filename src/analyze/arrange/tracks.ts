/**
 * Arrangement track-role analysis: a single harmony is inferred from every
 * track's notes pooled together, each track is then analysed against that shared
 * harmony, and notes that clash with the sounding chord are collected as
 * conflicts.
 */

import { isStrongBeat, parseTimeSignature, type TimeSignature } from '../../core/meter/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertNoteEvents,
  assertTimeSignature,
} from '../../core/validation/index.js';
import {
  evaluateSafety,
  NoteSafety,
  type SafetyProfile,
  type VoiceSnapshot,
} from '../../theory/safety/index.js';
import { majorKey } from '../../theory/scale/index.js';
import { detectKeyFromNotes } from '../detect/index.js';
import {
  type CadenceHit,
  type ChordTimeline,
  chordTimelineFromNotes,
  detectCadences,
} from '../timeline/index.js';
import {
  type AnalyzedNote,
  analyzeVoice,
  type TheoryLabel,
  type VoiceNote,
} from '../voice/index.js';
import { EPS, isPercussion, type PreparedTrack, poolNotes, prepareTracks } from './internal.js';

/**
 * The musical role a track plays in the arrangement.
 *
 * `drums` marks a percussion track. Its pitches select instruments rather than
 * naming harmony, so such a track is excluded from chord and key inference and
 * from every voice-leading comparison; it is reported back with no annotations.
 *
 * @category Arrangement & Analysis
 */
export type TrackRole = 'melody' | 'harmony' | 'bass' | 'drums' | 'other';

/**
 * One input track: its notes plus optional name and role.
 *
 * @category Arrangement & Analysis
 */
export type ArrangementTrack = {
  name?: string;
  role?: TrackRole;
  notes: NoteEvent[];
};

/**
 * A track after analysis: its resolved name, role, and per-note annotations.
 *
 * @category Arrangement & Analysis
 */
export type TrackAnalysis = {
  name: string;
  role: TrackRole;
  /** One {@link AnalyzedNote} per note, labelled against the inferred chords. */
  notes: AnalyzedNote[];
};

/**
 * A note that clashes with the harmony sounding beneath it.
 *
 * @category Arrangement & Analysis
 */
export type Conflict = {
  beat: number;
  trackName: string;
  /** The clashing track's index in the caller's input array. */
  trackIndex: number;
  /** The note's index in that track's own note array. */
  originalIndex?: number;
  /** The id the note carries in {@link TrackAnalysis.notes}. */
  noteId: number;
  pitch: number;
  /**
   * The note's theory labels at its onset, so a caller can tell a genuine clash
   * from a passing tone, a neighbour, or a prepared suspension — all of which
   * are ordinary non-chord tones that still evaluate as unsafe.
   */
  labels: TheoryLabel[];
  /** The clash severity: {@link NoteSafety.Warning} or {@link NoteSafety.Dissonant}. */
  safety: NoteSafety;
  /** {@link SafetyResult.reasons} bitmask. */
  reasons: number;
  /** Preferred stepwise resolution, when the safety evaluator provides one. */
  resolveTo?: number;
  /** Nearby fully safe replacement pitches, nearest first. */
  suggestions?: number[];
  rationale?: string;
};

/**
 * The full result of {@link analyzeArrangement}.
 *
 * @category Arrangement & Analysis
 */
export type ArrangementAnalysis = {
  key: KeyScale;
  timeline: ChordTimeline;
  segmentConfidence: number[];
  cadences: CadenceHit[];
  tracks: TrackAnalysis[];
  /** Notes clashing with the sounding harmony, worst severity first. */
  conflicts: Conflict[];
};

/**
 * Options controlling {@link analyzeArrangement} and {@link tensionCurve}.
 *
 * @category Arrangement & Analysis
 */
export type ArrangementOptions = {
  /** Key context; inferred from the pooled notes when omitted. */
  key?: KeyScale;
  /**
   * A chord timeline to analyse against, instead of inferring one from the
   * notes. Supply it to analyse a hand-written progression, or to reuse the
   * timeline of an earlier call rather than re-running chord inference.
   */
  timeline?: ChordTimeline;
  /**
   * Indices of the tracks the harmony is inferred from. Defaults to every
   * pitched track. Percussion tracks are excluded either way.
   */
  harmonyTracks?: number[];
  /**
   * Lowest severity reported in `conflicts`.
   *
   * @defaultValue {@link NoteSafety.Warning}
   */
  minSeverity?: NoteSafety;
  /**
   * Time signature; defaults to 4/4.
   *
   * @defaultValue `4/4`
   */
  ts?: TimeSignature;
  /**
   * Chord-slot length in beats; defaults to one bar of `ts`.
   *
   * @defaultValue one bar of `ts`
   */
  harmonicRhythm?: number;
  /**
   * Safety profile used for conflict detection; defaults to `pop`.
   *
   * @defaultValue `'pop'`
   */
  profile?: SafetyProfile;
  /**
   * Upper bound on the work this call may do — note counts, windows, and
   * candidate counts are each checked against it before anything is allocated.
   *
   * Raise it to analyse a piece larger than the default allows; the default is
   * {@link DEFAULT_GENERATION_BUDGET}, chosen so a runaway input fails fast
   * rather than blocking the thread.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/**
 * Sounding pitches of every sub-voice at a beat, excluding one sub-voice.
 *
 * Only the sub-voice under analysis is excluded — sibling sub-voices of the
 * same track are included, so dissonant clusters inside a single polyphonic
 * track are still detected.
 */
function otherVoicesSounding(
  prepared: PreparedTrack[],
  excludeTrack: number,
  excludeVoice: number,
  beat: number,
): VoiceSnapshot[] {
  const out: VoiceSnapshot[] = [];
  for (let t = 0; t < prepared.length; t += 1) {
    const track = prepared[t];
    if (!track || isPercussion(track.role)) {
      continue;
    }
    for (let v = 0; v < track.voices.length; v += 1) {
      if (t === excludeTrack && v === excludeVoice) {
        continue;
      }
      // Each sub-voice is monophonic, so this is one binary search per voice
      // rather than a scan of every note in the arrangement.
      const note = track.voices[v]?.at(beat);
      if (note === undefined) {
        continue;
      }
      const snap: VoiceSnapshot = { pitch: note.pitch };
      // Motion reasons compare one real transition shared by both voices.
      // A voice attacking exactly here contributes its adjacent predecessor;
      // a sustained voice contributes the same pitch (oblique motion).
      const previous = Math.abs(note.startBeat - beat) <= EPS ? note.prevPitch : note.pitch;
      if (previous !== undefined) {
        snap.prevPitch = previous;
      }
      out.push(snap);
    }
  }
  return out;
}

/** Index of the first segment starting strictly after a beat. */
function firstSegmentAfter(timeline: ChordTimeline, beat: number): number {
  let low = 0;
  let high = timeline.segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((timeline.segments[middle]?.startBeat ?? Number.POSITIVE_INFINITY) <= beat + EPS) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * The beats at which a note must be checked against the harmony: its onset,
 * plus the onset of every later chord segment the note sustains across. Each
 * crossed segment is visited exactly once (at its own start), so a boundary
 * beat is never evaluated twice for the same note.
 *
 * Segments are in beat order, so the crossed ones are a contiguous run found by
 * binary search rather than by scanning the whole timeline for every note.
 */
function evaluationBeats(note: VoiceNote, timeline: ChordTimeline): number[] {
  const noteEnd = note.startBeat + note.durationBeat;
  const beats = [note.startBeat];
  for (let i = firstSegmentAfter(timeline, note.startBeat); i < timeline.segments.length; i += 1) {
    const start = timeline.segments[i]?.startBeat;
    if (start === undefined || start >= noteEnd - EPS) {
      break;
    }
    beats.push(start);
  }
  return beats;
}

/**
 * Analyse a whole arrangement against a single inferred harmony.
 *
 * The chord timeline and key are inferred from the pooled notes of every
 * pitched track (see {@link chordTimelineFromNotes}); pooling all voices is
 * robust even when roles are absent or a track doubles the harmony, so it is
 * preferred over deriving the harmony from a subset. A track marked
 * `role: 'drums'` is excluded — its pitches name instruments, not harmony, and
 * pooling them would corrupt the key, the timeline and every reading built on
 * them. Pass `harmonyTracks` to restrict inference further, or `timeline` to
 * analyse against a progression you already have. Zero- and negative-length
 * notes never sound, so they are dropped at ingest and appear in neither the
 * annotations nor the conflicts.
 *
 * Voice analysis assumes one monophonic voice at a time, so each track is
 * first partitioned into monophonic sub-voices (a polyphonic block-chord track
 * fans out into one sub-voice per simultaneous note; a monophonic track is
 * unaffected). Each sub-voice is labelled note-by-note against the harmony
 * with {@link analyzeVoice}, seeing every other sub-voice — including siblings
 * within the same track — as its accompaniment. Every note is then re-checked
 * with {@link evaluateSafety} at its onset and again at each chord change it
 * sustains across, so a held note that clashes with a later chord is caught:
 * evaluations that are not {@link NoteSafety.Safe} become conflicts, one per
 * clashing beat, sorted worst severity first and then by beat.
 *
 * Every ordinary non-chord tone — a passing note, a neighbour, a prepared
 * suspension — is by definition unsafe against the chord under it, so the
 * conflict list is a report, not a fault list. Each conflict carries the note's
 * `labels` and its `trackIndex`/`originalIndex`, so a caller can tell those
 * apart and map a conflict back to the note it passed in; `minSeverity` narrows
 * the list to outright dissonance.
 *
 * @param tracks The tracks to analyse.
 * @param opts Analysis options; see {@link ArrangementOptions}.
 * @returns The inferred harmony, per-track annotations, cadences, and conflicts.
 * @example
 * ```ts
 * import { analyzeArrangement } from '@libraz/libcantus';
 * const melody = [
 *   { pitch: 60, startBeat: 0, durationBeat: 2 },
 *   { pitch: 67, startBeat: 2, durationBeat: 2 },
 * ];
 * const { key, conflicts } = analyzeArrangement([{ role: 'melody', notes: melody }]);
 * conflicts; // notes clashing with the inferred harmony, worst severity first
 * ```
 * @category Arrangement & Analysis
 */
export function analyzeArrangement(
  tracks: ArrangementTrack[],
  opts: ArrangementOptions = {},
): ArrangementAnalysis {
  const ts = opts.ts ?? parseTimeSignature('4/4');
  assertTimeSignature(ts);
  const budget = opts.budget;
  assertGenerationBudget(tracks.length, 'arrangement tracks', budget);
  for (let index = 0; index < tracks.length; index += 1) {
    assertNoteEvents(tracks[index]?.notes ?? [], `tracks[${index}].notes`, {
      allowNonPositiveDuration: true,
      budget,
    });
  }
  const profile: SafetyProfile = opts.profile ?? 'pop';
  const minSeverity = opts.minSeverity ?? NoteSafety.Warning;
  const harmonyTracks =
    opts.harmonyTracks === undefined ? undefined : new Set(opts.harmonyTracks.map(Math.trunc));
  const pooled = poolNotes(tracks, harmonyTracks);

  const inferred =
    opts.timeline === undefined
      ? chordTimelineFromNotes(pooled, {
          key: opts.key,
          ts,
          harmonicRhythm: opts.harmonicRhythm,
        })
      : {
          timeline: opts.timeline,
          key: opts.key ?? detectKeyFromNotes(pooled)[0]?.key ?? majorKey(0),
          segmentConfidence: opts.timeline.segments.map(() => 1),
        };
  const { timeline, key, segmentConfidence } = inferred;
  const cadences = detectCadences(timeline, key);
  const prepared = prepareTracks(tracks);

  const trackAnalyses: TrackAnalysis[] = [];
  const conflicts: Conflict[] = [];

  for (let t = 0; t < prepared.length; t += 1) {
    const track = prepared[t];
    if (!track) {
      continue;
    }
    if (isPercussion(track.role)) {
      // A drum hit has no harmonic reading, so labelling it against the chord
      // would produce noise rather than analysis.
      trackAnalyses.push({ name: track.name, role: track.role, notes: [] });
      continue;
    }
    const notes: AnalyzedNote[] = [];
    for (let v = 0; v < track.voices.length; v += 1) {
      const subVoice = track.voices[v];
      if (!subVoice) {
        continue;
      }
      const analyzed = analyzeVoice(subVoice.voice, timeline.at, key, (beat) =>
        otherVoicesSounding(prepared, t, v, beat),
      );
      notes.push(...analyzed.map((note) => ({ ...note, trackIndex: track.trackIndex })));
      const labelsById = new Map(analyzed.map((note) => [note.noteId, note.labels]));

      for (let noteIndex = 0; noteIndex < subVoice.voice.length; noteIndex += 1) {
        const note = subVoice.voice[noteIndex];
        const preparedNote = subVoice.sounding[noteIndex];
        if (note === undefined || preparedNote === undefined) {
          continue;
        }
        for (const beat of evaluationBeats(note, timeline)) {
          const atOnset = Math.abs(beat - note.startBeat) <= EPS;
          const result = evaluateSafety({
            profile,
            candidatePitch: note.pitch,
            prevPitch: atOnset ? preparedNote.prevPitch : note.pitch,
            chord: timeline.at(beat),
            key,
            otherVoices: otherVoicesSounding(prepared, t, v, beat),
            strongBeat: isStrongBeat(beat, ts),
          });
          if (result.safety !== NoteSafety.Safe && result.safety >= minSeverity) {
            const conflict: Conflict = {
              beat,
              trackName: track.name,
              trackIndex: track.trackIndex,
              noteId: note.id,
              pitch: note.pitch,
              labels: labelsById.get(note.id) ?? [],
              safety: result.safety,
              reasons: result.reasons,
            };
            if (note.originalIndex !== undefined) {
              conflict.originalIndex = note.originalIndex;
            }
            if (result.rationale !== undefined) {
              conflict.rationale = result.rationale;
            }
            if (result.resolveTo !== undefined) {
              conflict.resolveTo = result.resolveTo;
            }
            if (result.suggestions !== undefined) {
              conflict.suggestions = [...result.suggestions];
            }
            conflicts.push(conflict);
          }
        }
      }
    }
    // Sub-voice results interleave; restore the track's onset-then-pitch order.
    notes.sort((a, b) => a.noteId - b.noteId);
    trackAnalyses.push({ name: track.name, role: track.role, notes });
  }

  conflicts.sort((a, b) => b.safety - a.safety || a.beat - b.beat);

  return { key, timeline, segmentConfidence, cadences, tracks: trackAnalyses, conflicts };
}
