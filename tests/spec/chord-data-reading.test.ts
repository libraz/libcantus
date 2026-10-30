/**
 * Chord data handed to an entrance as a plain object is checked where the chord
 * module checks it: the quality where the chord's tones are asked for, the
 * spelling hints where the chord's own spelling is read, and the interval
 * template the way the reading that uses it iterates it. A field no reading
 * touches is never refused, and a field that is refused is refused with the
 * chord module's own message.
 */

import {
  analyzeChord,
  analyzeReference,
  chordToRoman,
  detectModulations,
  explainRoman,
  functionOf,
  isDiatonic,
  spellLine,
} from '@libraz/libcantus/analyze';
import { generateMotif } from '@libraz/libcantus/generate';
import { Voicing } from '@libraz/libcantus/model';
import {
  availableTensions,
  avoidNotes,
  chordScaleReport,
  chordScales,
  chordSpecOf,
  enumerateSafePitches,
  evaluateSafety,
  figuredBassOf,
  majorKey,
  nextVoicing,
  roleOf,
  scalesForChanges,
  spellVoicing,
  voiceChord,
  voiceProgression,
} from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

/** Plain chord data with any field replaced, typed loosely as a caller's JSON is. */
function chord(fields: Record<string, unknown>): never {
  return { rootPc: 0, quality: 'maj', intervals: [0, 4, 7], ...fields } as never;
}

const noQuality = { rootPc: 0, intervals: [0, 4, 7] } as never;
const dominant = chord({ rootPc: 7, quality: 'dom7', intervals: [0, 4, 7, 10] });

describe('an unknown quality is refused where the chord tones are read', () => {
  it('by the chord-scale entrances', () => {
    expect(() => chordScales(noQuality)).toThrow('Unknown chord quality: undefined');
    expect(() => avoidNotes(chord({ quality: 'mj7' }), 'mixolydian')).toThrow(
      'Unknown chord quality: mj7',
    );
    expect(() => availableTensions(chord({ quality: 5 }), 'ionian')).toThrow(
      'Unknown chord quality: 5',
    );
    expect(() => chordScaleReport(noQuality)).toThrow('Unknown chord quality: undefined');
    expect(() => scalesForChanges([noQuality, chord({})])).toThrow(
      'Unknown chord quality: undefined',
    );
  });

  it('of a resolution target only when a dominant seventh moves to it down a fifth', () => {
    const target = (rootPc: number) => chord({ rootPc, quality: 'zz', intervals: [0, 3, 7] });
    expect(() => availableTensions(dominant, 'mixolydian', { resolvesTo: target(0) })).toThrow(
      'Unknown chord quality: zz',
    );
    expect(availableTensions(dominant, 'mixolydian', { resolvesTo: target(2) })).toEqual(
      availableTensions(dominant, 'mixolydian'),
    );
  });

  it('by the voicing entrances', () => {
    expect(() => voiceChord(chord({ quality: 'mj7' }))).toThrow('Unknown chord quality: mj7');
    expect(() => voiceProgression([chord({}), noQuality])).toThrow(
      'Unknown chord quality: undefined',
    );
    expect(() => nextVoicing([48, 55, 64, 72], chord({ quality: 5 }))).toThrow(
      'Unknown chord quality: 5',
    );
  });

  it('as a number, which only a table lookup reads by its text', () => {
    const power = chord({ rootPc: 7, quality: 5, intervals: [0, 7] });
    expect(() => functionOf(power, 'C major')).toThrow('Unknown chord quality: 5');
    expect(() => isDiatonic(power, 'C major')).toThrow('Unknown chord quality: 5');
    expect(chordToRoman(power, 'C major')).toBe('V5');
    expect(() =>
      chordToRoman(chord({ rootPc: 8, quality: 5, intervals: [0, 7] }), 'C major'),
    ).toThrow('Unknown chord quality: 5');
    expect(() =>
      generateMotif({
        key: 'C major',
        bars: 1,
        chord: chord({ quality: 5, intervals: [0, 7] }),
        seed: 1,
      } as never),
    ).toThrow('Unknown chord quality: 5');
  });

  it('by the safety verdict at the first pitch outside the chord', () => {
    const query = (fields: Record<string, unknown>) =>
      ({
        chord: noQuality,
        key: { rootPc: 0, modeMask12: 2741 },
        otherVoices: [],
        profile: 'strict',
        ...fields,
      }) as never;
    expect(() => evaluateSafety(query({ candidatePitch: 62 }))).toThrow(
      'Unknown chord quality: undefined',
    );
    expect(evaluateSafety(query({ candidatePitch: 60 })).rationale).toBe('Chord tone');
    expect(enumerateSafePitches(query({ vocalLow: 64, vocalHigh: 64 }), 60, 72)).toEqual([64]);
    expect(() => enumerateSafePitches(query({ vocalLow: 62, vocalHigh: 64 }), 60, 72)).toThrow(
      'Unknown chord quality: undefined',
    );
  });
});

