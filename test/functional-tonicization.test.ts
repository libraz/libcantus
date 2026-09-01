import { describe, expect, it } from 'vitest';
import {
  analyzeChord,
  chordToRoman,
  explainRoman,
  functionOf,
  type HarmonicFunction,
  romanToChord,
} from '../src/analyze/functional/index.js';
import { appliedTarget } from '../src/analyze/functional/tonicization.js';
import { parseNote } from '../src/core/pitch/index.js';
import { substituteChord } from '../src/generate/reharmony/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { crossRelations } from '../src/theory/partwriting/cross-relation.js';
import {
  majorKey,
  minorKey,
  NAMED_SCALES,
  type ScaleName,
  scaleByName,
} from '../src/theory/scale/index.js';

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

describe('the part-writing licence and the analysis read one list of tonicizable degrees', () => {
  /**
   * Two voicings holding a cross relation whatever chords they are said to be:
   * the alto's Eb is contradicted by the soprano's E natural, a contradiction
   * sprung rather than led into and exposed in an outer voice. Neither voicing
   * writes a sixth above its bass, so nothing here can read as an augmented
   * sixth in any key, and the only exemption left to be had is the applied
   * dominant's.
   */
  const CONTRADICTION = {
    from: ['C3', 'Eb3', 'G4'].map((name) => parseNote(name)),
    to: ['C3', 'F3', 'E4'].map((name) => parseNote(name)),
  };

  it('exempts the chromatic tone exactly where a degree can be tonicized', () => {
    // The checker exempts a cross relation the applied dominant brings with it,
    // and the analysis names the degree that dominant tonicizes. Both read one
    // list, so a chord let through the rule is one an applied numeral can be
    // written for, in every scale the library names.
    const divergences: string[] = [];
    const swept = new Set<ScaleName>();
    let exempted = 0;
    let reported = 0;
    for (const name of Object.keys(NAMED_SCALES) as ScaleName[]) {
      for (let tonic = 0; tonic < 12; tonic += 1) {
        const key = scaleByName(name, tonic);
        swept.add(name);
        for (let degree = 0; degree < 12; degree += 1) {
          const target = (tonic + degree) % 12;
          const applied = makeChord((target + 7) % 12, 'dom7');
          const licensed =
            crossRelations(
              { notes: CONTRADICTION.from, chord: makeChord(key.rootPc, 'min') },
              { notes: CONTRADICTION.to, chord: applied },
              key,
              { after: makeChord(target, 'maj') },
            ).length === 0;
          const tonicized = appliedTarget(applied, key)?.rootPc === target;
          if (licensed !== tonicized) {
            divergences.push(`${name} on ${tonic}: the chord over pitch class ${target}`);
          }
          if (licensed) {
            exempted += 1;
          } else {
            reported += 1;
          }
        }
      }
    }
    // The sweep is the whole registry rather than a written list, and it saw
    // the rule both grant the exemption and withhold it, so an empty divergence
    // list means the two layers were actually put to the question.
    expect(swept.size).toBe(Object.keys(NAMED_SCALES).length);
    expect(exempted).toBeGreaterThan(0);
    expect(reported).toBeGreaterThan(0);
    expect(divergences).toEqual([]);
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

describe("the tonic is no target, so a key's own dominant tonicizes nothing", () => {
  it('reads the dominant seventh of a minor key as the degree it stands on', () => {
    // E7 in A minor is V7. Calling it applied would say the key's own cadence
    // tonicizes some other degree, which is the one thing V7 cannot do.
    expect(analyzeChord(makeChord(4, 'dom7'), aMinor).rationale).toContain(
      'takes the dominant function of its degree in the key',
    );
    expect(analyzeChord(makeChord(7, 'dom7'), cMinor).rationale).not.toContain('applied');
    expect(functionOf(makeChord(4, 'dom7'), aMinor)).toBe('dominant');
    expect(functionOf(makeChord(7, 'dom7'), cMinor)).toBe('dominant');
  });

  it('reads the altered dominants of a major key the same way', () => {
    for (const quality of ['7b9', '7#9', '13b9', '7alt', 'dom9'] as const) {
      const analysis = analyzeChord(makeChord(7, quality), cMajor);
      expect(analysis.function, quality).toBe('dominant');
      expect(analysis.rationale, quality).not.toContain('applied');
    }
  });

  it('reads the leading-tone sevenths of both modes the same way', () => {
    expect(analyzeChord(makeChord(11, 'dim7'), cMajor).rationale).not.toContain('applied');
    expect(analyzeChord(makeChord(8, 'dim7'), aMinor).rationale).not.toContain('applied');
    expect(functionOf(makeChord(11, 'dim7'), cMajor)).toBe('dominant');
  });

  it('keeps the tritone substitute a dominant, since it reaches the tonic by semitone', () => {
    // The one sonority that may point at the tonic: Db7 falls a semitone onto
    // it, and the flat second degree it stands on would otherwise read as a
    // predominant.
    expect(functionOf(makeChord(1, 'dom7'), cMajor)).toBe('dominant');
    expect(analyzeChord(makeChord(1, 'dom7'), cMajor).rationale).toContain('applied');
  });

  it('still names a genuine applied dominant', () => {
    expect(functionOf(makeChord(9, 'dom7'), cMajor)).toBe('dominant');
    expect(analyzeChord(makeChord(9, 'dom7'), cMajor).rationale).toContain('applied');
  });
});

describe('an applied numeral cases its target as the key writes that degree', () => {
  it('names the dominant of the dominant of a minor key V7/V', () => {
    // Textbooks write V/III, V/iv, V/V, V/VI and V/VII in a minor key: the
    // fifth degree is written as a major V, since the key cadences through the
    // raised seventh, so the numeral applied to it is upper case.
    expect(chordToRoman(makeChord(11, 'dom7'), aMinor, { applied: true })).toBe('V7/V');
    expect(chordToRoman(makeChord(3, 'dim7'), aMinor, { applied: true })).toBe('viio7/V');
  });

  it('leaves the degrees whose own triad is minor in lower case', () => {
    expect(chordToRoman(makeChord(9, 'dom7'), aMinor, { applied: true })).toBe('V7/iv');
    expect(chordToRoman(makeChord(9, 'dom7'), cMajor, { applied: true })).toBe('V7/ii');
    expect(chordToRoman(makeChord(4, 'dom7'), cMajor, { applied: true })).toBe('V7/vi');
  });

  it('round-trips the numeral it prints', () => {
    for (const numeral of ['V7/V', 'viio7/V', 'V7/iv']) {
      const chord = romanToChord(numeral, aMinor);
      expect(chordToRoman(chord, aMinor, { applied: true })).toBe(numeral);
    }
  });
});

describe('the readings an applied numeral declines', () => {
  it('names the root against the home key where the target carries no perfect fifth', () => {
    // Nothing tonicizes the diminished triad on the seventh degree of a major
    // key, so F#7 stays #IV7.
    expect(chordToRoman(makeChord(6, 'dom7'), cMajor, { applied: true })).toBe('#IV7');
  });

  it('names the root against the home key where the target is the tonic', () => {
    expect(chordToRoman(makeChord(4, 'dom7'), aMinor, { applied: true })).toBe('V7');
    expect(chordToRoman(makeChord(1, 'dom7'), cMajor, { applied: true })).toBe('bII7');
  });

  it('names the root against the home key where the chord is diatonic to it', () => {
    // G7 is diatonic to A minor and to C mixolydian's parallel reading alike: a
    // chord the key contains keeps the function of its degree.
    expect(chordToRoman(makeChord(7, 'dom7'), aMinor, { applied: true })).toBe('VII7');
    expect(
      chordToRoman(makeChord(0, 'dom7'), scaleByName('mixolydian', 0), { applied: true }),
    ).toBe('I7');
  });
});
