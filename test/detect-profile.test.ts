import { describe, expect, it } from 'vitest';
import { detectKey, detectKeyFromNotes } from '../src/analyze/detect/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { isScaleTone } from '../src/theory/scale/index.js';

/** Fold a semitone offset into a pitch class. */
function pc(value: number): number {
  return ((value % 12) + 12) % 12;
}

/** Pitch classes of a I - IV - V - I cadence in the major key on `tonic`. */
function majorCadence(tonic: number): number[] {
  return [
    [0, 4, 7],
    [5, 9, 12],
    [7, 11, 14],
    [0, 4, 7],
  ].flatMap((chord) => chord.map((interval) => pc(tonic + interval)));
}

/** Pitch classes of an i - iv - V - i cadence in the minor key on `tonic`. */
function minorCadence(tonic: number): number[] {
  return [
    [0, 3, 7],
    [5, 8, 12],
    [7, 11, 14],
    [0, 3, 7],
  ].flatMap((chord) => chord.map((interval) => pc(tonic + interval)));
}

/** Position of a key in a ranking, or -1 when it somehow went missing. */
function rankOf(
  matches: readonly { key: { rootPc: number }; mode: string }[],
  rootPc: number,
  mode: 'major' | 'minor',
): number {
  return matches.findIndex((match) => match.key.rootPc === rootPc && match.mode === mode);
}

