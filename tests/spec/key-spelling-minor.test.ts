import {
  analyzeChord,
  chordToRoman,
  functionOf,
  isDiatonic,
  pivotChords,
  romanToChord,
  spellLine,
  tensionCurve,
} from '@libraz/libcantus/analyze';
import { InvalidInputError, type NoteEvent } from '@libraz/libcantus/core';
import { noteNames } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

/** Lay pitches out as a line of quarter notes, one per beat. */
function line(pitches: number[]): NoteEvent[] {
  return pitches.map((pitch, index) => ({ pitch, startBeat: index, durationBeat: 1 }));
}

/** Spell a line from the key alone. */
function spelled(pitches: number[], key: string): string[] {
  return noteNames(spellLine(line(pitches), null, key));
}

describe('spellLine writes a minor key raised degrees as the key does', () => {
  it('spells the leading tone of A minor as G# where the line falls through an augmented second', () => {
    expect(spelled([69, 68, 65, 64], 'A minor')).toEqual(['A4', 'G#4', 'F4', 'E4']);
  });

  it('spells the leading tone of a flat minor key as a natural on the seventh letter', () => {
    expect(spelled([72, 71, 68, 67], 'C minor')).toEqual(['C5', 'B4', 'Ab4', 'G4']);
    expect(spelled([75, 74, 71, 70], 'Eb minor')).toEqual(['Eb5', 'D5', 'Cb5', 'Bb4']);
  });

  it('keeps the sharp spelling of the leading tone in sharp minor keys', () => {
    expect(spelled([68, 67, 68], 'G# minor')).toEqual(['G#4', 'F##4', 'G#4']);
    expect(spelled([63, 62, 63], 'D# minor')).toEqual(['D#4', 'C##4', 'D#4']);
    expect(spelled([66, 65, 62, 61], 'F# minor')).toEqual(['F#4', 'E#4', 'D4', 'C#4']);
  });

  it('spells the raised sixth on the sixth letter in a descent', () => {
    expect(spelled([69, 68, 66, 64], 'A minor')).toEqual(['A4', 'G#4', 'F#4', 'E4']);
  });
});

describe('a diatonic root keeps its degree numeral however its symbol spells it', () => {
  it('numbers a flat-spelled root of E major by its degree', () => {
    expect(chordToRoman('Abm', 'E major')).toBe('iii');
    expect(chordToRoman('Ab7', 'E major')).toBe('III7');
    expect(chordToRoman('Eb7', 'E major')).toBe('VII7');
  });

  it('numbers a sharp-spelled root of Db major by its degree', () => {
    expect(chordToRoman('F#', 'Db major')).toBe('IV');
    expect(chordToRoman('D#m', 'Db major')).toBe('ii');
  });

  it('agrees with isDiatonic and the analysis of the same chord', () => {
    expect(isDiatonic('Abm', 'E major')).toBe(true);
    expect(analyzeChord('Abm', 'E major')).toEqual(analyzeChord('G#m', 'E major'));
  });

  it('reads the pivots of two enharmonically distant keys as diatonic numerals', () => {
    expect(pivotChords('F# major', 'Db major').map((p) => `${p.romanFrom}=${p.romanTo}`)).toEqual([
      'I=IV',
      'iii=vi',
      'V=I',
      'vi=ii',
    ]);
  });
});

describe('tensionCurve reads harmonic function against the key as written', () => {
  /** I - Ger6 - V - I on F#, one bar each, the German sixth over its D bass. */
  const progression: NoteEvent[] = [
    [42, 66, 70, 73],
    [50, 66, 69, 72],
    [49, 65, 68, 73],
    [42, 66, 70, 73],
  ].flatMap((pitches, bar) =>
    pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
  );

  it('gives the same curve for enharmonic spellings of the same key', () => {
    const sharp = tensionCurve([{ notes: progression }], { key: 'F# major', step: 4 });
    const flat = tensionCurve([{ notes: progression }], { key: 'Gb major', step: 4 });
    expect(sharp).toEqual(flat);
  });

  it('weighs the augmented sixth as a predominant, below the dominant it resolves to', () => {
    const curve = tensionCurve([{ notes: progression }], { key: 'F# major', step: 4 });
    expect(curve[1]?.tension ?? 1).toBeLessThan(curve[2]?.tension ?? 0);
  });
});

describe('a malformed numeral or key is named in the rejection', () => {
  it('rejects a numeral that is not text with the value it received', () => {
    expect(() => romanToChord(5 as never, 'C major')).toThrow(InvalidInputError);
    expect(() => romanToChord(5 as never, 'C major')).toThrow(
      'Roman numeral must be a string; received number',
    );
    expect(() => romanToChord(null as never, 'C major')).toThrow(
      'Roman numeral must be a string; received null',
    );
  });

  it('names a null key as null', () => {
    expect(() => functionOf('C', null as never)).toThrow(
      'key must be a key name or a key/scale; received null',
    );
  });
});
