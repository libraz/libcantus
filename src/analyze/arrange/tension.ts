/**
 * Arrangement tension analysis: a coarse harmonic-tension curve sampled at
 * regular beats across a whole multi-track piece, combining the sounding
 * chord's harmonic function, the dissonance of the sounding notes, and their
 * registral span into a single normalized reading.
 */

import type { MeterMap } from '../../core/meter/index.js';
import { isStrongBeat, resolveMeters } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { NoteEventAssertOptions } from '../../core/validation/index.js';
import {
  assertArray,
  assertGenerationBudget,
  assertInteger,
  assertRange,
  assertRecord,
} from '../../core/validation/index.js';
import { chordPitchClasses } from '../../theory/chord/index.js';
import { evaluateSafety, NoteSafety, type SafetyProfile } from '../../theory/safety/index.js';
import { majorKey, resolveKey, scaleOf } from '../../theory/scale/index.js';
import { BEAT_EPS } from '../adjacency.js';
import { functionOf } from '../functional/index.js';
import { gridForNotes } from '../grid.js';
import { keyLookup, keyTimelineFromNotes, prevailingKeyOf } from '../keys/index.js';
import { type ChordTimeline, chordTimelineFromNotes } from '../timeline/index.js';
import {
  arrangementProfile,
  assertGivenKeys,
  assertGivenTimeline,
  assertTrackNotes,
  harmonyTrackSet,
  isPercussion,
  type PreparedTrack,
  poolNotes,
  prepareTracks,
} from './internal.js';
import type { ArrangementAnalysis, ArrangementOptions, ArrangementTrack } from './tracks.js';

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

