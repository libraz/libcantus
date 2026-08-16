import { describe, expect, it } from 'vitest';
import { augmentedSixthChord, chordToRoman } from '../src/analyze/functional/index.js';
import { isLibcantusError } from '../src/core/errors/index.js';
import type { Note } from '../src/core/pitch/index.js';
import { noteToPitchClass, parseNote, pitchClassOf } from '../src/core/pitch/index.js';
import type { KeyScale } from '../src/core/types.js';
import type { Chord } from '../src/theory/chord/index.js';
import { chordPitchClasses, chordQualities, makeChord } from '../src/theory/chord/index.js';
import {
  figuredBassOf,
  figuredBassRealization,
  realizeFiguredBass,
} from '../src/theory/figured-bass/index.js';
import { majorKey, minorKey, scaleByName, spelledKeyOf } from '../src/theory/scale/index.js';
import { noteNames, spellChord } from '../src/theory/spelling/index.js';

const cMajor = majorKey(0);
const cMinor = minorKey(0);
const aMinor = minorKey(9);

/** The spelled notes a figure sounds over a bass, bass first. */
function realizedNames(bass: string, figures: string, key = cMajor): string[] {
  return noteNames(figuredBassRealization(parseNote(bass), figures, key).notes);
}

describe('realizeFiguredBass reads figures against the key', () => {
  it('gives the same 6 a different quality on each degree of one key', () => {
    // The rule of the notation: the sixth and the third are the key's own, so
    // the chord changes quality from degree to degree while the figure does not.
    expect(realizeFiguredBass(parseNote('D'), '6', cMajor)).toMatchObject({
      rootPc: 11,
      quality: 'dim',
      bassPc: 2,
    });
    expect(realizeFiguredBass(parseNote('E'), '6', cMajor)).toMatchObject({
      rootPc: 0,
      quality: 'maj',
      bassPc: 4,
    });
    expect(realizeFiguredBass(parseNote('F'), '6', cMajor)).toMatchObject({
      rootPc: 2,
      quality: 'min',
      bassPc: 5,
    });
    expect(realizeFiguredBass(parseNote('B'), '6', cMajor)).toMatchObject({
      rootPc: 7,
      quality: 'maj',
      bassPc: 11,
    });
  });

  it('reads an unfigured bass as the diatonic triad on that degree', () => {
    for (const figures of ['', '5', '53', '3']) {
      expect(realizeFiguredBass(parseNote('D'), figures, cMajor)).toMatchObject({
        rootPc: 2,
        quality: 'min',
        bassPc: 2,
      });
    }
    expect(realizedNames('D', '')).toEqual(['D', 'F', 'A']);
  });

  it('reads 64 as the second-inversion triad', () => {
    expect(realizeFiguredBass(parseNote('G'), '64', cMajor)).toMatchObject({
      rootPc: 0,
      quality: 'maj',
      bassPc: 7,
    });
    expect(realizedNames('G', '64')).toEqual(['G', 'C', 'E']);
    // The slash is only a separator between stacked figures.
    expect(realizeFiguredBass(parseNote('G'), '6/4', cMajor)).toEqual(
      realizeFiguredBass(parseNote('G'), '64', cMajor),
    );
  });

  it('reads all four positions of the seventh chord, each with its own bass', () => {
    const positions: [string, string, number][] = [
      ['G', '7', 7],
      ['B', '65', 11],
      ['D', '43', 2],
      ['F', '42', 5],
    ];
    for (const [bass, figures, bassPc] of positions) {
      expect(realizeFiguredBass(parseNote(bass), figures, cMajor), figures).toMatchObject({
        rootPc: 7,
        quality: 'dom7',
        bassPc,
      });
    }
    // `2` is the short form of `42`, and the full stacks name the same chords.
    expect(realizeFiguredBass(parseNote('F'), '2', cMajor)).toEqual(
      realizeFiguredBass(parseNote('F'), '42', cMajor),
    );
    expect(realizeFiguredBass(parseNote('G'), '753', cMajor)).toEqual(
      realizeFiguredBass(parseNote('G'), '7', cMajor),
    );
    expect(realizeFiguredBass(parseNote('B'), '653', cMajor)).toEqual(
      realizeFiguredBass(parseNote('B'), '65', cMajor),
    );
  });

  it('carries the bass so the inversion machinery reads the chord back', () => {
    expect(chordToRoman(realizeFiguredBass(parseNote('B'), '6', cMajor), cMajor)).toBe('V6');
    expect(chordToRoman(realizeFiguredBass(parseNote('G'), '64', cMajor), cMajor)).toBe('I64');
    expect(chordToRoman(realizeFiguredBass(parseNote('B'), '65', cMajor), cMajor)).toBe('V65');
    expect(chordToRoman(realizeFiguredBass(parseNote('D'), '43', cMajor), cMajor)).toBe('V43');
    expect(chordToRoman(realizeFiguredBass(parseNote('F'), '42', cMajor), cMajor)).toBe('V42');
  });

  it('rejects a key with no seven letters to count intervals through', () => {
    expect(() =>
      realizeFiguredBass(parseNote('C'), '6', scaleByName('majorPentatonic', 0)),
    ).toThrow(/heptatonic/);
  });
});

