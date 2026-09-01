/**
 * Bar-level evidence shared by the form analyses.
 *
 * Phrases, hypermeter and sections all ask the same two questions of a bar —
 * what sounds in it, and how far that is from what sounded in the bar before —
 * so they read the answer from one place. Everything here works in absolute
 * quarter-note beats and 0-based bar indices, so a pickup is bar -1 rather than
 * a special case.
 */

import type { MeterLike } from '../../core/meter/index.js';
import { barIndexAt, barPositionToBeat } from '../../core/meter/index.js';
import type { NoteEvent } from '../../core/types.js';
import { assertGenerationBudget } from '../../core/validation/index.js';
import { windowWeights } from '../histogram.js';

/** Tolerance for beat comparisons reached by float arithmetic. */
export const EPS = 1e-9;

/** Hold a score inside the [0, 1] range every confidence in this module reports. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Remainder carrying the sign of the divisor.
 *
 * Bar indices run negative through a pickup, so the phase of a hypermetric
 * group has to be asked with a modulo that answers 3 for bar -1 of a four-bar
 * group rather than -1.
 */
export function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Where the analysed span starts: the earliest beat that sounds.
 *
 * Seeding this with 0 instead would anchor every analysis to bar 0 — an excerpt
 * lifted from bar 9 would be reported as starting at beat 0 and as holding
 * eight bars of silence it never had. The span runs back past beat 0 only for a
 * genuine pickup, which sounds before the first downbeat.
 *
 * @param notes The sounding notes.
 * @param fallback The beat to report when nothing sounds.
 * @returns The earliest onset, or `fallback` for an empty span.
 */
export function firstSoundingBeat(notes: readonly NoteEvent[], fallback = 0): number {
  let first = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    first = Math.min(first, note.startBeat);
  }
  return Number.isFinite(first) ? first : fallback;
}

/**
 * Index of the last bar a span occupies.
 *
 * A span ending exactly on a bar line ends in the bar before it: the bar its
 * end beat falls in has not begun. Asking for the bar of `spanEnd` minus an
 * epsilon does not answer this — bar arithmetic carries a tolerance of its own,
 * measured in bars rather than beats, and rounds such a beat back up — so the
 * empty trailing bar is dropped explicitly.
 *
 * @param meter A single signature, or the piece's meter map.
 * @param spanStart First beat of the span.
 * @param spanEnd End of the span, exclusive.
 * @returns The last bar index, never before the span's first bar.
 */
export function lastBarOf(meter: MeterLike, spanStart: number, spanEnd: number): number {
  const firstBar = barIndexAt(spanStart, meter);
  const bar = barIndexAt(Math.max(spanStart, spanEnd), meter);
  if (bar > firstBar && barPositionToBeat({ bar, beat: 0 }, meter) >= spanEnd - EPS) {
    return bar - 1;
  }
  return bar;
}

/** One bar of the analysed span, with what sounds in it. */
export type BarSlice = {
  /** 0-based bar index; negative inside a pickup. */
  index: number;
  /** First beat of the bar. */
  startBeat: number;
  /** End of the bar, exclusive. */
  endBeat: number;
  /** Every note overlapping the bar, in input order. */
  notes: NoteEvent[];
  /** Pitch-class weights over the bar, indexed 0-11. */
  weights: number[];
  /** Sum of those weights; zero for a silent bar. */
  totalWeight: number;
};

/**
 * Cut a span into its bars and weigh what sounds in each.
 *
 * Notes are bucketed into the bars they overlap before any histogram is built,
 * so the cost is one pass over the notes plus one per bar-membership rather
 * than a scan of the whole piece per bar.
 *
 * @param notes The sounding notes; those outside the span are ignored.
 * @param meter A single signature, or the piece's meter map.
 * @param spanStart First beat of the span, negative inside a pickup.
 * @param spanEnd End of the span, exclusive.
 * @param budget Upper bound on the work this may do.
 * @returns One slice per bar, in bar order.
 */
export function sliceBars(
  notes: readonly NoteEvent[],
  meter: MeterLike,
  spanStart: number,
  spanEnd: number,
  budget?: number,
): BarSlice[] {
  const firstBar = barIndexAt(spanStart, meter);
  const lastBar = lastBarOf(meter, spanStart, spanEnd);
  const barCount = lastBar - firstBar + 1;
  assertGenerationBudget(barCount, 'form bars', budget);

  const buckets: NoteEvent[][] = Array.from({ length: barCount }, () => []);
  let memberships = 0;
  for (const note of notes) {
    const noteEnd = note.startBeat + note.durationBeat;
    const from = Math.max(firstBar, barIndexAt(note.startBeat, meter));
    const to = Math.min(lastBar, barIndexAt(Math.max(note.startBeat, noteEnd - EPS), meter));
    memberships += Math.max(0, to - from + 1);
    assertGenerationBudget(memberships, 'form note-to-bar memberships', budget);
    for (let bar = from; bar <= to; bar += 1) {
      buckets[bar - firstBar]?.push(note);
    }
  }

  const slices: BarSlice[] = [];
  for (let bar = firstBar; bar <= lastBar; bar += 1) {
    const startBeat = barPositionToBeat({ bar, beat: 0 }, meter);
    const endBeat = barPositionToBeat({ bar: bar + 1, beat: 0 }, meter);
    const barNotes = buckets[bar - firstBar] ?? [];
    const { weights, totalWeight } = windowWeights(barNotes, startBeat, endBeat, meter);
    slices.push({ index: bar, startBeat, endBeat, notes: barNotes, weights, totalWeight });
  }
  return slices;
}

/**
 * Cosine similarity of two non-negative weight vectors, in [0, 1].
 *
 * Cosine rather than a difference of weights, because two statements of the
 * same harmony are the same harmony whether they are played loud or soft, long
 * or short. Two silent spans are alike; a silent one and a sounding one are not.
 */
export function weightSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA <= EPS && normB <= EPS) {
    return 1;
  }
  if (normA <= EPS || normB <= EPS) {
    return 0;
  }
  return clamp01(dot / Math.sqrt(normA * normB));
}

/**
 * How much the harmony changes at the start of slice `index`, in [0, 1].
 *
 * The opening of the music counts as a change outright: nothing precedes it to
 * be the same as. A pickup bar does not — it is an upbeat into the first bar,
 * and treating it as an opening would pull the hypermetric phase onto it.
 */
export function harmonicNovelty(slices: readonly BarSlice[], index: number): number {
  const current = slices[index];
  if (current === undefined) {
    return 0;
  }
  const previous = slices[index - 1];
  if (previous === undefined) {
    // The first slice of the analysed span, wherever the span was cut from: an
    // excerpt taken from bar 9 opens on bar 9, and nothing precedes it there
    // either. Only a pickup, which is bar -1, is not an opening.
    return current.index >= 0 ? 1 : 0;
  }
  return 1 - weightSimilarity(previous.weights, current.weights);
}

/**
 * Sum independent evidence into one strength in [0, 1].
 *
 * Two signals pointing at the same boundary reinforce each other without ever
 * summing past certainty, and neither can drag the other down — which a plain
 * sum or a mean would both get wrong.
 */
export function combineEvidence(strengths: Iterable<number>): number {
  let remaining = 1;
  for (const strength of strengths) {
    remaining *= 1 - clamp01(strength);
  }
  return clamp01(1 - remaining);
}