/** Clamp a value into [0, 1]. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Sample the harmonic tension of an arrangement at regular beats.
 *
 * At each sample beat the tension combines three normalized terms:
 *  - the sounding chord's harmonic function (dominant `1`, subdominant `0.5`,
 *    tonic or no chord `0`), weighted `FUNCTION_WEIGHT`;
 *  - the dissonance of the sounding notes — the larger of the share of sounding
 *    pitches that are not chord tones and the share that {@link evaluateSafety}
 *    rates {@link NoteSafety.Dissonant} — weighted `DISSONANCE_WEIGHT`;
 *  - the registral span of the sounding notes, saturating at
 *    `SPAN_SATURATION` semitones, weighted `SPAN_WEIGHT`.
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
  const meters = resolveMeters(opts, 'arrangement meters');
  const budget = opts.budget;
  const noteOptions: NoteEventAssertOptions = { allowNonPositiveDuration: true, budget };
  if (opts.pickupBeats !== undefined) {
    assertRange(opts.pickupBeats, 0, Number.MAX_SAFE_INTEGER, 'arrangement pickupBeats');
    noteOptions.minStartBeat = -opts.pickupBeats;
  }
  assertArray(tracks, 'arrangement tracks');
  assertGenerationBudget(tracks.length, 'arrangement tracks', budget);
  const noteCount = assertTrackNotes(tracks, noteOptions);
  // The pooled total is what the sampling and the inferred timeline size their
  // work by, so it is checked here, under this layer's own name.
  assertGenerationBudget(noteCount, 'arrangement notes', budget);
  const profile = arrangementProfile(opts.profile);
  const step = opts.step ?? 1;
  assertRange(step, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'tension sampling step');
  // Read by no sampling this call makes, and checked all the same: the option is
  // one of the arrangement options this entry point accepts, and a value the
  // sibling entry point refuses cannot be one this one silently takes.
  if (opts.minSeverity !== undefined) {
    assertInteger(
      opts.minSeverity,
      'arrangement minSeverity',
      NoteSafety.Safe,
      NoteSafety.Dissonant,
    );
  }

  // The two options a caller can hand a previous pass's work through are read
  // for their shape here, with the rest of the options, rather than at the line
  // that first dereferences them several layers down.
  assertGivenTimeline(opts.timeline, 'arrangement timeline');
  assertGivenKeys(opts.keys, 'arrangement keys');
  const harmonyTracks = harmonyTrackSet(opts.harmonyTracks, tracks);
  const pooled = poolNotes(tracks, harmonyTracks);
  const all = poolNotes(tracks);
  const totalBeats = all.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  // The grid the samples sit on is a whole number of steps from beat 0, and the
  // music itself starts at `musicStart`: a pickup sounds before beat 0 and an
  // excerpt lifted from bar 9 begins there, and neither is sampled across
  // silence it never had.
  const { origin: sampleStart, startBeat: musicStart } = gridForNotes(all, step);
  // A caller-supplied timeline still needs key regions to be read against: the
  // ones the caller gave, the single key they named, or the ones the notes
  // themselves give, since supplying chords answers nothing about the key.
  const suppliedKeys =
    opts.timeline === undefined
      ? undefined
      : (opts.keys ??
        (opts.key !== undefined
          ? [
              {
                // The one region a named key holds starts where the music does,
                // as the searched regions and the timeline's own key window do:
                // a key cannot be in force over beats nothing sounds in.
                startBeat: musicStart,
                endBeat: totalBeats,
                key: resolveKey(opts.key),
                confidence: 1,
              },
            ]
          : keyTimelineFromNotes(pooled, { meters, totalBeats, budget })));
  const { timeline, keys, prevailingKey } =
    opts.timeline === undefined || suppliedKeys === undefined
      ? chordTimelineFromNotes(pooled, {
          key: opts.key,
          meters,
          pickupBeats: opts.pickupBeats,
          harmonicRhythm: opts.harmonicRhythm,
          budget,
        })
      : {
          timeline: opts.timeline,
          keys: suppliedKeys,
          prevailingKey: prevailingKeyOf(suppliedKeys) ?? resolveKey(majorKey(0)),
        };
  // Harmonic tension is judged against the key in force at the sample, not
  // against one key for the piece: a chord is only tense relative to a tonic.
  const regions = opts.keys ?? keys;
  const keyAt = keyLookup(regions, prevailingKeyOf(regions) ?? prevailingKey);

  const prepared = prepareTracks(tracks);
  const points: TensionPoint[] = [];
  const sampleCount = Math.max(0, Math.ceil((totalBeats - sampleStart) / step - BEAT_EPS));
  assertGenerationBudget(sampleCount, 'tension samples', budget);
  // The per-sample cost is one lookup per sub-voice, so it is their product —
  // not either dimension alone — that has to stay inside the budget.
  const voiceCount = prepared.reduce((sum, track) => sum + track.voices.length, 0);
  assertGenerationBudget(
    sampleCount * Math.min(128, voiceCount) * voiceCount,
    'tension sample-voice comparisons',
    budget,
  );
  for (let i = 0; i < sampleCount; i += 1) {
    // The first sample is taken where the music starts rather than at the slot
    // boundary before it, so a curve carries no phantom lead-in over silence the
    // piece never had; every later sample stays a whole number of steps from
    // beat 0, which is what keeps them on the bar lines.
    const beat = i === 0 ? Math.max(sampleStart, musicStart) : sampleStart + i * step;
    points.push({
      beat,
      // The pitch classes alone: tension is scored from what sounds against
      // the tonic, and no reading below here asks how the key is written.
      tension: sampleTension(prepared, timeline, scaleOf(keyAt(beat)), meters, profile, beat),
    });
  }
  return points;
}

/**
 * Sample the tension of an arrangement already analysed by
 * {@link analyzeArrangement}, reusing its harmony instead of inferring it again.
 *
 * `analyzeArrangement` followed by `tensionCurve` runs chord and key inference
 * twice over the same notes. This takes the analysis it already produced, so
 * the curve and the annotations describe the same harmony by construction.
 *
 * The analysis is the harmony to fall back on rather than one laid over the
 * caller: `key`, `keys` and `harmonyTracks` each name a harmony the analysis
 * does not hold, so naming one is asking for a different reading, and the curve
 * is taken under it. Nothing else about the analysis is re-derived.
 *
 * @param tracks The same tracks that were analysed.
 * @param analysis The result of {@link analyzeArrangement} for those tracks.
 * @param opts Analysis options plus an optional `step` (default one beat).
 * @returns One {@link TensionPoint} per sampled beat, in beat order.
 * @example
 * ```ts
 * import { analyzeArrangement, tensionCurveFrom } from '@libraz/libcantus';
 * const tracks = [{ notes: [{ pitch: 60, startBeat: 0, durationBeat: 4 }] }];
 * const analysis = analyzeArrangement(tracks);
 * tensionCurveFrom(tracks, analysis, { step: 1 });
 * ```
 * @category Arrangement & Analysis
 */
