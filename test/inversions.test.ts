import { describe, expect, it } from 'vitest';
import { detectChord, detectChordBest } from '../src/analyze/detect/index.js';
import { chordToRoman, romanToChord } from '../src/analyze/functional/index.js';
import { chordQualities, makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

describe('romanToChord inversions', () => {
  it('parses triad inversions into a bass', () => {
    expect(romanToChord('V6', cMajor)).toMatchObject({ rootPc: 7, quality: 'maj', bassPc: 11 });
    expect(romanToChord('IV64', cMajor)).toMatchObject({ rootPc: 5, quality: 'maj', bassPc: 0 });
  });

  it('parses seventh-chord inversions', () => {
    expect(romanToChord('V65', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom7', bassPc: 11 });
    expect(romanToChord('V43', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom7', bassPc: 2 });
    expect(romanToChord('V42', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom7', bassPc: 5 });
  });

  it('round-trips figured-bass numerals', () => {
    for (const roman of ['V6', 'IV64', 'V65', 'ii43', 'V42']) {
      expect(chordToRoman(romanToChord(roman, cMajor), cMajor)).toBe(roman);
    }
  });

  it('leaves root-position numerals unchanged', () => {
    expect(chordToRoman(romanToChord('V7', cMajor), cMajor)).toBe('V7');
  });
});

describe('detectChord inversions', () => {
  it('reports the inversion from the lowest note', () => {
    const best = detectChord([64, 67, 72])[0]; // E G C = C/E, first inversion
    expect(best).toMatchObject({ rootPc: 0, quality: 'maj', inversion: 1, bassPc: 4 });
  });

  it('carries the bass into the best Chord', () => {
    expect(detectChordBest([64, 67, 72])).toMatchObject({ rootPc: 0, quality: 'maj', bassPc: 4 });
  });

  it('prefers the root-position reading of an ambiguous set', () => {
    // A C E G with A in the bass reads as Am7 (root position), not C6/A.
    const best = detectChord([57, 60, 64, 67])[0];
    expect(best).toMatchObject({ rootPc: 9, quality: 'min7', inversion: 0 });
  });
});

describe('inverted voicings round-trip through detectChord', () => {
  /** Reduce a value to a pitch class in [0, 11]. */
  function pitchClass(value: number): number {
    return ((value % 12) + 12) % 12;
  }

  /**
   * `quality:inversion` pairs whose inverted pitch-class set is identical to
   * another chord's, so detectChord may legitimately report the other reading:
   * - relative pairs: 6/min7 share one set, min6/m7b5 share another;
   * - symmetric chords: every inversion of dim7 and aug is another root's
   *   voicing of the same quality;
   * - rotations: sus2/sus4 are rotations of one set, 6/9 and 11 of another.
   */
  const ambiguous = new Set<string>([
    // 6 <-> min7 (e.g. C6 = Am7)
    '6:1',
    '6:2',
    '6:3',
    'min7:1',
    'min7:2',
    'min7:3',
    // min6 <-> m7b5 (e.g. Cmin6 = Am7b5)
    'min6:1',
    'min6:2',
    'min6:3',
    'm7b5:1',
    'm7b5:2',
    'm7b5:3',
    // symmetric chords
    'dim7:1',
    'dim7:2',
    'dim7:3',
    'aug:1',
    'aug:2',
    // sus2 <-> sus4 (e.g. Csus2 = Gsus4)
    'sus2:1',
    'sus2:2',
    'sus4:1',
    'sus4:2',
    // 6/9 <-> 11 (e.g. C6/9 = D11)
    '6/9:1',
    '6/9:2',
    '6/9:3',
    '6/9:4',
    '11:1',
    '11:2',
    '11:3',
    '11:4',
  ]);

  it('recovers root, quality, and inversion from every unambiguous inversion', () => {
    const mismatches = new Set<string>();
    for (const quality of chordQualities()) {
      const template = makeChord(0, quality);
      for (let inversion = 1; inversion < template.intervals.length; inversion += 1) {
        if (ambiguous.has(`${quality}:${inversion}`)) {
          continue;
        }
        for (let rootPc = 0; rootPc < 12; rootPc += 1) {
          const chord = makeChord(rootPc, quality);
          const bassInterval = chord.intervals[inversion] ?? 0;
          // Voice the chosen chord tone below the rest of the chord.
          const pitches = [
            48 + rootPc + pitchClass(bassInterval),
            ...chord.intervals.map((interval) => 60 + rootPc + interval),
          ];
          const best = detectChord(pitches)[0];
          if (best?.rootPc !== rootPc || best.quality !== quality || best.inversion !== inversion) {
            mismatches.add(`${quality}:${inversion}`);
          }
        }
      }
    }
    expect([...mismatches]).toEqual([]);
  });
});
