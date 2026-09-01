import { describe, expect, it } from 'vitest';
import { detectKeyBest } from '../src/analyze/detect/index.js';
import { detectCadence, pivotChords } from '../src/analyze/functional/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { noteToMidi, parseNote, transposeByInterval } from '../src/core/pitch/index.js';
import { edo, frequencyOf } from '../src/core/tuning/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { modalInterchangePalette, substituteChord } from '../src/generate/reharmony/index.js';
import {
  Chord,
  type ChordData,
  Interval,
  Key,
  Note,
  Progression,
  Timeline,
  Tuning,
} from '../src/model/index.js';
import {
  chordSpecOf,
  chordToneRole,
  isChordMember,
  spanFromChord,
} from '../src/theory/chord/index.js';
import { figuredBassOf } from '../src/theory/figured-bass/index.js';
import {
  majorKey,
  minorKey,
  NAMED_SCALES,
  nearestScaleTone,
  pitchToScaleDegree,
} from '../src/theory/scale/index.js';
import { transposeChordSymbol } from '../src/theory/symbol/index.js';
import { toWrittenPitch } from '../src/theory/transposition/index.js';
import { voiceProgression } from '../src/theory/voicing/index.js';

describe('Note', () => {
  it('parses, formats, and converts name -> pitch class -> MIDI', () => {
    const note = Note.parse('C4');
    expect(note.name).toBe('C4');
    expect(note.pitchClass).toBe(0);
    expect(note.midi).toBe(60);
    expect(note.letter).toBe(0);
    expect(note.alter).toBe(0);
    expect(note.octave).toBe(4);
  });

  it('names MIDI numbers with sharp or flat spelling', () => {
    expect(Note.fromMidi(61).name).toBe('C#4');
    expect(Note.fromMidi(61, 'flat').name).toBe('Db4');
  });

  it('wraps plain note data', () => {
    expect(Note.fromData({ letter: 6, alter: -1, octave: 3 }).name).toBe('Bb3');
  });

  it('builds from parts, by letter number or by bare letter name', () => {
    expect(Note.of(0, 0, 4).name).toBe('C4');
    expect(Note.of(6, -1, 3).name).toBe('Bb3');
    expect(Note.of('B', -1, 3).name).toBe('Bb3');
    expect(Note.of('F', 1, 4).equals(Note.parse('F#4'))).toBe(true);
    // Every letter name means the same letter number the parser reads it as.
    for (const [index, name] of ['C', 'D', 'E', 'F', 'G', 'A', 'B'].entries()) {
      expect(Note.of(name).letter, name).toBe(index);
    }
  });

  it('defaults the alteration to natural and leaves an omitted octave out', () => {
    const bare = Note.of('E');
    expect(bare.alter).toBe(0);
    expect(bare.octave).toBeUndefined();
    expect(bare.name).toBe('E');
    expect(bare.toJSON()).toEqual({ letter: 2, alter: 0 });
    expect(Note.of(4, 0).octave).toBeUndefined();
    expect(Note.of(4, 0, 5).octave).toBe(5);
  });

  it('refuses a name that has to be parsed, naming the parser that reads it', () => {
    // `of` takes parts; anything carrying an accidental or an octave is text,
    // and a caller reaching for it here needs to be sent to `parse`.
    for (const text of ['Bb', 'C#4', 'C4', 'gis', 'H', 'b', '']) {
      expect(() => Note.of(text), text).toThrow(InvalidInputError);
      expect(() => Note.of(text), text).toThrow(/Note\.parse/);
    }
    expect(() => Note.of('Bb')).toThrow(/Note\.parse\("Bb"\)/);
    expect(Note.parse('Bb').name).toBe('Bb');
    expect(Note.parse('C#4').name).toBe('C#4');
  });

  it('holds a letter number to the range plain data is held to', () => {
    expect(() => Note.of(7)).toThrow(/letter/);
    expect(() => Note.of(-1)).toThrow(/letter/);
    expect(() => Note.of(0, Number.NaN)).toThrow(RangeError);
  });

  it('rejects a letter outside 0..6 instead of accepting a name-equal mismatch', () => {
    // 7 and 0 both print as C and both report pitch class 0, but `equals`
    // compares letters directly, so an unreduced letter would be a note that
    // looks identical to C yet never equals it.
    expect(() => Note.fromData({ letter: 7, alter: 0, octave: 4 })).toThrow(RangeError);
    expect(() => new Note({ letter: -1, alter: 0 })).toThrow(/letter/);
    expect(() => new Note({ letter: 1.5, alter: 0 })).toThrow(/letter/);
    expect(() => new Note({ letter: 0, alter: Number.NaN })).toThrow(RangeError);
    expect(() => new Note({ letter: 0, alter: 7 })).toThrow(RangeError);
    expect(() => new Note({ letter: 0, alter: 0, octave: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
  });

  it('transposes up and down via MIDI when an octave is present', () => {
    expect(Note.parse('C4').transpose(7).name).toBe('G4');
    expect(Note.parse('G4').transpose(-7).name).toBe('C4');
    expect(Note.parse('B3').transpose(1).name).toBe('C4');
  });

  it('keeps an octave-less note octave-less when transposing', () => {
    const transposed = Note.parse('C').transpose(7);
    expect(transposed.name).toBe('G');
    expect(transposed.octave).toBeUndefined();
  });

  it('throws a clear error when asking an octave-less note for MIDI', () => {
    expect(() => Note.parse('C').midi).toThrow(/octave/);
  });

  it('measures spelled intervals', () => {
    expect(Note.parse('C4').intervalTo(Note.parse('G4')).toJSON()).toEqual({
      number: 5,
      quality: 'P',
      semitones: 7,
    });
    expect(Note.parse('C4').intervalTo(Note.parse('E4')).name).toBe('M3');
  });

  it('carries a zero-semitone descending interval through the class API', () => {
    const from = Note.parse('Fb4');
    const interval = from.intervalTo(Note.parse('E4'));
    expect(interval.toJSON()).toMatchObject({
      number: 2,
      quality: 'd',
      semitones: 0,
      descending: true,
    });
    expect(from.transposeBy(interval).name).toBe('E4');
  });

  it('compares by spelling', () => {
    expect(Note.parse('C#4').equals(Note.parse('C#4'))).toBe(true);
    expect(Note.parse('C#4').equals(Note.parse('Db4'))).toBe(false);
  });

  it('is immutable: transpose returns a new instance', () => {
    const original = Note.parse('C4');
    const transposed = original.transpose(2);
    expect(transposed).not.toBe(original);
    expect(original.name).toBe('C4');
  });

  it('transposes by zero as the identity, preserving the exact spelling', () => {
    // A naive MIDI round-trip would respell Eb4 as D#4; zero must keep Eb4.
    expect(Note.parse('Eb4').transpose(0).name).toBe('Eb4');
    expect(Note.parse('D#4').transpose(0).name).toBe('D#4');
    expect(Note.parse('Cb').transpose(0).name).toBe('Cb');
    const eb = Note.parse('Eb4');
    const same = eb.transpose(0);
    expect(same).not.toBe(eb);
    expect(same.equals(eb)).toBe(true);
  });

  it('serializes to plain note data instead of {}', () => {
    expect(Note.parse('Bb3').toJSON()).toEqual({ letter: 6, alter: -1, octave: 3 });
    // Round-trips through JSON back into an equal note.
    const restored = Note.fromData(JSON.parse(JSON.stringify(Note.parse('F#4'))));
    expect(restored.equals(Note.parse('F#4'))).toBe(true);
  });
});

describe('class API string conversion', () => {
  it('reads as itself in a template literal instead of [object Object]', () => {
    expect(`${Note.parse('Bb3')}`).toBe('Bb3');
    expect(`${Note.parse('C4').intervalTo(Note.parse('E4'))}`).toBe('M3');
    expect(`${Key.major('C')}`).toBe('C major');
    expect(`${Key.minor('A')}`).toBe('A minor');
    expect(`${Chord.parse('Cmaj7')}`).toBe('Cmaj7');
    const progression = new Progression([Chord.parse('C'), Chord.parse('Am'), Chord.parse('F')]);
    expect(`${progression}`).toBe('C Am F');
  });
});

describe('plain data round trips and collection access', () => {
  it('rebuilds every class from its own JSON', () => {
    const note = Note.parse('F#4');
    expect(Note.fromJSON(JSON.parse(JSON.stringify(note))).equals(note)).toBe(true);
    const chord = Chord.parse('Cmaj7');
    expect(Chord.fromJSON(JSON.parse(JSON.stringify(chord))).equals(chord)).toBe(true);
    expect(Chord.fromData(chord.toJSON()).equals(chord)).toBe(true);
    const key = Key.minor('A');
    expect(Key.fromJSON(JSON.parse(JSON.stringify(key))).equals(key)).toBe(true);
    const progression = new Progression([Chord.parse('C'), Chord.parse('G')], Key.major('C'));
    const restored = Progression.fromJSON(JSON.parse(JSON.stringify(progression)));
    expect(restored.equals(progression)).toBe(true);
    expect(restored.key?.equals(Key.major('C'))).toBe(true);
  });

  it('compares keys by tonic and mode, not by spelling', () => {
    expect(Key.major('C#').equals(Key.major('Db'))).toBe(true);
    expect(Key.major('C').equals(Key.minor('C'))).toBe(false);
    expect(Key.major('C').equals(Key.major('D'))).toBe(false);
  });

  it('indexes and iterates a progression without copying it each time', () => {
    const chords = [Chord.parse('C'), Chord.parse('Am'), Chord.parse('F')];
    const progression = new Progression(chords);
    expect(progression.at(0)?.symbol()).toBe('C');
    expect(progression.at(-1)?.symbol()).toBe('F');
    expect(progression.at(3)).toBeUndefined();
    expect([...progression].map((chord) => chord.symbol())).toEqual(['C', 'Am', 'F']);
    // The same array is handed out each time rather than a fresh copy.
    expect(progression.chords).toBe(progression.chords);
  });

  it('lifts generated chord spans into a progression', () => {
    const key = Key.major('C');
    const spans = generateProgression({ key: key.scale, style: 'dance', bars: 4 });
    const progression = Progression.fromSpans(spans, key);
    expect(progression.length).toBe(spans.length);
    expect(progression.at(0)?.rootPc).toBe(spans[0]?.rootPc);
    // The chords carry the key, so they answer analysis questions directly.
    expect(progression.roman().length).toBe(spans.length);
  });
});

describe('recognition through the class API', () => {
  it('keeps the match metadata a recognition UI needs', () => {
    const [best] = Chord.detectMatches([60, 64, 67]);
    expect(best?.chord.symbol()).toBe('C');
    expect(best?.match.exact).toBe(true);
    expect(best?.match.missingPcs).toEqual([]);
    expect(best?.match.extraPcs).toEqual([]);
    // A fifth-less voicing is still recognised, and says which tone is absent.
    const partial = Chord.detectMatches([60, 64, 71]).find((m) => m.chord.symbol() === 'Cmaj7');
    expect(partial?.match.exact).toBe(false);
    expect(partial?.match.missingPcs).toContain(7);
  });

  it('detects a key the way it detects a chord', () => {
    const cMajorScale = [0, 2, 4, 5, 7, 9, 11];
    expect(Key.detectBest(cMajorScale)?.toString()).toBe('C major');
    expect(Key.detect(cMajorScale).length).toBeGreaterThan(1);
    expect(Key.detectBest([])).toBe(null);
    expect(detectKeyBest(cMajorScale)?.mode).toBe('major');
    expect(detectKeyBest([])).toBe(null);
  });

  it('keeps key-detection scores and scale variants through the class API', () => {
    const [best] = Key.detectMatches([57, 59, 60, 62, 64, 65, 68]); // A harmonic minor
    expect(best).toMatchObject({ mode: 'minor', variant: 'harmonic', fit: 1 });
    expect(best?.key.toString()).toBe('A harmonic minor');
    expect(best?.key.variant).toBe('harmonic');
  });
});

describe('class API parity with functional analysis helpers', () => {
  it('passes applied-Roman options through chord and progression analysis', () => {
    const key = Key.major('C');
    const applied = Chord.parse('D7');
    const progression = new Progression([applied, Chord.parse('G7'), Chord.parse('C')], key);

    expect(applied.roman(key, { applied: true })).toBe('V7/V');
    expect(progression.roman(undefined, { applied: true })).toEqual(['V7/V', 'V7', 'I']);
    expect(progression.analyze(undefined, { applied: true }).chords[0]?.roman).toBe('V7/V');
  });

  it('chooses chord scales directly from a progression', () => {
    const progression = new Progression([
      Chord.parse('Cmaj7'),
      Chord.parse('Dm7'),
      Chord.parse('G7'),
    ]);
    const choices = progression.scales();
    expect(choices).toHaveLength(progression.length);
    expect(choices.map((choice) => choice.chord.rootPc)).toEqual([0, 2, 7]);
  });
});

describe('transposing without a string round trip', () => {
  it('keeps a slash bass and a custom interval set', () => {
    expect(Chord.parse('C/G').transpose(2).symbol()).toBe('D/A');
    // A symbol round trip has no way to express this chord, so a transpose that
    // went through text would either throw or lose the added tone.
    const custom = Chord.fromData({ rootPc: 0, quality: 'maj', intervals: [0, 4, 7, 14] });
    expect(custom.transpose(3).pitchClasses()).toEqual([3, 5, 7, 10]);
  });

  it('preserves explicit flat spelling while transposing chord symbols', () => {
    expect(Chord.parse('Bb7').transpose(0).symbol()).toBe('Bb7');
    expect(Chord.parse('Bb7').transpose(3).symbol()).toBe('Db7');
    expect(Chord.parse('Bb7').transpose(-2).symbol()).toBe('Ab7');
  });

  it('keeps model and function chord transposition on one spelling pipeline', () => {
    for (const symbol of ['C', 'Bb7', 'F#m7b5', 'Eb/G']) {
      for (const semitones of [-12, -5, 0, 3, 12]) {
        expect(Chord.parse(symbol).transpose(semitones).symbol(), `${symbol}/${semitones}`).toBe(
          transposeChordSymbol(symbol, semitones),
        );
      }
    }
  });

  it('carries the key, so the degree survives the transposition', () => {
    const chord = Key.major('C').chord(5); // G major, the dominant
    expect(chord.roman()).toBe('V');
    const moved = chord.transpose(2);
    expect(moved.symbol()).toBe('A');
    expect(moved.roman()).toBe('V');
  });

  it('moves the tonic of a key and keeps its mode', () => {
    expect(Key.major('C').transpose(2).toString()).toBe('D major');
    expect(Key.minor('A').transpose(3).toString()).toBe('C minor');
    expect(Key.major('C').transpose(2).scale.modeMask12).toBe(Key.major('C').scale.modeMask12);
    expect(Key.major('C#').transpose(0).toString()).toBe('C# major');
    expect(Key.major('F#').transpose(0).toString()).toBe('F# major');
  });

  it('moves every chord of a progression at once', () => {
    const progression = new Progression(
      [Chord.parse('C'), Chord.parse('Am'), Chord.parse('F'), Chord.parse('G')],
      Key.major('C'),
    );
    const moved = progression.transpose(5);
    expect(`${moved}`).toBe('F Dm Bb C');
    expect(moved.key?.toString()).toBe('F major');
  });

  it('passes its carried key to voiceProgression', () => {
    const key = Key.major('C');
    const progression = new Progression([key.chord(5), key.chord(1)], key);
    expect(progression.voice()).toEqual(
      voiceProgression(
        progression.chords.map((chord) => chord.data),
        { key: key.scale },
      ),
    );
  });

  it('preserves spelling across class identity transpositions', () => {
    for (const semitones of [-12, 0, 12]) {
      expect(Note.parse('C#').transpose(semitones).name).toBe('C#');
      expect(Key.major('C#').transpose(semitones).toString()).toBe('C# major');
      expect(Chord.parse('Bb7').transpose(semitones).symbol()).toBe('Bb7');
      expect(`${new Progression([Chord.parse('Bb7')], Key.major('Db')).transpose(semitones)}`).toBe(
        'Bb7',
      );
    }
  });
});

describe('Interval as a usable value', () => {
  it('parses a name and rejects one that is not an interval', () => {
    expect(Interval.parse('P5').semitones).toBe(7);
    expect(Interval.parse('m3').semitones).toBe(3);
    expect(Interval.parse('AA4').semitones).toBe(7);
    expect(Interval.parse('d7').semitones).toBe(9);
    expect(() => Interval.parse('X3')).toThrow(RangeError);
    expect(() => Interval.parse('P3')).toThrow(RangeError);
  });

  it('rejects components that do not describe one interval', () => {
    // A perfect fifth is seven semitones; any other span is a value no
    // measurement could produce, and reading it back gives a different name.
    expect(() => Interval.of(5, 'P', 8)).toThrow(RangeError);
    expect(Interval.of(5, 'P', -7).semitones).toBe(-7);
  });

  it('builds and double-inverts every valid simple diminished or augmented interval', () => {
    const intervals: Interval[] = [];
    for (let numberValue = 1; numberValue <= 8; numberValue += 1) {
      for (const quality of ['P', 'M', 'm', 'A', 'AA', 'd', 'dd'] as const) {
        try {
          intervals.push(Interval.parse(`${quality}${numberValue}`));
        } catch {
          // A quality can be invalid for a degree (for example M5); those are
          // rejected by the parser and are not interval values to invert.
        }
      }
    }
    for (const parsed of intervals) {
      // The augmented octave is the one interval whose inversion has no name:
      // its complement would be a diminished unison, and the letters do not
      // move in a unison, so the pitch module reads that relation as the
      // descending `-A1` instead. It is tested for its refusal below.
      if (parsed.number === 8 && parsed.quality.startsWith('A')) {
        continue;
      }
      const built = Interval.of(parsed.number, parsed.quality, parsed.semitones);
      expect(built.invert().invert().equals(built), parsed.name).toBe(true);
    }
    expect(Interval.parse('AA7').invert().name).toBe('dd2');
  });

  it('refuses to name the inversion of an augmented octave', () => {
    expect(() => Interval.parse('A8').invert()).toThrow(/unison cannot be diminished/);
    expect(() => Interval.parse('AA8').invert()).toThrow(RangeError);
    // The diminished octave still inverts: it is the augmented unison.
    expect(Interval.parse('d8').invert().name).toBe('A1');
  });

  it('inverts to the complement that completes the octave', () => {
    expect(Interval.parse('M3').invert().name).toBe('m6');
    expect(Interval.parse('m6').invert().name).toBe('M3');
    expect(Interval.parse('P5').invert().name).toBe('P4');
    expect(Interval.parse('A4').invert().name).toBe('d5');
    expect(Interval.parse('P1').invert().name).toBe('P8');
    // A compound interval reduces before inverting.
    expect(Interval.parse('M10').invert().name).toBe('m6');
  });

  it('classifies consonance and compares by spelling', () => {
    expect(Interval.parse('M3').isConsonant()).toBe(true);
    expect(Interval.parse('P4').isConsonant()).toBe(false);
    expect(Interval.parse('P4').isConsonant(false)).toBe(true);
    expect(Interval.parse('M2').isConsonant()).toBe(false);
    expect(Interval.parse('M3').equals(Interval.parse('M3'))).toBe(true);
    // Same distance, different interval: an augmented second is not a minor third.
    expect(Interval.parse('A2').semitones).toBe(Interval.parse('m3').semitones);
    expect(Interval.parse('A2').equals(Interval.parse('m3'))).toBe(false);
  });

  it('applies to a note by diatonic number, not by semitone count', () => {
    expect(Note.parse('C4').transposeBy(Interval.parse('A2')).name).toBe('D#4');
    expect(Note.parse('C4').transposeBy(Interval.parse('m3')).name).toBe('Eb4');
    expect(Note.parse('C4').transposeBy(Interval.parse('P5')).name).toBe('G4');
    expect(Note.parse('C4').transposeBy(Interval.of(3, 'M', -4)).name).toBe('Ab3');
    // An octave-less note stays octave-less.
    const bare = Note.parse('C').transposeBy(Interval.parse('P5'));
    expect(bare.name).toBe('G');
    expect(bare.octave).toBeUndefined();
  });

  it('round-trips through JSON', () => {
    const interval = Interval.parse('m7');
    expect(Interval.fromJSON(JSON.parse(JSON.stringify(interval))).equals(interval)).toBe(true);
  });
});

describe('Interval', () => {
  it('builds from two notes', () => {
    const third = Interval.between(Note.parse('C4'), Note.parse('E4'));
    expect(third.name).toBe('M3');
    expect(third.number).toBe(3);
    expect(third.quality).toBe('M');
    expect(third.semitones).toBe(4);
  });

  it('builds from explicit components', () => {
    const fifth = Interval.of(5, 'P', 7);
    expect(fifth.name).toBe('P5');
    expect(fifth.semitones).toBe(7);
  });

  it('serializes to plain interval data instead of {}', () => {
    expect(Interval.of(5, 'P', 7).toJSON()).toEqual({ number: 5, quality: 'P', semitones: 7 });
    expect(Interval.between(Note.parse('C4'), Note.parse('E4')).toJSON()).toEqual({
      number: 3,
      quality: 'M',
      semitones: 4,
    });
  });
});

describe('Key', () => {
  it('spells the major scale', () => {
    expect(Key.major('C').noteNames()).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect(Key.major('Eb').noteNames()).toEqual(['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D']);
  });

  it('spells the minor scale', () => {
    expect(Key.minor('A').noteNames()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(Key.minor('A').isMinor).toBe(true);
    expect(Key.major('C').isMinor).toBe(false);
  });

  it('synthesizes a spelled tonic from a numeric root', () => {
    expect(Key.major(0).tonic.name).toBe('C');
    expect(Key.minor(10).tonic.name).toBe('Bb');
  });

  it('spells a numeric root with the fewest accidentals (no double flats/sharps)', () => {
    // Pitch class 6 minor is F# minor (3 sharps), not Gb minor (which needs
    // Bbb and Ebb double flats).
    const sixMinor = Key.minor(6);
    expect(sixMinor.tonic.name).toBe('F#');
    expect(sixMinor.noteNames()).toEqual(['F#', 'G#', 'A', 'B', 'C#', 'D', 'E']);
    for (const note of sixMinor.notes()) {
      expect(Math.abs(note.alter)).toBeLessThanOrEqual(1);
    }
    // Pitch class 6 major is Gb major (Gb Ab Bb Cb Db Eb F), the flat side here.
    expect(Key.major(6).noteNames()).toEqual(['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F']);
    // Flat keys with a natural minimal spelling stay flat.
    expect(Key.minor(10).noteNames()).toEqual(['Bb', 'C', 'Db', 'Eb', 'F', 'Gb', 'Ab']);
  });

  it('serializes to plain key data instead of {}', () => {
    const key = Key.major('Eb');
    const json = key.toJSON();
    expect(json.tonic).toEqual({ letter: 2, alter: -1 });
    expect(json.scale).toEqual(key.scale);
    // Round-trips through Key.of back into the same spelled scale.
    const restored = Key.of(json.scale, Note.fromData(json.tonic));
    expect(restored.noteNames()).toEqual(key.noteNames());
  });

  it('supports named scales', () => {
    expect(Key.named('dorian', 'D').pitchClasses()).toEqual([2, 4, 5, 7, 9, 11, 0]);
  });

  it('wraps an existing KeyScale', () => {
    const key = Key.of({ rootPc: 7, modeMask12: 0b101010110101 });
    expect(key.rootPc).toBe(7);
    expect(key.tonic.name).toBe('G');
  });

  it('rejects an invalid mode mask instead of constructing a tonic-less key', () => {
    expect(() => Key.of({ rootPc: 0, modeMask12: 0 })).toThrow(/modeMask12/);
    expect(() => Key.of({ rootPc: 0, modeMask12: 0b10 })).toThrow(/must include its root/);
  });

  it('names the type of a tonic that is not the note this API takes', () => {
    // A spelled note from the pitch functions is plain data with no pitch class
    // of its own, so the mismatch message would otherwise read "tonic undefined
    // does not match ..." and name neither what arrived nor the way to convert it.
    const plain = parseNote('C');
    expect(() => Key.of(majorKey(0), plain as unknown as Note)).toThrow(InvalidInputError);
    expect(() => Key.of(majorKey(0), plain as unknown as Note)).toThrow(
      /tonic must be the class API's Note; received plain note data; wrap plain note data with Note.fromData/,
    );
    // `Key.of` synthesizes a tonic when none is given, so the constructor is
    // where a tonic that is present but unusable has to be named.
    for (const [label, value] of [
      ['undefined', undefined],
      ['null', null],
      ['a number', 60],
      ['an unrelated object', { name: 'C' }],
    ] as [string, unknown][]) {
      expect(() => new Key(majorKey(0), value as Note), label).toThrow(
        /tonic must be the class API's Note/,
      );
    }
    // The conversion the message names is the one that works.
    expect(Key.of(majorKey(0), Note.fromData(plain)).tonic.name).toBe('C');
  });

  it('tests scale membership for numbers and notes', () => {
    const cMajor = Key.major('C');
    expect(cMajor.contains(7)).toBe(true);
    expect(cMajor.contains(6)).toBe(false);
    expect(cMajor.contains(Note.parse('F#'))).toBe(false);
    expect(cMajor.contains(Note.parse('E4'))).toBe(true);
  });

  it('builds degree chords carrying the key context', () => {
    const cMajor = Key.major('C');
    expect(cMajor.chord(1).quality).toBe('maj');
    expect(cMajor.chord(7).quality).toBe('dim');
    expect(cMajor.chord(5, 'dom7').roman()).toBe('V7');
    expect(cMajor.diatonicTriad(6).quality).toBe('min');
    expect(cMajor.diatonicSeventh(2).quality).toBe('min7');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, 0, -1])(
    'validates every degree-chord overload for degree %s',
    (degree) => {
      const key = Key.major('C');
      expect(() => key.chord(degree)).toThrow(RangeError);
      expect(() => key.chord(degree, 'maj7')).toThrow(RangeError);
      expect(() => key.diatonicTriad(degree)).toThrow(RangeError);
      expect(() => key.diatonicSeventh(degree)).toThrow(RangeError);
    },
  );

  it('keeps the key spelling on degree and Roman-numeral chords', () => {
    expect(Key.major('Eb').chord(1).symbol()).toBe('Eb');
    expect(Key.major('Bb').diatonicTriad(4).symbol()).toBe('Eb');
    expect(Key.major('C').roman('V7/vi').symbol()).toBe('E7');
  });

  it('builds Roman-numeral chords carrying the key context', () => {
    const five = Key.major('C').roman('V7');
    expect(five.rootPc).toBe(7);
    expect(five.quality).toBe('dom7');
    expect(five.function()).toBe('dominant');
  });

  it('lists the pivots into another key, reading each chord in both', () => {
    const pivots = Key.major('C').pivotsTo('G major');
    expect(pivots.map((pivot) => `${pivot.romanFrom}=${pivot.romanTo}`)).toEqual([
      'I=IV',
      'iii=vi',
      'V=I',
      'vi=ii',
    ]);
    expect(pivots.map((pivot) => pivot.chord.symbol())).toEqual(['C', 'Em', 'G', 'Am']);
    expect(pivots.map((pivot) => [pivot.chord.rootPc, pivot.romanFrom, pivot.romanTo])).toEqual(
      pivotChords(majorKey(0), majorKey(7)).map((pivot) => [
        pivot.chord.rootPc,
        pivot.romanFrom,
        pivot.romanTo,
      ]),
    );
  });

  it('carries the key it pivots from into the chords it hands back', () => {
    const [first] = Key.major('C').pivotsTo(Key.major('G'));
    expect(first?.chord.key?.toString()).toBe('C major');
    expect(first?.chord.roman()).toBe('I');
  });

  it('offers nothing to pivot on when the scale stacks no triads', () => {
    expect(Key.named('wholeTone', 'C').pivotsTo('G major')).toEqual([]);
  });

  it('refuses a value that names no key', () => {
    expect(() => Key.major('C').pivotsTo({ alternatives: true } as never)).toThrow(
      /key must be a Key; received an object/,
    );
    expect(() => Key.major('C').pivotsTo('H sharp major')).toThrow(InvalidInputError);
  });
});

describe('Chord', () => {
  it('builds from a root and quality', () => {
    expect(Chord.of('C', 'maj').pitchClasses()).toEqual([0, 4, 7]);
    expect(Chord.of(9, 'min7').pitchClasses()).toEqual([0, 4, 7, 9]);
    expect(Chord.of('G', 'dom7', 11).bassPc).toBe(11);
  });

  it('preserves a string root spelling', () => {
    expect(Chord.of('Eb', 'maj').symbol()).toBe('Eb');
    expect(Chord.of('C#', 'min').symbol()).toBe('C#m');
  });

  it('supports the fluent degree-chord chain', () => {
    expect(Key.major('C').chord(5, 'dom7').pitchClasses()).toEqual([2, 5, 7, 11]);
  });

  it('voices a secondary dominant built from a Roman numeral', () => {
    const voicing = Key.major('C').roman('V7/V').voice();
    expect(voicing.length).toBe(4);
    for (const pitch of voicing) {
      expect(Number.isInteger(pitch)).toBe(true);
    }
    // Every voiced pitch belongs to D7.
    const d7 = new Set([2, 6, 9, 0]);
    for (const pitch of voicing) {
      expect(d7.has(((pitch % 12) + 12) % 12)).toBe(true);
    }
  });

  it('names Roman numerals with an explicit or carried key', () => {
    const cMajor = Key.major('C');
    expect(Chord.of(0, 'maj').roman(cMajor)).toBe('I');
    expect(Chord.of(0, 'maj').withKey(cMajor).roman()).toBe('I');
  });

  it('throws a clear error for analysis without any key', () => {
    expect(() => Chord.of(0, 'maj').roman()).toThrow(/key/);
    expect(() => Chord.of(0, 'maj').analyze()).toThrow(/key/);
    expect(() => Chord.of(0, 'maj').spell()).toThrow(/key/);
  });

  it('analyzes function and borrowing', () => {
    const cMajor = Key.major('C');
    expect(Chord.of(7, 'dom7').function(cMajor)).toBe('dominant');
    expect(Chord.of(5, 'min').isBorrowed(cMajor)).toBe(true);
    expect(Chord.of(5, 'min').borrowedSource(cMajor)).toBe('parallelMinor');
    const analysis = Chord.of(5, 'min').analyze(cMajor);
    expect(analysis.borrowed).toBe(true);
    expect(analysis.roman).toBe('iv');
  });

  it('inverts by chord-tone index, wrapping and keeping context', () => {
    const cMajor = Key.major('C');
    const tonic = cMajor.chord(1, 'maj');
    expect(tonic.invert(1).bassPc).toBe(4);
    expect(tonic.invert(2).bassPc).toBe(7);
    // invert(3) wraps to index 0 = root position, so it carries no slash bass.
    expect(tonic.invert(3).bassPc).toBeUndefined();
    expect(tonic.invert(1).roman()).toBe('I6');
  });

  it('derives each inversion bass from the chord letter sequence', () => {
    const bbMinor = Chord.parse('Bbm');
    expect(bbMinor.invert(1).symbol()).toBe('Bbm/Db');
    expect(bbMinor.invert(2).symbol()).toBe('Bbm/F');
    expect(bbMinor.invert(3).symbol()).toBe('Bbm');

    // The augmented fifth of G# is D##, not its enharmonic E.
    expect(Chord.parse('G#aug').invert(2).symbol()).toBe('G#aug/D##');
  });

  it('round-trips every inversion without changing pitch classes or spellings', () => {
    const source = Chord.parse('Bbm7');
    for (let inversion = 0; inversion < source.intervals.length; inversion += 1) {
      const transformed = source.invert(inversion);
      const reparsed = Chord.parse(transformed.symbol());
      expect(reparsed.pitchClasses()).toEqual(source.pitchClasses());
      expect(reparsed.symbol()).toBe(transformed.symbol());
    }
  });

  it('treats invert(0) as root position: no bass, equal to the original', () => {
    const c = Chord.of('C', 'maj');
    const rooted = c.invert(0);
    expect(rooted.bassPc).toBeUndefined();
    expect(rooted.equals(c)).toBe(true);
    // A root-position chord serializes without a spurious bassPc.
    expect(rooted.toJSON()).toEqual({
      rootPc: 0,
      quality: 'maj',
      intervals: [0, 4, 7],
      rootSpelling: { letter: 0, alter: 0 },
    });
    expect('bassPc' in rooted.toJSON()).toBe(false);
    // Inverting a slash chord back to index 0 also clears the bass.
    const slash = Chord.of('C', 'maj', 4);
    expect(slash.invert(0).bassPc).toBeUndefined();
  });

  it('lists chord scales, tensions, and avoid notes', () => {
    const cMaj7 = Chord.of('C', 'maj7');
    const names = cMaj7.scales().map((match) => match.name);
    expect(names).toContain('ionian');
    expect(names).toContain('lydian');
    expect(cMaj7.tensions('lydian')).toEqual([2, 6, 9]);
    expect(cMaj7.avoidNotes('major')).toEqual([5]);
    expect(cMaj7.tensions('major')).toEqual([2, 9]);
  });

  it('detects chords from pitches', () => {
    const best = Chord.detectBest([60, 64, 67]);
    expect(best).not.toBeNull();
    expect(best?.rootPc).toBe(0);
    expect(best?.quality).toBe('maj');
    const matches = Chord.detect([60, 64, 67]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.equals(Chord.of(0, 'maj'))).toBe(true);
  });

  it('spells chord tones in a key', () => {
    const names = Chord.of(7, 'dom7')
      .spell(Key.major('C'))
      .map((note) => note.name);
    expect(names).toEqual(['G', 'B', 'D', 'F']);
  });

  it('compares by data and serializes to plain data', () => {
    expect(Chord.of(0, 'maj').equals(Chord.of(0, 'maj').withKey(Key.major('C')))).toBe(true);
    expect(Chord.of(0, 'maj').equals(Chord.of(0, 'min'))).toBe(false);
    expect(Chord.of(0, 'maj').toJSON()).toEqual({
      rootPc: 0,
      quality: 'maj',
      intervals: [0, 4, 7],
    });
  });

  it('is immutable: withKey and invert return new instances', () => {
    const original = Chord.of(0, 'maj');
    const withKey = original.withKey(Key.major('C'));
    expect(withKey).not.toBe(original);
    expect(original.key).toBeUndefined();
    const inverted = original.invert(1);
    expect(inverted).not.toBe(original);
    expect(original.bassPc).toBeUndefined();
    // Mutating exposed copies never affects the chord.
    original.intervals.push(99);
    expect(original.intervals).toEqual([0, 4, 7]);
  });
});

describe('Chord members over the chord functions', () => {
  const cMajor = Key.major('C');

  it('answers membership and chord-tone role as the functions do', () => {
    const chord = Chord.parse('Cmaj7/E');
    for (const pitch of [59, 60, 62, 64, 66, 67, 71, 73]) {
      expect(chord.contains(pitch), `${pitch}`).toBe(isChordMember(pitch, chord.data));
      expect(chord.roleOf(pitch), `${pitch}`).toBe(chordToneRole(pitch, chord.data));
    }
    // The two disagree about a tension, which is what makes them separate reads:
    // a ninth belongs to no basic role while still not being a chord tone.
    expect(chord.contains(62)).toBe(false);
    expect(chord.roleOf(62)).toBeNull();
    expect(chord.contains(64)).toBe(true);
    expect(chord.roleOf(64)).toBe('third');
  });

  it('reads its structure and places itself on a beat as the functions do', () => {
    const chord = Chord.parse('Cmaj7/E');
    expect(chord.spec).toEqual(chordSpecOf(chord.data));
    expect(chord.span(4)).toEqual(spanFromChord(chord.data, 4));
    // A template no quality names travels through both the same way.
    const custom = Chord.fromData({ rootPc: 0, quality: 'maj', intervals: [0, 4, 7, 14] });
    expect(custom.spec).toEqual(chordSpecOf(custom.data));
    expect(custom.span(0)).toEqual(spanFromChord(custom.data, 0));
    expect(() => chord.span(Number.NaN)).toThrow(RangeError);
  });

  it('figures a bass, substitutes, and borrows as the functions do', () => {
    const chord = Chord.parse('G7/D').withKey(cMajor);
    expect(chord.figuredBass()).toBe(figuredBassOf(chord.data, cMajor.scale));
    expect(chord.substitutions()).toEqual(substituteChord(chord.data, cMajor.scale));
    expect(chord.modalInterchange()).toEqual(modalInterchangePalette(cMajor.scale));
  });

  it('passes the melody constraint through to substituteChord', () => {
    const chord = Chord.parse('G7').withKey(cMajor);
    const opts = { melodyPcs: [2] };
    expect(chord.substitutions(undefined, opts)).toEqual(
      substituteChord(chord.data, cMajor.scale, opts),
    );
    // The constraint is doing something: it turns candidates away.
    expect(chord.substitutions(undefined, opts).length).toBeLessThan(chord.substitutions().length);
  });

  it('reads a key in every shape the coercion accepts', () => {
    const chord = Chord.parse('G7/D');
    const figures = figuredBassOf(chord.data, majorKey(0));
    expect(chord.figuredBass('C major')).toBe(figures);
    expect(chord.figuredBass(majorKey(0))).toBe(figures);
    expect(chord.figuredBass(cMajor)).toBe(figures);
    expect(chord.substitutions('C major')).toEqual(substituteChord(chord.data, majorKey(0)));
    expect(chord.modalInterchange('C major')).toEqual(modalInterchangePalette(majorKey(0)));
  });

  it('lets an explicit key win over the carried context', () => {
    const chord = Chord.parse('G7').withKey(cMajor);
    expect(chord.modalInterchange(Key.minor('A'))).toEqual(modalInterchangePalette(minorKey(9)));
    expect(chord.modalInterchange(Key.minor('A'))).not.toEqual(chord.modalInterchange());
    expect(chord.substitutions('F major')).toEqual(substituteChord(chord.data, majorKey(5)));
    expect(chord.figuredBass('Eb major')).toBe(figuredBassOf(chord.data, majorKey(3)));
  });

  it('throws a clear error when no key is given and none is carried', () => {
    const keyless = Chord.parse('G7/D');
    expect(() => keyless.figuredBass()).toThrow(/key/);
    expect(() => keyless.substitutions()).toThrow(/key/);
    expect(() => keyless.modalInterchange()).toThrow(/key/);
  });
});

describe('Note members over the tuning, transposition, and scale functions', () => {
  it('reports a frequency under the default and a given temperament', () => {
    expect(Note.parse('A4').frequency()).toBe(frequencyOf(69));
    expect(Note.parse('C4').frequency()).toBe(frequencyOf(60));
    const et19 = edo(19);
    expect(Note.parse('C4').frequency(et19)).toBe(frequencyOf(60, et19));
    expect(Note.parse('C4').frequency(et19)).not.toBe(Note.parse('C4').frequency());
    // A Tuning carries the three fields a table does, so an instance is a table.
    expect(Note.parse('C4').frequency(Tuning.edo(19))).toBe(frequencyOf(60, et19));
    expect(() => Note.parse('C').frequency()).toThrow(/octave/);
  });

  it('writes a part for a transposing instrument the way a key does', () => {
    for (const instrument of ['clarinetBb', 'clarinetA', 'altoSax', 'hornF', 'piccolo'] as const) {
      const note = Note.parse('C4');
      expect(note.forInstrument(instrument).data, instrument).toEqual(
        toWrittenPitch(note.data, instrument),
      );
      // The note and the key of its part agree on the direction.
      expect(note.forInstrument(instrument).pitchClass, instrument).toBe(
        Key.major('C').forInstrument(instrument).tonic.pitchClass,
      );
    }
  });

  it('respells onto the letter above and the letter below', () => {
    const up = { number: 2, quality: 'd', semitones: 0 } as const;
    const down = { number: 2, quality: 'd', semitones: 0, descending: true } as const;
    const note = Note.parse('C#4');
    expect(note.enharmonic().map((other) => other.data)).toEqual([
      transposeByInterval(note.data, up),
      transposeByInterval(note.data, down),
    ]);
    // Every spelling sounds the pitch it was made from.
    for (const other of note.enharmonic()) {
      expect(other.midi, other.name).toBe(note.midi);
      expect(other.equals(note)).toBe(false);
    }
    // The letter above Cb would need a triple flat, so only one spelling is left.
    expect(
      Note.parse('Cb4')
        .enharmonic()
        .map((other) => other.name),
    ).toEqual(['B3']);
    // An octave-less note stays octave-less.
    expect(
      Note.parse('F#')
        .enharmonic()
        .map((other) => other.name),
    ).toEqual(['Gb', 'E##']);
  });

  it('places a note in another octave without respelling it', () => {
    expect(Note.parse('Cb4').withOctave(3).data).toEqual({ letter: 0, alter: -1, octave: 3 });
    expect(Note.parse('C#').withOctave(4).midi).toBe(61);
    expect(Note.parse('Eb5').withOctave(3).name).toBe('Eb3');
    // The same range plain note data is held to.
    expect(() => Note.parse('C4').withOctave(1.5)).toThrow(RangeError);
    expect(() => Note.parse('C4').withOctave(Number.NaN)).toThrow(RangeError);
  });

  it('orders by sounding pitch, leaving an enharmonic pair as it found it', () => {
    const notes = [Note.parse('G4'), Note.parse('Db4'), Note.parse('C4'), Note.parse('C#4')];
    const sorted = [...notes].sort((a, b) => a.compareTo(b));
    expect(sorted.map((note) => note.name)).toEqual(['C4', 'Db4', 'C#4', 'G4']);
    // Enharmonics sound the same pitch, so they compare equal while the
    // spelling comparison keeps them apart.
    expect(Note.parse('C#4').compareTo(Note.parse('Db4'))).toBe(0);
    expect(Note.parse('C#4').equals(Note.parse('Db4'))).toBe(false);
    // The sign is the sign of the MIDI distance the pitch module measures.
    for (const [a, b] of [
      ['B3', 'C4'],
      ['C4', 'B3'],
      ['C4', 'C4'],
      ['G4', 'C4'],
    ] as const) {
      expect(Math.sign(Note.parse(a).compareTo(Note.parse(b))), `${a}/${b}`).toBe(
        Math.sign(noteToMidi(parseNote(a)) - noteToMidi(parseNote(b))),
      );
    }
    // Octave-less notes are ordered by pitch class among themselves.
    expect(
      [Note.parse('G'), Note.parse('C'), Note.parse('E')]
        .sort((a, b) => a.compareTo(b))
        .map((note) => note.name),
    ).toEqual(['C', 'E', 'G']);
  });

  it('reads a scale degree as the scale function does, with null for a miss', () => {
    for (const name of ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'F#4', 'Ab4', 'B#4']) {
      const note = Note.parse(name);
      const degree = pitchToScaleDegree(note.pitchClass, majorKey(0));
      expect(note.degreeIn('C major'), name).toBe(degree === -1 ? null : degree);
    }
    expect(Note.parse('E4').degreeIn(majorKey(0))).toBe(3);
    expect(Note.parse('E4').degreeIn(Key.major('C'))).toBe(3);
    expect(Note.parse('F#4').degreeIn('C major')).toBeNull();
    // The degree follows the sounding pitch, not the letter.
    expect(Note.parse('B#4').degreeIn('C major')).toBe(1);
  });
});

describe('Progression', () => {
  it('flows key context from Key-produced chords through progressionTo', () => {
    const result = Key.major('C')
      .chord(1, 'maj')
      .progressionTo(Key.major('C').chord(8, 'dom7'))
      .analyze();
    expect(result.chords).toHaveLength(2);
    expect(result).toHaveProperty('cadence');
  });

  it('analyzes a ii-V-I with an authentic cadence', () => {
    const cMajor = Key.major('C');
    const prog = cMajor
      .chord(2, 'min7')
      .progressionTo(cMajor.chord(5, 'dom7'), cMajor.chord(1, 'maj'));
    expect(prog.length).toBe(3);
    expect(prog.roman()).toEqual(['ii7', 'V7', 'I']);
    expect(prog.functions()).toEqual(['subdominant', 'dominant', 'tonic']);
    expect(prog.analyze().cadence).toMatchObject({ type: 'authentic', strength: null });
  });

  it('yields no cadence for fewer than two chords', () => {
    const single = new Progression([Chord.of(0, 'maj')], Key.major('C'));
    expect(single.analyze().cadence).toBeNull();
  });

  it('voices with smooth voice leading', () => {
    const cMajor = Key.major('C');
    const voicings = cMajor
      .chord(2, 'min7')
      .progressionTo(cMajor.chord(5, 'dom7'), cMajor.chord(1, 'maj'))
      .voice();
    expect(voicings).toHaveLength(3);
    for (const voicing of voicings) {
      expect(voicing).toHaveLength(4);
      for (let i = 1; i < voicing.length; i += 1) {
        expect(voicing[i] ?? 0).toBeGreaterThanOrEqual(voicing[i - 1] ?? 0);
      }
    }
    // Consecutive voicings should move each voice only a short distance.
    for (let i = 1; i < voicings.length; i += 1) {
      const prev = voicings[i - 1] ?? [];
      const cur = voicings[i] ?? [];
      let motion = 0;
      for (let v = 0; v < cur.length; v += 1) {
        motion += Math.abs((cur[v] ?? 0) - (prev[v] ?? 0));
      }
      // Smooth, but not at any price: resolving the seventh downward can cost a
      // few semitones more than the nearest-neighbour voicing would.
      expect(motion).toBeLessThanOrEqual(16);
    }
  });

  it('throws a clear error for analysis without any key', () => {
    const keyless = Chord.of(0, 'maj').progressionTo(Chord.of(7, 'dom7'));
    expect(() => keyless.analyze()).toThrow(/key/);
    // Motion onto the dominant is a half cadence.
    expect(keyless.withKey(Key.major('C')).analyze().cadence).toMatchObject({ type: 'half' });
  });

  it('is immutable: add returns a new progression', () => {
    const cMajor = Key.major('C');
    const prog = new Progression([cMajor.chord(1)], cMajor);
    const longer = prog.add(cMajor.chord(5, 'dom7'));
    expect(longer).not.toBe(prog);
    expect(prog.length).toBe(1);
    expect(longer.length).toBe(2);
    expect(longer.chords[1]?.quality).toBe('dom7');
  });

  it('serializes to plain progression data instead of {}', () => {
    const cMajor = Key.major('C');
    const prog = cMajor.chord(1, 'maj').progressionTo(cMajor.chord(5, 'dom7'));
    const json = prog.toJSON();
    expect(json.chords).toEqual([
      {
        rootPc: 0,
        quality: 'maj',
        intervals: [0, 4, 7],
      },
      {
        rootPc: 7,
        quality: 'dom7',
        intervals: [0, 4, 7, 10],
      },
    ]);
    expect(json.key?.tonic).toEqual({ letter: 0, alter: 0 });
    // A keyless progression serializes its chords with an undefined key.
    const keyless = new Progression([Chord.of(0, 'maj')]);
    expect(keyless.toJSON().key).toBeUndefined();
  });

  it('attaches the progression key consistently across every construction path', () => {
    const key = Key.major('Eb');
    const bare = Chord.of(8, 'maj');
    const fromConstructor = new Progression([bare], key);
    const fromWithKey = new Progression([bare]).withKey(key);
    const fromSpans = Progression.fromSpans([{ startBeat: 0, rootPc: 8, quality: 'maj' }], key);
    const fromTranspose = new Progression([Chord.of(6, 'maj')], Key.major('Db')).transpose(2);

    for (const progression of [fromConstructor, fromWithKey, fromSpans, fromTranspose]) {
      expect(progression.chords[0]?.key?.equals(progression.key as Key)).toBe(true);
      expect(progression.chords[0]?.symbol()).toBe('Ab');
      expect(progression.chords[0]?.spell().map((note) => note.name)).toEqual(['Ab', 'C', 'Eb']);
    }
  });

  it('re-keys chords that already carry a key, whatever key they carried', () => {
    const dbMajor = Key.major('Db');
    const progression = new Progression([dbMajor.chord(1), dbMajor.chord(4)], dbMajor);
    expect(`${progression}`).toBe('Db Gb');

    const resharped = progression.withKey(Key.major('C#'));
    for (const chord of resharped) {
      expect(chord.key?.equals(Key.major('C#'))).toBe(true);
    }
    expect(`${resharped}`).toBe('C# F#');
    expect(resharped.chords[1]?.spell().map((note) => note.name)).toEqual(['F#', 'A#', 'C#']);

    // Neither the key the chords arrived with nor the number of re-keys shows.
    expect(`${progression.withKey(Key.major('E')).withKey(Key.major('C#'))}`).toBe(`${resharped}`);
    expect(`${new Progression([Chord.of(1, 'maj'), Chord.of(6, 'maj')], Key.major('C#'))}`).toBe(
      `${resharped}`,
    );
  });

  it('keeps a caller-supplied chord spelling through a progression re-key', () => {
    // The chord's own hint outranks the progression key, so only the chord that
    // was left to the key follows the modulation.
    const progression = new Progression(
      [Chord.parse('Db'), Chord.of(6, 'maj')],
      Key.major('Db'),
    ).withKey(Key.major('C#'));
    expect(`${progression}`).toBe('Db F#');
  });

  it('re-keys the members when a chord that carries its own key is appended', () => {
    const progression = new Progression([Chord.of(1, 'maj')], Key.major('C#')).add(
      Chord.of(6, 'maj').withKey(Key.major('Db')),
    );
    expect(progression.chords[1]?.key?.equals(Key.major('C#'))).toBe(true);
    expect(`${progression}`).toBe('C# F#');
  });

  it('uses an explicit spelling key and preserves only caller spelling hints through JSON', () => {
    const chord = Chord.of(6, 'dim7').withKey(Key.major('Db'));
    expect(chord.spell(Key.major('D')).map((note) => note.name)).toEqual(['F#', 'A', 'C', 'Eb']);

    const restored = Chord.fromJSON(
      JSON.parse(JSON.stringify(Chord.of(6, 'maj').withKey(Key.major('G')))),
    );
    expect(restored.withKey(Key.major('Db')).symbol()).toBe('Gb');
    expect(
      restored
        .withKey(Key.major('Db'))
        .spell()
        .map((note) => note.name),
    ).toEqual(['Gb', 'Bb', 'Db']);
  });
});

describe('Chord letter-name spelling and plain-data construction', () => {
  it('spells its tones using the carried key context', () => {
    const g7 = Key.major('C').chord(5, 'dom7');
    expect(g7.spell().map((note) => note.name)).toEqual(['G', 'B', 'D', 'F']);
  });

  it('wraps a plain chord object with Chord.fromData', () => {
    const chord = Chord.fromData({ rootPc: 0, quality: 'maj', intervals: [0, 4, 7] });
    expect(chord.pitchClasses()).toEqual([0, 4, 7]);
    expect(chord.key).toBeUndefined();
  });

  it('round-trips plain chord data through both rebuild factories', () => {
    // `fromData` takes what `.data` hands out and `fromJSON` what a serialized
    // chord carries; the two are the only way back in, so both must return the
    // chord the data came from.
    const original = Chord.parse('Ebmaj7/Bb');
    const fromData = Chord.fromData(original.data);
    const fromJSON = Chord.fromJSON(JSON.parse(JSON.stringify(original)) as ChordData);
    expect(fromData.data).toEqual(original.data);
    expect(fromJSON.data).toEqual(original.toJSON());
    expect(fromData.equals(original)).toBe(true);
    expect(fromJSON.equals(original)).toBe(true);
    expect(fromData.symbol()).toBe('Ebmaj7/Bb');
    expect(fromJSON.symbol()).toBe('Ebmaj7/Bb');
  });

  it('exposes Key.spell as an alias of the spelled scale', () => {
    expect(
      Key.major('C')
        .spell()
        .map((note) => note.name),
    ).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });

  it('exposes the carried key on a progression', () => {
    const key = Key.minor('A');
    const prog = new Progression([key.chord(1)], key);
    expect(prog.key?.isMinor).toBe(true);
  });

  it('refuses to invert a chord with no intervals', () => {
    const empty = Chord.fromData({ rootPc: 0, quality: 'maj', intervals: [] });
    expect(() => empty.invert(0)).toThrow(/invert/);
  });
});

describe('Chord symbols, styled voicings, and negative harmony', () => {
  it('round-trips a chord symbol through Chord.parse and symbol()', () => {
    const chord = Chord.parse('F#m7b5');
    expect(chord.rootPc).toBe(6);
    expect(chord.quality).toBe('m7b5');
    expect(chord.symbol()).toBe('F#m7b5');
  });

  it('parses a slash chord and formats it back', () => {
    const chord = Chord.parse('C/G');
    expect(chord.bassPc).toBe(7);
    expect(chord.symbol()).toBe('C/G');
  });

  it('renders a styled voicing as ascending MIDI pitches', () => {
    const voicing = Chord.of('C', 'maj7').styledVoicing({ style: 'shell' });
    for (let i = 1; i < voicing.length; i += 1) {
      expect(voicing[i] ?? 0).toBeGreaterThan(voicing[i - 1] ?? 0);
    }
  });

  it('mirrors a dominant into its negative-harmony counterpart', () => {
    // In C major the axis reflects each pitch class p -> (7 - p) mod 12, turning
    // G7 into the {C, D, F, Ab} subdominant-function collection, and the result
    // carries no spurious slash bass.
    const g7 = Key.major('C').chord(5, 'dom7');
    const mirrored = g7.negativeHarmony();
    const expected = new Set(g7.pitchClasses().map((pc) => (((7 - pc) % 12) + 12) % 12));
    expect(new Set(mirrored.pitchClasses())).toEqual(expected);
    expect(mirrored.bassPc).toBeUndefined();
  });

  it('retains an explicit negative-harmony key so a later no-arg analysis works', () => {
    const cMajor = Key.major('C');
    // The source chord carries no key context of its own.
    const g7 = Chord.of(7, 'dom7');
    const mirrored = g7.negativeHarmony(cMajor);
    expect(mirrored.key).toBeDefined();
    expect(() => mirrored.analyze()).not.toThrow();
    const analysis = mirrored.analyze();
    expect(analysis.function).toBe('subdominant');
  });

  it('round-trips a flat-spelled chord symbol through the class API', () => {
    // The parse-time spelling hint survives the immutable copy, so the flat
    // name is reproduced instead of being respelled with sharps.
    expect(Chord.parse('Bbmaj7').symbol()).toBe('Bbmaj7');
    expect(Chord.parse('Ebm7').symbol()).toBe('Ebm7');
    expect(Chord.parse('Ab/C').symbol()).toBe('Ab/C');
    // An explicit preference still overrides the hint.
    expect(Chord.parse('Bbmaj7').symbol({ flats: false })).toBe('A#maj7');
  });
});

describe('Progression and Key closure over the functional core', () => {
  const key = Key.major('C');
  const progression = new Progression(
    [Chord.parse('C'), Chord.parse('Am'), Chord.parse('F'), Chord.parse('G7')],
    key,
  );

  it('maps to a progression carrying the same key and leaves the original alone', () => {
    const mapped = progression.map((chord) => chord.transpose(2));
    expect(mapped).toBeInstanceOf(Progression);
    expect(mapped.key?.equals(key)).toBe(true);
    expect(mapped.chords.map((chord) => chord.symbol())).toEqual(
      progression.chords.map((chord) => chord.transpose(2).symbol()),
    );
    expect(progression.toString()).toBe('C Am F G7');
    expect(progression.length).toBe(4);
  });

  it('filters to a progression carrying the same key and leaves the original alone', () => {
    const majors = progression.filter((chord) => chord.quality === 'maj');
    expect(majors).toBeInstanceOf(Progression);
    expect(majors.key?.equals(key)).toBe(true);
    expect(majors.chords.map((chord) => chord.symbol())).toEqual(
      progression.chords.filter((chord) => chord.quality === 'maj').map((chord) => chord.symbol()),
    );
    expect(majors.length).toBe(2);
    expect(progression.length).toBe(4);
  });

  it('hands map and filter the index alongside the chord', () => {
    const seen: number[] = [];
    progression.map((chord, index) => {
      seen.push(index);
      return chord;
    });
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(progression.filter((_chord, index) => index % 2 === 0).toString()).toBe('C F');
  });

  it('slices to a progression carrying the same key and leaves the original alone', () => {
    const middle = progression.slice(1, 3);
    expect(middle).toBeInstanceOf(Progression);
    expect(middle.key?.equals(key)).toBe(true);
    expect(middle.chords.map((chord) => chord.symbol())).toEqual(
      progression.chords.slice(1, 3).map((chord) => chord.symbol()),
    );
    expect(progression.slice(-2).toString()).toBe('F G7');
    expect(progression.slice().toString()).toBe(progression.toString());
    expect(progression.length).toBe(4);
  });

  it('concatenates a progression and a bare chord array alike', () => {
    const tail = [Chord.parse('C')];
    const joined = progression.concat(tail);
    expect(joined).toBeInstanceOf(Progression);
    expect(joined.key?.equals(key)).toBe(true);
    expect(joined.toString()).toBe('C Am F G7 C');
    // The two argument forms describe the same run of chords, so they answer alike.
    expect(progression.concat(new Progression(tail)).equals(joined)).toBe(true);
    // A key the other progression carried is not the one the result is read in.
    expect(progression.concat(new Progression(tail, Key.major('F'))).key?.equals(key)).toBe(true);
    expect(progression.length).toBe(4);
  });

  it('finds a chord built separately but equal, rather than one by identity', () => {
    // Neither chord below is any of the progression's own objects.
    expect(progression.indexOf(Chord.of('A', 'min'))).toBe(1);
    expect(progression.indexOf(Chord.of('G', 'dom7'))).toBe(3);
    expect(progression.indexOf(Chord.parse('Eb'))).toBe(-1);
    const mine = progression.chords[1];
    expect(mine === undefined ? -1 : progression.indexOf(mine)).toBe(1);
  });

  it('classifies every chord change the way detectCadence does', () => {
    const chords = progression.chords;
    const expected = chords.slice(1).map((to, index) => {
      const from = chords[index];
      const approach = chords[index - 1];
      return detectCadence(
        from?.data as ChordData,
        to.data,
        key.scale,
        approach === undefined ? {} : { approach: approach.data },
      );
    });
    expect(progression.cadences()).toEqual(expected);
    expect(progression.cadences().length).toBe(progression.length - 1);
    expect(progression.cadences().map((cadence) => cadence.type)).toEqual([null, null, 'half']);
    // Nothing changes in a single chord, so there is no pair to classify.
    expect(new Progression([Chord.parse('C')], key).cadences()).toEqual([]);
    expect(() => new Progression([Chord.parse('C'), Chord.parse('G')]).cadences()).toThrow(
      InvalidInputError,
    );
  });

  it('reaches every option detectCadence accepts, pair by pair', () => {
    const voiced = progression.voice();
    const chords = progression.chords;
    const found = progression.cadences(undefined, { voicing: voiced, alternatives: true });
    expect(found[2]).toEqual(
      detectCadence(chords[2]?.data as ChordData, chords[3]?.data as ChordData, key.scale, {
        alternatives: true,
        approach: chords[1]?.data,
        voicing: [voiced[2] ?? [], voiced[3] ?? []],
      }),
    );
    // The first pair has no predecessor of its own, so `approach` supplies one.
    const before = Chord.parse('G');
    expect(progression.cadences(undefined, { approach: before })[0]).toEqual(
      detectCadence(chords[0]?.data as ChordData, chords[1]?.data as ChordData, key.scale, {
        approach: before.data,
      }),
    );
  });

  it('substitutes the chord substituteChord proposes for that relationship', () => {
    const dominant = new Progression([Chord.parse('G7'), Chord.parse('C')], key);
    const expected = substituteChord(Chord.parse('G7').data, key.scale).find(
      (candidate) => candidate.type === 'tritone',
    );
    const substituted = dominant.substitute(0, 'tritone');
    expect(substituted.at(0)?.toJSON()).toEqual(expected?.chord);
    expect(substituted.toString()).toBe('Db7 C');
    expect(substituted.key?.equals(key)).toBe(true);
    expect(dominant.toString()).toBe('G7 C');
    // A negative index counts from the end, exactly as `at` counts it.
    expect(dominant.substitute(-2, 'tritone').equals(substituted)).toBe(true);
  });

  it('keeps only the substitutes a melody stays consonant against', () => {
    const dominant = new Progression([Chord.parse('G7')], key);
    // Db7 sounds no G, so a melody resting on one rules the substitute out —
    // in the function first, and so in the class that reads it.
    const kept = substituteChord(Chord.parse('G7').data, key.scale, { melodyPcs: [7] });
    expect(kept.some((candidate) => candidate.type === 'tritone')).toBe(false);
    expect(() => dominant.substitute(0, 'tritone', { melodyPcs: [7] })).toThrow(InvalidInputError);
    expect(dominant.substitute(0, 'tritone').toString()).toBe('Db7');
  });

  it('reports an index, a key, or a relationship it cannot substitute', () => {
    expect(() => progression.substitute(9, 'tritone')).toThrow(InvalidInputError);
    // A plain triad is no dominant, so it has no tritone substitute.
    expect(() => progression.substitute(0, 'tritone')).toThrow(InvalidInputError);
    expect(() => new Progression([Chord.parse('G7')]).substitute(0, 'tritone')).toThrow(
      InvalidInputError,
    );
  });

  it('places the chords on a grid the way Timeline.fromProgression does', () => {
    expect(progression.timeline(4).data).toEqual(Timeline.fromProgression(progression, 4).data);
    expect(progression.timeline(4).totalBeats).toBe(16);
    expect(progression.timeline(4).at(5)?.symbol()).toBe('Am');
    // The round trip keeps the chord order the grid was built from.
    expect(progression.timeline(2).progression().toString()).toBe(progression.toString());
  });

  it('builds a progression from numerals, chord for chord as key.roman does', () => {
    const numerals = ['I', 'vi', 'IV', 'V'];
    const built = key.progression(...numerals);
    expect(built).toBeInstanceOf(Progression);
    expect(built.chords.map((chord) => chord.toJSON())).toEqual(
      numerals.map((numeral) => key.roman(numeral).toJSON()),
    );
    expect(built.key?.equals(key)).toBe(true);
    expect(built.roman()).toEqual(numerals);
    expect(built.toString()).toBe('C Am F G');
    expect(key.progression().length).toBe(0);
    expect(() => key.progression('I', 'nope')).toThrow(InvalidInputError);
  });

  it('names the scale by the mask the built-in table holds', () => {
    for (const [name, mask] of Object.entries(NAMED_SCALES)) {
      const canonical = Object.entries(NAMED_SCALES).find(([, other]) => other === mask)?.[0];
      expect(Key.named(name, 'C').scaleName, name).toBe(canonical);
    }
    expect(Key.major('C').scaleName).toBe('major');
    expect(Key.minor('A').scaleName).toBe('naturalMinor');
    // A mask no built-in scale has answers with nothing rather than a near miss.
    expect(Key.of({ rootPc: 0, modeMask12: 0b000010010001 }, Note.parse('C')).scaleName).toBe(
      undefined,
    );
  });

  it('snaps a pitch and names its degree exactly as the scale functions do', () => {
    for (const scaleKey of [key, Key.minor('A'), Key.named('majorPentatonic', 'Eb')]) {
      for (let pitch = 48; pitch <= 72; pitch += 1) {
        expect(scaleKey.nearestTone(pitch)).toBe(nearestScaleTone(pitch, scaleKey.scale));
        const degree = pitchToScaleDegree(pitch, scaleKey.scale);
        expect(scaleKey.degreeOf(pitch)).toBe(degree === -1 ? null : degree);
      }
    }
    // The absent degree is null in the class API, so it cannot read as the tonic.
    expect(pitchToScaleDegree(61, key.scale)).toBe(-1);
    expect(key.degreeOf(61)).toBeNull();
    expect(key.degreeOf(60)).toBe(1);
  });
});

describe('a key argument refuses the options that belong after it', () => {
  // Every method here reads a key first and its options second, so an options
  // bag passed on its own used to be taken for the key and surface several
  // calls later as a complaint about a key field the caller never wrote.
  const chord = Chord.parse('G7');
  const progression = new Progression(
    [Chord.parse('C'), Chord.parse('G7'), Chord.parse('C')],
    Key.major('C'),
  );

  it.each([
    ['Chord.roman', () => chord.roman({ applied: true } as unknown as Key)],
    ['Chord.analyze', () => chord.analyze({ alternatives: true } as unknown as Key)],
    ['Progression.roman', () => progression.roman({ applied: true } as unknown as Key)],
    ['Progression.analyze', () => progression.analyze({ alternatives: true } as unknown as Key)],
    ['Progression.cadences', () => progression.cadences({ alternatives: true } as unknown as Key)],
  ])('%s names the mistake instead of failing inside the analysis', (_name, call) => {
    expect(call).toThrow(InvalidInputError);
    expect(call).toThrow(/must be a Key; received an object/);
  });

  it('still takes a key, the carried key, and a key with options', () => {
    expect(chord.roman(Key.major('C'))).toBe('V7');
    expect(progression.roman()).toEqual(['I', 'V7', 'I']);
    expect(progression.cadences(Key.major('C'), { alternatives: true }).length).toBe(2);
  });
});
