import { describe, expect, it } from 'vitest';
import type { KeyScale } from '../src/core/types.js';
import type { Chord } from '../src/theory/chord/index.js';
import { chordPitchClasses, chordQualities, makeChord } from '../src/theory/chord/index.js';
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

it('never reports a hard-rule tritone or forbidden leap as Safe', () => {
  const leapPop = evaluateSafety(query({ candidatePitch: 76, prevPitch: 60, profile: 'pop' }));
  const leapStrict = evaluateSafety(
    query({ candidatePitch: 76, prevPitch: 60, profile: 'strict' }),
  );
  expect(leapPop.reasons & ReasonFlag.LargeLeap).toBeTruthy();
  expect(leapPop.safety).toBe(NoteSafety.Warning);
  expect(leapStrict.safety).toBe(NoteSafety.Dissonant);

  const tritoneChord: Chord = { rootPc: 0, quality: 'majb5', intervals: [0, 4, 6] };
  for (const profile of ['pop', 'strict'] as const) {
    const result = evaluateSafety(
      query({ candidatePitch: 66, prevPitch: 60, chord: tritoneChord, profile }),
    );
    expect(result.reasons & ReasonFlag.Tritone).toBeTruthy();
    expect(result.safety).toBe(NoteSafety.Dissonant);
  }
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

describe('chord tones are never rejected for the chord they belong to', () => {
  it('does not flag a chord tone for a tritone its own chord spells', () => {
    // Diminished, half-diminished, diminished-seventh and minor-sixth chords all
    // contain a tritone between two of their own chord tones. Those tones are the
    // chord, not a clash with it.
    const cases: [Chord, string][] = [
      [makeChord(11, 'dim'), 'B dim'],
      [makeChord(11, 'dim7'), 'B dim7'],
      [makeChord(11, 'm7b5'), 'B m7b5'],
      [makeChord(0, 'min6'), 'C min6'],
      [makeChord(7, 'dom7'), 'G7'],
    ];
    for (const [chord, label] of cases) {
      for (const pc of chordPitchClasses(chord)) {
        const r = evaluateSafety(query({ candidatePitch: 60 + pc, chord, strongBeat: true }));
        expect(r.reasons & ReasonFlag.ChordTone, `${label} pc ${pc}`).toBeTruthy();
        expect(r.reasons & ReasonFlag.Tritone, `${label} pc ${pc}`).toBeFalsy();
        expect(r.safety, `${label} pc ${pc}`).toBe(NoteSafety.Safe);
      }
    }
  });

  it('keeps every chord tone of every quality placeable in the pop profile', () => {
    for (const quality of chordQualities()) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const chord = makeChord(rootPc, quality);
        for (const pc of chordPitchClasses(chord)) {
          const r = evaluateSafety(query({ candidatePitch: 60 + pc, chord, strongBeat: true }));
          expect(r.safety, `${quality}/${rootPc} pc ${pc}`).toBeLessThanOrEqual(NoteSafety.Warning);
        }
      }
    }
  });

  it('enumerates every chord tone of a diminished-family chord', () => {
    for (const quality of ['dim', 'dim7', 'm7b5', 'min6'] as const) {
      const chord = makeChord(11, quality);
      const pitches = enumerateSafePitches(query({ chord }), 60, 71);
      for (const pc of chordPitchClasses(chord)) {
        expect(pitches, `${quality} pc ${pc}`).toContain(60 + pc);
      }
    }
  });

  it('still flags a non-chord tone that forms a tritone with a chord tone', () => {
    // Db over C major is not a chord tone and sits a tritone above the fifth.
    const r = evaluateSafety(query({ candidatePitch: 61, chord: makeChord(0, 'maj') }));
    expect(r.reasons & ReasonFlag.Tritone).toBeTruthy();
  });

  it('reports no conflict for a correctly voiced dominant seventh on a strong beat', () => {
    // G7 in close SATB position: G3 B3 D4 F4. The seventh against the root and
    // the tritone between third and seventh are the chord's own colour.
    const g7 = makeChord(7, 'dom7');
    const voices = [55, 59, 62, 65];
    for (const pitch of voices) {
      const r = evaluateSafety(
        query({
          candidatePitch: pitch,
          chord: g7,
          strongBeat: true,
          otherVoices: voices.filter((p) => p !== pitch).map((p) => ({ pitch: p })),
        }),
      );
      expect(r.reasons & ReasonFlag.VerticalDissonance, `pitch ${pitch}`).toBeFalsy();
      expect(r.safety, `pitch ${pitch}`).toBe(NoteSafety.Safe);
    }
  });

  it('still flags a second between two chord tones as a spacing clash', () => {
    // The ninth of Cadd9 is a chord tone, but voiced a major second above the
    // root it is a voicing problem rather than a property of the harmony.
    const r = evaluateSafety(
      query({
        candidatePitch: 74,
        chord: makeChord(0, 'add9'),
        strongBeat: true,
        otherVoices: [{ pitch: 72 }],
      }),
    );
    expect(r.reasons & ReasonFlag.ChordTone).toBeTruthy();
    expect(r.reasons & ReasonFlag.VerticalDissonance).toBeTruthy();
  });

  it('still flags a non-chord tone clashing with a sounding chord tone', () => {
    // F# over a sounding G7 chord tone is not part of the chord.
    const r = evaluateSafety(
      query({
        candidatePitch: 66,
        chord: makeChord(7, 'dom7'),
        strongBeat: true,
        otherVoices: [{ pitch: 65 }],
      }),
    );
    expect(r.reasons & ReasonFlag.VerticalDissonance).toBeTruthy();
    expect(r.safety).toBe(NoteSafety.Dissonant);
  });
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

  it('rejects a non-finite bound instead of hanging', () => {
    expect(() => enumerateSafePitches(query({}), 60, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => enumerateSafePitches(query({}), Number.NaN, 67)).toThrow(RangeError);
  });
});