describe('an unknown quality is refused where a profile or a voicing reads the chord', () => {
  const line = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];
  const reference = (chords: unknown[], fields: Record<string, unknown> = {}) =>
    analyzeReference(line, {
      key: majorKey(0),
      timeline: {
        segments: chords.map((value, index) => ({
          startBeat: 4 * index,
          endBeat: 4 * index + 4,
          chord: value,
        })),
        at: () => null,
      },
      ...fields,
    } as never);

  it('by the reference profile of a timeline, never reading it as major', () => {
    for (const quality of ['minor', undefined, 5, null]) {
      expect(() => reference([chord({ quality, intervals: [0, 3, 7] })])).toThrow(
        `Unknown chord quality: ${String(quality)}`,
      );
      expect(() => reference([{ rootPc: 0, quality }])).toThrow(
        `Unknown chord quality: ${String(quality)}`,
      );
    }
    expect(() => reference([{ rootPc: 0, quality: 'maj' }])).toThrow(
      'chord intervals must be an array; received undefined',
    );
    // The chord is read as data, not as a symbol, and its offsets where it is named.
    expect(() => reference(['C'])).toThrow('pitch must be finite; received NaN');
    expect(() => reference([chord({ intervals: [0, null, 7] })])).toThrow(
      'chord.intervals[1] must be finite; received null',
    );
    expect(() => reference([chord({ rootPc: 2, quality: 'min', intervals: [0, 'x', 7] })])).toThrow(
      'chord.intervals[1] must be finite; received x',
    );
    expect(() =>
      reference([chord({ rootPc: 7, quality: 'aa' }), chord({ quality: 'bb' })]),
    ).toThrow('Unknown chord quality: bb');
    expect(() => reference([chord({ quality: 'minor' })], { melody: 5 })).toThrow(
      'reference melody must be an array; received number',
    );
    expect(
      reference([chord({ toneSpellings: [null, null, null], rootSpelling: 5 })]).harmony.chords.map(
        (entry) => entry.roman,
      ),
    ).toEqual(['I']);
  });

  it('by a voicing spelled against a chord', () => {
    const tonic = Voicing.satb(chord({}), { key: majorKey(0) });
    expect(() =>
      tonic.spell(majorKey(0), chord({ quality: 'minor', intervals: [0, 3, 7] })),
    ).toThrow('Unknown chord quality: minor');
    expect(() => tonic.spell(majorKey(0), noQuality)).toThrow('Unknown chord quality: undefined');
    // The voicing's tones are all in the key, so the root hint is never read.
    expect(tonic.spell(majorKey(0), chord({ rootSpelling: 5 }))).toHaveLength(4);
  });

  it('by a voicing checked against the next, each chord asserted before the first is spelled', () => {
    const tonic = Voicing.satb(chord({}), { key: majorKey(0) });
    const dominantChord = chord({ rootPc: 7 });
    const other = Voicing.satb(dominantChord, { key: majorKey(0) });
    const check = (from: unknown, to: unknown, peer: unknown = other) =>
      tonic.checkTo(peer as never, [from, to] as never, majorKey(0));
    expect(() => check(chord({}), chord({ rootPc: 7, quality: 'minor' }))).toThrow(
      'Unknown chord quality: minor',
    );
    expect(() => check(chord({ quality: 'minor' }), chord({ rootPc: 7, quality: 'zz' }))).toThrow(
      'Unknown chord quality: minor',
    );
    expect(() => check(noQuality, dominantChord)).toThrow('Unknown chord quality: undefined');
    expect(() => check(chord({ quality: 'minor' }), dominantChord, [43, 59, 62, 67])).toThrow(
      'Unknown chord quality: minor',
    );
    expect(() => check(chord({}), dominantChord, [43, 59, 62, 67])).toThrow(
      'voicing must be an array; received undefined',
    );
  });
});

