import { describe, expect, it } from 'vitest';
import {
  Chord,
  chordTimelineFromChords,
  developMotif,
  generateBassLine,
  generateCounterMelody,
  generateMotif,
  generateProgression,
  harmonizeMelody,
  InvalidInputError,
  imitate,
  Key,
  majorKey,
  makeChord,
  modalInterchangePalette,
  negativeHarmonyMirror,
  parseChordSymbol,
  placeLicks,
  substituteChord,
  transformMotif,
} from '../src/index.js';

/**
 * The generate layer takes a key or a chord in whatever form the caller holds
 * it. Text is read by the same three coercers the layers below use, and the
 * reading happens once, at the entry point — so the strongest statement about a
 * generator is that the text form and the data form produce the same notes
 * under the same seed, down to the seeded draws.
 */

const KEY_TEXT = 'C major';
const KEY_DATA = majorKey(0);
const CTX = { seed: 7 };

describe('bass takes a key name and a chord symbol', () => {
  const spans = [
    { startBeat: 0, endBeat: 4 },
    { startBeat: 4, endBeat: 8 },
  ];
  const symbols = ['Cmaj7', 'G7'];

  it('generateBassLine writes the same line from either form', () => {
    const fromText = generateBassLine({
      segments: spans.map((span, index) => ({ ...span, chord: symbols[index] as string })),
      key: KEY_TEXT,
      style: 'walking',
      ctx: CTX,
    });
    const fromData = generateBassLine({
      segments: spans.map((span, index) => ({
        ...span,
        chord: parseChordSymbol(symbols[index] as string),
      })),
      key: KEY_DATA,
      style: 'walking',
      ctx: CTX,
    });
    expect(fromText).toEqual(fromData);
    expect(fromText.length).toBeGreaterThan(0);
  });

  it('placeLicks lays the same figures over either form', () => {
    const fromText = placeLicks(
      spans.map((span, index) => ({ ...span, chord: symbols[index] as string })),
      KEY_TEXT,
      { genre: 'motown', ctx: CTX },
    );
    const fromData = placeLicks(
      spans.map((span, index) => ({
        ...span,
        chord: parseChordSymbol(symbols[index] as string),
      })),
      KEY_DATA,
      { genre: 'motown', ctx: CTX },
    );
    expect(fromText).toEqual(fromData);
    expect(fromText.length).toBeGreaterThan(0);
  });
});

describe('countermelody takes a key name', () => {
  const melody = [0, 1, 2, 3].map((beat) => ({
    pitch: 72 + beat,
    startBeat: beat,
    durationBeat: 1,
  }));

  it('generateCounterMelody writes the same line from either form', () => {
    const chordAt = () => parseChordSymbol('C');
    const fromText = generateCounterMelody({ melody, chordAt, key: KEY_TEXT, ctx: CTX });
    const fromData = generateCounterMelody({ melody, chordAt, key: KEY_DATA, ctx: CTX });
    expect(fromText).toEqual(fromData);
    expect(fromText.length).toBeGreaterThan(0);
  });

  it('imitate answers the same way from either form', () => {
    const fromText = imitate(melody, {
      atBeat: 4,
      interval: 'P5',
      key: KEY_TEXT,
      answer: 'tonal',
    });
    const fromData = imitate(melody, {
      atBeat: 4,
      interval: 'P5',
      key: KEY_DATA,
      answer: 'tonal',
    });
    expect(fromText).toEqual(fromData);
    expect(fromText.length).toBe(melody.length);
  });
});

describe('harmonize takes a key name', () => {
  const melody = [60, 64, 67, 65, 64, 62, 60].map((pitch, index) => ({
    pitch,
    startBeat: index,
    durationBeat: 1,
  }));

  it('harmonizeMelody chooses the same chords from either form', () => {
    const fromText = harmonizeMelody({ melody, key: KEY_TEXT, ctx: CTX });
    const fromData = harmonizeMelody({ melody, key: KEY_DATA, ctx: CTX });
    expect(fromText).toEqual(fromData);
    expect(fromText.chords.length).toBeGreaterThan(0);
  });

  it("still reads 'infer' as the request to estimate the key", () => {
    // The sentinel names no key, so it must never reach the key coercer.
    const inferred = harmonizeMelody({ melody, key: 'infer', ctx: CTX });
    expect(inferred).toEqual(harmonizeMelody({ melody, ctx: CTX }));
  });
});