describe('accidentals in figures', () => {
  it('raises the third above the bass on a bare accidental', () => {
    // The commonest figure in a real exercise: the leading tone of a minor key.
    expect(realizeFiguredBass(parseNote('E'), '#', aMinor)).toMatchObject({
      rootPc: 4,
      quality: 'maj',
      bassPc: 4,
    });
    expect(realizedNames('E', '#', aMinor)).toEqual(['E', 'G#', 'B']);
  });

  it('spells the raised third from the key, not from the nearest sharp', () => {
    // The third above G in C minor is a Bb, so raising it gives a B natural.
    expect(realizedNames('G', '#', cMinor)).toEqual(['G', 'B', 'D']);
    expect(realizeFiguredBass(parseNote('G'), '#', cMinor)).toMatchObject({
      rootPc: 7,
      quality: 'maj',
      bassPc: 7,
    });
    // And a flat lowers whatever the key gives: the third above Db in Ab major
    // is an F, so it goes to Fb rather than to an enharmonic E.
    expect(realizedNames('Db', 'b', majorKey(8))).toEqual(['Db', 'Fb', 'Ab']);
  });

  it('reaches a double accidental when the key already spells a sharp', () => {
    // G# minor: the third above D# is an F#, so the raised third is an F##.
    expect(realizedNames('D#', '#', minorKey(8))).toEqual(['D#', 'F##', 'A#']);
    expect(realizeFiguredBass(parseNote('D#'), '#', minorKey(8))).toMatchObject({
      rootPc: 3,
      quality: 'maj',
      bassPc: 3,
    });
  });

  it('alters the interval an accidental is written on', () => {
    // The dominant seventh of the dominant, third inversion: `#4/2` over C.
    expect(realizeFiguredBass(parseNote('C'), '#42', cMajor)).toMatchObject({
      rootPc: 2,
      quality: 'dom7',
      bassPc: 0,
    });
    expect(realizedNames('C', '#42')).toEqual(['C', 'D', 'F#', 'A']);
    // `+` is the typed form of the slashed figure and raises it the same way.
    expect(realizeFiguredBass(parseNote('C'), '+42', cMajor)).toEqual(
      realizeFiguredBass(parseNote('C'), '#42', cMajor),
    );
    // Unaltered, the same figure is the diatonic supertonic seventh.
    expect(realizeFiguredBass(parseNote('C'), '42', cMajor)).toMatchObject({
      rootPc: 2,
      quality: 'min7',
    });
  });

  it('reads a natural sign as the natural note whatever the key gives', () => {
    expect(realizedNames('G', 'n', cMinor)).toEqual(['G', 'B', 'D']);
    expect(realizedNames('C', 'n6', cMinor)).toEqual(['C', 'Eb', 'A']);
  });

  it('records the spelling of the root and the bass on the chord', () => {
    const chord = realizeFiguredBass(parseNote('D#'), '#', minorKey(8));
    expect(chord.rootSpelling).toEqual({ letter: 1, alter: 1 });
    expect(chord.bassSpelling).toEqual({ letter: 1, alter: 1 });
    expect(noteNames(spellChord(chord, parseNote('G#'), minorKey(8)))).toEqual(['D#', 'F##', 'A#']);
  });
});