describe('a spelling hint is read as a note where the chord spelling is read', () => {
  const nullTones = (fields: Record<string, unknown> = {}) =>
    chord({ toneSpellings: [null, null, null], ...fields });

  it('by the role of a tone and the voicing that weighs roles', () => {
    expect(() => roleOf(60, nullTones())).toThrow('note must be an object; received null');
    expect(() => voiceChord(nullTones())).toThrow('note must be an object; received null');
    expect(() => nextVoicing([48, 55, 64, 72], chord({ toneSpellings: ['', '', ''] }))).toThrow(
      'note must be an object; received ""',
    );
  });

  it('by the chord left in a checked pair, where its seventh is looked for', () => {
    const tonic = Voicing.satb(chord({}), { key: majorKey(0) });
    const dominantChord = chord({ rootPc: 7 });
    const other = Voicing.satb(dominantChord, { key: majorKey(0) });
    const check = (from: unknown, to: unknown) =>
      tonic.checkTo(other, [from, to] as never, majorKey(0));
    expect(() => check(chord({ toneSpellings: [5, null, null] }), dominantChord)).toThrow(
      'note must be an object; received number',
    );
    expect(() => check(nullTones(), dominantChord)).toThrow(
      'note must be an object; received null',
    );
    expect(() => check(nullTones(), chord({ rootPc: 7, quality: 'minor' }))).toThrow(
      'Unknown chord quality: minor',
    );
    expect(check(chord({}), chord({ rootPc: 7, toneSpellings: [null, null, null] }))).toEqual([]);
    expect(check(chord({ rootSpelling: 5 }), dominantChord)).toEqual([]);
  });

  it('by the voicing entrances that spell in a key, the root hint included', () => {
    const misspelled = chord({ rootSpelling: 5 });
    const message = 'diatonic letter must be finite; received undefined';
    const key = majorKey(0);
    expect(() => voiceChord(misspelled, { key })).toThrow(message);
    expect(() => voiceProgression([misspelled], { key: 'C major' })).toThrow(message);
    expect(() => voiceProgression([chord({}), misspelled], { key: 'C major' })).toThrow(message);
    expect(() => nextVoicing([48, 55, 64, 72], misspelled, { key: 'C major' })).toThrow(message);
    expect(() =>
      nextVoicing([48, 55, 64, 72], chord({}), { key: 'C major', previousChord: misspelled }),
    ).toThrow(message);
    expect(() => Voicing.satb(misspelled, { key })).toThrow(message);
    expect(() => Voicing.satb(chord({}), { key }).next(misspelled, { key })).toThrow(message);
    // The tone spellings are read where the roles are scored, before the key spells the root.
    expect(() =>
      voiceChord(chord({ rootSpelling: 5, toneSpellings: [null, null, null] }), { key }),
    ).toThrow('note must be an object; received null');
    // Without a key nothing spells the chord, and a key that names every pitch class asks nothing
    // of it.
    expect(voiceChord(misspelled)).toEqual([48, 60, 64, 67]);
    expect(voiceProgression([misspelled])).toEqual([[48, 60, 64, 67]]);
    expect(nextVoicing([48, 55, 64, 72], chord({}), { previousChord: misspelled })).toHaveLength(4);
    expect(voiceChord(misspelled, { key: { rootPc: 0, modeMask12: 4095 } })).toEqual([
      48, 60, 64, 67,
    ]);
  });

  it('by a voicing spelled against a chord, at the first pitch the key leaves to it', () => {
    const misspelled = chord({
      rootPc: 2,
      quality: 'dom7',
      intervals: [0, 4, 7, 10],
      rootSpelling: 5,
    });
    const message = 'diatonic letter must be finite; received undefined';
    const key = majorKey(0);
    expect(() => spellVoicing([50, 66, 69, 72], misspelled, 'C major')).toThrow(message);
    expect(spellVoicing([50, 62, 69, 72], misspelled, 'C major')).toHaveLength(4);
    expect(() => spellVoicing([50, 'x', 66] as never, misspelled, 'C major')).toThrow(
      'pitch must be finite; received x',
    );
    expect(() => spellVoicing([66, 'x'] as never, misspelled, 'C major')).toThrow(message);
    expect(() => spellVoicing([Number.NaN, 66], misspelled, 'C major')).toThrow(
      'pitch must be finite; received NaN',
    );
    const chromatic = Voicing.of([50, 66, 69, 72]);
    const unspelledTones = chord({
      rootPc: 2,
      quality: 'dom7',
      intervals: [0, 4, 7, 10],
      toneSpellings: [null, null, null, null],
    });
    expect(() => chromatic.spell(key, misspelled)).toThrow(message);
    expect(() => chromatic.spell(key, unspelledTones)).toThrow(
      'note must be an object; received null',
    );
    const dominantVoicing = Voicing.of([43, 59, 62, 67]);
    const dominantChord = chord({ rootPc: 7 });
    expect(() => chromatic.checkTo(dominantVoicing, [misspelled, dominantChord], key)).toThrow(
      message,
    );
    expect(() => dominantVoicing.checkTo(chromatic, [dominantChord, misspelled], key)).toThrow(
      message,
    );
    expect(() =>
      dominantVoicing.checkTo(
        { pitches: [50, 66, 69, 72] } as never,
        [dominantChord, misspelled],
        key,
      ),
    ).toThrow(message);
  });

  it('by a line spelled over a timeline chord', () => {
    const over = (value: unknown) =>
      spellLine(
        [{ pitch: 60, startBeat: 0, durationBeat: 1 }],
        { segments: [{ startBeat: 0, endBeat: 4, chord: value }], at: () => value } as never,
        majorKey(0),
      );
    expect(() => over(chord({ rootSpelling: 5 }))).toThrow(
      'diatonic letter must be finite; received undefined',
    );
    expect(() => over(nullTones())).toThrow('note must be an object; received null');
    expect(over(chord({}))).toEqual([{ letter: 0, alter: 0, octave: 4 }]);
  });

  it('by the figures, which spell the chord in the key', () => {
    expect(() => figuredBassOf(nullTones(), 'C major')).toThrow(
      'note must be an object; received null',
    );
    expect(() => figuredBassOf(chord({ rootSpelling: null }), 'C major')).toThrow(
      "Cannot read properties of null (reading 'letter')",
    );
    expect(() => figuredBassOf(noQuality, 'C major')).toThrow('Unknown chord quality: undefined');
  });

  it('by a numeral over the lowered submediant, read as an augmented sixth', () => {
    const flatSix = (fields: Record<string, unknown>) =>
      chord({ rootPc: 8, quality: 'dom7', intervals: [0, 4, 7, 10], ...fields });
    expect(() => chordToRoman(flatSix({ toneSpellings: ['', '', '', ''] }), 'C major')).toThrow(
      'note must be an object; received ""',
    );
    expect(() => chordToRoman(flatSix({ rootSpelling: null }), 'C major')).toThrow(
      "Cannot read properties of null (reading 'letter')",
    );
    expect(() =>
      chordToRoman(flatSix({ rootSpelling: { letter: 5, alter: [1] } }), 'C major'),
    ).toThrow('pitch must be finite; received 91');
    expect(() => explainRoman(flatSix({ toneSpellings: ['', '', '', ''] }), 'C major')).toThrow(
      'note must be an object; received ""',
    );
  });

  it('by the tonicizing reading of an applied numeral, before the quality', () => {
    const applied = (quality: string) =>
      chord({
        rootPc: 2,
        quality,
        intervals: [0, 4, 7, 10],
        toneSpellings: [null, null, null, null],
      });
    expect(() => chordToRoman(applied('dom7'), 'C major', { applied: true })).toThrow(
      'note must be an object; received null',
    );
    expect(() => chordToRoman(applied('zz'), 'C major', { applied: true })).toThrow(
      'note must be an object; received null',
    );
    expect(() => analyzeChord(applied('dom7'), 'C major', { applied: true })).toThrow(
      'note must be an object; received null',
    );
    expect(chordToRoman(nullTones(), 'C major')).toBe('I');
  });
});

