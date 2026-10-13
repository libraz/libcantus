import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AugmentedSixthKind } from '../src/analyze/functional/index.js';
import {
  augmentedSixthChord,
  chordToRoman,
  romanToChord,
  tonicizableDegrees,
} from '../src/analyze/functional/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { toKeyScale } from '../src/theory/scale/index.js';
import { unionMembers } from './support/signatures.js';
import { SRC } from './support/source-files.js';

/**
 * The augmented sixths as the declaration lists them, so a fourth kind is
 * round-tripped here the day it is named rather than the day somebody
 * remembers to add it to a list.
 */
function augmentedSixthKinds(): AugmentedSixthKind[] {
  return unionMembers(
    path.join(SRC, 'analyze/functional/augmented-sixth.ts'),
    'AugmentedSixthKind',
  ) as AugmentedSixthKind[];
}

describe('chordToRoman and romanToChord are mutual inverses', () => {
  /**
   * The keys written on the far side of the circle from what their pitches read
   * as, where a numeral rendered against the pitch classes alone would be
   * measuring letters the key never writes.
   */
  const FAR_SIDE_KEYS = ['Ab minor', 'D# minor', 'Cb major', 'F# major'] as const;

  it.each(FAR_SIDE_KEYS)('round-trips every augmented sixth in %s', (name) => {
    const kinds = augmentedSixthKinds();
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      const chord = augmentedSixthChord(kind, name);
      const roman = chordToRoman(chord, name);
      expect(romanToChord(roman, name), `${kind} in ${name} renders ${roman}`).toEqual(chord);
    }
  });

  it.each(FAR_SIDE_KEYS)('round-trips an applied augmented sixth in %s', (name) => {
    const key = toKeyScale(name);
    // The targets are the degrees the key itself says can be tonicized, so a
    // degree that becomes one is covered without being written down here. The
    // tonic is not among them: the augmented sixth over the home key is that
    // key's own chord, which needs no slash.
    const targets = tonicizableDegrees(key).filter((degree) => degree.degreeNumber !== 1);
    expect(targets.length).toBeGreaterThan(0);
    const kinds = augmentedSixthKinds();
    expect(kinds.length).toBeGreaterThan(0);
    for (const degree of targets) {
      // The target is written under the numeral its own diatonic triad renders
      // as, which is where the applied numeral takes its case from.
      const target = chordToRoman(makeChord(degree.rootPc, degree.lower ? 'min' : 'maj'), name);
      for (const kind of kinds) {
        // The symbol likewise comes from the rendering of the chord itself.
        const symbol = chordToRoman(augmentedSixthChord(kind, name), name);
        const roman = `${symbol}/${target}`;
        const chord = romanToChord(roman, name);
        expect(chordToRoman(chord, name, { applied: true }), `${roman} in ${name}`).toBe(roman);
        // Reading it is what `applied` asks for: without it the chord is named
        // against the home key, as every other tonicizing chord is.
        expect(chordToRoman(chord, name), `${roman} in ${name}`).not.toContain('/');
      }
    }
  });
});
