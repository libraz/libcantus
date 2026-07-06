import { describe, expect, it } from 'vitest';
import type { Chord } from '../src/chord/index.js';
import {
  enumerateSafePitches,
  evaluateSafety,
  NoteSafety,
  ReasonFlag,
  type SafetyQuery,
} from '../src/safety/index.js';
import { MAJOR_MASK } from '../src/scale/index.js';
import type { KeyScale } from '../src/types.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };
const cMaj: Chord = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] };

const query = (over: Partial<SafetyQuery>): SafetyQuery => ({
  profile: 'pop',
  candidatePitch: 60,
  beat: 0,
  chord: cMaj,
  key: cMajor,
  otherVoices: [],
  strongBeat: false,
  vocalLow: 48,
  vocalHigh: 84,
  ...over,
});

describe('evaluateSafety', () => {
  it('marks a chord tone as safe', () => {
    const r = evaluateSafety(query({ candidatePitch: 64 })); // E
    expect(r.safety).toBe(NoteSafety.Safe);
    expect(r.reasons & ReasonFlag.ChordTone).toBeTruthy();
  });

  it('treats the avoid-note fourth by profile', () => {
    const pop = evaluateSafety(query({ candidatePitch: 65, profile: 'pop' })); // F
    const strict = evaluateSafety(query({ candidatePitch: 65, profile: 'strict' }));
    expect(pop.reasons & ReasonFlag.AvoidNote).toBeTruthy();
    expect(pop.safety).toBe(NoteSafety.Warning);
    expect(strict.safety).toBe(NoteSafety.Dissonant);
    expect(pop.resolveTo).toBe(64); // resolves down to E
  });

  it('flags a chromatic tritone above the root', () => {
    const r = evaluateSafety(query({ candidatePitch: 66 })); // F#
    expect(r.reasons & ReasonFlag.NonScale).toBeTruthy();
    expect(r.reasons & ReasonFlag.Tritone).toBeTruthy();
    expect(r.safety).toBe(NoteSafety.Dissonant);
  });

  it('rejects a strong-beat vertical tritone against another voice', () => {
    const r = evaluateSafety(
      query({ candidatePitch: 66, strongBeat: true, otherVoices: [{ pitch: 60 }] }),
    );
    expect(r.reasons & ReasonFlag.VerticalDissonance).toBeTruthy();
    expect(r.safety).toBe(NoteSafety.Dissonant);
  });

  it('escalates parallel perfects from warning (pop) to dissonant (strict)', () => {
    const cp = (profile: 'pop' | 'strict') =>
      evaluateSafety(
        query({
          candidatePitch: 69, // A, moving with the other voice into a fifth
          prevPitch: 67,
          profile,
          otherVoices: [{ pitch: 62, prevPitch: 60 }],
        }),
      );
    expect(cp('pop').reasons & ReasonFlag.ParallelPerfect).toBeTruthy();
    expect(cp('pop').safety).toBe(NoteSafety.Warning);
    expect(cp('strict').safety).toBe(NoteSafety.Dissonant);
  });
});

it('warns when the candidate is outside the vocal range', () => {
  const r = evaluateSafety(query({ candidatePitch: 40, vocalLow: 48, vocalHigh: 84 }));
  expect(r.reasons & ReasonFlag.OutOfRange).toBeTruthy();
  expect(r.safety).toBe(NoteSafety.Warning);
});

it('warns on a scale tone without a chord', () => {
  const r = evaluateSafety(query({ candidatePitch: 62, chord: null }));
  expect(r.reasons & ReasonFlag.ScaleTone).toBeTruthy();
  expect(r.safety).toBe(NoteSafety.Warning);
  const chromatic = evaluateSafety(query({ candidatePitch: 61, chord: null }));
  expect(chromatic.reasons & ReasonFlag.NonScale).toBeTruthy();
  expect(chromatic.safety).toBe(NoteSafety.Dissonant);
});

it('flags a melodic large leap and minor second against the previous pitch', () => {
  const leap = evaluateSafety(query({ candidatePitch: 72, prevPitch: 60 }));
  expect(leap.reasons & ReasonFlag.LargeLeap).toBeTruthy();
  const semitone = evaluateSafety(query({ candidatePitch: 65, prevPitch: 64 }));
  expect(semitone.reasons & ReasonFlag.MinorSecond).toBeTruthy();
});

describe('enumerateSafePitches', () => {
  it('lists chord tones first, descending, and excludes dissonances', () => {
    const pitches = enumerateSafePitches(query({}), 60, 67);
    expect(pitches[0]).toBe(67); // top chord tone (G)
    expect(pitches).toContain(64); // E
    expect(pitches).not.toContain(66); // F# is chromatic
    // chord tones (67,64,60) come before scale tones.
    expect(pitches.indexOf(64)).toBeLessThan(pitches.indexOf(62));
  });

  it('returns [] for a non-finite bound instead of hanging', () => {
    expect(enumerateSafePitches(query({}), 60, Number.POSITIVE_INFINITY)).toEqual([]);
    expect(enumerateSafePitches(query({}), Number.NaN, 67)).toEqual([]);
  });
});
