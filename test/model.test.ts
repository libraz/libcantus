import { describe, expect, it } from 'vitest';
import { Chord, Interval, Key, Note, Progression } from '../src/model/index.js';

describe('Note', () => {
  it('parses, formats, and converts name -> pitch class -> MIDI', () => {
    const note = Note.of('C4');
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

  it('transposes up and down via MIDI when an octave is present', () => {
    expect(Note.of('C4').transpose(7).name).toBe('G4');
    expect(Note.of('G4').transpose(-7).name).toBe('C4');
    expect(Note.of('B3').transpose(1).name).toBe('C4');
  });

  it('keeps an octave-less note octave-less when transposing', () => {
    const transposed = Note.of('C').transpose(7);
    expect(transposed.name).toBe('G');
    expect(transposed.octave).toBeUndefined();
  });

  it('throws a clear error when asking an octave-less note for MIDI', () => {
    expect(() => Note.of('C').midi).toThrow(/octave/);
  });

  it('measures spelled intervals', () => {
    expect(Note.of('C4').intervalTo(Note.of('G4'))).toEqual({
      number: 5,
      quality: 'P',
      semitones: 7,
    });
    expect(Note.of('C4').intervalTo(Note.of('E4'))).toEqual({
      number: 3,
      quality: 'M',
      semitones: 4,
    });
  });

  it('compares by spelling', () => {
    expect(Note.of('C#4').equals(Note.of('C#4'))).toBe(true);
    expect(Note.of('C#4').equals(Note.of('Db4'))).toBe(false);
  });

  it('is immutable: transpose returns a new instance', () => {
    const original = Note.of('C4');
    const transposed = original.transpose(2);
    expect(transposed).not.toBe(original);
    expect(original.name).toBe('C4');
  });

  it('transposes by zero as the identity, preserving the exact spelling', () => {
    // A naive MIDI round-trip would respell Eb4 as D#4; zero must keep Eb4.
    expect(Note.of('Eb4').transpose(0).name).toBe('Eb4');
    expect(Note.of('D#4').transpose(0).name).toBe('D#4');
    expect(Note.of('Cb').transpose(0).name).toBe('Cb');
    const eb = Note.of('Eb4');
    const same = eb.transpose(0);
    expect(same).not.toBe(eb);
    expect(same.equals(eb)).toBe(true);
  });

  it('serializes to plain note data instead of {}', () => {
    expect(Note.of('Bb3').toJSON()).toEqual({ letter: 6, alter: -1, octave: 3 });
    // Round-trips through JSON back into an equal note.
    const restored = Note.fromData(JSON.parse(JSON.stringify(Note.of('F#4'))));
    expect(restored.equals(Note.of('F#4'))).toBe(true);
  });
});

describe('Interval', () => {
  it('builds from two notes', () => {
    const third = Interval.between(Note.of('C4'), Note.of('E4'));
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
    expect(Interval.between(Note.of('C4'), Note.of('E4')).toJSON()).toEqual({
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

  it('tests scale membership for numbers and notes', () => {
    const cMajor = Key.major('C');
    expect(cMajor.contains(7)).toBe(true);
    expect(cMajor.contains(6)).toBe(false);
    expect(cMajor.contains(Note.of('F#'))).toBe(false);
    expect(cMajor.contains(Note.of('E4'))).toBe(true);
  });

  it('builds degree chords carrying the key context', () => {
    const cMajor = Key.major('C');
    expect(cMajor.chord(0).quality).toBe('maj');
    expect(cMajor.chord(6).quality).toBe('dim');
    expect(cMajor.chord(4, 'dom7').roman()).toBe('V7');
    expect(cMajor.diatonicTriad(5).quality).toBe('min');
    expect(cMajor.diatonicSeventh(1).quality).toBe('min7');
  });

  it('keeps the key spelling on degree and Roman-numeral chords', () => {
    expect(Key.major('Eb').chord(0).symbol()).toBe('Eb');
    expect(Key.major('Bb').diatonicTriad(3).symbol()).toBe('Eb');
    expect(Key.major('C').roman('V7/vi').symbol()).toBe('E7');
  });

  it('builds Roman-numeral chords carrying the key context', () => {
    const five = Key.major('C').roman('V7');
    expect(five.rootPc).toBe(7);
    expect(five.quality).toBe('dom7');
    expect(five.function()).toBe('dominant');
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
    expect(Key.major('C').chord(4, 'dom7').pitchClasses()).toEqual([2, 5, 7, 11]);
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
    expect(Chord.of(5, 'min').borrowedSource(cMajor)).toBe('parallel-minor');
    const analysis = Chord.of(5, 'min').analyze(cMajor);
    expect(analysis.borrowed).toBe(true);
    expect(analysis.roman).toBe('iv');
  });

  it('inverts by chord-tone index, wrapping and keeping context', () => {
    const cMajor = Key.major('C');
    const tonic = cMajor.chord(0, 'maj');
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

describe('Progression', () => {
  it('flows key context from Key-produced chords through progressionTo', () => {
    const result = Key.major('C')
      .chord(0, 'maj')
      .progressionTo(Key.major('C').chord(7, 'dom7'))
      .analyze();
    expect(result.chords).toHaveLength(2);
    expect(result).toHaveProperty('cadence');
  });

  it('analyzes a ii-V-I with an authentic cadence', () => {
    const cMajor = Key.major('C');
    const prog = cMajor
      .chord(1, 'min7')
      .progressionTo(cMajor.chord(4, 'dom7'), cMajor.chord(0, 'maj'));
    expect(prog.length).toBe(3);
    expect(prog.roman()).toEqual(['ii7', 'V7', 'I']);
    expect(prog.functions()).toEqual(['subdominant', 'dominant', 'tonic']);
    expect(prog.analyze().cadence).toBe('authentic');
  });

  it('yields no cadence for fewer than two chords', () => {
    const single = new Progression([Chord.of(0, 'maj')], Key.major('C'));
    expect(single.analyze().cadence).toBeNull();
  });

  it('voices with smooth voice leading', () => {
    const cMajor = Key.major('C');
    const voicings = cMajor
      .chord(1, 'min7')
      .progressionTo(cMajor.chord(4, 'dom7'), cMajor.chord(0, 'maj'))
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
      expect(motion).toBeLessThanOrEqual(12);
    }
  });

  it('throws a clear error for analysis without any key', () => {
    const keyless = Chord.of(0, 'maj').progressionTo(Chord.of(7, 'dom7'));
    expect(() => keyless.analyze()).toThrow(/key/);
    // Motion onto the dominant is a half cadence.
    expect(keyless.withKey(Key.major('C')).analyze().cadence).toBe('half');
  });

  it('is immutable: add returns a new progression', () => {
    const cMajor = Key.major('C');
    const prog = new Progression([cMajor.chord(0)], cMajor);
    const longer = prog.add(cMajor.chord(4, 'dom7'));
    expect(longer).not.toBe(prog);
    expect(prog.length).toBe(1);
    expect(longer.length).toBe(2);
    expect(longer.chords[1]?.quality).toBe('dom7');
  });

  it('serializes to plain progression data instead of {}', () => {
    const cMajor = Key.major('C');
    const prog = cMajor.chord(0, 'maj').progressionTo(cMajor.chord(4, 'dom7'));
    const json = prog.toJSON();
    expect(json.chords).toEqual([
      {
        rootPc: 0,
        quality: 'maj',
        intervals: [0, 4, 7],
        rootSpelling: { letter: 0, alter: 0 },
      },
      {
        rootPc: 7,
        quality: 'dom7',
        intervals: [0, 4, 7, 10],
        rootSpelling: { letter: 4, alter: 0 },
      },
    ]);
    expect(json.key?.tonic).toEqual({ letter: 0, alter: 0 });
    // A keyless progression serializes its chords with an undefined key.
    const keyless = new Progression([Chord.of(0, 'maj')]);
    expect(keyless.toJSON().key).toBeUndefined();
  });
});

describe('Chord letter-name spelling and plain-data construction', () => {
  it('spells its tones using the carried key context', () => {
    const g7 = Key.major('C').chord(4, 'dom7');
    expect(g7.spell().map((note) => note.name)).toEqual(['G', 'B', 'D', 'F']);
  });

  it('wraps a plain chord object with Chord.from', () => {
    const chord = Chord.from({ rootPc: 0, quality: 'maj', intervals: [0, 4, 7] });
    expect(chord.pitchClasses()).toEqual([0, 4, 7]);
    expect(chord.key).toBeUndefined();
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
    const prog = new Progression([key.chord(0)], key);
    expect(prog.key?.isMinor).toBe(true);
  });

  it('refuses to invert a chord with no intervals', () => {
    const empty = Chord.from({ rootPc: 0, quality: 'maj', intervals: [] });
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
    const g7 = Key.major('C').chord(4, 'dom7');
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
