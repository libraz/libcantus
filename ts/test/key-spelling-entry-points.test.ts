import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { augmentedSixthChord, romanToChord } from '../src/analyze/index.js';
import { formatNote } from '../src/core/pitch/index.js';
import { Key } from '../src/model/key.js';
import { unionMembers } from './support/signatures.js';
import { SRC } from './support/source-files.js';

/**
 * A key names the letters its answers are written with, at every entry point
 * that takes one.
 *
 * The keys that make this visible are the ones whose pitch classes read best
 * from the other side of the circle. An A flat minor reduced to pitch classes
 * and spelled back is a G sharp minor, so a reharmonization asked for in one
 * comes back written in the other — and the chords a caller then prints carry
 * accidentals that key never uses.
 */

/** The keys written on the far side of the circle from what their pitches read as. */
const FAR_SIDE_KEYS = ['Ab minor', 'D# minor', 'Cb major', 'F# major'] as const;

/**
 * The subject is the kinds the family declares, so a fourth augmented sixth
 * would be checked the day it is named.
 */
describe('a chromatic chord named as a symbol is built from the key that named it', () => {
  const KINDS = unionMembers(
    path.join(SRC, 'analyze/functional/augmented-sixth.ts'),
    'AugmentedSixthKind',
  );

  /** The numeral each kind is written as. */
  const SYMBOL_BY_KIND: Readonly<Record<string, string>> = {
    italian: 'It6',
    french: 'Fr6',
    german: 'Ger6',
  };

  it('names a numeral for every kind the family declares', () => {
    // The kinds come from the declaration, so a fourth one leaves this failing
    // until its numeral is named and the check below covers it too.
    expect(Object.keys(SYMBOL_BY_KIND).sort()).toEqual([...KINDS].sort());
  });

  it('builds the same chord from the numeral as from the family', () => {
    for (const name of FAR_SIDE_KEYS) {
      for (const kind of KINDS) {
        const built = augmentedSixthChord(kind as 'italian' | 'french' | 'german', name);
        const symbol = SYMBOL_BY_KIND[kind] ?? '';
        expect(romanToChord(symbol, name), `${symbol} in ${name}`).toEqual(built);
        // The class API names the same letters, whatever order it reads them in.
        expect(
          Key.parse(name)
            .augmentedSixth(kind as 'german')
            .spell()
            .map((tone) => tone.name)
            .sort(),
          `${symbol} in ${name}`,
        ).toEqual((built.toneSpellings ?? []).map((tone) => formatNote(tone)).sort());
      }
    }
  });
});
