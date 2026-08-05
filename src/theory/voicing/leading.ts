import { InvalidInputError, NoSolutionError } from '../../core/errors/index.js';
import { assertFiniteNumber } from '../../core/validation/index.js';
import type { Chord } from '../chord/index.js';
import { createsHiddenParallelPerfect } from '../counterpoint/index.js';
import {
  enumerateVoicings,
  RESOLUTION_PENALTY,
  resolutionViolations,
  structuralPenalty,
  VIOLATION_PENALTY,
  violationCount,
} from './internal.js';
import type { VoicingOptions } from './satb.js';
import { resolveMaxCandidates, resolveMaxSpacing, resolveRanges } from './satb.js';

/**
 * Moderate penalty for a hidden/direct perfect fifth or octave reached on the
 * outer-voice (bass–soprano) pair. Unlike a true parallel perfect it is
 * discouraged rather than forbidden, so the weight sits alongside voice-leading
 * motion rather than the hard {@link VIOLATION_PENALTY}.
 */
const HIDDEN_PERFECT_PENALTY = 6;

/**
 * Total voice-leading cost between two voicings: the sum of absolute semitone
 * motion across voices, plus a moderate `HIDDEN_PERFECT_PENALTY` when the
 * outer-voice (bass–soprano) pair reaches a hidden/direct perfect fifth or
 * octave by similar motion. The arrays must be the same length; when they
 * differ the voicings are not comparable and the cost is `Infinity`.
 *
 * @param from The previous voicing, one MIDI pitch per voice.
 * @param to The next voicing, one MIDI pitch per voice.
 * @returns The summed absolute motion (plus any hidden-perfect penalty), or
 *   `Infinity` when lengths differ.
 * @category Voicing & Counterpoint
 */
export function voiceLeadingCost(from: number[], to: number[]): number {
  if (from.length !== to.length) {
    return Number.POSITIVE_INFINITY;
  }
  let total = 0;
  for (let i = 0; i < from.length; i += 1) {
    const a = from[i];
    const b = to[i];
    if (a === undefined || b === undefined) {
      continue;
    }
    total += Math.abs(b - a);
  }
  // Discourage hidden/direct perfects between the outermost voices, where they
  // are most audible. True parallels are handled (and forbidden) elsewhere.
  if (from.length >= 2) {
    const bassPrev = from[0];
    const bassCur = to[0];
    const sopPrev = from[from.length - 1];
    const sopCur = to[to.length - 1];
    if (
      bassPrev !== undefined &&
      bassCur !== undefined &&
      sopPrev !== undefined &&
      sopCur !== undefined &&
      createsHiddenParallelPerfect(bassPrev, bassCur, sopPrev, sopCur)
    ) {
      total += HIDDEN_PERFECT_PENALTY;
    }
  }
  return total;
}

/**
 * Voice a single chord to follow smoothly from an arbitrary current voicing.
 *
 * Candidate voicings of `chord` are enumerated within ranges taken from `opts`,
 * or — when neither `voices` nor `ranges` is given — from a one-octave window
 * around each pitch of `current` (so the result matches `current`'s voice
 * count). Each candidate is scored by structural quality, voice-leading motion
 * from `current`, and a large penalty per counterpoint violation; the lowest
 * scoring candidate is returned, ascending.
 *
 * @param current The current voicing to lead from, ascending (index 0 = lowest).
 * @param chord The next chord to voice.
 * @param opts Voicing options; when omitted, ranges follow `current`'s span.
 * @returns The chosen voicing, ascending with one MIDI pitch per voice.
 * @throws If `current` is empty or holds a non-finite pitch while the ranges
 *   are derived from it, or if no voicing fits the ranges.
 * @category Voicing & Counterpoint
 */
export function nextVoicing(current: number[], chord: Chord, opts?: VoicingOptions): number[] {
  const derived = opts?.ranges === undefined && opts?.voices === undefined;
  if (derived) {
    // The ranges are read off `current`, so an empty voicing would describe a
    // zero-voice chord and return an empty result — the same input that throws
    // when written as an explicit `{ ranges: [] }`.
    if (current.length === 0) {
      throw new InvalidInputError('current must contain at least one pitch');
    }
    for (let index = 0; index < current.length; index += 1) {
      assertFiniteNumber(current[index] ?? Number.NaN, `current[${index}]`);
    }
  }
  const ranges = derived
    ? current.map((pitch) => {
        // Window one octave around each current pitch, clamped so extreme-low
        // or extreme-high input can never yield MIDI outside [0, 127].
        const centre = Math.min(127, Math.max(0, pitch));
        return { min: Math.max(0, centre - 12), max: Math.min(127, centre + 12) };
      })
    : resolveRanges(opts);
  for (let index = 0; index < current.length; index += 1) {
    assertFiniteNumber(current[index] ?? Number.NaN, `current[${index}]`);
  }
  if (current.length < ranges.length) {
    throw new InvalidInputError(
      `current has ${current.length} voices but the requested ranges require ${ranges.length}`,
    );
  }
  // Thinning an existing texture is a normal use case (SATB to three voices,
  // for example). Keep the outer voices and select evenly spaced inner voices
  // so motion is still measured between like voice roles.
  const source =
    current.length === ranges.length
      ? current
      : ranges.length === 1
        ? [current[0] ?? Number.NaN]
        : ranges.map((_, index) => {
            const sourceIndex = Math.round((index * (current.length - 1)) / (ranges.length - 1));
            return current[sourceIndex] ?? Number.NaN;
          });
  const maxSpacing = resolveMaxSpacing(opts);
  const candidates = enumerateVoicings(chord, ranges, maxSpacing, resolveMaxCandidates(opts));
  const previousChord = opts?.previousChord;
  let best: number[] | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const score =
      structuralPenalty(candidate, chord, opts?.key) +
      voiceLeadingCost(source, candidate) +
      VIOLATION_PENALTY * violationCount(source, candidate) +
      RESOLUTION_PENALTY *
        (previousChord === undefined
          ? 0
          : resolutionViolations(source, candidate, previousChord, chord, opts?.key));
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best === undefined) {
    throw new NoSolutionError('no voicing satisfies the given ranges');
  }
  return best;
}
