import { describe, expect, it } from 'vitest';
import type { Chord } from '../src/theory/chord/index.js';
import { roleOf } from '../src/theory/harmony/index.js';

const cMaj: Chord = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] };
const cSus4: Chord = { rootPc: 0, quality: 'sus4', intervals: [0, 5, 7] };
const cSus2: Chord = { rootPc: 0, quality: 'sus2', intervals: [0, 2, 7] };

describe('roleOf', () => {
  it('locks the root to chord identity', () => {
    expect(roleOf(0, cMaj)).toEqual({ role: 'root', lock: 'identity', belongsToChordId: 0 });
  });

  it('locks the third to chord quality', () => {
    expect(roleOf(4, cMaj)).toEqual({ role: 'third', lock: 'quality', belongsToChordId: 0 });
  });

  it('leaves the fifth as free voicing', () => {
    expect(roleOf(7, cMaj)).toEqual({ role: 'fifth', lock: 'voicing', belongsToChordId: 0 });
  });

  it('classifies sevenths and tensions as voicing', () => {
    expect(roleOf(10, cMaj).role).toBe('seventh');
    expect(roleOf(2, cMaj)).toEqual({ role: 'tension', lock: 'voicing', belongsToChordId: 0 });
  });

  it('locks the suspended tone of a sus4 chord to quality', () => {
    // The fourth defines the sus4 chord; moving it changes the chord identity.
    expect(roleOf(5, cSus4)).toEqual({ role: 'third', lock: 'quality', belongsToChordId: 0 });
  });

  it('locks the suspended tone of a sus2 chord to quality', () => {
    expect(roleOf(2, cSus2)).toEqual({ role: 'third', lock: 'quality', belongsToChordId: 0 });
  });

  it('leaves a ninth over a chord with a third as free tension', () => {
    const add9: Chord = { rootPc: 0, quality: 'add9', intervals: [0, 4, 7, 14] };
    expect(roleOf(2, add9)).toEqual({ role: 'tension', lock: 'voicing', belongsToChordId: 0 });
  });

  it('carries the chord id through', () => {
    expect(roleOf(0, cMaj, 42).belongsToChordId).toBe(42);
  });
});
