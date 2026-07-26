import { describe, expect, it } from 'vitest';
import { formatNote, parseNote } from '../src/core/pitch/index.js';
import { Chord, Key, Note } from '../src/model/index.js';
import { chordQualities, makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';
import {
  noteNames,
  spellChord,
  spellPitch,
  spellPitchClass,
  spellPitchClasses,
  spellScale,
} from '../src/theory/spelling/index.js';

describe('spellScale', () => {
  it('spells C major with natural letters', () => {
    expect(noteNames(spellScale(parseNote('C'), majorKey(0)))).toEqual([
      'C',
      'D',
      'E',
      'F',
      'G',
      'A',
      'B',
    ]);
  });

  it('spells F major with a B flat', () => {
    expect(noteNames(spellScale(parseNote('F'), majorKey(5)))).toEqual([
      'F',
      'G',
      'A',
      'Bb',
      'C',
      'D',
      'E',
    ]);
  });

  it('spells A harmonic minor with a raised seventh', () => {
    expect(noteNames(spellScale(parseNote('A'), scaleByName('harmonicMinor', 9)))).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G#',
    ]);
  });

  it('spells the natural minor', () => {
    expect(noteNames(spellScale(parseNote('E'), minorKey(4)))).toEqual([
      'E',
      'F#',
      'G',
      'A',
      'B',
      'C',
      'D',
    ]);
  });

  it('derives a double-sharp leading tone in G# harmonic minor (Fx)', () => {
    // G# harmonic minor raises the seventh degree F# to F double-sharp (Fx),
    // which must keep the F letter rather than collapsing to a natural G.
    const scale = spellScale(parseNote('G#'), scaleByName('harmonicMinor', 8));
    expect(noteNames(scale)).toEqual(['G#', 'A#', 'B', 'C#', 'D#', 'E', 'F##']);
    expect(scale[6]).toEqual({ letter: 3, alter: 2 });
  });

  it('derives a double-sharp seventh in D# harmonic minor (Cx)', () => {
    expect(noteNames(spellScale(parseNote('D#'), scaleByName('harmonicMinor', 3)))).toEqual([
      'D#',
      'E#',
      'F#',
      'G#',
      'A#',
      'B',
      'C##',
    ]);
  });
});

describe('spellPitchClass', () => {
  it('spells a sharp minor key raised leading tone with a sharp letter (E# in F# minor)', () => {
    // F# natural minor omits pc 5; its raised leading tone must spell E#, not F.
    expect(spellPitchClass(5, parseNote('F#'), minorKey(6))).toEqual({ letter: 2, alter: 1 });
  });

  it('spells a sharp minor key raised sixth with a sharp letter (E# in G# minor)', () => {
    // G# natural minor's sixth degree is E; its raised sixth must spell E#, not F.
    expect(spellPitchClass(5, parseNote('G#'), minorKey(8))).toEqual({ letter: 2, alter: 1 });
  });
});

describe('spellChord', () => {
  const cMajor = majorKey(0);

  it('spells a diatonic seventh chord exactly', () => {
    expect(noteNames(spellChord(makeChord(7, 'dom7'), parseNote('C'), cMajor))).toEqual([
      'G',
      'B',
      'D',
      'F',
    ]);
  });

  it('spells a secondary dominant with a sharp fourth', () => {
    expect(noteNames(spellChord(makeChord(2, 'dom7'), parseNote('C'), cMajor))).toEqual([
      'D',
      'F#',
      'A',
      'C',
    ]);
  });

  it('spells secondary dominants from the chord root letter, not nearest key tones', () => {
    expect(noteNames(spellChord(makeChord(4, 'dom7'), parseNote('C'), cMajor))).toEqual([
      'E',
      'G#',
      'B',
      'D',
    ]);
    expect(noteNames(spellChord(makeChord(11, 'dom7'), parseNote('C'), cMajor))).toEqual([
      'B',
      'D#',
      'F#',
      'A',
    ]);
  });

  it('spells a borrowed flat-seven chord with flats', () => {
    expect(noteNames(spellChord(makeChord(10, 'maj'), parseNote('C'), cMajor))).toEqual([
      'Bb',
      'D',
      'F',
    ]);
  });

  it('spells a leading-tone diminished seventh with a double-sharp root (Fx in G# minor)', () => {
    // The vii°7 of G# harmonic minor is rooted on the double-sharp leading tone.
    expect(
      noteNames(spellChord(makeChord(7, 'dim7'), parseNote('G#'), scaleByName('harmonicMinor', 8))),
    ).toEqual(['F##', 'A#', 'C#', 'E']);
  });
});

