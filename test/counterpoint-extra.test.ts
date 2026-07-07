import { describe, expect, it } from 'vitest';
import {
  createsHiddenParallelPerfect,
  createsParallelOctave,
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

  it('does not flag a change of perfect class by contrary motion', () => {
    // A fifth (7) contracting to a unison (0) changes perfect kind, so it is not
    // a parallel perfect even though both voices move.
    expect(createsParallelPerfect(67, 65, 60, 65)).toBe(false);
  });

  it('flags anti-parallel octaves reached by contrary motion', () => {
    // Both voices move in opposite directions from an octave to an octave
    // (74->62 down, 50->62 up): forbidden in strict two-voice counterpoint.
    expect(createsParallelPerfect(74, 62, 50, 62)).toBe(true);
  });

  it('does not flag an oblique approach to the same perfect class', () => {
    // Upper voice stationary at 74 while the lower rises 50->62 into an octave:
    // oblique motion is allowed.
    expect(createsParallelPerfect(74, 74, 50, 62)).toBe(false);
  });
});

describe('parallel octave subsumption', () => {
  // A similar-motion parallel octave must be counted exactly once. It is the
  // perfect-class-zero case of createsParallelPerfect, so callers rely on that
  // single predicate rather than OR-ing in createsParallelOctave (double count).
  it('flags a similar-motion parallel octave through both predicates', () => {
    // C5/C4 to D5/D4: octave to octave, both voices ascending a step.
    expect(createsParallelOctave(72, 74, 60, 62)).toBe(true);
    expect(createsParallelPerfect(72, 74, 60, 62)).toBe(true);
  });

  it('has createsParallelPerfect cover every case createsParallelOctave flags', () => {
    // Anti-parallel octaves by contrary motion: createsParallelPerfect still
    // flags them while the similar-motion-only octave predicate does not, so the
    // former is the strict superset to tally on.
    expect(createsParallelOctave(74, 62, 50, 62)).toBe(false);
    expect(createsParallelPerfect(74, 62, 50, 62)).toBe(true);
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
