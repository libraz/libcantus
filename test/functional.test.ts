import { describe, expect, it } from 'vitest';
import {
  chordToRoman,
  detectCadence,
  functionOf,
  romanToChord,
  secondaryDominant,
} from '../src/analyze/functional/index.js';
import type { KeyScale } from '../src/core/types.js';
import { chordPitchClasses, chordQualities, makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

describe('romanToChord', () => {
  it('parses diatonic numerals with case-based quality', () => {
    expect(romanToChord('V7', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom7' });
    expect(romanToChord('ii', cMajor)).toMatchObject({ rootPc: 2, quality: 'min' });
    expect(romanToChord('Imaj7', cMajor)).toMatchObject({ rootPc: 0, quality: 'maj7' });
  });

  it('parses borrowed and altered numerals', () => {
    expect(romanToChord('bVII', cMajor)).toMatchObject({ rootPc: 10, quality: 'maj' });
    expect(romanToChord('viio7', cMajor)).toMatchObject({ rootPc: 11, quality: 'dim7' });
    expect(romanToChord('iiø7', cMajor)).toMatchObject({ rootPc: 2, quality: 'm7b5' });
  });

  it('parses secondary dominants', () => {
    expect(romanToChord('V7/V', cMajor)).toMatchObject({ rootPc: 2, quality: 'dom7' });
    expect(romanToChord('V/ii', cMajor)).toMatchObject({ rootPc: 9, quality: 'maj' });
  });

  it('rejects nonsense', () => {
    expect(() => romanToChord('Q', cMajor)).toThrow();
  });
});

describe('chordToRoman', () => {
  it('names diatonic chords', () => {
    expect(chordToRoman(makeChord(7, 'maj'), cMajor)).toBe('V');
    expect(chordToRoman(makeChord(9, 'min'), cMajor)).toBe('vi');
    expect(chordToRoman(makeChord(7, 'dom7'), cMajor)).toBe('V7');
    expect(chordToRoman(makeChord(11, 'dim'), cMajor)).toBe('viio');
  });

  it('names borrowed chords with accidentals', () => {
    expect(chordToRoman(makeChord(10, 'maj'), cMajor)).toBe('bVII');
  });

  it('round-trips with romanToChord', () => {
    for (const roman of ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'viio', 'V7', 'bVII']) {
      expect(chordToRoman(romanToChord(roman, cMajor), cMajor)).toBe(roman);
    }
  });
});

describe('chromatic-root spelling round-trip', () => {
  // The canonical major-key spelling of each semitone offset above the tonic,
  // mirroring the module's OFFSET_SPELLING table. The tritone (offset 6) spells
  // as a raised subdominant #IV; every other chromatic keeps its flat spelling.
  const majorSpelling = [
    'I',
    'bII',
    'II',
    'bIII',
    'III',
    'IV',
    '#IV',
    'V',
    'bVI',
    'VI',
    'bVII',
    'VII',
  ];

  it('names each pitch class in C major consistent with OFFSET_SPELLING', () => {
    for (let pc = 0; pc < 12; pc += 1) {
      expect(chordToRoman(makeChord(pc, 'maj'), cMajor)).toBe(majorSpelling[pc]);
    }
  });

  it('round-trips every triad root through chordToRoman and romanToChord', () => {
    for (let pc = 0; pc < 12; pc += 1) {
      const roman = chordToRoman(makeChord(pc, 'maj'), cMajor);
      expect(romanToChord(roman, cMajor).rootPc).toBe(pc);
    }
  });

  it('spells the tritone as #IV and round-trips it', () => {
    expect(chordToRoman(makeChord(6, 'maj'), cMajor)).toBe('#IV');
    expect(romanToChord('#iv', cMajor)).toMatchObject({ rootPc: 6 });
    expect(romanToChord('#IV', cMajor).rootPc).toBe(6);
  });
});

describe('half-diminished implies a seventh', () => {
  it('reads a bare ø as a half-diminished seventh', () => {
    expect(romanToChord('iiø', cMajor)).toMatchObject({ rootPc: 2, quality: 'm7b5' });
    expect(romanToChord('viiø', cMajor)).toMatchObject({ rootPc: 11, quality: 'm7b5' });
  });

  it('still reads an explicit ø7 as a half-diminished seventh', () => {
    expect(romanToChord('iiø7', cMajor)).toMatchObject({ rootPc: 2, quality: 'm7b5' });
  });
});

describe('extension figures', () => {
  it('maps a ninth figure to a root-position dominant ninth', () => {
    expect(romanToChord('V9', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom9' });
  });

  it('maps eleventh and thirteenth figures to their qualities', () => {
    expect(romanToChord('V11', cMajor)).toMatchObject({ rootPc: 7, quality: '11' });
    expect(romanToChord('V13', cMajor)).toMatchObject({ rootPc: 7, quality: '13' });
  });

  it('throws on an unsupported figure rather than silently downgrading', () => {
    expect(() => romanToChord('V8', cMajor)).toThrow();
    expect(() => romanToChord('V99', cMajor)).toThrow();
  });
});

describe('maj7 / minMaj7 inversion round-trips', () => {
  it('round-trips maj7 in every inversion', () => {
    expect(chordToRoman(makeChord(0, 'maj7'), cMajor)).toBe('Imaj7');
    for (const [bass, roman] of [
      [4, 'Imaj765'],
      [7, 'Imaj743'],
      [11, 'Imaj742'],
    ] as const) {
      const chord = makeChord(0, 'maj7', bass);
      expect(chordToRoman(chord, cMajor)).toBe(roman);
      expect(romanToChord(roman, cMajor)).toMatchObject({
        rootPc: 0,
        quality: 'maj7',
        bassPc: bass,
      });
    }
  });

  it('round-trips minMaj7 in every inversion', () => {
    expect(chordToRoman(makeChord(0, 'minMaj7'), cMajor)).toBe('imaj7');
    for (const [bass, roman] of [
      [3, 'imaj765'],
      [7, 'imaj743'],
      [11, 'imaj742'],
    ] as const) {
      const chord = makeChord(0, 'minMaj7', bass);
      expect(chordToRoman(chord, cMajor)).toBe(roman);
      expect(romanToChord(roman, cMajor)).toMatchObject({
        rootPc: 0,
        quality: 'minMaj7',
        bassPc: bass,
      });
    }
  });
});

describe('chordToRoman with a tension in the bass', () => {
  it('falls back to root-position rendering instead of a bare numeral', () => {
    expect(chordToRoman(makeChord(7, 'dom9', 9), cMajor)).not.toBe('V');
    expect(chordToRoman(makeChord(7, 'dom9', 9), cMajor)).toContain('V');
  });
});

describe('functionOf', () => {
  it('maps degrees to tonal functions', () => {
    expect(functionOf(makeChord(0, 'maj'), cMajor)).toBe('tonic');
    expect(functionOf(makeChord(9, 'min'), cMajor)).toBe('tonic');
    expect(functionOf(makeChord(5, 'maj'), cMajor)).toBe('subdominant');
    expect(functionOf(makeChord(2, 'min'), cMajor)).toBe('subdominant');
    expect(functionOf(makeChord(7, 'dom7'), cMajor)).toBe('dominant');
    expect(functionOf(makeChord(11, 'dim'), cMajor)).toBe('dominant');
  });
});

describe('detectCadence', () => {
  it('classifies the common cadences', () => {
    expect(detectCadence(makeChord(7, 'dom7'), makeChord(0, 'maj'), cMajor)).toBe('authentic');
    expect(detectCadence(makeChord(5, 'maj'), makeChord(0, 'maj'), cMajor)).toBe('plagal');
    expect(detectCadence(makeChord(7, 'maj'), makeChord(9, 'min'), cMajor)).toBe('deceptive');
    expect(detectCadence(makeChord(2, 'min'), makeChord(7, 'maj'), cMajor)).toBe('half');
    expect(detectCadence(makeChord(0, 'maj'), makeChord(2, 'min'), cMajor)).toBeNull();
  });

  it('does not treat a static V-to-V repeat as a cadence', () => {
    expect(detectCadence(makeChord(7, 'dom7'), makeChord(7, 'dom7'), cMajor)).toBeNull();
    expect(detectCadence(makeChord(7, 'maj'), makeChord(7, 'maj'), cMajor)).toBeNull();
  });

  it('treats V to the borrowed flat-submediant bVI as deceptive in major', () => {
    expect(detectCadence(makeChord(7, 'maj'), makeChord(8, 'maj'), cMajor)).toBe('deceptive');
    // The diatonic submediant vi (offset 9) remains deceptive too.
    expect(detectCadence(makeChord(7, 'maj'), makeChord(9, 'min'), cMajor)).toBe('deceptive');
  });
});

describe('secondaryDominant', () => {
  it('builds V7 of a target degree', () => {
    expect(secondaryDominant(4, cMajor)).toMatchObject({ rootPc: 2, quality: 'dom7' });
  });
});

describe('roman round-trip across every chord quality', () => {
  // Tonic, supertonic, subdominant, and dominant degrees of each key.
  const keyCases: [string, KeyScale, number[]][] = [
    ['C major', cMajor, [0, 2, 5, 7]],
    ['A minor', aMinor, [9, 11, 2, 4]],
  ];

  for (const [name, key, roots] of keyCases) {
    it(`chord -> roman -> chord preserves quality and pitch classes in ${name}`, () => {
      for (const quality of chordQualities()) {
        for (const rootPc of roots) {
          const chord = makeChord(rootPc, quality);
          const roman = chordToRoman(chord, key);
          const back = romanToChord(roman, key);
          expect(back.rootPc, `${quality} on pc ${rootPc} via "${roman}"`).toBe(rootPc);
          expect(back.quality, `${quality} on pc ${rootPc} via "${roman}"`).toBe(quality);
          expect(chordPitchClasses(back), `${quality} on pc ${rootPc} via "${roman}"`).toEqual(
            chordPitchClasses(chord),
          );
        }
      }
    });

    it(`roman -> chord -> roman is stable in ${name}`, () => {
      for (const quality of chordQualities()) {
        for (const rootPc of roots) {
          const roman = chordToRoman(makeChord(rootPc, quality), key);
          expect(chordToRoman(romanToChord(roman, key), key), `${quality} as "${roman}"`).toBe(
            roman,
          );
        }
      }
    });
  }
});

describe('extension figures honor numeral case and quality suffix', () => {
  it('keeps ii9-V9-Imaj9 diatonic in C major', () => {
    const ii9 = romanToChord('ii9', cMajor);
    expect(ii9).toMatchObject({ rootPc: 2, quality: 'min9' });
    // D F A C E
    expect(chordPitchClasses(ii9)).toEqual([0, 2, 4, 5, 9]);

    const v9 = romanToChord('V9', cMajor);
    expect(v9).toMatchObject({ rootPc: 7, quality: 'dom9' });
    // G B D F A
    expect(chordPitchClasses(v9)).toEqual([2, 5, 7, 9, 11]);

    const imaj9 = romanToChord('Imaj9', cMajor);
    expect(imaj9).toMatchObject({ rootPc: 0, quality: 'maj9' });
    // C E G B D
    expect(chordPitchClasses(imaj9)).toEqual([0, 2, 4, 7, 11]);
  });

  it('reads a lowercase ninth as a minor ninth', () => {
    expect(romanToChord('vi9', cMajor)).toMatchObject({ rootPc: 9, quality: 'min9' });
  });

  it('round-trips ninths in a minor key', () => {
    expect(romanToChord('i9', aMinor)).toMatchObject({ rootPc: 9, quality: 'min9' });
    expect(chordToRoman(makeChord(9, 'min9'), aMinor)).toBe('i9');
    expect(chordToRoman(makeChord(4, 'dom9'), aMinor)).toBe('V9');
    expect(romanToChord('V9', aMinor)).toMatchObject({ rootPc: 4, quality: 'dom9' });
  });

  it('rejects extensions that have no quality for the numeral case', () => {
    // No minor-11 or minor-13 quality exists, so a lowercase numeral with
    // those figures throws instead of silently becoming a dominant.
    expect(() => romanToChord('ii11', cMajor)).toThrow();
    expect(() => romanToChord('ii13', cMajor)).toThrow();
  });
});

describe('added-tone and suspended qualities round-trip', () => {
  it('renders min6 in lower case and round-trips it', () => {
    const roman = chordToRoman(makeChord(2, 'min6'), cMajor);
    expect(roman).toBe('iiadd6');
    expect(romanToChord(roman, cMajor)).toMatchObject({ rootPc: 2, quality: 'min6' });
  });

  it('round-trips sus2 without re-parsing as an inverted seventh', () => {
    const roman = chordToRoman(makeChord(0, 'sus2'), cMajor);
    expect(roman).toBe('Isus2');
    const back = romanToChord(roman, cMajor);
    expect(back).toMatchObject({ rootPc: 0, quality: 'sus2' });
    expect(back.bassPc).toBeUndefined();
  });

  it('round-trips sus4, the power chord, and majb5 without throwing', () => {
    for (const quality of ['sus4', '5', 'majb5'] as const) {
      const roman = chordToRoman(makeChord(7, quality), cMajor);
      expect(romanToChord(roman, cMajor)).toMatchObject({ rootPc: 7, quality });
    }
  });

  it('round-trips augmented sevenths including inversions', () => {
    expect(chordToRoman(makeChord(0, 'augMaj7'), cMajor)).toBe('I+maj7');
    expect(romanToChord('I+maj7', cMajor)).toMatchObject({ rootPc: 0, quality: 'augMaj7' });
    expect(chordToRoman(makeChord(0, 'aug7', 4), cMajor)).toBe('I+65');
    expect(romanToChord('I+65', cMajor)).toMatchObject({ rootPc: 0, quality: 'aug7', bassPc: 4 });
    expect(chordToRoman(makeChord(0, 'augMaj7', 4), cMajor)).toBe('I+maj765');
    expect(romanToChord('I+maj765', cMajor)).toMatchObject({
      rootPc: 0,
      quality: 'augMaj7',
      bassPc: 4,
    });
  });
});

describe('inverted added-tone chords do not become false seventh figures', () => {
  it('renders an inverted sixth chord in root position, not I65', () => {
    expect(chordToRoman(makeChord(0, '6', 4), cMajor)).toBe('Iadd6');
    expect(chordToRoman(makeChord(0, 'min6', 3), cMajor)).toBe('iadd6');
  });

  it('renders inverted add9 and 6/9 in root position', () => {
    expect(chordToRoman(makeChord(0, 'add9', 4), cMajor)).toBe('Iadd9');
    expect(chordToRoman(makeChord(0, '6/9', 7), cMajor)).toBe('I69');
  });

  it('still emits seventh figures for true seventh chords', () => {
    expect(chordToRoman(makeChord(7, 'dom7', 11), cMajor)).toBe('V65');
    expect(chordToRoman(makeChord(11, 'dim7', 2), cMajor)).toBe('viio65');
  });
});