export function tensionCurveFrom(
  tracks: ArrangementTrack[],
  analysis: ArrangementAnalysis,
  opts: ArrangementOptions & { step?: number } = {},
): TensionPoint[] {
  const carried = carriedHarmony(assertRecord<ArrangementAnalysis>(analysis, 'analysis'), opts);
  return tensionCurve(tracks, { ...carried, ...opts });
}

/**
 * How much of an analysis's harmony a set of options leaves in place.
 *
 * Restricting the harmony to a few tracks changes which notes state it, so
 * nothing of the analysis survives; naming a key or its regions changes only
 * what the chords are heard against, so the chords themselves are kept.
 */
function carriedHarmony(
  analysis: ArrangementAnalysis,
  opts: ArrangementOptions,
): ArrangementOptions {
  if (opts.harmonyTracks !== undefined) {
    return {};
  }
  if (opts.key !== undefined || opts.keys !== undefined) {
    return { timeline: analysis.timeline };
  }
  return { timeline: analysis.timeline, keys: analysis.keys };
}

/**
 * All sounding pitched notes across every track at a beat, tagged with their
 * track. Percussion carries no harmony, so it is skipped; each sub-voice is
 * monophonic, so its contribution is one binary search rather than a scan.
 */
function allSounding(prepared: PreparedTrack[], beat: number): { pitch: number; track: number }[] {
  const out: { pitch: number; track: number }[] = [];
  for (let t = 0; t < prepared.length; t += 1) {
    const track = prepared[t];
    if (!track || isPercussion(track.role)) {
      continue;
    }
    for (const subVoice of track.voices) {
      const note = subVoice.at(beat);
      if (note !== undefined) {
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
  meters: MeterMap,
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
  const strongBeat = isStrongBeat(beat, meters);
  let nonChord = 0;
  let dissonant = 0;
  // A coarse tension sample supplies no individual voice history. Every voice
  // at the same MIDI pitch consequently receives the same safety verdict, so
  // a dense pad needs at most 128 evaluations instead of one per voice.
  const pitches = new Map<number, number>();
  for (const voice of sounding) {
    pitches.set(voice.pitch, (pitches.get(voice.pitch) ?? 0) + 1);
  }
  // The voices a candidate is weighed against are the texture with one of its
  // own occurrences taken out, so the texture is written down once for the
  // sample and that one occurrence is lifted out and put back around each
  // evaluation. Rebuilding it per distinct pitch instead allocated a record per
  // voice per pitch — a hundred-voice pad spending ten thousand objects on a
  // beat to say the same thing a hundred times.
  const others: { pitch: number }[] = [];
  const firstOf = new Map<number, number>();
  for (const [pitch, count] of pitches) {
    firstOf.set(pitch, others.length);
    for (let i = 0; i < count; i += 1) {
      others.push({ pitch });
    }
  }
  for (const [pitch, count] of pitches) {
    // Non-chord-tone share only applies when a chord is sounding; at a timeline
    // gap there is no reference harmony, so vertical dissonance alone drives the
    // dissonance term (the chord function term is already 0 there).
    if (chordPcs && !chordPcs.has(pitchClass(pitch))) {
      nonChord += count;
    }
    // One occurrence of the candidate's own pitch is moved to the end and
    // dropped, which leaves exactly the multiset the caller would have built.
    const at = firstOf.get(pitch) ?? 0;
    const last = others.length - 1;
    const held = others[at];
    const tail = others[last];
    if (held !== undefined && tail !== undefined) {
      others[at] = tail;
      others.pop();
    }
    // Only the verdict is read, so the replacement-pitch search is skipped.
    const result = evaluateSafety(
      { profile, candidatePitch: pitch, chord, key, otherVoices: others, strongBeat },
      { suggestions: false },
    );
    if (held !== undefined && tail !== undefined) {
      others.push(tail);
      others[at] = held;
    }
    if (result.safety === NoteSafety.Dissonant) {
      dissonant += count;
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
