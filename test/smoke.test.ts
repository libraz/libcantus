import {
  chordFromDegree,
  chordPitchClasses,
  classifyInterval,
  diatonicPitchClasses,
  IntervalQuality,
  majorKey,
} from '@libraz/cantus';
import { describe, expect, it } from 'vitest';

describe('public entry point', () => {
  it('resolves and re-exports the public surface', () => {
    const cMajor = majorKey(0);
    expect(classifyInterval(7)).toBe(IntervalQuality.PerfectConsonance);
    expect(diatonicPitchClasses(cMajor)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(chordPitchClasses(chordFromDegree(0, 'maj7', cMajor))).toEqual([0, 4, 7, 11]);
  });
});
