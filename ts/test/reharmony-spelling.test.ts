import { describe, expect, it } from 'vitest';
import {
  chordPitchClasses,
  formatChordSymbol,
  majorKey,
  minorKey,
  modalInterchangePalette,
  negativeHarmonyMirror,
  parseChordSymbol,
  substituteChord,
} from '../src/index.js';

/**
 * Reharmonization used to name its results with default sharps regardless of
 * the key, so the tritone substitute of G7 in C major came back as C#7 rather
 * than the Db7 it is written as. These tests assert what a consumer actually
 * sees — the formatted symbol — rather than the spelling hints behind it.
 */

/** The formatted symbols of every substitution of one type. */
function symbolsOfType(chord: string, key: Parameters<typeof substituteChord>[1], type: string) {
  return substituteChord(parseChordSymbol(chord), key)
    .filter((substitution) => substitution.type === type)
    .map((substitution) => formatChordSymbol(substitution.chord));
}

describe('substituteChord spelling', () => {
  it('writes the tritone substitute on the flattened supertonic of the key', () => {
    // In C major the tritone substitute of V7 is bII7, which is written Db7.
    expect(symbolsOfType('G7', majorKey(0), 'tritone')).toEqual(['Db7']);
  });

  it('spells the flattened supertonic without a double sharp in a sharp key', () => {
    // B major's bII is C natural, not B#.
    expect(symbolsOfType('F#7', majorKey(11), 'tritone')).toEqual(['C7']);
  });

  it('spells chromatic mediants on the flat side in a flat-leaning key', () => {
    const mediants = symbolsOfType('G7', majorKey(0), 'chromaticMediant');
    expect(mediants).toContain('Bb');
    expect(mediants).toContain('Eb');
    expect(mediants.some((symbol) => symbol.includes('#'))).toBe(false);
  });

  it('spells chromatic mediants on the sharp side in a sharp key', () => {
    const mediants = symbolsOfType('F#7', majorKey(11), 'chromaticMediant');
    expect(mediants).toContain('A#');
    expect(mediants).toContain('D#');
    expect(mediants.some((symbol) => symbol.includes('b'))).toBe(false);
  });

  it('spells borrowed and relative substitutes in the key as well', () => {
    expect(symbolsOfType('G7', majorKey(0), 'borrowed')).toEqual(['Gm']);
    expect(symbolsOfType('G7', majorKey(0), 'relative')).toEqual(['Em', 'Bdim']);
  });
});

describe('modalInterchangePalette spelling', () => {
  it('borrows from the parallel minor with that key’s flats', () => {
    const symbols = modalInterchangePalette(majorKey(0)).map((borrowed) =>
      formatChordSymbol(borrowed.chord),
    );
    expect(symbols).toEqual(['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Db']);
  });

  it('borrows from the parallel major with that key’s sharps', () => {
    const symbols = modalInterchangePalette(minorKey(9)).map((borrowed) =>
      formatChordSymbol(borrowed.chord),
    );
    // A minor borrows from A major, so the mediant is C# minor, never Db minor.
    expect(symbols).toContain('C#m');
    expect(symbols).toContain('F#m');
    // The Neapolitan is the one flat-side member: bII of A minor is Bb.
    expect(symbols).toContain('Bb');
    expect(symbols.filter((symbol) => symbol.includes('b'))).toEqual(['Bb']);
  });
});

describe('negativeHarmonyMirror spelling', () => {
  it('spells the mirrored chord in the key', () => {
    expect(formatChordSymbol(negativeHarmonyMirror(parseChordSymbol('G7'), majorKey(0)))).toBe(
      'Dm7b5',
    );
  });

  it('mirrors into flats in a flat key and sharps in a sharp key', () => {
    const inEb = formatChordSymbol(negativeHarmonyMirror(parseChordSymbol('Ab'), majorKey(3)));
    expect(inEb.includes('#')).toBe(false);
    const inE = formatChordSymbol(negativeHarmonyMirror(parseChordSymbol('A'), majorKey(4)));
    expect(inE.includes('b')).toBe(false);
  });
});

describe('spelling does not disturb the sounding notes', () => {
  const keys = [majorKey(0), majorKey(3), majorKey(11), minorKey(9), minorKey(1)];
  const sources = ['G7', 'Cmaj7', 'Dm7', 'F#7', 'Bb7'];

  it('keeps every substitution a chord whose hint agrees with its root', () => {
    for (const key of keys) {
      for (const source of sources) {
        for (const { chord } of substituteChord(parseChordSymbol(source), key)) {
          const label = `${source} in ${key.rootPc}`;
          expect(chordPitchClasses(chord).length, label).toBeGreaterThan(0);
          if (chord.rootSpelling !== undefined) {
            // A hint the formatter cannot trust is worse than no hint at all.
            const { letter, alter } = chord.rootSpelling;
            const hinted = (([0, 2, 4, 5, 7, 9, 11][letter] ?? 0) + alter + 120) % 12;
            expect(hinted, `${label}: hint disagrees with root`).toBe(chord.rootPc % 12);
          }
        }
      }
    }
  });

  it('leaves the palette and the mirror pitch-class-identical to their roots', () => {
    for (const key of keys) {
      for (const { chord } of modalInterchangePalette(key)) {
        if (chord.rootSpelling !== undefined) {
          const { letter, alter } = chord.rootSpelling;
          const hinted = (([0, 2, 4, 5, 7, 9, 11][letter] ?? 0) + alter + 120) % 12;
          expect(hinted).toBe(chord.rootPc % 12);
        }
      }
      for (const source of sources) {
        const mirrored = negativeHarmonyMirror(parseChordSymbol(source), key);
        expect(chordPitchClasses(mirrored).length).toBeGreaterThan(0);
      }
    }
  });
});