describe('motif takes a key name and a chord symbol', () => {
  it('generateMotif writes the same cell from either form', () => {
    const fromText = generateMotif({
      key: KEY_TEXT,
      chord: 'Cmaj7',
      bars: 2,
      jitter: 0.5,
      ctx: CTX,
    });
    const fromData = generateMotif({
      key: KEY_DATA,
      chord: parseChordSymbol('Cmaj7'),
      bars: 2,
      jitter: 0.5,
      ctx: CTX,
    });
    expect(fromText).toEqual(fromData);
    expect(fromText.notes.length).toBeGreaterThan(0);
  });

  it('transformMotif shifts by the same degrees from either form', () => {
    const cell = generateMotif({ key: KEY_DATA, bars: 1, ctx: CTX });
    expect(transformMotif(cell, 'sequence', 2, KEY_TEXT)).toEqual(
      transformMotif(cell, 'sequence', 2, KEY_DATA),
    );
    // A key left out still shifts chromatically, as it did before.
    expect(transformMotif(cell, 'transposeDiatonic', 1)).toEqual({
      notes: cell.notes.map((note) => ({ ...note, pitch: note.pitch + 1 })),
    });
  });

  it('developMotif snaps the same way from either form', () => {
    const cell = generateMotif({ key: KEY_DATA, bars: 1, ctx: CTX });
    const timeline = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 8);
    expect(developMotif(cell, timeline, KEY_TEXT, 2)).toEqual(
      developMotif(cell, timeline, KEY_DATA, 2),
    );
  });
});

describe('progression takes a key name', () => {
  it('generateProgression picks the same chords from either form', () => {
    const fromText = generateProgression({
      key: KEY_TEXT,
      style: 'dance',
      bars: 8,
      ctx: { seed: 3, complexity: { harmonic: 0.5 } },
    });
    const fromData = generateProgression({
      key: KEY_DATA,
      style: 'dance',
      bars: 8,
      ctx: { seed: 3, complexity: { harmonic: 0.5 } },
    });
    expect(fromText).toEqual(fromData);
    expect(fromText.length).toBe(8);
  });

  it('reads a key class through its toJSON', () => {
    // An instance is accepted for what it serializes to, not for its type.
    expect(generateProgression({ key: Key.major('C'), style: 'dance', bars: 4 })).toEqual(
      generateProgression({ key: KEY_DATA, style: 'dance', bars: 4 }),
    );
  });
});

describe('reharmony takes a chord symbol and a key name', () => {
  it('substituteChord proposes the same substitutions from either form', () => {
    expect(substituteChord('G7', KEY_TEXT)).toEqual(
      substituteChord(makeChord(7, 'dom7'), KEY_DATA),
    );
  });

  it('modalInterchangePalette returns the same palette from either form', () => {
    expect(modalInterchangePalette(KEY_TEXT)).toEqual(modalInterchangePalette(KEY_DATA));
  });

  it('negativeHarmonyMirror reflects the same chord from either form', () => {
    expect(negativeHarmonyMirror('G', KEY_TEXT)).toEqual(
      negativeHarmonyMirror(makeChord(7, 'maj'), KEY_DATA),
    );
  });

  it('reads the model classes through their toJSON', () => {
    expect(negativeHarmonyMirror(Chord.parse('G'), Key.major('C'))).toEqual(
      negativeHarmonyMirror(makeChord(7, 'maj'), KEY_DATA),
    );
  });
});

describe('a string that names nothing is rejected at the boundary', () => {
  it('refuses a key name no parser knows', () => {
    expect(() => generateProgression({ key: 'H flat sideways', style: 'dance', bars: 4 })).toThrow(
      InvalidInputError,
    );
    expect(() => modalInterchangePalette('not a key')).toThrow(InvalidInputError);
  });

  it('refuses a chord symbol no parser knows', () => {
    expect(() => negativeHarmonyMirror('Cmaj7(#', KEY_TEXT)).toThrow(InvalidInputError);
  });
});
