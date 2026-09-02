import { InvalidInputError, NoSolutionError } from '../../core/errors/index.js';
import { assertArray, assertFiniteNumber } from '../../core/validation/index.js';
import { type ChordLike, toChordData } from '../symbol/index.js';
import { enumerateVoicings, leadingCost, moveScore, moveScoring } from './internal.js';
import type { VoicingOptions } from './satb.js';
import {
  resolvedKeyOf,
  resolveMaxCandidates,
  resolveMaxSpacing,
  resolvePreviousChord,
  resolveRanges,
} from './satb.js';

/**
 * Total voice-leading cost between two voicings: the sum of absolute semitone
 * motion across voices, and nothing besides. The rules the search also weighs —
 * parallels, hidden perfects, unresolved tendency tones — are judged and
 * reported by {@link checkPartWriting}, so measuring distance stays a
 * measurement. The arrays must be the same length; when they differ the
 * voicings are not comparable and the cost is `Infinity`.
 *
 * @param from The previous voicing, one MIDI pitch per voice.
 * @param to The next voicing, one MIDI pitch per voice.
 * @returns The summed absolute motion, or `Infinity` when lengths differ.
 * @category Voicing & Counterpoint
 */
export function voiceLeadingCost(from: number[], to: number[]): number {
  const previous = assertArray<number>(from, 'from');
  const next = assertArray<number>(to, 'to');
  if (previous.length !== next.length) {
    return Number.POSITIVE_INFINITY;
  }
  return leadingCost(previous, 0, next, 0, previous.length);
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
 * The rules read from the chord being left — the resolution of a chordal
 * seventh, the resolution of a leading tone, and the cross relation between the
 * two chords — are scored only when `opts.previousChord` names it: what a
 * voicing is written on cannot be read back from the pitches it holds. An
 * editor moving from one chord to the next has that chord, and passing it is
 * what keeps this generator and {@link checkPartWriting} agreeing about the
 * pair.
 *
 * @param current The current voicing to lead from, ascending (index 0 = lowest).
 * @param chord The next chord to voice, as a chord symbol, chord data, or a
 *   `Chord`.
 * @param opts Voicing options; when omitted, ranges follow `current`'s span.
 * @returns The chosen voicing, ascending with one MIDI pitch per voice.
 * @throws If `current` is empty or holds a non-finite pitch while the ranges
 *   are derived from it, if it asks for more voices than the search will take,
 *   or if no voicing fits the ranges.
 * @category Voicing & Counterpoint
 */
export function nextVoicing(current: number[], chord: ChordLike, opts?: VoicingOptions): number[] {
  const data = toChordData(chord);
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
  // Both branches end in the same resolver, so the voice-count budget and the
  // range checks apply wherever the ranges came from: a texture read off
  // `current` is no smaller a search than the same one written out as `ranges`.
  const ranges = derived
    ? resolveRanges({
        ranges: current.map((pitch) => {
          // Window one octave around each current pitch, clamped so extreme-low
          // or extreme-high input can never yield MIDI outside [0, 127].
          const centre = Math.min(127, Math.max(0, pitch));
          return { min: Math.max(0, centre - 12), max: Math.min(127, centre + 12) };
        }),
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
  const candidates = enumerateVoicings(data, ranges, maxSpacing, resolveMaxCandidates(opts));
  const key = resolvedKeyOf(opts);
  // The chord the current voicing came from is optional, so the line it is
  // leaving is spelled against that chord when the caller named one and by the
  // key alone when it did not. Only one chord is being voiced, so there is
  // nothing after it to look ahead to; the move is otherwise scored exactly as
  // one step of a progression is.
  const scoring = moveScoring(resolvePreviousChord(opts), data, key);
  const { pitches, voices } = candidates;
  let bestOffset = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let candidate = 0; candidate < candidates.count; candidate += 1) {
    const offset = candidate * voices;
    const score = moveScore(scoring, source, 0, pitches, offset, voices);
    if (score < bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  if (bestOffset < 0) {
    throw new NoSolutionError('no voicing satisfies the given ranges');
  }
  return [...pitches.subarray(bestOffset, bestOffset + voices)];
}
