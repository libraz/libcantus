import { describe, expect, it } from 'vitest';
import { chordQualities, makeChord } from '../src/chord/index.js';
import { detectChord, detectChordBest, detectKey } from '../src/detect/index.js';

describe('detectChord', () => {
  it('recognizes a C major triad exactly', () => {
    const best = detectChord([60, 64, 67])[0];
    expect(best).toMatchObject({ rootPc: 0, quality: 'maj', exact: true });
  });

  it('returns the best chord as a Chord object', () => {
    expect(detectChordBest([60, 64, 67])).toMatchObject({ rootPc: 0, quality: 'maj' });
  });

  it('recognizes a dominant seventh', () => {
    const best = detectChord([67, 71, 74, 77])[0];
    expect(best).toMatchObject({ rootPc: 7, quality: 'dom7', exact: true });
  });

  it('recognizes a diminished seventh at one of its symmetric roots', () => {
    const best = detectChord([0, 3, 6, 9])[0];
    expect(best?.quality).toBe('dim7');
    expect([0, 3, 6, 9]).toContain(best?.rootPc);
  });

  it('reports extra notes for a partial superset', () => {
    const match = detectChord([0, 7]).find((m) => m.quality === '5' && m.rootPc === 0);
    expect(match).toMatchObject({ exact: true, missingPcs: [], extraPcs: [] });
  });

  it('recognizes a fifth-omitted dominant seventh shell voicing', () => {
    const matches = detectChord([0, 4, 10]);
    const c7 = matches.find((m) => m.rootPc === 0 && m.quality === 'dom7');
    expect(c7).toBeDefined();
    expect(c7?.missingPcs).toContain(7);
    expect(c7?.extraPcs).toEqual([]);
  });

  it('returns nothing for an empty input', () => {
    expect(detectChord([])).toEqual([]);
    expect(detectChordBest([])).toBeNull();
  });

  it('does not flag a voicing with a missing third-less tone set as exact', () => {
    // C E alone: the best reading is a fifth-omitted C major, not an exact one.
    const best = detectChord([60, 64])[0];
    expect(best).toMatchObject({ rootPc: 0, quality: 'maj', exact: false });
    expect(best?.missingPcs).toEqual([7]);
  });

  it('does not flag a single note as an exact chord', () => {
    for (const match of detectChord([60])) {
      expect(match.exact).toBe(false);
    }
  });
});

describe('makeChord -> detectChord round trip', () => {
  it('recovers root and quality from every root-position voicing', () => {
    for (const quality of chordQualities()) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const chord = makeChord(rootPc, quality);
        // Voice the chord in root position so the bass pins the root; bare
        // pitch-class input is ambiguous for relative pairs such as C6/Am7.
        const pitches = chord.intervals.map((interval) => 60 + rootPc + interval);
        const best = detectChord(pitches)[0];
        expect(best, `${quality} rooted on ${rootPc}`).toMatchObject({
          rootPc,
          quality,
          exact: true,
          inversion: 0,
        });
      }
    }
  });
});

describe('detectKey', () => {
  it('prefers C major for a tonic-heavy C major fragment', () => {
    const best = detectKey([0, 0, 0, 4, 7])[0];
    expect(best).toMatchObject({ mode: 'major' });
    expect(best?.key.rootPc).toBe(0);
  });

  it('reports a perfect fit when every note is in the scale', () => {
    const best = detectKey([0, 2, 4, 5, 7, 9, 11])[0];
    expect(best?.fit).toBe(1);
  });

  it('detects A minor for a minor cadence containing the leading tone', () => {
    // Am - E7 - Am (A C E / E G# B D / A C E): the leading tone G# must count
    // toward A minor via its harmonic-minor variant instead of handing the win
    // to C major.
    const matches = detectKey([9, 0, 4, 4, 8, 11, 2, 9, 0, 4]);
    const best = matches[0];
    expect(best?.mode).toBe('minor');
    expect(best?.key.rootPc).toBe(9);
    expect(best?.fit).toBe(1);
  });

  it('breaks a major/minor tie on the same tonic toward major', () => {
    // A lone C fits C major and C minor equally; mode order keeps major first.
    const matches = detectKey([0]);
    expect(matches[0]).toMatchObject({ mode: 'major' });
    expect(matches[0]?.key.rootPc).toBe(0);
    expect(matches[1]).toMatchObject({ mode: 'minor' });
    expect(matches[1]?.key.rootPc).toBe(0);
  });

  it('breaks ties between keys sharing the input toward the weighted tonic', () => {
    // G D fit many keys; the tonic bonus must rank G-rooted keys first.
    const best = detectKey([7, 7, 2])[0];
    expect(best?.key.rootPc).toBe(7);
  });

  it('still ranks all 24 keys for a non-empty input', () => {
    expect(detectKey([0])).toHaveLength(24);
  });

  it('returns nothing for an empty input', () => {
    expect(detectKey([])).toEqual([]);
  });
});
