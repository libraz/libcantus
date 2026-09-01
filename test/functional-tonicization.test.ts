import { describe, expect, it } from 'vitest';
import {
  analyzeChord,
  chordToRoman,
  explainRoman,
  functionOf,
  type HarmonicFunction,
} from '../src/analyze/functional/index.js';
import { substituteChord } from '../src/generate/reharmony/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);
const cMinor = minorKey(0);

/** The diminished-family qualities, which tonicize from a semitone below. */
const DIMINISHED_FAMILY = ['dim', 'dim7', 'm7b5'] as const;

describe('a chromatic chord only tonicizes a degree that can be a tonic', () => {
  it('leaves the Picardy tonic of a minor key a tonic', () => {
    expect(functionOf(makeChord(9, 'maj'), aMinor)).toBe('tonic');
    expect(functionOf(makeChord(0, 'maj'), cMinor)).toBe('tonic');
  });

  it('never proposes the tonic triad as a substitute for the dominant', () => {
    // The dominant of C minor has no substitute that is the key's own tonic,
    // which is what a chord reading as an applied dominant on the tonic degree
    // would have made of it.
    for (const substitute of substituteChord(makeChord(7, 'maj'), cMinor)) {
      expect(substitute.chord.rootPc, substitute.type).not.toBe(cMinor.rootPc);
    }
  });

  it('leaves the borrowed major IV of a minor key a subdominant', () => {
    expect(functionOf(makeChord(2, 'maj'), aMinor)).toBe('subdominant');
  });

  it('keeps the applied dominant of a major key dominant', () => {
    // E major tonicizes vi, D major tonicizes V; neither is borrowed and both
    // fall a fifth onto a degree whose triad spans a perfect fifth.
    expect(functionOf(makeChord(4, 'maj'), cMajor)).toBe('dominant');
    expect(functionOf(makeChord(2, 'maj'), cMajor)).toBe('dominant');
    expect(functionOf(makeChord(9, 'dom7'), cMajor)).toBe('dominant');
  });

  it('keeps the major dominant of a minor key dominant', () => {
    expect(functionOf(makeChord(4, 'maj'), aMinor)).toBe('dominant');
    expect(functionOf(makeChord(4, 'dom7'), aMinor)).toBe('dominant');
  });

  it('refuses the diminished seventh degree of a major key as a target', () => {
    // The only degree either chord resolves onto is the diminished triad on the
    // seventh degree, which no chord tonicizes, so both keep their own degree.
    for (const quality of ['dim7', 'm7b5'] as const) {
      expect(functionOf(makeChord(10, quality), cMajor)).toBe('subdominant');
      expect(analyzeChord(makeChord(10, quality), cMajor).rationale).toContain(
        'takes the subdominant function of its degree',
      );
    }
  });

  it('agrees with the numeral about which degrees can be tonicized', () => {
    // Both layers read one predicate, so a chord the numeral refuses to name a
    // target for is not reported as an applied dominant either.
    expect(chordToRoman(makeChord(10, 'dim7'), cMajor, { applied: true })).toBe('bviio7');
    expect(functionOf(makeChord(10, 'dim7'), cMajor)).toBe('subdominant');
    expect(chordToRoman(makeChord(2, 'maj'), cMajor, { applied: true })).toBe('V/V');
    expect(functionOf(makeChord(2, 'maj'), cMajor)).toBe('dominant');
  });

  it('keeps the analysis of a chord internally consistent', () => {
    const picardy = analyzeChord(makeChord(9, 'maj'), aMinor);
    expect(picardy).toMatchObject({
      function: 'tonic',
      borrowed: true,
      source: 'parallelMajor',
      roman: 'I',
    });
    expect(picardy.rationale).toBe(
      'Tonic: I takes the tonic function of its degree in the key, borrowed from the parallel major',
    );
    const borrowedFour = analyzeChord(makeChord(2, 'maj'), aMinor);
    expect(borrowedFour).toMatchObject({
      function: 'subdominant',
      source: 'parallelMajor',
      roman: 'IV',
    });
    expect(borrowedFour.rationale).not.toContain('applied dominant');
  });
});

