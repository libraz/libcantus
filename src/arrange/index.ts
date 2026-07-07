/**
 * Arrangement analysis: the capstone that ties the timeline, per-voice analysis,
 * functional harmony, and safety modules together for a whole multi-track piece.
 *
 * A chord timeline and key are inferred once from every track's notes pooled
 * together; each track is then analysed against that shared harmony, notes that
 * clash with the sounding chord are collected as conflicts, and a coarse tension
 * curve is sampled across the piece.
 */

import { type AnalyzedNote, analyzeVoice, type VoiceNote } from '../analysis/index.js';
import { chordPitchClasses } from '../chord/index.js';
import { functionOf } from '../functional/index.js';
import { isStrongBeat, parseTimeSignature, type TimeSignature } from '../meter/index.js';
import {
  evaluateSafety,
  NoteSafety,
  type SafetyProfile,
  type VoiceSnapshot,
} from '../safety/index.js';
import {
  type CadenceHit,
  type ChordTimeline,
  chordTimelineFromNotes,
  detectCadences,
} from '../timeline/index.js';
import type { KeyScale, NoteEvent } from '../types.js';

/** Float tolerance for beat boundary comparisons. */
const EPS = 1e-9;

/** The musical role a track plays in the arrangement. */
export type TrackRole = 'melody' | 'harmony' | 'bass' | 'other';

/** One input track: its notes plus optional name and role. */
export type ArrangementTrack = {
  name?: string;
  role?: TrackRole;
  notes: NoteEvent[];
};

/** A track after analysis: its resolved name, role, and per-note annotations. */
export type TrackAnalysis = {
  name: string;
  role: TrackRole;
  /** One {@link AnalyzedNote} per note, labelled against the inferred chords. */
  notes: AnalyzedNote[];
};

/** A note that clashes with the harmony sounding beneath it. */
export type Conflict = {
  beat: number;
  trackName: string;
  pitch: number;
  /** The clash severity: {@link NoteSafety.Warning} or {@link NoteSafety.Dissonant}. */
  safety: NoteSafety;
  /** {@link import('../safety/index.js').SafetyResult.reasons} bitmask. */
  reasons: number;
  rationale?: string;
};

/** The full result of {@link analyzeArrangement}. */
export type ArrangementAnalysis = {
  key: KeyScale;
  timeline: ChordTimeline;
  segmentConfidence: number[];
  cadences: CadenceHit[];
  tracks: TrackAnalysis[];
  /** Notes clashing with the sounding harmony, worst severity first. */
  conflicts: Conflict[];
};

/** Options controlling {@link analyzeArrangement} and {@link tensionCurve}. */
export type ArrangementOptions = {
  /** Key context; inferred from the pooled notes when omitted. */
  key?: KeyScale;
  /** Time signature; defaults to 4/4. */
  ts?: TimeSignature;
  /** Chord-slot length in beats; defaults to one bar of `ts`. */
  harmonicRhythm?: number;
  /** Safety profile used for conflict detection; defaults to `pop`. */
  profile?: SafetyProfile;
};

/** A note with the pitch that immediately preceded it in the same sub-voice. */
type PreparedNote = {
  pitch: number;
  prevPitch?: number;
  startBeat: number;
  endBeat: number;
};

/** One monophonic sub-voice of a track: ordered notes plus sounding spans. */
type PreparedVoice = {
  /** The sub-voice's notes in time order, each with a stable id. */
  voice: VoiceNote[];
  /** The same notes as sounding spans, each carrying its predecessor's pitch. */
  sounding: PreparedNote[];
};

/** A track prepared for analysis: resolved metadata plus monophonic sub-voices. */
type PreparedTrack = {
  name: string;
  role: TrackRole;
  /**
   * The track's notes partitioned into monophonic sub-voices. Voice analysis
   * assumes one note at a time, so a polyphonic track (e.g. a 'harmony' track
   * playing block chords) is split here; a monophonic track yields exactly one
   * sub-voice.
   */
  voices: PreparedVoice[];
};

/** Reduce a pitch to a pitch class in [0, 11]. */
function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

/** Whether a sounding span `[start, end)` covers a beat. */
function covers(note: PreparedNote, beat: number): boolean {
  return beat >= note.startBeat - EPS && beat < note.endBeat - EPS;
}

