import { describe, expect, it } from 'vitest';
import {
  detectKey,
  detectKeyFromNotes,
  type KeyMatch,
  MODAL_SCALE_NAMES,
} from '../src/analyze/detect/index.js';
import { MODAL_CANDIDATES, modalProfileVector } from '../src/analyze/detect/modes.js';
import { KRUMHANSL_KESSLER_PROFILE } from '../src/analyze/detect/profiles.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { isScaleTone } from '../src/theory/scale/index.js';

/** How many candidates are ranked when no mode takes part. */
const DIATONIC_CANDIDATES = 24;

/** Tonic and scale of each match, the pair a ranking assertion reads. */
function ranking(matches: readonly KeyMatch[], depth: number): [number, string][] {
  return matches.slice(0, depth).map((match) => [match.key.rootPc, match.scaleName]);
}

/** The diatonic candidates of a ranking, in the order they were ranked. */
function diatonicOnly(matches: readonly KeyMatch[]): KeyMatch[] {
  return matches.filter((match) => match.variant !== 'modal');
}

/**
 * D dorian: a D–F–A tonic outline with the natural sixth (B) sounding as the
 * characteristic degree, and no B flat anywhere.
 */
const D_DORIAN_RIFF = [2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2];

/** G mixolydian: a G triad outline whose seventh is F natural, never F sharp. */
const G_MIXOLYDIAN_RIFF = [7, 7, 7, 7, 11, 11, 2, 2, 5, 5, 5, 9, 0, 7];

/** F lydian: an F triad outline whose fourth is B natural, never B flat. */
const F_LYDIAN_RIFF = [5, 5, 5, 5, 9, 9, 0, 0, 11, 11, 7, 2, 4, 5];

/** A tonic-heavy C major melody, the reading modes must not overturn. */
const C_MAJOR_MELODY = [0, 0, 0, 2, 4, 4, 5, 7, 7, 9, 11, 0];

/** An A minor melody with the raised seventh of the harmonic form. */
const A_HARMONIC_MINOR_MELODY = [9, 9, 9, 11, 0, 2, 4, 4, 5, 8, 9, 8, 9];

