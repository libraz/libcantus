import { describe, expect, it } from 'vitest';
import type { KeyScale } from '../src/core/types.js';
import type { Chord } from '../src/theory/chord/index.js';
import {
  enumerateSafePitches,
  evaluateSafety,
  NoteSafety,
  ReasonFlag,
  type SafetyQuery,
} from '../src/theory/safety/index.js';
import { MAJOR_MASK } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };
const cMaj: Chord = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] };

const query = (over: Partial<SafetyQuery>): SafetyQuery => ({
  profile: 'pop',
  candidatePitch: 60,
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

  it('flags a prepared suspension but not a dissonance moved into', () => {
    // Candidate voice holds D across the barline; the other voice steps from G
    // (a perfect fifth below, consonant) to C (a major second, dissonant).
    const held = evaluateSafety(
      query({
        candidatePitch: 62, // D, held over
        prevPitch: 62,
        strongBeat: true,
        otherVoices: [{ pitch: 60, prevPitch: 55 }],
      }),
    );
    expect(held.reasons & ReasonFlag.Suspension).toBeTruthy();
    expect(held.reasons & ReasonFlag.VerticalDissonance).toBeTruthy();

    // The same clash reached by leaping into it is not a suspension.
    const moved = evaluateSafety(
      query({
        candidatePitch: 62,
        prevPitch: 64, // stepped down into the dissonance, not held
        strongBeat: true,
        otherVoices: [{ pitch: 60, prevPitch: 55 }],
      }),
    );
    expect(moved.reasons & ReasonFlag.Suspension).toBeFalsy();
  });

  it('suggests nearby safe pitches for a rejected candidate only', () => {
    const bad = evaluateSafety(query({ candidatePitch: 66 })); // F#, chromatic
    expect(bad.safety).toBe(NoteSafety.Dissonant);
    expect(bad.suggestions).toBeDefined();
    expect(bad.suggestions?.[0]).toBe(67); // nearest safe pitch (G, chord tone)
    // Every suggestion evaluates to Safe under the same context, ordered by nearness.
    const sugg = bad.suggestions ?? [];
    for (const p of sugg) {
      expect(evaluateSafety(query({ candidatePitch: p })).safety).toBe(NoteSafety.Safe);
    }
    for (let i = 1; i < sugg.length; i += 1) {
      expect(Math.abs(sugg[i] - 66)).toBeGreaterThanOrEqual(Math.abs(sugg[i - 1] - 66));
    }
    // A safe candidate carries no suggestions.
    expect(evaluateSafety(query({ candidatePitch: 64 })).suggestions).toBeUndefined();
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

it('flags a forbidden melodic leap and minor second against the previous pitch', () => {
  // A major ninth (14 semitones) is a forbidden leap; an octave is not, so the
  // LargeLeap flag now defers to the counterpoint forbidden-leap rule.
  const leap = evaluateSafety(query({ candidatePitch: 74, prevPitch: 60 }));
  expect(leap.reasons & ReasonFlag.LargeLeap).toBeTruthy();
  expect(
    evaluateSafety(query({ candidatePitch: 72, prevPitch: 60 })).reasons & ReasonFlag.LargeLeap,
  ).toBeFalsy();
  const semitone = evaluateSafety(query({ candidatePitch: 65, prevPitch: 64 }));
  expect(semitone.reasons & ReasonFlag.MinorSecond).toBeTruthy();
});

it('flags parallel octaves moving by similar motion', () => {
  // Both voices rise a step, keeping an exact octave: 62/50 -> 64/52.
  const r = evaluateSafety(
    query({ candidatePitch: 64, prevPitch: 62, otherVoices: [{ pitch: 52, prevPitch: 50 }] }),
  );
  expect(r.reasons & ReasonFlag.ParallelPerfect).toBeTruthy();
  expect(r.safety).toBe(NoteSafety.Warning);
});

it('flags anti-parallel perfect intervals reached by contrary motion', () => {
  // Candidate descends 74->62 while the other voice rises 50->62: an octave to a
  // unison (same perfect class) by contrary motion — a parallel perfect.
  const r = evaluateSafety(
    query({ candidatePitch: 62, prevPitch: 74, otherVoices: [{ pitch: 62, prevPitch: 50 }] }),
  );
  expect(r.reasons & ReasonFlag.ParallelPerfect).toBeTruthy();
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
