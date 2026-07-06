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

/** A note with the pitch that immediately preceded it in the same track. */
type PreparedNote = {
  pitch: number;
  prevPitch?: number;
  startBeat: number;
  endBeat: number;
};

/** A track prepared for analysis: resolved metadata plus derived note views. */
type PreparedTrack = {
  name: string;
  role: TrackRole;
  /** The track's notes in time order, each with a stable id. */
  voice: VoiceNote[];
  /** The same notes as sounding spans, each carrying its predecessor's pitch. */
  sounding: PreparedNote[];
};

/** Reduce a pitch to a pitch class in [0, 11]. */
function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

/** Whether a sounding span `[start, end)` covers a beat. */
function covers(note: PreparedNote, beat: number): boolean {
  return beat >= note.startBeat - EPS && beat < note.endBeat - EPS;
}

/** Every note of every track pooled into one flat list. */
function poolNotes(tracks: ArrangementTrack[]): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (const track of tracks) {
    for (const note of track.notes) {
      notes.push(note);
    }
  }
  return notes;
}

/**
 * Resolve each track's metadata and derive its ordered voice and sounding spans.
 *
 * Notes are sorted by onset, then pitch, so ordering is deterministic; the
 * predecessor pitch used for suspension and parallel detection is simply the
 * previous note in that order.
 */
function prepareTracks(tracks: ArrangementTrack[]): PreparedTrack[] {
  let nextId = 0;
  return tracks.map((track, index) => {
    const ordered = [...track.notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
    const voice: VoiceNote[] = ordered.map((note) => ({ ...note, id: nextId++ }));
    const sounding: PreparedNote[] = ordered.map((note, i) => {
      const prev = i > 0 ? ordered[i - 1] : undefined;
      return {
        pitch: note.pitch,
        prevPitch: prev?.pitch,
        startBeat: note.startBeat,
        endBeat: note.startBeat + note.durationBeat,
      };
    });
    return {
      name: track.name ?? `track ${index + 1}`,
      role: track.role ?? 'other',
      voice,
      sounding,
    };
  });
}

/** Sounding pitches of every track except `excludeIndex` at a beat. */
function otherVoicesSounding(
  prepared: PreparedTrack[],
  excludeIndex: number,
  beat: number,
): VoiceSnapshot[] {
  const out: VoiceSnapshot[] = [];
  for (let t = 0; t < prepared.length; t += 1) {
    if (t === excludeIndex) {
      continue;
    }
    const track = prepared[t];
    if (!track) {
      continue;
    }
    for (const note of track.sounding) {
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
  return out;
}

/**
 * Analyse a whole arrangement against a single inferred harmony.
 *
 * The chord timeline and key are inferred from the pooled notes of every track
 * (see {@link chordTimelineFromNotes}); pooling all voices is robust even when
 * roles are absent or a track doubles the harmony, so it is preferred over
 * deriving the harmony from a subset. Each track is then labelled note-by-note
 * against that harmony with {@link analyzeVoice}, seeing the other tracks as its
 * accompaniment, and every note is re-checked with {@link evaluateSafety}: those
 * that are not {@link NoteSafety.Safe} against the sounding chord become
 * conflicts, sorted worst severity first and then by beat.
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
    const notes = analyzeVoice(track.voice, timeline.at, key, (beat) =>
      otherVoicesSounding(prepared, t, beat),
    );
    trackAnalyses.push({ name: track.name, role: track.role, notes });

    for (const note of track.voice) {
      const result = evaluateSafety({
        profile,
        candidatePitch: note.pitch,
        chord: timeline.at(note.startBeat),
        key,
        otherVoices: otherVoicesSounding(prepared, t, note.startBeat),
        strongBeat: isStrongBeat(note.startBeat, ts),
      });
      if (result.safety !== NoteSafety.Safe) {
        const conflict: Conflict = {
          beat: note.startBeat,
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
    for (const note of track.sounding) {
      if (covers(note, beat)) {
        out.push({ pitch: note.pitch, track: t });
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