describe('modal key candidates', () => {
  it('reads a D dorian riff as dorian once the modes are asked for', () => {
    const best = detectKey(D_DORIAN_RIFF, { modes: true })[0];
    expect(best).toMatchObject({ scaleName: 'dorian', mode: 'minor', variant: 'modal' });
    expect(best?.key.rootPc).toBe(2);
    // The reported scale is the mode itself, so the natural sixth is in it.
    expect(isScaleTone(11, best?.key ?? { rootPc: 0, modeMask12: 0 })).toBe(true);
  });

  it('still reads the same riff as D minor when the modes stay out', () => {
    const matches = detectKey(D_DORIAN_RIFF);
    expect(matches).toHaveLength(DIATONIC_CANDIDATES);
    expect(matches[0]).toMatchObject({ mode: 'minor', scaleName: 'melodicMinor' });
    expect(matches[0]?.key.rootPc).toBe(2);
  });

  it('reads a flat-seventh riff as mixolydian and a raised-fourth riff as lydian', () => {
    const mixolydian = detectKey(G_MIXOLYDIAN_RIFF, { modes: true })[0];
    expect(mixolydian).toMatchObject({ scaleName: 'mixolydian', mode: 'major' });
    expect(mixolydian?.key.rootPc).toBe(7);
    // Without the modes the same riff falls back on the major key on the same
    // tonic, which is what makes the flat seventh look like a foreign note.
    expect(detectKey(G_MIXOLYDIAN_RIFF)[0]).toMatchObject({ mode: 'major', scaleName: 'major' });

    const lydian = detectKey(F_LYDIAN_RIFF, { modes: true })[0];
    expect(lydian).toMatchObject({ scaleName: 'lydian', mode: 'major' });
    expect(lydian?.key.rootPc).toBe(5);
    expect(detectKey(F_LYDIAN_RIFF)[0]).toMatchObject({ mode: 'major', scaleName: 'major' });
  });

  it('reports the major or minor key a mode leans on', () => {
    const expected: Record<string, 'major' | 'minor'> = {
      dorian: 'minor',
      phrygian: 'minor',
      lydian: 'major',
      mixolydian: 'major',
      locrian: 'minor',
    };
    for (const match of detectKey(D_DORIAN_RIFF, { modes: true })) {
      if (match.variant !== 'modal') {
        continue;
      }
      expect(match.mode, match.scaleName).toBe(expected[match.scaleName]);
    }
  });

  it('leaves the 24 diatonic candidates scored and ordered exactly as they were', () => {
    // Modal candidates are added to the contest, never mixed into it: a
    // diatonic candidate keeps the score, fit and relative rank it has when the
    // modes stay out, whatever the modes do around it.
    for (const input of [C_MAJOR_MELODY, A_HARMONIC_MINOR_MELODY, D_DORIAN_RIFF]) {
      expect(diatonicOnly(detectKey(input, { modes: true }))).toEqual(detectKey(input));
    }
  });

  it('keeps a tonic-heavy C major melody on C major', () => {
    const withModes = detectKey(C_MAJOR_MELODY, { modes: true });
    expect(withModes[0]).toMatchObject({ mode: 'major', scaleName: 'major' });
    expect(withModes[0]?.key.rootPc).toBe(0);
    // The runners-up change: a melody this firmly on its tonic correlates with
    // every profile peaking on C, so the parallel modes displace the
    // neighbouring keys that used to follow. Both cost fit — the melody has the
    // perfect fourth and the leading tone neither mode admits — and neither
    // reaches the diatonic reading.
    expect(ranking(withModes, 3)).toEqual([
      [0, 'major'],
      [0, 'mixolydian'],
      [0, 'lydian'],
    ]);
    for (const match of withModes.slice(1, 3)) {
      expect(match.score, match.scaleName).toBeLessThan(withModes[0]?.score ?? 0);
      expect(match.fit, match.scaleName).toBeLessThan(withModes[0]?.fit ?? 0);
    }
  });

  it('keeps a harmonic-minor melody on its own tonic and variant', () => {
    const plain = detectKey(A_HARMONIC_MINOR_MELODY);
    const withModes = detectKey(A_HARMONIC_MINOR_MELODY, { modes: true });
    expect(plain[0]).toMatchObject({ mode: 'minor', variant: 'harmonic' });
    expect(plain[0]?.key.rootPc).toBe(9);
    // No church mode carries a raised seventh over a minor tonic, so the raised
    // seventh keeps the harmonic-minor reading in front. What follows it are
    // modes on that same tonic, so the key of the melody is not in question
    // either way.
    expect(ranking(withModes, 3)).toEqual([
      [9, 'harmonicMinor'],
      [9, 'phrygian'],
      [9, 'dorian'],
    ]);
  });

  it('adds one candidate per tonic for each mode asked for', () => {
    expect(detectKey([0])).toHaveLength(DIATONIC_CANDIDATES);
    expect(detectKey([0], { modes: false })).toHaveLength(DIATONIC_CANDIDATES);
    expect(detectKey([0], { modes: [] })).toHaveLength(DIATONIC_CANDIDATES);
    expect(detectKey([0], { modes: ['dorian'] })).toHaveLength(DIATONIC_CANDIDATES + 12);
    expect(detectKey([0], { modes: true })).toHaveLength(
      DIATONIC_CANDIDATES + 12 * MODAL_SCALE_NAMES.length,
    );
  });

  it('ranks only the modes it was asked for', () => {
    const named = detectKey(D_DORIAN_RIFF, { modes: ['mixolydian', 'dorian'] });
    expect(new Set(named.filter((m) => m.variant === 'modal').map((m) => m.scaleName))).toEqual(
      new Set(['dorian', 'mixolydian']),
    );
    // The request order does not reach the ranking: naming the same two modes
    // the other way round produces the same list.
    expect(ranking(named, named.length)).toEqual(
      ranking(detectKey(D_DORIAN_RIFF, { modes: ['dorian', 'mixolydian'] }), named.length),
    );
  });

  it('names the scale of every diatonic candidate as well', () => {
    const names = new Set(detectKey(A_HARMONIC_MINOR_MELODY).map((match) => match.scaleName));
    for (const name of names) {
      expect(['major', 'naturalMinor', 'harmonicMinor', 'melodicMinor']).toContain(name);
    }
    expect(detectKey([0, 4, 7])[0]).toMatchObject({ scaleName: 'major', variant: 'major' });
  });

  it('rejects a mode it does not know', () => {
    expect(() => detectKey([0], { modes: ['ionian'] as never })).toThrow(InvalidInputError);
    expect(() => detectKey([0], { modes: 'dorian' as never })).toThrow(InvalidInputError);
  });

  it('carries the option through the note-event entry point', () => {
    const notes = D_DORIAN_RIFF.map((pc, index) => ({
      pitch: 60 + pc,
      startBeat: index,
      durationBeat: 1,
    }));
    expect(detectKeyFromNotes(notes, { modes: true })[0]).toMatchObject({ scaleName: 'dorian' });
    expect(detectKeyFromNotes(notes)).toHaveLength(DIATONIC_CANDIDATES);
  });

  it('substitutes the same degrees in the profile as in the scale', () => {
    for (const candidate of MODAL_CANDIDATES) {
      const parent = candidate.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
      const substituted = parent.map((degree) => {
        const swap = candidate.substitutions.find(([replaced]) => replaced === degree);
        return swap === undefined ? degree : swap[1];
      });
      let mask = 0;
      for (const degree of substituted) {
        mask |= 1 << degree;
      }
      expect(mask, candidate.scaleName).toBe(candidate.mask);
    }
  });

  it('derives every modal profile as a permutation of its parent', () => {
    for (const candidate of MODAL_CANDIDATES) {
      const parent =
        candidate.mode === 'major'
          ? KRUMHANSL_KESSLER_PROFILE.major
          : KRUMHANSL_KESSLER_PROFILE.minor;
      const vector = modalProfileVector(KRUMHANSL_KESSLER_PROFILE, candidate);
      // A permutation shares the parent's mean and variance, which is what keeps
      // modal and diatonic correlations comparable.
      expect([...vector].sort(), candidate.scaleName).toEqual([...parent].sort());
      for (const [replaced, replacing] of candidate.substitutions) {
        expect(vector[replacing], candidate.scaleName).toBe(parent[replaced]);
      }
    }
  });
});