/** A spread of inputs that between them exercise every scoring path. */
const EDGE_INPUTS: Record<string, { pitches: number[]; weights?: number[] }> = {
  'single pitch': { pitches: [0] },
  'single repeated pitch': { pitches: [7, 7, 7, 7] },
  'two pitches': { pitches: [0, 7] },
  'two pitches a semitone apart': { pitches: [0, 1] },
  'empty after weighting': { pitches: [0, 4, 7], weights: [0, 0, 0] },
  'chromatic scale': { pitches: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  'chromatic scale unevenly weighted': {
    pitches: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    weights: [9, 1, 4, 1, 6, 5, 1, 8, 1, 3, 1, 2],
  },
  'whole-tone scale': { pitches: [0, 2, 4, 6, 8, 10] },
  'diminished seventh': { pitches: [0, 3, 6, 9] },
  'C major scale': { pitches: [0, 2, 4, 5, 7, 9, 11] },
};

const PROFILES = ['krumhansl', 'temperley', 'flat'] as const;

describe('key-profile correlation', () => {
  it('separates C major from its relative minor on a major melody', () => {
    // The two keys share all seven pitch classes, so membership scoring can
    // only tell them apart by a tie-break. Correlation reads where the weight
    // fell: on the tonic, mediant and dominant of C.
    const matches = detectKey([0, 2, 4, 5, 7, 7, 4, 0]);
    expect(rankOf(matches, 0, 'major')).toBeLessThan(rankOf(matches, 9, 'minor'));
    expect(matches[0]).toMatchObject({ mode: 'major' });
    expect(matches[0]?.key.rootPc).toBe(0);
  });

  it('separates C major from its relative minor on a I - IV - V - I', () => {
    const matches = detectKey(majorCadence(0));
    expect(rankOf(matches, 0, 'major')).toBeLessThan(rankOf(matches, 9, 'minor'));
    expect(matches[0]?.key.rootPc).toBe(0);
    expect(matches[0]?.mode).toBe('major');
  });

  it('separates A minor from its relative major when the leading tone sounds', () => {
    // Am - E7 - Am. G# belongs to no form of C major, and A minor expects
    // weight on its own tonic and dominant, which is where it landed.
    const matches = detectKey([9, 0, 4, 4, 8, 11, 2, 9, 0, 4]);
    expect(rankOf(matches, 9, 'minor')).toBeLessThan(rankOf(matches, 0, 'major'));
    expect(matches[0]?.key.rootPc).toBe(9);
    expect(matches[0]?.mode).toBe('minor');
  });

  it('separates A minor from its relative major on a plain natural-minor passage', () => {
    // No leading tone at all: only the distribution distinguishes the two.
    const matches = detectKey([9, 11, 0, 2, 4, 5, 7, 9]);
    expect(rankOf(matches, 9, 'minor')).toBeLessThan(rankOf(matches, 0, 'major'));
    expect(matches[0]?.key.rootPc).toBe(9);
    expect(matches[0]?.mode).toBe('minor');
  });

  it('names every major key from its own I - IV - V - I', () => {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const best = detectKey(majorCadence(tonic))[0];
      expect(best, `major cadence on ${tonic}`).toMatchObject({ mode: 'major', variant: 'major' });
      expect(best?.key.rootPc, `major cadence on ${tonic}`).toBe(tonic);
      expect(best?.fit, `major cadence on ${tonic}`).toBe(1);
    }
  });

  it('names every minor key from its own i - iv - V - i', () => {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const best = detectKey(minorCadence(tonic))[0];
      expect(best, `minor cadence on ${tonic}`).toMatchObject({ mode: 'minor' });
      expect(best?.key.rootPc, `minor cadence on ${tonic}`).toBe(tonic);
      // The dominant's leading tone is what the reported variant has to cover.
      expect(best?.variant, `minor cadence on ${tonic}`).toBe('harmonic');
      expect(best?.fit, `minor cadence on ${tonic}`).toBe(1);
    }
  });

  it('never reports a score that is not a finite number', () => {
    for (const [label, input] of Object.entries(EDGE_INPUTS)) {
      for (const profile of PROFILES) {
        const matches = detectKey(input.pitches, { profile, weights: input.weights });
        for (const match of matches) {
          expect(
            Number.isFinite(match.score),
            `${label} / ${profile} / ${match.mode} on ${match.key.rootPc}: ${match.score}`,
          ).toBe(true);
        }
      }
    }
  });

  it('never reports a score outside [-1, 1]', () => {
    for (const [label, input] of Object.entries(EDGE_INPUTS)) {
      for (const profile of PROFILES) {
        for (const match of detectKey(input.pitches, { profile, weights: input.weights })) {
          expect(match.score, `${label} / ${profile}`).toBeGreaterThanOrEqual(-1);
          expect(match.score, `${label} / ${profile}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('falls back to a normalized dot product where the correlation is undefined', () => {
    // An evenly spread chromatic input has zero variance, so Pearson r is 0/0.
    // The fallback keeps every candidate finite and keeps the two modes apart.
    const matches = detectKey([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(matches).toHaveLength(24);
    for (const match of matches) {
      expect(Number.isFinite(match.score)).toBe(true);
      expect(match.score).toBeGreaterThan(0);
    }
    // Nothing in the input favours any tonic, so every candidate of a mode ties
    // and the documented tie-break orders them by tonic.
    const scores = new Set(matches.map((match) => match.score));
    expect(scores.size).toBe(2);
    expect(matches.slice(0, 12).map((match) => match.key.rootPc)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('puts C major and C minor on top for a lone repeated C', () => {
    const matches = detectKey([0, 0, 0]);
    expect(matches[0]).toMatchObject({ mode: 'major' });
    expect(matches[0]?.key.rootPc).toBe(0);
    expect(matches[1]).toMatchObject({ mode: 'minor' });
    expect(matches[1]?.key.rootPc).toBe(0);
    // The one sounding pitch class is the only evidence, so weighting it more
    // heavily must not move the answer.
    expect(detectKey([0]).map((match) => [match.key.rootPc, match.mode])).toEqual(
      matches.map((match) => [match.key.rootPc, match.mode]),
    );
  });

  it('returns an identical ranking on repeated calls', () => {
    for (const [label, input] of Object.entries(EDGE_INPUTS)) {
      for (const profile of PROFILES) {
        const first = detectKey(input.pitches, { profile, weights: input.weights });
        const second = detectKey(input.pitches, { profile, weights: input.weights });
        expect(second, `${label} / ${profile}`).toEqual(first);
      }
    }
  });

  it('orders a fully tied input by tonic, then major before minor', () => {
    // Every rotation of a chromatic input is mathematically equal; only the
    // documented tie-break may decide, never the order candidates were built in.
    const order = detectKey([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).map(
      (match) => `${match.key.rootPc}${match.mode === 'major' ? 'M' : 'm'}`,
    );
    expect(order.slice(0, 3)).toEqual(['0m', '1m', '2m']);
    expect(order.slice(12, 15)).toEqual(['0M', '1M', '2M']);
    for (const scrambled of [
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
      [6, 0, 7, 1, 8, 2, 9, 3, 10, 4, 11, 5],
    ]) {
      expect(
        detectKey(scrambled).map(
          (match) => `${match.key.rootPc}${match.mode === 'major' ? 'M' : 'm'}`,
        ),
        `scrambled ${scrambled.join(' ')}`,
      ).toEqual(order);
    }
  });

  it('sorts strictly by the score it reports', () => {
    for (const [label, input] of Object.entries(EDGE_INPUTS)) {
      for (const profile of PROFILES) {
        const matches = detectKey(input.pitches, { profile, weights: input.weights });
        for (let index = 1; index < matches.length; index += 1) {
          expect(
            matches[index]?.score,
            `${label} / ${profile} / rank ${index}`,
          ).toBeLessThanOrEqual(matches[index - 1]?.score ?? 0);
        }
      }
    }
  });
});

describe('detectKey profile option', () => {
  it("reproduces membership ranking under profile: 'flat'", () => {
    // Four C's and a Db. Membership scoring sees the same in-scale weight for C
    // major and C minor and settles it on mode order; the probe-tone profiles
    // read the Db as a flat second and lean minor. The escape hatch must give
    // the old answer back.
    const pitches = [0, 0, 0, 0, 1];
    expect(detectKey(pitches)[0]).toMatchObject({ mode: 'minor' });
    const flat = detectKey(pitches, { profile: 'flat' })[0];
    expect(flat).toMatchObject({ mode: 'major' });
    expect(flat?.key.rootPc).toBe(0);
  });

  it("cannot separate a key from its relative under profile: 'flat'", () => {
    // The escape hatch is exactly the old defect: a flat profile scores C major
    // and A minor identically on the shared scale, which is why the default is
    // no longer this.
    const matches = detectKey([0, 2, 4, 5, 7, 9, 11], { profile: 'flat' });
    const cMajor = matches.find((match) => match.key.rootPc === 0 && match.mode === 'major');
    const aMinor = matches.find((match) => match.key.rootPc === 9 && match.mode === 'minor');
    expect(cMajor?.score).toBe(aMinor?.score);
    const ranked = detectKey([0, 2, 4, 5, 7, 9, 11]);
    const rankedMajor = ranked.find((match) => match.key.rootPc === 0 && match.mode === 'major');
    const rankedMinor = ranked.find((match) => match.key.rootPc === 9 && match.mode === 'minor');
    expect(rankedMajor?.score).toBeGreaterThan(rankedMinor?.score ?? 1);
  });

  it("ranks with the corpus proportions under profile: 'temperley'", () => {
    const best = detectKey([0, 2, 4, 5, 7, 7, 4, 0], { profile: 'temperley' })[0];
    expect(best).toMatchObject({ mode: 'major' });
    expect(best?.key.rootPc).toBe(0);
    // A different profile is a different ranking, not a relabelling of the same one.
    expect(best?.score).not.toBe(detectKey([0, 2, 4, 5, 7, 7, 4, 0])[0]?.score);
  });

  it('accepts a custom profile and ranks by it', () => {
    // A profile that expects everything on the fifth degree reads a lone C as
    // the dominant of F, not as a tonic.
    const dominantOnly = {
      major: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
      minor: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    };
    expect(detectKey([0])[0]?.key.rootPc).toBe(0);
    expect(detectKey([0], { profile: dominantOnly })[0]?.key.rootPc).toBe(5);
  });

  it('rejects a malformed custom profile', () => {
    const good = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2];
    expect(() => detectKey([0], { profile: { major: [1, 2, 3], minor: good } })).toThrow(
      InvalidInputError,
    );
    expect(() => detectKey([0], { profile: { major: good, minor: [...good, 1] } })).toThrow(
      InvalidInputError,
    );
    expect(() =>
      detectKey([0], { profile: { major: [Number.NaN, ...good.slice(1)], minor: good } }),
    ).toThrow(InvalidInputError);
    expect(() =>
      detectKey([0], {
        profile: { major: good, minor: [Number.POSITIVE_INFINITY, ...good.slice(1)] },
      }),
    ).toThrow(InvalidInputError);
    // A name that is not a built-in profile is just as malformed.
    expect(() => detectKey([0], { profile: 'kostka' as unknown as 'flat' })).toThrow(
      InvalidInputError,
    );
  });

  it('carries the profile through the NoteEvent entry point', () => {
    const notes = [0, 2, 4, 5, 7, 7, 4, 0].map((pitch, index) => ({
      pitch: 60 + pitch,
      startBeat: index,
      durationBeat: 1,
    }));
    const viaNotes = detectKeyFromNotes(notes, { profile: 'flat' });
    const viaPitches = detectKey(
      notes.map((note) => note.pitch),
      { profile: 'flat', weights: notes.map(() => 100) },
    );
    expect(viaNotes).toEqual(viaPitches);
    expect(viaNotes[0]?.score).not.toBe(detectKeyFromNotes(notes)[0]?.score);
  });
});

describe('fit under profile correlation', () => {
  it('still measures the coverage of the scale it returns', () => {
    for (const [label, input] of Object.entries(EDGE_INPUTS)) {
      const distinct = [
        ...new Set(
          input.pitches.filter((_, index) => (input.weights?.[index] ?? 1) > 0).map((p) => pc(p)),
        ),
      ];
      for (const profile of PROFILES) {
        for (const match of detectKey(input.pitches, { profile, weights: input.weights })) {
          const inScale = distinct.filter((p) => isScaleTone(p, match.key)).length;
          expect(
            match.fit,
            `${label} / ${profile} / ${match.mode} on ${match.key.rootPc}`,
          ).toBeCloseTo(inScale / distinct.length);
        }
      }
    }
  });

  it('does not let fit override the score in the ranking', () => {
    // Db major contains both pitch classes and so fits perfectly; C major does
    // not, but it is where the weight actually is.
    const matches = detectKey([0, 0, 0, 0, 1]);
    expect(matches[0]?.key.rootPc).toBe(0);
    const dbMajor = matches.find((match) => match.key.rootPc === 1 && match.mode === 'major');
    expect(dbMajor?.fit).toBe(1);
    expect(dbMajor?.score).toBeLessThan(matches[0]?.score ?? 0);
  });
});