describe('spellPitchClasses', () => {
  it('spells an arbitrary pitch-class list in input order', () => {
    expect(noteNames(spellPitchClasses([0, 4, 7], parseNote('C'), majorKey(0)))).toEqual([
      'C',
      'E',
      'G',
    ]);
  });

  it('falls back to a sharp spelling of the nearest natural for a non-heptatonic scale', () => {
    // A whole-tone scale is not heptatonic, so degrees are named tone-by-tone.
    expect(
      noteNames(spellPitchClasses([0, 2, 6, 10], parseNote('C'), scaleByName('wholeTone', 0))),
    ).toEqual(['C', 'D', 'F#', 'A#']);
  });
});

describe('spelling stays on the key side across every path', () => {
  it('spells a non-heptatonic scale from the caller tonic, not a sharp table', () => {
    expect(noteNames(spellScale(parseNote('Eb'), scaleByName('majorPentatonic', 3)))).toEqual([
      'Eb',
      'F',
      'G',
      'Bb',
      'C',
    ]);
    expect(noteNames(spellScale(parseNote('Bb'), scaleByName('blues', 10)))).not.toContain('A#');
  });

  it('spells a chord over a flat-side mode without double accidentals', () => {
    expect(
      noteNames(spellChord(makeChord(3, 'maj'), parseNote('Bb'), scaleByName('lydian', 10))),
    ).toEqual(['Eb', 'G', 'Bb']);
  });

  it('never produces a double accidental for any named scale on any root', () => {
    const names = [
      'major',
      'naturalMinor',
      'dorian',
      'phrygian',
      'lydian',
      'mixolydian',
      'locrian',
      'harmonicMinor',
      'melodicMinor',
      'majorPentatonic',
      'minorPentatonic',
      'blues',
      'wholeTone',
      'octatonicHalfWhole',
      'octatonicWholeHalf',
      'chromatic',
    ];
    for (const name of names) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const key = Key.named(name, rootPc);
        for (const spelled of key.noteNames()) {
          expect(spelled, `${name}/${rootPc} -> ${key.noteNames().join(' ')}`).toMatch(
            /^[A-G](#|b)?$/,
          );
        }
      }
    }
  });

  it('spells a raised ninth as a ninth, never a duplicated third', () => {
    expect(noteNames(spellChord(makeChord(0, '7#9'), parseNote('C'), majorKey(0)))).toEqual([
      'C',
      'E',
      'G',
      'Bb',
      'D#',
    ]);
    expect(
      Chord.parse('Bb7#9')
        .withKey(Key.major('Eb'))
        .spell()
        .map((n) => n.name),
    ).toEqual(['Bb', 'D', 'F', 'Ab', 'C#']);
  });

  it('never spells one chord with the same letter twice', () => {
    for (const quality of chordQualities()) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const letters = spellChord(makeChord(rootPc, quality), parseNote('C'), majorKey(0)).map(
          (n) => n.letter,
        );
        expect(new Set(letters).size, `${quality}/${rootPc}`).toBe(letters.length);
      }
    }
  });

  it('keeps the octave when spelling a sounding pitch', () => {
    expect(formatNote(spellPitch(70, parseNote('Eb'), majorKey(3)))).toBe('Bb4');
    expect(formatNote(spellPitch(59, parseNote('C'), majorKey(0)))).toBe('B3');
  });
});

