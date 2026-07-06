import { describe, expect, it } from 'vitest';
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

  it('returns nothing for an empty input', () => {
    expect(detectChord([])).toEqual([]);
    expect(detectChordBest([])).toBeNull();
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
});
