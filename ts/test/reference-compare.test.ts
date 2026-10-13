import { describe, expect, it } from 'vitest';
import { romanDegreeToken } from '../src/analyze/reference/measures.js';

describe('compareReferences progression', () => {
  it('reads the degree token as accidental plus numeral, ignoring case, quality and inversion', () => {
    expect(romanDegreeToken('V7')).toBe('V');
    expect(romanDegreeToken('V6')).toBe('V');
    expect(romanDegreeToken('vi')).toBe('VI');
    expect(romanDegreeToken('IVadd6')).toBe('IV');
    expect(romanDegreeToken('bVII7')).toBe('bVII');
    expect(romanDegreeToken('#iv°7')).toBe('#IV');
    expect(romanDegreeToken('vii°')).toBe('VII');
  });

  it('reads an applied chord as one token distinct from its numeral', () => {
    expect(romanDegreeToken('V7/V')).toBe('V/V');
    expect(romanDegreeToken('vii°7/ii')).toBe('VII/II');
    expect(romanDegreeToken('V/V')).not.toBe(romanDegreeToken('V'));
  });

  it('reads the Neapolitan and augmented sixths as tokens equal only to themselves', () => {
    expect(romanDegreeToken('N6')).toBe('N');
    expect(romanDegreeToken('It6')).toBe('It');
    expect(romanDegreeToken('Fr6')).toBe('Fr');
    expect(romanDegreeToken('Ger6')).toBe('Ger');
    expect(romanDegreeToken('Ger65')).toBe('Ger');
    expect(romanDegreeToken('Ger6/V')).toBe('Ger/V');
    expect(romanDegreeToken('N6')).not.toBe(romanDegreeToken('bII'));
  });
});
