import { describe, expect, it } from 'vitest';
import {
  createsHiddenParallelPerfect,
  createsParallelPerfect,
  createsParallelUnison,
  createsVoiceOverlap,
  exceedsSpacing,
  isForbiddenMelodicLeap,
} from '../src/counterpoint/index.js';

describe('parallel perfect fixes', () => {
  it('flags a fifth expanding to a twelfth (same perfect class)', () => {
    expect(createsParallelPerfect(67, 81, 60, 62)).toBe(true);
  });

  it('does not flag a fifth moving to an octave (different perfect kinds)', () => {
    // prev fifth (7), now octave (12): not "parallel fifths".
    expect(createsParallelPerfect(67, 72, 60, 60)).toBe(false);
  });

  it('requires similar motion', () => {
    // contrary motion into a fifth is not a parallel perfect.
    expect(createsParallelPerfect(67, 65, 60, 65)).toBe(false);
  });
});

describe('parallel unison', () => {
  it('flags two voices moving together on the same pitch', () => {
    expect(createsParallelUnison(60, 62, 60, 62)).toBe(true);
  });

  it('is false when the voices are not in unison', () => {
    expect(createsParallelUnison(60, 62, 55, 57)).toBe(false);
  });
});

describe('hidden parallel step exception', () => {
  it('allows a direct fifth when the upper voice moves by step', () => {
    expect(createsHiddenParallelPerfect(65, 67, 57, 60)).toBe(false);
  });

  it('still flags a direct fifth when the upper voice leaps', () => {
    expect(createsHiddenParallelPerfect(64, 67, 55, 60)).toBe(true);
  });

  it('flags similar motion from one perfect interval into a different one', () => {
    // Octave C4/C5 to fifth C5/G5, both voices ascending: a direct fifth that a
    // guard exempting any prior perfect interval would wrongly allow.
    expect(createsHiddenParallelPerfect(72, 79, 60, 72)).toBe(true);
  });
});

describe('forbidden melodic leaps', () => {
  it('forbids both sevenths and any leap wider than an octave', () => {
    expect(isForbiddenMelodicLeap(60, 70)).toBe(true); // minor seventh
    expect(isForbiddenMelodicLeap(60, 71)).toBe(true); // major seventh
    expect(isForbiddenMelodicLeap(60, 66)).toBe(true); // tritone
    expect(isForbiddenMelodicLeap(60, 74)).toBe(true); // compound (major ninth)
    expect(isForbiddenMelodicLeap(60, 72)).toBe(false); // octave is allowed
    expect(isForbiddenMelodicLeap(60, 67)).toBe(false); // fifth
  });
});

describe('spacing and overlap', () => {
  it('detects voice overlap distinct from crossing', () => {
    expect(createsVoiceOverlap(67, 58, 60, 62)).toBe(true);
    expect(createsVoiceOverlap(67, 65, 60, 62)).toBe(false);
  });

  it('detects excessive spacing between upper voices', () => {
    expect(exceedsSpacing(80, 60)).toBe(true);
    expect(exceedsSpacing(67, 60)).toBe(false);
  });
});
