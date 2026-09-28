/**
 * The chain search a melody's pitches are chosen by: a Viterbi pass over one
 * statement's notes, each note choosing a pitch from its own candidate list.
 *
 * A state is a pitch together with the direction of the leap that reached it
 * (none, up or down), so a leap followed by motion the same way can be charged
 * without looking two notes back. Per-note costs arrive precomputed from the
 * caller; this module owns only the interval costs and the search, so the root
 * search, the variation search and every repair share one definition of what a
 * good step is.
 */

import { allocateCandidateTable, allocateChoiceTable } from '../../core/validation/index.js';
import { isForbiddenMelodicLeap } from '../../theory/counterpoint/index.js';

/** One note of a chain search. */
export type PitchSlot = {
  /** The pitches this note may take. An empty list makes the chain unsolvable. */
  candidates: readonly number[];
  /** The note's own cost for a candidate pitch. */
  cost: (pitch: number) => number;
  /** Whether the note is held at its one candidate rather than searched. */
  fixed: boolean;
};

/**
 * An extra cost on the step into note `index` (from note `index - 1`), added to
 * the interval cost.
 */
export type StepCost = (index: number, from: number, to: number) => number;

/** Direction of the leap that reached a state. */
const NO_LEAP = 0;
const LEAP_UP = 1;
const LEAP_DOWN = 2;
const LEAP_STATES = 3;

/** Budget label every table of the search is charged under. */
const SEARCH_LABEL = 'melody pitch search';

/** Widest step, in semitones, still read as a third; anything wider is a leap. */
const WIDEST_THIRD = 4;
/** Surcharge for continuing in the direction of the leap just taken. */
const LEAP_CONTINUATION_COST = 0.5;

/**
 * Cost of a melodic step by its size: a repeated note, a step, a third, a
 * fourth or fifth, and anything wider.
 */
function intervalCost(size: number): number {
  if (size === 0) {
    return 0.2;
  }
  if (size <= 2) {
    return 0;
  }
  if (size <= WIDEST_THIRD) {
    return 0.3;
  }
  if (size <= 7) {
    return 0.6;
  }
  return 1;
}

/** The leap state a step of `delta` semitones arrives in. */
function leapOf(delta: number): number {
  if (Math.abs(delta) <= WIDEST_THIRD) {
    return NO_LEAP;
  }
  return delta > 0 ? LEAP_UP : LEAP_DOWN;
}

/**
 * Cost of stepping from `from` (reached by a leap in state `leap`) to `to`, or
 * `Infinity` where the step is forbidden. A step between two held notes is
 * never forbidden: both were prescribed, and the search cannot move either.
 */
function stepCost(from: number, to: number, leap: number, bothFixed: boolean): number {
  const delta = to - from;
  const size = Math.abs(delta);
  if (!bothFixed && isForbiddenMelodicLeap(from, to)) {
    return Number.POSITIVE_INFINITY;
  }
  let cost = intervalCost(size);
  if ((leap === LEAP_UP && delta > 0) || (leap === LEAP_DOWN && delta < 0)) {
    cost += LEAP_CONTINUATION_COST;
  }
  return cost;
}

/**
 * Find the cheapest pitch line through a chain of notes.
 *
 * Ties go to the earliest state visited, so the answer is a pure function of
 * the slots; a caller wanting a seeded tie-break folds it into the per-note
 * costs.
 *
 * @param slots The notes, in time order.
 * @param budget Upper bound each per-note table is charged against.
 * @param extra An additional cost on each step, if any.
 * @returns The chosen pitch per note, or null when no line satisfies every
 *   hard constraint.
 */
export function searchPitches(
  slots: readonly PitchSlot[],
  budget: number | undefined,
  extra?: StepCost,
): number[] | null {
  const first = slots[0];
  if (first === undefined) {
    return [];
  }
  let previous = allocateCandidateTable(
    first.candidates.length,
    LEAP_STATES,
    SEARCH_LABEL,
    budget,
  ).fill(Number.POSITIVE_INFINITY);
  for (let j = 0; j < first.candidates.length; j += 1) {
    previous[j * LEAP_STATES + NO_LEAP] = first.cost(first.candidates[j] as number);
  }
  const backs: Int32Array[] = [];
  for (let k = 1; k < slots.length; k += 1) {
    const before = slots[k - 1] as PitchSlot;
    const slot = slots[k] as PitchSlot;
    const unary = slot.candidates.map((pitch) => slot.cost(pitch));
    const current = allocateCandidateTable(
      slot.candidates.length,
      LEAP_STATES,
      SEARCH_LABEL,
      budget,
    ).fill(Number.POSITIVE_INFINITY);
    const back = allocateChoiceTable(
      slot.candidates.length,
      LEAP_STATES,
      SEARCH_LABEL,
      budget,
    ).fill(-1);
    const bothFixed = before.fixed && slot.fixed;
    for (let state = 0; state < previous.length; state += 1) {
      const reached = previous[state] as number;
      if (reached === Number.POSITIVE_INFINITY) {
        continue;
      }
      const from = before.candidates[Math.floor(state / LEAP_STATES)] as number;
      const leap = state % LEAP_STATES;
      for (let j = 0; j < slot.candidates.length; j += 1) {
        const to = slot.candidates[j] as number;
        const step = stepCost(from, to, leap, bothFixed);
        if (step === Number.POSITIVE_INFINITY) {
          continue;
        }
        const total = reached + step + (unary[j] as number) + (extra ? extra(k, from, to) : 0);
        const index = j * LEAP_STATES + leapOf(to - from);
        if (total < (current[index] as number)) {
          current[index] = total;
          back[index] = state;
        }
      }
    }
    backs.push(back);
    previous = current;
  }
  let best = -1;
  for (let state = 0; state < previous.length; state += 1) {
    if (
      (previous[state] as number) < Number.POSITIVE_INFINITY &&
      (best < 0 || (previous[state] as number) < (previous[best] as number))
    ) {
      best = state;
    }
  }
  if (best < 0) {
    return null;
  }
  const pitches = new Array<number>(slots.length);
  let state = best;
  for (let k = slots.length - 1; k >= 0; k -= 1) {
    pitches[k] = (slots[k] as PitchSlot).candidates[Math.floor(state / LEAP_STATES)] as number;
    if (k > 0) {
      state = (backs[k - 1] as Int32Array)[state] as number;
    }
  }
  return pitches;
}