/**
 * Every sounding note of every track pooled into one flat list. Zero- and
 * negative-length notes never sound, so they are dropped here (matching the
 * chord-inference ingest in the timeline module).
 */
function poolNotes(tracks: ArrangementTrack[]): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (const track of tracks) {
    for (const note of track.notes) {
      if (note.durationBeat > 0) {
        notes.push(note);
      }
    }
  }
  return notes;
}

/**
 * Split a track's ordered notes into monophonic sub-voices.
 *
 * Greedy lane assignment: each note joins the first sub-voice that is free at
 * its onset (its last note has ended), otherwise it opens a new sub-voice. A
 * monophonic track therefore stays a single sub-voice, while block chords fan
 * out into one sub-voice per simultaneous note, keeping every sub-voice's
 * note-to-note adjacency genuinely melodic.
 */
function splitIntoSubVoices(ordered: VoiceNote[]): VoiceNote[][] {
  const lanes: VoiceNote[][] = [];
  for (const note of ordered) {
    const lane = lanes.find((candidate) => {
      const last = candidate[candidate.length - 1];
      return last !== undefined && last.startBeat + last.durationBeat <= note.startBeat + EPS;
    });
    if (lane) {
      lane.push(note);
    } else {
      lanes.push([note]);
    }
  }
  return lanes;
}

/**
 * Resolve each track's metadata and derive its monophonic sub-voices.
 *
 * Notes are sorted by onset, then pitch, so ordering is deterministic, and ids
 * are assigned in that order. Zero- and negative-length notes never sound and
 * are dropped at ingest. Each track is then partitioned into monophonic
 * sub-voices (see {@link splitIntoSubVoices}); the predecessor pitch used for
 * suspension and parallel detection is the previous note of the same sub-voice,
 * never a simultaneous chord member.
 */
