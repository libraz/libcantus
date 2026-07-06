import { describe, expect, it } from 'vitest';
import {
  createsHiddenParallelPerfect,
  createsParallelOctave,
  createsParallelPerfect,
  createsVerticalDissonance,
  createsVoiceCrossing,
  isForbiddenMelodicLeap,
  isLeadingToneResolution,
} from '../src/counterpoint/index.js';
import { MAJOR_MASK } from '../src/scale/index.js';
import type { KeyScale } from '../src/types.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

describe('counterpoint predicates', () => {
  it('flags consecutive parallel fifths', () => {
    expect(createsParallelPerfect(67, 69, 60, 62)).toBe(true);
    expect(createsParallelPerfect(67, 67, 60, 62)).toBe(false);
  });

  it('flags consecutive parallel octaves', () => {
    expect(createsParallelOctave(72, 74, 60, 62)).toBe(true);
    expect(createsParallelOctave(69, 71, 60, 62)).toBe(false);
  });

  it('flags hidden perfect intervals by similar motion', () => {
    expect(createsHiddenParallelPerfect(64, 67, 60, 60)).toBe(false);
    expect(createsHiddenParallelPerfect(64, 67, 55, 60)).toBe(true);
  });

  it('detects voice crossing', () => {
    expect(createsVoiceCrossing(60, 64)).toBe(true);
    expect(createsVoiceCrossing(67, 60)).toBe(false);
  });

  it('detects vertical dissonance with the two-voice fourth rule', () => {
    expect(createsVerticalDissonance(66, 60, true)).toBe(true); // tritone
    expect(createsVerticalDissonance(65, 60, true)).toBe(true); // fourth, two-voice
    expect(createsVerticalDissonance(65, 60, false)).toBe(false); // fourth, allowed
  });

  it('flags forbidden melodic leaps', () => {
    expect(isForbiddenMelodicLeap(60, 66)).toBe(true); // tritone
    expect(isForbiddenMelodicLeap(60, 71)).toBe(true); // major seventh
    expect(isForbiddenMelodicLeap(60, 67)).toBe(false); // fifth
  });

  it('recognizes a leading-tone resolution to the tonic', () => {
    expect(isLeadingToneResolution(71, 72, cMajor)).toBe(true); // B -> C
    expect(isLeadingToneResolution(71, 69, cMajor)).toBe(false); // B -> A
  });
});
