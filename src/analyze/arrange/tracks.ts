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
import {
  type CadenceHit,
  type ChordTimeline,
  chordTimelineFromNotes,
  detectCadences,
} from '../timeline/index.js';
import { type AnalyzedNote, analyzeVoice, type VoiceNote } from '../voice/index.js';
import { covers, EPS, type PreparedTrack, poolNotes, prepareTracks } from './internal.js';

/**
 * The musical role a track plays in the arrangement.
 *
 * @category Arrangement & Analysis
 */
export type TrackRole = 'melody' | 'harmony' | 'bass' | 'other';

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
  pitch: number;
  /** The clash severity: {@link NoteSafety.Warning} or {@link NoteSafety.Dissonant}. */
  safety: NoteSafety;
  /** {@link import('../safety/index.js').SafetyResult.reasons} bitmask. */
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
    if (!track) {
      continue;
    }
    for (let v = 0; v < track.voices.length; v += 1) {
      if (t === excludeTrack && v === excludeVoice) {
        continue;
      }
      const subVoice = track.voices[v];
      if (!subVoice) {
        continue;
      }
      for (const note of subVoice.sounding) {
        if (!covers(note, beat)) {
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
  }
  return out;
}

/**
 * The beats at which a note must be checked against the harmony: its onset,
 * plus the onset of every later chord segment the note sustains across. Each
 * crossed segment is visited exactly once (at its own start), so a boundary
 * beat is never evaluated twice for the same note.
 */
function evaluationBeats(note: VoiceNote, timeline: ChordTimeline): number[] {
  const noteEnd = note.startBeat + note.durationBeat;
  const beats = [note.startBeat];
  for (const segment of timeline.segments) {
    if (segment.startBeat > note.startBeat + EPS && segment.startBeat < noteEnd - EPS) {
      beats.push(segment.startBeat);
    }
  }
  return beats;
}

/**
 * Analyse a whole arrangement against a single inferred harmony.
 *
 * The chord timeline and key are inferred from the pooled notes of every track
 * (see {@link chordTimelineFromNotes}); pooling all voices is robust even when
 * roles are absent or a track doubles the harmony, so it is preferred over
 * deriving the harmony from a subset. Zero- and negative-length notes never
 * sound, so they are dropped at ingest and appear in neither the annotations
 * nor the conflicts.
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
  assertGenerationBudget(tracks.length, 'arrangement tracks');
  for (let index = 0; index < tracks.length; index += 1) {
    assertNoteEvents(tracks[index]?.notes ?? [], `tracks[${index}].notes`, {
      allowNonPositiveDuration: true,
    });
  }
  const profile: SafetyProfile = opts.profile ?? 'pop';
  const pooled = poolNotes(tracks);

  const { timeline, key, segmentConfidence } = chordTimelineFromNotes(pooled, {
    key: opts.key,
    ts,
    harmonicRhythm: opts.harmonicRhythm,
  });
  const cadences = detectCadences(timeline, key);
  const prepared = prepareTracks(tracks);

  const trackAnalyses: TrackAnalysis[] = [];
  const conflicts: Conflict[] = [];

  for (let t = 0; t < prepared.length; t += 1) {
    const track = prepared[t];
    if (!track) {
      continue;
    }
    const notes: AnalyzedNote[] = [];
    for (let v = 0; v < track.voices.length; v += 1) {
      const subVoice = track.voices[v];
      if (!subVoice) {
        continue;
      }
      notes.push(
        ...analyzeVoice(subVoice.voice, timeline.at, key, (beat) =>
          otherVoicesSounding(prepared, t, v, beat),
        ),
      );

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
          if (result.safety !== NoteSafety.Safe) {
            const conflict: Conflict = {
              beat,
              trackName: track.name,
              pitch: note.pitch,
              safety: result.safety,
              reasons: result.reasons,
            };
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
