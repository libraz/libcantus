import { describe, expect, it } from 'vitest';
import type { Chord } from '../src/chord/index.js';
import { roleOf } from '../src/harmony/index.js';

const cMaj: Chord = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] };

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

  it('carries the chord id through', () => {
    expect(roleOf(0, cMaj, 42).belongsToChordId).toBe(42);
  });
});