describe('an interval template is read the way its reading iterates it', () => {
  it('by the spec of a chord, where an entry that is no number leaves no structural reading', () => {
    expect(chordSpecOf(chord({ quality: 'min', intervals: [0, 3, null] })).omissions).toEqual([]);
    expect(chordSpecOf(chord({ intervals: [0, null, 7] })).base).toBe('maj');
    expect(chordSpecOf(chord({ quality: 'min', intervals: { length: 0 } })).base).toBe('min');
    expect(() => chordSpecOf(chord({ quality: 'zz', intervals: [0, 3, null] }))).toThrow(
      'Unknown chord quality: zz',
    );
    expect(() => chordSpecOf(chord({ intervals: true }))).toThrow(
      'boolean true is not iterable (cannot read property Symbol(Symbol.iterator))',
    );
    expect(() => chordSpecOf(chord({ intervals: {} }))).toThrow(
      'object is not iterable (cannot read property Symbol(Symbol.iterator))',
    );
  });

  it('by modulation detection, which asks each chord for a dominant seventh', () => {
    const segments = (intervals: unknown[], quality = 'maj') =>
      [
        { startBeat: 0, endBeat: 4, chord: chord({ quality, intervals }) },
        { startBeat: 4, endBeat: 8, chord: chord({ rootPc: 7 }) },
      ] as never;
    expect(() => detectModulations(segments([null, 4, 7]))).toThrow(
      'pitch must be finite; received null',
    );
    expect(() => detectModulations(segments([0, true, 7]))).toThrow(
      'pitch must be finite; received true',
    );
    expect(detectModulations(segments([0, 4, 10, null], 'dom7'))).toHaveLength(1);
  });
});