function prepareTracks(tracks: ArrangementTrack[]): PreparedTrack[] {
  let nextId = 0;
  return tracks.map((track, index) => {
    const ordered: VoiceNote[] = track.notes
      .filter((note) => note.durationBeat > 0)
      .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
      .map((note) => ({ ...note, id: nextId++ }));
    const voices: PreparedVoice[] = splitIntoSubVoices(ordered).map((voice) => ({
      voice,
      sounding: voice.map((note, i) => {
        const prev = i > 0 ? voice[i - 1] : undefined;
        return {
          pitch: note.pitch,
          prevPitch: prev?.pitch,
          startBeat: note.startBeat,
          endBeat: note.startBeat + note.durationBeat,
        };
      }),
    }));
    return {
      name: track.name ?? `track ${index + 1}`,
      role: track.role ?? 'other',
      voices,
    };
  });
}

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
        if (note.prevPitch !== undefined) {
          snap.prevPitch = note.prevPitch;
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
 */
export function analyzeArrangement(
  tracks: ArrangementTrack[],
  opts: ArrangementOptions = {},
): ArrangementAnalysis {
  const ts = opts.ts ?? parseTimeSignature('4/4');
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

      for (const note of subVoice.voice) {
        for (const beat of evaluationBeats(note, timeline)) {
          const result = evaluateSafety({
            profile,
            candidatePitch: note.pitch,
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

/** A tension reading sampled at a beat. */
export type TensionPoint = {
  beat: number;
  /** Combined tension in [0, 1]. */
  tension: number;
};

/** Tension contributed by the sounding chord's harmonic function. */
const FUNCTION_TENSION: Record<'tonic' | 'subdominant' | 'dominant', number> = {
  tonic: 0,
  subdominant: 0.5,
  dominant: 1,
};

/** Weight of the harmonic-function term in the combined tension score. */
const FUNCTION_WEIGHT = 0.5;
/** Weight of the non-chord-tone / dissonance term. */
const DISSONANCE_WEIGHT = 0.35;
/** Weight of the registral-span term. */
const SPAN_WEIGHT = 0.15;
/** Pitch span, in semitones, that saturates the span term. */
const SPAN_SATURATION = 24;

/** Clamp a value into [0, 1]. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Sample the harmonic tension of an arrangement at regular beats.
 *
 * At each sample beat the tension combines three normalized terms:
 *  - the sounding chord's harmonic function (dominant `1`, subdominant `0.5`,
 *    tonic or no chord `0`), weighted {@link FUNCTION_WEIGHT};
 *  - the dissonance of the sounding notes — the larger of the share of sounding
 *    pitches that are not chord tones and the share that {@link evaluateSafety}
 *    rates {@link NoteSafety.Dissonant} — weighted {@link DISSONANCE_WEIGHT};
 *  - the registral span of the sounding notes, saturating at
 *    {@link SPAN_SATURATION} semitones, weighted {@link SPAN_WEIGHT}.
 *
 * The weighted sum is clamped to [0, 1]. The harmony is inferred from all tracks
 * pooled together, so the result is deterministic and self-contained.
 *
 * @param tracks The tracks to sample.
 * @param opts Analysis options plus an optional `step` (default one beat).
 * @returns One {@link TensionPoint} per sampled beat, in beat order.
 * @throws If `step` is not positive.
 */
export function tensionCurve(
  tracks: ArrangementTrack[],
  opts: ArrangementOptions & { step?: number } = {},
): TensionPoint[] {
  const ts = opts.ts ?? parseTimeSignature('4/4');
  const profile: SafetyProfile = opts.profile ?? 'pop';
  const step = opts.step ?? 1;
  if (!(step > 0)) {
    throw new Error(`Invalid tension sampling step: ${step}`);
  }

  const pooled = poolNotes(tracks);
  const totalBeats = pooled.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  const { timeline, key } = chordTimelineFromNotes(pooled, {
    key: opts.key,
    ts,
    harmonicRhythm: opts.harmonicRhythm,
  });

  const prepared = prepareTracks(tracks);
  const points: TensionPoint[] = [];
  const sampleCount = Math.max(0, Math.ceil(totalBeats / step - EPS));
  for (let i = 0; i < sampleCount; i += 1) {
    const beat = i * step;
    points.push({ beat, tension: sampleTension(prepared, timeline, key, ts, profile, beat) });
  }
  return points;
}

/** All sounding notes across every track at a beat, tagged with their track. */
function allSounding(prepared: PreparedTrack[], beat: number): { pitch: number; track: number }[] {
  const out: { pitch: number; track: number }[] = [];
  for (let t = 0; t < prepared.length; t += 1) {
    const track = prepared[t];
    if (!track) {
      continue;
    }
    for (const subVoice of track.voices) {
      for (const note of subVoice.sounding) {
        if (covers(note, beat)) {
          out.push({ pitch: note.pitch, track: t });
        }
      }
    }
  }
  return out;
}

/** Combine the harmonic, dissonance, and span terms at one sample beat. */
function sampleTension(
  prepared: PreparedTrack[],
  timeline: ChordTimeline,
  key: KeyScale,
  ts: TimeSignature,
  profile: SafetyProfile,
  beat: number,
): number {
  const sounding = allSounding(prepared, beat);
  if (sounding.length === 0) {
    return 0;
  }
  const chord = timeline.at(beat);
  const functionScore = chord ? FUNCTION_TENSION[functionOf(chord, key)] : 0;

  const chordPcs = chord ? new Set(chordPitchClasses(chord)) : null;
  const strongBeat = isStrongBeat(beat, ts);
  let nonChord = 0;
  let dissonant = 0;
  for (let i = 0; i < sounding.length; i += 1) {
    const voice = sounding[i];
    if (!voice) {
      continue;
    }
    // Non-chord-tone share only applies when a chord is sounding; at a timeline
    // gap there is no reference harmony, so vertical dissonance alone drives the
    // dissonance term (the chord function term is already 0 there).
    if (chordPcs && !chordPcs.has(pitchClass(voice.pitch))) {
      nonChord += 1;
    }
    const others = sounding.filter((_, j) => j !== i).map((s) => ({ pitch: s.pitch }));
    const result = evaluateSafety({
      profile,
      candidatePitch: voice.pitch,
      chord,
      key,
      otherVoices: others,
      strongBeat,
    });
    if (result.safety === NoteSafety.Dissonant) {
      dissonant += 1;
    }
  }
  const dissonanceScore = Math.max(nonChord, dissonant) / sounding.length;

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const voice of sounding) {
    low = Math.min(low, voice.pitch);
    high = Math.max(high, voice.pitch);
  }
  const spanScore = Math.min(1, (high - low) / SPAN_SATURATION);

  return clamp01(
    FUNCTION_WEIGHT * functionScore + DISSONANCE_WEIGHT * dissonanceScore + SPAN_WEIGHT * spanScore,
  );
}
