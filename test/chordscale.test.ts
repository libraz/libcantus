import { describe, expect, it } from 'vitest';
import { makeChord } from '../src/chord/index.js';
import {
  availableTensions,
  avoidNotes,
  chordScaleReport,
  chordScales,
  scaleMatchesChord,
  scalesForChanges,
} from '../src/chordscale/index.js';
import { NAMED_SCALES } from '../src/scale/index.js';

describe('scaleMatchesChord', () => {
  it('accepts a scale that contains every chord tone', () => {
    // Cmaj7 = {0, 4, 7, 11}; C ionian = {0,2,4,5,7,9,11}.
    expect(scaleMatchesChord([0, 4, 7, 11], 0b101010110101, 0)).toBe(true);
  });

  it('rejects a scale missing a chord tone', () => {
    // C mixolydian {0,2,4,5,7,9,10} has b7 (10), not the maj7 (11) of Cmaj7.
    const mixolydian = 0b011010110101;
    expect(scaleMatchesChord([0, 4, 7, 11], mixolydian, 0)).toBe(false);
  });
});

describe('chordScales', () => {
  it('fits ionian and lydian over Cmaj7', () => {
    const names = chordScales(makeChord(0, 'maj7')).map((m) => m.name);
    expect(names).toContain('ionian');
    expect(names).toContain('lydian');
    expect(names).not.toContain('chromatic');
  });

  it('roots every match on the chord root', () => {
    for (const match of chordScales(makeChord(5, 'maj7'))) {
      expect(match.rootPc).toBe(5);
    }
  });

  it('fits mixolydian over C7', () => {
    const names = chordScales(makeChord(0, 'dom7')).map((m) => m.name);
    expect(names).toContain('mixolydian');
  });

  it('ranks a tighter-fitting scale before a looser one', () => {
    // C6 = {0,4,7,9}. Major pentatonic {0,2,4,7,9} adds one tone; ionian adds
    // three, so the pentatonic must rank first.
    const names = chordScales(makeChord(0, '6')).map((m) => m.name);
    const pentaIndex = names.indexOf('majorPentatonic');
    const ionianIndex = names.indexOf('ionian');
    expect(pentaIndex).toBeGreaterThanOrEqual(0);
    expect(ionianIndex).toBeGreaterThanOrEqual(0);
    expect(pentaIndex).toBeLessThan(ionianIndex);
  });

  it('falls back to the chromatic scale when nothing else contains the chord', () => {
    // 7b13 = {0,4,7,8,10}; no named heptatonic/symmetric scale is a superset.
    const matches = chordScales(makeChord(0, '7b13'));
    expect(matches).toEqual([{ name: 'chromatic', rootPc: 0 }]);
  });
});

describe('avoidNotes', () => {
  it('flags F as an avoid note for Cmaj7 in ionian', () => {
    // F (5) sits a semitone above the chord third E (4).
    expect(avoidNotes(makeChord(0, 'maj7'), 'ionian')).toEqual([5]);
  });

  it('reports no avoid notes for Cmaj7 in lydian', () => {
    // Lydian raises the fourth to F# (6), removing the clash with E.
    expect(avoidNotes(makeChord(0, 'maj7'), 'lydian')).toEqual([]);
  });

  it('flags F as an avoid note for C7 in mixolydian', () => {
    expect(avoidNotes(makeChord(0, 'dom7'), 'mixolydian')).toEqual([5]);
  });

  it('returns [] when the scale does not contain the chord', () => {
    expect(avoidNotes(makeChord(0, 'maj7'), 'mixolydian')).toEqual([]);
  });

  it('returns [] for an unknown scale name', () => {
    expect(avoidNotes(makeChord(0, 'maj7'), 'notAScale')).toEqual([]);
  });
});