describe('moving figures', () => {
  it('returns the chord a suspension resolves into, and records the suspension', () => {
    const realized = figuredBassRealization(parseNote('G'), '4-3', cMajor);
    expect(realized.chord).toMatchObject({ rootPc: 7, quality: 'maj', bassPc: 7 });
    expect(noteNames(realized.notes)).toEqual(['G', 'B', 'D']);
    expect(realized.suspensions).toHaveLength(1);
    expect(realized.suspensions[0]).toMatchObject({ from: 4, to: 3 });
    expect(noteNames([realized.suspensions[0]?.note ?? parseNote('C')])).toEqual(['C']);
    expect(noteNames([realized.suspensions[0]?.resolution ?? parseNote('C')])).toEqual(['B']);
  });

  it('resolves 9-8 onto the bass itself, leaving a plain triad', () => {
    const realized = figuredBassRealization(parseNote('C'), '9-8', cMajor);
    expect(realized.chord).toMatchObject({ rootPc: 0, quality: 'maj', bassPc: 0 });
    expect(noteNames(realized.notes)).toEqual(['C', 'E', 'G']);
    expect(realized.suspensions[0]).toMatchObject({ from: 9, to: 8 });
  });

  it('resolves 7-6 onto the first-inversion triad', () => {
    const realized = figuredBassRealization(parseNote('A'), '7-6', cMajor);
    expect(realized.chord).toMatchObject({ rootPc: 5, quality: 'maj', bassPc: 9 });
    expect(noteNames(realized.notes)).toEqual(['A', 'C', 'F']);
  });

  it('accepts an accidental on either side of the motion, and static figures beside it', () => {
    const realized = figuredBassRealization(parseNote('E'), '4-#3', aMinor);
    expect(realized.chord).toMatchObject({ rootPc: 4, quality: 'maj', bassPc: 4 });
    expect(noteNames(realized.notes)).toEqual(['E', 'G#', 'B']);
    expect(figuredBassRealization(parseNote('G'), '5 4-3', cMajor).chord).toEqual(
      figuredBassRealization(parseNote('G'), '4-3', cMajor).chord,
    );
  });

  it('leaves the suspension list empty for a static figure', () => {
    expect(figuredBassRealization(parseNote('G'), '7', cMajor).suspensions).toEqual([]);
  });
});

describe('figures that name no chord', () => {
  it('rejects a figure combination the notation does not use', () => {
    expect(() => realizeFiguredBass(parseNote('C'), '54', cMajor)).toThrow(/"54"/);
    expect(() => realizeFiguredBass(parseNote('C'), '54', cMajor)).toThrow(/names no chord/);
  });

  it('rejects text that is not a figure at all', () => {
    for (const figures of ['x', '6x', '1', '4-']) {
      let caught: unknown;
      try {
        realizeFiguredBass(parseNote('C'), figures, cMajor);
      } catch (error) {
        caught = error;
      }
      expect(isLibcantusError(caught) && caught.code, figures).toBe('INVALID_INPUT');
      expect(String(caught), figures).toContain(JSON.stringify(figures));
    }
  });

  it('reports a sonority no chord quality names rather than mis-spelling it', () => {
    // Ab with a raised sixth is the Italian sixth, which the closed chord
    // quality union cannot express: Ab C F# does not stack in thirds as a triad.
    let caught: unknown;
    try {
      realizeFiguredBass(parseNote('Ab'), '#6', cMinor);
    } catch (error) {
      caught = error;
    }
    expect(isLibcantusError(caught) && caught.code).toBe('NO_SOLUTION');
    expect(String(caught)).toContain('F#');
  });
});

