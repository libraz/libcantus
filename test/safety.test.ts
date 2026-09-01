import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { KeyScale } from '../src/core/types.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import type { Chord } from '../src/theory/chord/index.js';
import { chordPitchClasses, chordQualities, makeChord } from '../src/theory/chord/index.js';
import {
  enumerateSafePitches,
  evaluateSafety,
  NoteSafety,
  PROFILE_WEIGHTS,
  profileWeights,
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

  it('keeps a chromatic avoid note marked as non-scale', () => {
    const result = evaluateSafety(query({ candidatePitch: 66, chord: makeChord(7, 'dom7') }));
    expect(result.reasons & ReasonFlag.AvoidNote).toBeTruthy();
    expect(result.reasons & ReasonFlag.NonScale).toBeTruthy();
    expect(result.safety).toBe(NoteSafety.Dissonant);
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
    const distances = sugg.map((p) => Math.abs(p - 66));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
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

it('applies the safety profile to melodic tritones and forbidden leaps', () => {
  const leapPop = evaluateSafety(query({ candidatePitch: 76, prevPitch: 60, profile: 'pop' }));
  const leapStrict = evaluateSafety(
    query({ candidatePitch: 76, prevPitch: 60, profile: 'strict' }),
  );
  expect(leapPop.reasons & ReasonFlag.LargeLeap).toBeTruthy();
  expect(leapPop.safety).toBe(NoteSafety.Warning);
  expect(leapStrict.safety).toBe(NoteSafety.Dissonant);

  const tritoneChord: Chord = { rootPc: 0, quality: 'majb5', intervals: [0, 4, 6] };
  const pop = evaluateSafety(query({ candidatePitch: 66, prevPitch: 60, chord: tritoneChord }));
  const strict = evaluateSafety(
    query({ candidatePitch: 66, prevPitch: 60, chord: tritoneChord, profile: 'strict' }),
  );
  expect(pop.reasons & ReasonFlag.MelodicTritone).toBeTruthy();
  expect(pop.safety).toBe(NoteSafety.Warning);
  expect(strict.safety).toBe(NoteSafety.Dissonant);
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

  it('treats structural chord-tone dissonances identically in either inversion', () => {
    for (const quality of chordQualities()) {
      const chord = makeChord(0, quality);
      const tones = chordPitchClasses(chord);
      for (const a of tones) {
        for (const b of tones) {
          const rawInterval = Math.abs(a - b) % 12;
          const rootSeventh =
            (a === 0 && (b === 10 || b === 11)) || (b === 0 && (a === 10 || a === 11));
          if (rawInterval !== 6 && !rootSeventh) {
            continue;
          }
          const above = evaluateSafety(
            query({
              candidatePitch: 72 + a,
              chord,
              strongBeat: true,
              otherVoices: [{ pitch: 48 + b }],
            }),
          );
          const below = evaluateSafety(
            query({
              candidatePitch: 72 + b,
              chord,
              strongBeat: true,
              otherVoices: [{ pitch: 48 + a }],
            }),
          );
          expect(
            Boolean(above.reasons & ReasonFlag.VerticalDissonance),
            `${quality}: ${a} above ${b}`,
          ).toBe(Boolean(below.reasons & ReasonFlag.VerticalDissonance));
        }
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

describe('rationale', () => {
  it('explains the reason that drove the verdict, not a milder one', () => {
    // A chord tone reached by a forbidden leap is still a chord tone, but that
    // is not what the caller has to fix.
    const leap = evaluateSafety(
      query({ candidatePitch: 79, prevPitch: 60, profile: 'strict' }), // G4 -> G5, an octave up
    );
    expect(leap.reasons & ReasonFlag.ChordTone).toBeTruthy();
    if (leap.safety !== NoteSafety.Safe) {
      expect(leap.rationale).not.toBe('Chord tone');
    }
  });

  it('never reassures about a pitch it rejected', () => {
    // Every wording that says "nothing to fix here". A rejected pitch carrying
    // one of these is a rationale that contradicts its own verdict.
    const reassuring = new Set(['Chord tone', 'Placeable', 'No chord context']);
    let rejected = 0;
    for (const quality of chordQualities()) {
      for (let pitch = 55; pitch <= 79; pitch += 1) {
        for (const profile of ['pop', 'strict'] as const) {
          const r = evaluateSafety(
            query({
              candidatePitch: pitch,
              prevPitch: 60,
              profile,
              chord: makeChord(7, quality),
              otherVoices: [{ pitch: 65, prevPitch: 64 }],
              strongBeat: true,
            }),
          );
          if (r.safety === NoteSafety.Safe) {
            continue;
          }
          rejected += 1;
          expect(reassuring.has(r.rationale ?? ''), `${quality} at ${pitch} (${profile})`).toBe(
            false,
          );
        }
      }
    }
    expect(rejected).toBeGreaterThan(0);
  });
});

describe('enumerateSafePitches', () => {
  it('honors the vocal range supplied in its safety context', () => {
    const pitches = enumerateSafePitches(query({ vocalLow: 62, vocalHigh: 67 }), 55, 72);
    expect(pitches).not.toHaveLength(0);
    expect(pitches.every((pitch) => pitch >= 62 && pitch <= 67)).toBe(true);
  });
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

describe('profile weights', () => {
  it('gives each profile a complete table', () => {
    for (const profile of ['strict', 'pop'] as const) {
      expect(Object.keys(PROFILE_WEIGHTS[profile]).sort()).toEqual(
        Object.keys(PROFILE_WEIGHTS.strict).sort(),
      );
    }
  });

  it('states the difference between the two styles as a preference', () => {
    // Neither profile rejects parallel thirds; they disagree about wanting them.
    expect(PROFILE_WEIGHTS.pop.parallelImperfect).toBeGreaterThan(
      PROFILE_WEIGHTS.strict.parallelImperfect,
    );
    expect(PROFILE_WEIGHTS.strict.contraryMotion).toBeGreaterThan(
      PROFILE_WEIGHTS.strict.similarMotion,
    );
    expect(PROFILE_WEIGHTS.pop.similarMotion).toBeGreaterThan(PROFILE_WEIGHTS.strict.similarMotion);
  });

  it('applies overrides field by field', () => {
    const weights = profileWeights('pop', { parallelImperfect: 9 });
    expect(weights.parallelImperfect).toBe(9);
    expect(weights.contraryMotion).toBe(PROFILE_WEIGHTS.pop.contraryMotion);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses %p as a weight rather than scoring every candidate with it',
    (value) => {
      // One non-finite weight makes every candidate's score NaN, which leaves the
      // ranking in whatever order the candidates were enumerated in — plausible
      // output that nothing ranked.
      for (const field of Object.keys(PROFILE_WEIGHTS.pop)) {
        expect(() => profileWeights('pop', { [field]: value })).toThrow(InvalidInputError);
      }
      expect(() => profileWeights('pop', { contraryMotion: value })).toThrow(/weight/);
    },
  );

  it('reads a field written as an explicit undefined as absent', () => {
    // Spreading the overrides would have written the undefined over the profile's
    // own value, which is the same poisoned score by a quieter route.
    const weights = profileWeights('pop', { contraryMotion: undefined });
    expect(weights.contraryMotion).toBe(PROFILE_WEIGHTS.pop.contraryMotion);
    expect(Object.values(weights).every((value) => Number.isFinite(value))).toBe(true);
  });

  it('ranks a counter melody differently under each profile', () => {
    const melody = [72, 74, 76, 77, 76, 74, 72, 71].map((pitch, index) => ({
      pitch,
      startBeat: index,
      durationBeat: 1,
    }));
    const chords = ['maj', 'min', 'maj', 'maj'] as const;
    const chordAt = (beat: number) =>
      makeChord(
        [0, 9, 5, 7][Math.floor(beat / 2) % 4] ?? 0,
        chords[Math.floor(beat / 2) % 4] ?? 'maj',
      );
    const line = (profile: 'strict' | 'pop') =>
      generateCounterMelody({ melody, chordAt, key: cMajor, profile, rhythm: 'follow' }).map(
        (note) => note.pitch,
      );
    expect(line('pop')).not.toEqual(line('strict'));
  });

  it('refuses a profile name it does not have a table for', () => {
    // The silent fallback this replaces scored a misspelled profile under the
    // pop weights, so a caller asking for strict counterpoint got pop.
    expect(() => profileWeights('popp' as never)).toThrow(InvalidInputError);
    expect(() => profileWeights('Pop' as never)).toThrow(/safety profile/);
  });

  it('lets a weight override move the line without changing the profile', () => {
    const melody = [72, 74, 76, 77].map((pitch, index) => ({
      pitch,
      startBeat: index,
      durationBeat: 1,
    }));
    const chordAt = () => makeChord(0, 'maj');
    const plain = generateCounterMelody({ melody, chordAt, key: cMajor, rhythm: 'follow' });
    const pedal = generateCounterMelody({
      melody,
      chordAt,
      key: cMajor,
      rhythm: 'follow',
      weights: { obliqueMotion: 12 },
    });
    expect(pedal.map((note) => note.pitch)).not.toEqual(plain.map((note) => note.pitch));
  });
});

/**
 * The safety module's public functions, discovered from source rather than
 * listed by hand: a new entrance fails this test until it appears in
 * `SAFETY_ENTRIES` with the rejections its siblings already make.
 */
function publicSafetyEntries(): string[] {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
  const surface = read('src/theory/index.ts');
  return [...read('src/theory/safety/index.ts').matchAll(/^export function (\w+)/gm)]
    .map((match) => match[1] ?? '')
    .filter((name) => new RegExp(`\\b${name},`).test(surface))
    .sort();
}

/** Each entrance called with one query, so one bad field is swept across all. */
const SAFETY_ENTRIES: Record<string, (q: SafetyQuery) => unknown> = {
  enumerateSafePitches: (q) => enumerateSafePitches(q, q.candidatePitch, q.candidatePitch),
  evaluateSafety: (q) => evaluateSafety(q),
  profileWeights: (q) => profileWeights(q.profile),
};

/** The entrances that read pitches; `profileWeights` reads only the profile. */
const PITCH_ENTRIES = ['enumerateSafePitches', 'evaluateSafety'] as const;

/** Assert that one call refused its input as this library's own error. */
function expectRejected(call: () => unknown, label: string): void {
  let caught: unknown;
  try {
    call();
  } catch (error) {
    caught = error;
  }
  expect(caught, label).toBeInstanceOf(InvalidInputError);
}

describe('every safety entry point checks its profile and its pitches', () => {
  it('discovers the public entry points from the module surface', () => {
    expect(publicSafetyEntries()).toEqual(Object.keys(SAFETY_ENTRIES).sort());
  });

  it.each([
    ['a misspelled profile', 'popp'],
    ['a differently cased profile', 'Strict'],
    ['an empty profile', ''],
    ['a profile inherited from the prototype', 'toString'],
    ['a profile that is not a string', 7],
    ['a missing profile', undefined],
  ])('rejects %s at every entry point', (label, profile) => {
    const q = query({ profile: profile as never });
    for (const [name, entry] of Object.entries(SAFETY_ENTRIES)) {
      expectRejected(() => entry(q), `${name} accepted ${label}`);
    }
  });

  it.each([
    ['a candidate above the MIDI range', { candidatePitch: 128 }],
    ['a candidate below the MIDI range', { candidatePitch: -1 }],
    ['a fractional candidate', { candidatePitch: 60.5 }],
    ['a non-finite candidate', { candidatePitch: Number.NaN }],
    ['a previous pitch outside the MIDI range', { prevPitch: 200 }],
    ['a vocal floor outside the MIDI range', { vocalLow: -12 }],
    ['a vocal ceiling outside the MIDI range', { vocalHigh: 200 }],
    ['another voice outside the MIDI range', { otherVoices: [{ pitch: 999 }] }],
    ['another voice coming from outside it', { otherVoices: [{ pitch: 60, prevPitch: -5 }] }],
    ['a voice collection that is not one', { otherVoices: undefined }],
  ])('rejects %s at every entry point that reads a pitch', (label, over) => {
    const q = query({ vocalLow: undefined, vocalHigh: undefined, ...over } as Partial<SafetyQuery>);
    for (const name of PITCH_ENTRIES) {
      expectRejected(() => SAFETY_ENTRIES[name]?.(q), `${name} accepted ${label}`);
    }
  });

  it('refuses a range no note event could hold, and stays inside one it can', () => {
    expect(() => enumerateSafePitches(query({}), 200, 205)).toThrow(InvalidInputError);
    expect(() => enumerateSafePitches(query({}), -5, 10)).toThrow(InvalidInputError);
    const pitches = enumerateSafePitches(
      query({ vocalLow: undefined, vocalHigh: undefined }),
      0,
      127,
    );
    expect(pitches).not.toHaveLength(0);
    expect(pitches.every((pitch) => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127)).toBe(
      true,
    );
  });
});