describe('availableTensions', () => {
  it('excludes chord tones and avoid notes for Cmaj7 in ionian', () => {
    // Scale {0,2,4,5,7,9,11}; chord {0,4,7,11}; avoid {5} -> tensions {2,9}.
    const tensions = availableTensions(makeChord(0, 'maj7'), 'ionian');
    expect(tensions).toEqual([2, 9]);
    expect(tensions).not.toContain(5);
    expect(tensions).not.toContain(0);
  });

  it('includes the #11 for Cmaj7 in lydian', () => {
    // Lydian has no avoid note, so 2 (9), 6 (#11), 9 (13) are all available.
    expect(availableTensions(makeChord(0, 'maj7'), 'lydian')).toEqual([2, 6, 9]);
  });

  it('returns the 9 and 13 for C7 in mixolydian', () => {
    expect(availableTensions(makeChord(0, 'dom7'), 'mixolydian')).toEqual([2, 9]);
  });

  it('returns [] when the scale does not contain the chord', () => {
    expect(availableTensions(makeChord(0, 'maj7'), 'mixolydian')).toEqual([]);
  });
});

describe('chordScaleReport', () => {
  it('combines matches with their avoid notes and tensions', () => {
    const report = chordScaleReport(makeChord(0, 'maj7'));
    const ionian = report.find((entry) => entry.name === 'ionian');
    expect(ionian).toBeDefined();
    expect(ionian?.rootPc).toBe(0);
    expect(ionian?.avoid).toEqual([5]);
    expect(ionian?.tensions).toEqual([2, 9]);
  });

  it('honors the limit argument', () => {
    const report = chordScaleReport(makeChord(0, 'maj7'), 1);
    expect(report).toHaveLength(1);
  });

  it('reports the chromatic fallback for an unsupported chord', () => {
    const report = chordScaleReport(makeChord(0, '7b13'));
    expect(report).toHaveLength(1);
    expect(report[0]?.name).toBe('chromatic');
  });

  it('returns no avoid notes or tensions for an unknown scale name', () => {
    expect(avoidNotes(makeChord(0, 'maj7'), 'not-a-scale')).toEqual([]);
    expect(availableTensions(makeChord(0, 'maj7'), 'not-a-scale')).toEqual([]);
  });
});

describe('scalesForChanges', () => {
  /** Pitch-class set of a named scale rooted on `rootPc`. */
  function scalePitchClasses(name: string, rootPc: number): Set<number> {
    const mask = NAMED_SCALES[name];
    const pcs = new Set<number>();
    if (mask === undefined) {
      return pcs;
    }
    for (let n = 0; n < 12; n += 1) {
      if (((mask >> n) & 1) === 1) {
        pcs.add((rootPc + n) % 12);
      }
    }
    return pcs;
  }

  it('picks scales from the same collection for a ii-V-I in C', () => {
    const chords = [makeChord(2, 'min7'), makeChord(7, 'dom7'), makeChord(0, 'maj7')];
    const choices = scalesForChanges(chords);
    expect(choices).toHaveLength(3);
    expect(choices[0]?.scale.name).toBe('dorian');
    expect(choices[1]?.scale.name).toBe('mixolydian');
    expect(choices[2]?.scale.name).toBe('ionian');

    const first = choices[0]?.scale ?? { name: '', rootPc: 0 };
    const collection = scalePitchClasses(first.name, first.rootPc);
    for (const choice of choices) {
      const pcs = scalePitchClasses(choice.scale.name, choice.scale.rootPc);
      expect(pcs).toEqual(collection);
    }
  });

  it('returns the best-fit scale for a single chord', () => {
    const chord = makeChord(0, 'maj7');
    const choices = scalesForChanges([chord]);
    expect(choices).toEqual([{ chord, scale: chordScales(chord)[0] }]);
  });

  it('returns [] for an empty input', () => {
    expect(scalesForChanges([])).toEqual([]);
  });

  it('returns one choice per chord, rooted on each chord root', () => {
    const chords = [makeChord(2, 'min7'), makeChord(7, 'dom7'), makeChord(0, 'maj7')];
    const choices = scalesForChanges(chords);
    expect(choices).toHaveLength(chords.length);
    choices.forEach((choice, i) => {
      expect(choice.chord).toBe(chords[i]);
      expect(choice.scale.rootPc).toBe(chords[i]?.rootPc);
    });
  });
});
