import { describe, expect, it } from 'vitest';
import { choosePhrasePath, PHRASE_CUT_COST } from '../src/analyze/form/phrase.js';

describe('the phrase search does not invent a break-even boundary', () => {
  // Three stops — the span's start, one candidate, and its end — with the
  // length term switched off (`expected` 0), so the only thing separating the
  // two readings is whether the candidate is cut at. A candidate worth exactly
  // what a cut costs pays for itself and no more, which is the tie the rule is
  // about.
  const BEATS = [0, 8, 16];
  const END_STRENGTH = 0.5;

  it('leaves a boundary that exactly pays for itself uncut', () => {
    const strengths = [0, PHRASE_CUT_COST, END_STRENGTH];
    // Both readings score the same to the last stop: cutting at beat 8 earns
    // exactly the cut's cost back, so the reading with the boundary and the one
    // without are worth the same. The longer phrase wins.
    expect(choosePhrasePath(BEATS, strengths, 1, 0)).toEqual([2]);
  });

  it('takes the boundary as soon as it is worth more than the cut', () => {
    // Nothing is being suppressed: a hair more evidence and the search cuts.
    const strengths = [0, PHRASE_CUT_COST + 0.01, END_STRENGTH];
    expect(choosePhrasePath(BEATS, strengths, 1, 0)).toEqual([1, 2]);
  });

  it('does not depend on how many equally scored readings there are', () => {
    // Four break-even candidates in a row: every reading that cuts at any
    // subset of them scores the same, and the answer is still the one with no
    // boundaries at all.
    const beats = [0, 4, 8, 12, 16, 20];
    const strengths = [0, PHRASE_CUT_COST, PHRASE_CUT_COST, PHRASE_CUT_COST, PHRASE_CUT_COST, 0.5];
    expect(choosePhrasePath(beats, strengths, 1, 0)).toEqual([5]);
  });

  it('still reports the whole span when no reading reaches the end', () => {
    // Every phrase would be shorter than the minimum, so the span is one phrase.
    expect(choosePhrasePath([0, 4], [0, 0.5], 100, 0)).toEqual([1]);
  });
});