describe('figuredBassOf writes the figures back', () => {
  it('names the inversion of a triad and a seventh chord', () => {
    expect(figuredBassOf(makeChord(0, 'maj'), cMajor)).toBe('');
    expect(figuredBassOf(makeChord(7, 'maj', 11), cMajor)).toBe('6');
    expect(figuredBassOf(makeChord(0, 'maj', 7), cMajor)).toBe('64');
    expect(figuredBassOf(makeChord(7, 'dom7'), cMajor)).toBe('7');
    expect(figuredBassOf(makeChord(7, 'dom7', 11), cMajor)).toBe('65');
    expect(figuredBassOf(makeChord(7, 'dom7', 2), cMajor)).toBe('43');
    expect(figuredBassOf(makeChord(7, 'dom7', 5), cMajor)).toBe('42');
  });

  it('writes an accidental for every interval the key does not give', () => {
    expect(figuredBassOf(realizeFiguredBass(parseNote('G'), '#', cMinor), cMinor)).toBe('#3');
    expect(figuredBassOf(realizeFiguredBass(parseNote('C'), '#42', cMajor), cMajor)).toBe('#42');
  });

  it('round-trips every figure it emits', () => {
    const cases: [string, string, ReturnType<typeof majorKey>, string][] = [
      ['D', '', cMajor, ''],
      ['B', '6', cMajor, '6'],
      ['G', '64', cMajor, '64'],
      ['G', '7', cMajor, '7'],
      ['B', '65', cMajor, '65'],
      ['D', '43', cMajor, '43'],
      ['F', '2', cMajor, '42'],
      ['G', '#', cMinor, '#3'],
      ['E', '#', aMinor, '#3'],
      ['C', '#42', cMajor, '#42'],
    ];
    for (const [bass, figures, key, expected] of cases) {
      const chord = realizeFiguredBass(parseNote(bass), figures, key);
      expect(figuredBassOf(chord, key), `${bass} ${figures}`).toBe(expected);
      expect(realizeFiguredBass(parseNote(bass), expected, key), expected).toEqual(chord);
    }
  });

  it('refuses a chord no figure names', () => {
    let caught: unknown;
    try {
      figuredBassOf(makeChord(0, 'add9'), cMajor);
    } catch (error) {
      caught = error;
    }
    expect(isLibcantusError(caught) && caught.code).toBe('NO_SOLUTION');
  });
});

/** The bass a chord is figured over, spelled as the key spells it. */
function bassNoteOf(chord: Chord, key: KeyScale): Note | undefined {
  const bassPc = pitchClassOf(chord.bassPc ?? chord.rootPc);
  return spellChord(chord, spelledKeyOf(key).tonic, key).find(
    (tone) => noteToPitchClass(tone) === bassPc,
  );
}

describe('the two directions of the figure grammar reach the same chords', () => {
  /** Every chord the vocabulary builds, over each of its own tones as bass. */
  function figurableChords(): [Chord, KeyScale][] {
    const cases: [Chord, KeyScale][] = [];
    for (const key of [cMajor, cMinor, aMinor]) {
      for (const quality of chordQualities()) {
        for (const rootPc of [0, 3, 7]) {
          for (const bassPc of chordPitchClasses(makeChord(rootPc, quality))) {
            cases.push([makeChord(rootPc, quality, bassPc), key]);
          }
        }
      }
    }
    return cases;
  }

  it('accepts back every figure it writes, or writes none at all', () => {
    for (const [chord, key] of figurableChords()) {
      const label = `${chord.quality}/${chord.rootPc}/${chord.bassPc}`;
      let figures: string;
      try {
        figures = figuredBassOf(chord, key);
      } catch (error) {
        // Refusing to figure a chord is a documented answer; failing to name
        // the refusal as this library's own is not.
        expect(isLibcantusError(error) && error.code, label).toBe('NO_SOLUTION');
        continue;
      }
      const bass = bassNoteOf(chord, key);
      expect(bass, label).toBeDefined();
      if (bass === undefined) {
        continue;
      }
      const realized = realizeFiguredBass(bass, figures, key);
      expect(chordPitchClasses(realized), `${label} -> ${figures}`).toEqual(
        chordPitchClasses(chord),
      );
    }
  });

  it('writes no figures for the augmented sixths the realization refuses', () => {
    // The three of them occupy the interval positions of an inversion without
    // stacking in thirds over the bass, so the digits alone would name a chord
    // that cannot be realized back.
    for (const kind of ['italian', 'french', 'german'] as const) {
      const chord = augmentedSixthChord(kind, cMajor);
      let figures: string | undefined;
      try {
        figures = figuredBassOf(chord, cMajor);
      } catch (error) {
        expect(isLibcantusError(error) && error.code, kind).toBe('NO_SOLUTION');
        continue;
      }
      const bass = bassNoteOf(chord, cMajor);
      expect(bass, kind).toBeDefined();
      if (bass === undefined) {
        continue;
      }
      expect(() => realizeFiguredBass(bass, figures ?? '', cMajor), kind).not.toThrow();
    }
  });
});