describe('Chord spelling agrees with the symbol it renders as', () => {
  it('spells the root the symbol shows, not a respelling of its pitch class', () => {
    const chord = Chord.parse('C#7').withKey(Key.major('C'));
    expect(chord.symbol()).toBe('C#7');
    expect(chord.spell().map((n) => n.name)).toEqual(['C#', 'E#', 'G#', 'B']);
    const dSharpMinor = Chord.parse('D#m').withKey(Key.major('C'));
    expect(dSharpMinor.symbol()).toBe('D#m');
    expect(dSharpMinor.spell().map((n) => n.name)).toEqual(['D#', 'F#', 'A#']);
  });

  it('spells a slash bass from the chord, not from a sharp table', () => {
    expect(Chord.of('Eb', 'maj', 10).symbol()).toBe('Eb/Bb');
    expect(Chord.of('Ab', 'maj', 3).symbol()).toBe('Ab/Eb');
    expect(Chord.of('Eb', 'maj').invert(2).symbol()).toBe('Eb/Bb');
    expect(Chord.parse('Bb').withKey(Key.major('Eb')).invert(1).symbol()).toBe('Bb/D');
  });

  it('re-spells when a different key is attached, whatever the order', () => {
    const chord = Key.major('C').chord(1); // Dm, spelled from C major
    const viaTwo = chord.withKey(Key.major('Db')).withKey(Key.major('D'));
    const direct = chord.withKey(Key.major('D'));
    expect(viaTwo.symbol()).toBe(direct.symbol());
    // The same chord, first spelled by a flat key, then re-keyed to a sharp one.
    const gSharpMinor = Key.major('Cb').chord(5); // Ab minor in Cb major
    expect(gSharpMinor.symbol()).toBe('Abm');
    expect(gSharpMinor.withKey(Key.major('B')).symbol()).toBe('G#m');
  });

  it('keeps a spelling the caller supplied through a key change', () => {
    const parsed = Chord.parse('Gb');
    expect(parsed.withKey(Key.major('D')).symbol()).toBe('Gb');
  });
});

describe('Key factories agree on numeric roots', () => {
  it('spells a numeric root the same way whichever factory is used', () => {
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      expect(Key.major(rootPc).noteNames()).toEqual(Key.of(majorKey(rootPc)).noteNames());
      expect(Key.major(rootPc).noteNames()).toEqual(Key.named('major', rootPc).noteNames());
      expect(Key.minor(rootPc).noteNames()).toEqual(Key.of(minorKey(rootPc)).noteNames());
    }
  });

  it('rejects a tonic that does not spell the scale root', () => {
    expect(() => Key.of(majorKey(0), Note.of('F#'))).toThrow(RangeError);
  });
});

describe('Note.transpose keeps the spelling', () => {
  it('moves the letter by the interval, not by a sharp table', () => {
    expect(Note.of('Ab4').transpose(2).name).toBe('Bb4');
    expect(Note.of('Eb4').transpose(5).name).toBe('Ab4');
    expect(Note.of('F#3').transpose(2).name).toBe('G#3');
    expect(Note.of('Bb').transpose(7).name).toBe('F');
  });

  it('is an exact inverse of itself for every note and offset', () => {
    for (const name of ['C4', 'Ab4', 'F#3', 'Bb2', 'D#5', 'Cb4', 'B#3']) {
      for (let semitones = -14; semitones <= 14; semitones += 1) {
        // A tritone is the one ambiguous distance: ascending it is an augmented
        // fourth and descending it a diminished fifth, so it is not self-inverse.
        if (Math.abs(semitones) % 12 === 6) continue;
        const note = Note.of(name);
        const round = note.transpose(semitones).transpose(-semitones);
        expect(round.name, `${name} +-${semitones}`).toBe(note.name);
      }
    }
  });

  it('spells a tritone by direction: up an augmented fourth, down a diminished fifth', () => {
    expect(Note.of('C4').transpose(6).name).toBe('F#4');
    expect(Note.of('C4').transpose(-6).name).toBe('F#3');
    expect(Note.of('Ab4').transpose(-6).name).toBe('D4');
  });

  it('honours an explicit spelling preference', () => {
    expect(Note.of('Ab4').transpose(2, { spelling: 'sharp' }).name).toBe('A#4');
    expect(Note.of('C4').transpose(1, { spelling: 'flat' }).name).toBe('Db4');
  });
});
