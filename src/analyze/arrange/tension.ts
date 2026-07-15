/**
 * Arrangement tension analysis: a coarse harmonic-tension curve sampled at
 * regular beats across a whole multi-track piece, combining the sounding
 * chord's harmonic function, the dissonance of the sounding notes, and their
 * registral span into a single normalized reading.
 */

import { isStrongBeat, parseTimeSignature, type TimeSignature } from '../../core/meter/index.js';
import type { KeyScale } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertNoteEvents,
  assertRange,
  assertTimeSignature,
} from '../../core/validation/index.js';
import { chordPitchClasses } from '../../theory/chord/index.js';
import { evaluateSafety, NoteSafety, type SafetyProfile } from '../../theory/safety/index.js';
import { functionOf } from '../functional/index.js';
import { type ChordTimeline, chordTimelineFromNotes } from '../timeline/index.js';
import { covers, EPS, type PreparedTrack, poolNotes, prepareTracks } from './internal.js';
import type { ArrangementOptions, ArrangementTrack } from './tracks.js';

/**
 * A tension reading sampled at a beat.
 *
 * @category Arrangement & Analysis
 */
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

/** Reduce a pitch to a pitch class in [0, 11]. */
function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

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
 * @example
 * ```ts
 * import { tensionCurve } from '@libraz/libcantus';
 * const notes = [{ pitch: 60, startBeat: 0, durationBeat: 4 }];
 * const curve = tensionCurve([{ notes }], { step: 1 });
 * curve; // one { beat, tension } sample per beat, in beat order
 * ```
 * @category Arrangement & Analysis
 */
export function tensionCurve(
  tracks: ArrangementTrack[],
  opts: ArrangementOptions & { step?: number } = {},
): TensionPoint[] {
  const ts = opts.ts ?? parseTimeSignature('4/4');
  assertTimeSignature(ts);
  assertGenerationBudget(tracks.length, 'arrangement tracks');
  for (let index = 0; index < tracks.length; index += 1) {
    assertNoteEvents(tracks[index]?.notes ?? [], `tracks[${index}].notes`, {
      allowNonPositiveDuration: true,
    });
  }
  const profile: SafetyProfile = opts.profile ?? 'pop';
  const step = opts.step ?? 1;
  assertRange(step, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'tension sampling step');

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
  assertGenerationBudget(sampleCount, 'tension samples');
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