describe('the chromatic mediant of a minor key', () => {
  it('prolongs the tonic rather than sounding a dominant', () => {
    // C# major and C# minor in A minor: neither carries a dominant sonority nor
    // resolves like one.
    expect(functionOf(makeChord(1, 'maj'), aMinor)).toBe('tonic');
    expect(functionOf(makeChord(1, 'min'), aMinor)).toBe('tonic');
    expect(functionOf(makeChord(1, 'maj'), aMinor)).not.toBe('dominant');
  });

  it('reads the same way on every minor tonic', () => {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const mediant = (tonic + 4) % 12;
      expect(functionOf(makeChord(mediant, 'min'), minorKey(tonic)), `tonic ${tonic}`).toBe(
        'tonic',
      );
    }
  });

  it('leaves the diatonic mediant and the dominant where they were', () => {
    expect(functionOf(makeChord(0, 'maj'), aMinor)).toBe('tonic');
    expect(functionOf(makeChord(4, 'min'), aMinor)).toBe('dominant');
  });

  it('gives every offset of the minor table the function its degree carries', () => {
    // A minor triad fires none of the sonority rules, so this is the degree
    // table itself: the diatonic degrees as the textbooks give them, and each
    // chromatic offset as the displaced neighbour it is.
    const byOffset: HarmonicFunction[] = [
      'tonic', // i
      'subdominant', // bII
      'subdominant', // iio
      'tonic', // III
      'tonic', // #III, the chromatic mediant
      'subdominant', // iv
      'dominant', // #iv / bv
      'dominant', // V
      'tonic', // VI
      'tonic', // #VI
      'subdominant', // VII
      'dominant', // viio
    ];
    byOffset.forEach((expected, offset) => {
      expect(functionOf(makeChord((9 + offset) % 12, 'min'), aMinor), `offset ${offset}`).toBe(
        expected,
      );
    });
  });
});

describe('the function layer and the numeral layer read one tonicization rule', () => {
  it.each([
    { name: 'C major', key: cMajor },
    { name: 'A minor', key: aMinor },
  ])('gives every applied numeral in $name a dominant function', ({ key }) => {
    // A numeral that names a target is asserting the chord tonicizes a degree,
    // and the function layer reads the same predicate, so it can never call
    // that chord anything but a dominant.
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      for (const quality of DIMINISHED_FAMILY) {
        const chord = makeChord(rootPc, quality);
        if (chordToRoman(chord, key, { applied: true }).includes('/')) {
          expect(functionOf(chord, key), `${rootPc} ${quality}`).toBe('dominant');
        }
      }
    }
  });

  it('withholds a numeral, but not the function, when the target is the tonic', () => {
    // The one licensed difference between the layers: a chord pointing at the
    // tonic is the key's own dominant, and `viio7/i` is a numeral nobody writes.
    expect(chordToRoman(makeChord(8, 'dim7'), aMinor, { applied: true })).toBe('viio7');
    expect(functionOf(makeChord(8, 'dim7'), aMinor)).toBe('dominant');
  });

  it('withholds both when no degree can take the resolution', () => {
    // Bb dim7 and Bb m7b5 in C major rise onto the diminished triad of the
    // seventh degree, which is no tonic, so neither layer tonicizes anything.
    for (const quality of ['dim7', 'm7b5'] as const) {
      expect(chordToRoman(makeChord(10, quality), cMajor, { applied: true })).not.toContain('/');
      expect(functionOf(makeChord(10, quality), cMajor)).toBe('subdominant');
    }
  });
});

describe('explainRoman on the seventh degree of a minor key', () => {
  it('calls the raised leading tone raised and explains the bare numeral', () => {
    const raised = explainRoman(makeChord(8, 'dim7'), aMinor);
    expect(raised.roman).toBe('viio7');
    expect(raised.rationale).toContain('raised leading tone');
    expect(raised.rationale).toContain('a semitone above the seventh degree of the key');
    expect(raised.rationale).toContain('bare numeral');
    expect(raised.rationale).not.toContain('the root is the seventh degree of the key,');
  });

  it('calls the subtonic the seventh degree it is', () => {
    const subtonic = explainRoman(makeChord(7, 'dim7'), aMinor);
    expect(subtonic.roman).toBe('bviio7');
    expect(subtonic.rationale).toContain('the root is the seventh degree of the key');
    expect(subtonic.rationale).not.toContain('chromatic');
  });

  it('describes one root the same way whatever quality stands on it', () => {
    // G major and G diminished share a root, so they cannot disagree about
    // whether that root belongs to the key.
    const triad = explainRoman(makeChord(7, 'maj'), aMinor);
    const diminished = explainRoman(makeChord(7, 'dim'), aMinor);
    expect(triad.rationale).toContain('the root is the seventh degree of the key');
    expect(diminished.rationale).toContain('the root is the seventh degree of the key');
  });

  it('leaves an ordinary chromatic root described as chromatic', () => {
    const explained = explainRoman(makeChord(1, 'maj'), cMajor);
    expect(explained.roman).toBe('bII');
    expect(explained.rationale).toContain('the root is chromatic');
  });
});

describe('the tonicization predicates in an unusual key', () => {
  it('reads a mode through the same frame as its numerals', () => {
    const dDorian = scaleByName('dorian', 2);
    // A major triad on the dorian tonic is borrowed from the parallel major, so
    // it sounds its own degree rather than tonicizing anything.
    expect(functionOf(makeChord(2, 'maj'), dDorian)).toBe('tonic');
  });

  it('lets a tritone substitute point at the tonic', () => {
    expect(functionOf(makeChord(1, 'dom7'), cMajor)).toBe('dominant');
    expect(functionOf(makeChord(1, 'dom7'), cMinor)).toBe('dominant');
  });
});
