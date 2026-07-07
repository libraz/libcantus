import { describe, expect, it } from 'vitest';
import type { KeyScale } from '../src/core/types.js';
import { chordFromDegree, chordPitchClasses, chordToneRole } from '../src/theory/chord/index.js';
import { MAJOR_MASK } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

describe('chordFromDegree', () => {
  it('builds a maj7 chord on the tonic', () => {
    const chord = chordFromDegree(0, 'maj7', cMajor);
    expect(chord.rootPc).toBe(0);
    expect(chordPitchClasses(chord)).toEqual([0, 4, 7, 11]);
  });

  it('builds a dominant seventh on the fifth degree', () => {
    const chord = chordFromDegree(4, 'dom7', cMajor);
    expect(chord.rootPc).toBe(7);
    expect(chordPitchClasses(chord)).toEqual([2, 5, 7, 11]);
  });
});

describe('chordPitchClasses', () => {
  it('reduces augmented triads to pitch classes', () => {
    const chord = chordFromDegree(0, 'aug', cMajor);
    expect(chordPitchClasses(chord)).toEqual([0, 4, 8]);
  });
});

describe('chordToneRole', () => {
  const cMaj7 = chordFromDegree(0, 'maj7', cMajor);

  it('identifies the third', () => {
    expect(chordToneRole(4, cMaj7)).toBe('third');
  });

  it('identifies the seventh', () => {
    expect(chordToneRole(11, cMaj7)).toBe('seventh');
  });

  it('identifies the root and fifth', () => {
    expect(chordToneRole(0, cMaj7)).toBe('root');
    expect(chordToneRole(7, cMaj7)).toBe('fifth');
  });

  it('returns null for a non-chord-tone interval', () => {
    expect(chordToneRole(2, cMaj7)).toBeNull();
  });
});
