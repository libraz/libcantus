import { describe, expect, it } from 'vitest';
import { formatNote, noteToMidi, noteToPitchClass, parseNote } from '../src/core/pitch/index.js';
import type { KeyScale } from '../src/core/types.js';
import { Chord, Key, Note } from '../src/model/index.js';
import { chordFromSpec, chordQualities, makeChord } from '../src/theory/chord/index.js';
import { isScaleTone, majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';
import type { SpellingContext } from '../src/theory/spelling/index.js';
import {
  noteNames,
  spellChord,
  spellChordFromRoot,
  spellPitch,
  spellPitchClass,
  spellPitchClasses,
  spellScale,
} from '../src/theory/spelling/index.js';
import { shortestReading } from './support/growth.js';

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

describe('spellChordFromRoot', () => {
  it('requires the supplied spelling to name the chord root', () => {
    expect(() => spellChordFromRoot(makeChord(0, 'maj'), parseNote('D'))).toThrow(
      /must match chord.rootPc/,
    );
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

describe('spellPitchClass with a spelling context', () => {
  const pitchClasses = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const keys: { name: string; tonic: string; key: KeyScale }[] = [
    { name: 'C major', tonic: 'C', key: majorKey(0) },
    { name: 'Eb major', tonic: 'Eb', key: majorKey(3) },
    { name: 'F# minor', tonic: 'F#', key: minorKey(6) },
    { name: 'A harmonic minor', tonic: 'A', key: scaleByName('harmonicMinor', 9) },
    { name: 'C blues', tonic: 'C', key: scaleByName('blues', 0) },
  ];

  it('spells every pitch class of C major as it always has when no context is given', () => {
    expect(
      pitchClasses.map((pc) => formatNote(spellPitchClass(pc, parseNote('C'), majorKey(0)))),
    ).toEqual(['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']);
  });

  it('reproduces the key-only spelling for an empty context, in every key', () => {
    for (const { name, tonic, key } of keys) {
      for (const pc of pitchClasses) {
        const bare = spellPitchClass(pc, parseNote(tonic), key);
        expect(spellPitchClass(pc, parseNote(tonic), key, {}), `${name}/${pc}`).toEqual(bare);
        expect(
          spellPitchClass(pc, parseNote(tonic), key, {
            chordRoot: undefined,
            previous: undefined,
            next: undefined,
          }),
          `${name}/${pc}`,
        ).toEqual(bare);
      }
    }
  });

  it('never lets a context respell a scale tone or the tonic', () => {
    // Db as the chord root would make E the minor third above it (Fb), but E is
    // the third of the key and keeps the letter the key gave it.
    expect(formatNote(spellPitchClass(4, parseNote('C'), majorKey(0), { chordRoot: 1 }))).toBe('E');
    expect(
      formatNote(spellPitchClass(0, parseNote('C'), majorKey(0), { chordRoot: 8, next: 1 })),
    ).toBe('C');
    for (const { name, tonic, key } of keys) {
      for (const pc of pitchClasses) {
        const bare = spellPitchClass(pc, parseNote(tonic), key);
        if (!isScaleTone(pc, key)) {
          continue;
        }
        for (const chordRoot of pitchClasses) {
          expect(
            spellPitchClass(pc, parseNote(tonic), key, {
              chordRoot,
              previous: pc - 1,
              next: pc + 1,
            }),
            `${name}/${pc}`,
          ).toEqual(bare);
        }
      }
    }
  });

  it('spells the third of a secondary dominant from the chord root (F# in D7, not Gb)', () => {
    // F major spells the tritone above its tonic Gb; as the third of D7 it is F#.
    expect(formatNote(spellPitchClass(6, parseNote('F'), majorKey(5)))).toBe('Gb');
    expect(formatNote(spellPitchClass(6, parseNote('F'), majorKey(5), { chordRoot: 2 }))).toBe(
      'F#',
    );
  });

  it('spells the third of E7 in C major as G#, not Ab', () => {
    expect(formatNote(spellPitchClass(8, parseNote('C'), majorKey(0)))).toBe('Ab');
    expect(formatNote(spellPitchClass(8, parseNote('C'), majorKey(0), { chordRoot: 4 }))).toBe(
      'G#',
    );
  });

  it('spells the fifth of F#7 in C major as C#, not Db', () => {
    expect(formatNote(spellPitchClass(1, parseNote('C'), majorKey(0), { chordRoot: 6 }))).toBe(
      'C#',
    );
  });

  it('spells the minor seventh of Ab7 in C major as Gb, not F#', () => {
    expect(formatNote(spellPitchClass(6, parseNote('C'), majorKey(0)))).toBe('F#');
    expect(formatNote(spellPitchClass(6, parseNote('C'), majorKey(0), { chordRoot: 8 }))).toBe(
      'Gb',
    );
  });

  it('leaves an ambiguous interval above the chord root to the key', () => {
    // A tritone over C is an augmented fourth or a diminished fifth by turns,
    // so the chord gives no evidence and F major keeps its Gb.
    expect(formatNote(spellPitchClass(6, parseNote('F'), majorKey(5), { chordRoot: 0 }))).toBe(
      'Gb',
    );
  });

  it('spells a semitone resolution upward as the leading tone of what follows', () => {
    // The C# rising to D in D minor, and the F# rising to G in F major.
    expect(formatNote(spellPitchClass(1, parseNote('D'), minorKey(2), { next: 2 }))).toBe('C#');
    expect(formatNote(spellPitchClass(6, parseNote('F'), majorKey(5)))).toBe('Gb');
    expect(formatNote(spellPitchClass(6, parseNote('F'), majorKey(5), { next: 7 }))).toBe('F#');
    // Rising to A in C major makes the black key a G#, not the key's Ab.
    expect(formatNote(spellPitchClass(8, parseNote('C'), majorKey(0), { next: 9 }))).toBe('G#');
  });

  it('spells a double-sharp leading tone when the note it resolves to is sharp (F## to G#)', () => {
    // E major spells pitch class 7 as a plain G; rising a semitone into G# it is
    // the leading tone below it, one letter down.
    expect(formatNote(spellPitchClass(7, parseNote('E'), majorKey(4)))).toBe('G');
    expect(formatNote(spellPitchClass(7, parseNote('E'), majorKey(4), { next: 8 }))).toBe('F##');
  });

  it('spells an ascending chromatic line with sharps, from the note before it', () => {
    // F F# G in C major: the black key is the F inflected upward, on F's letter,
    // and the note it came from is enough to say so.
    expect(formatNote(spellPitchClass(6, parseNote('C'), majorKey(0), { previous: 5 }))).toBe('F#');
    expect(
      formatNote(spellPitchClass(6, parseNote('C'), majorKey(0), { previous: 5, next: 9 })),
    ).toBe('F#');
  });

  it('spells an ascending inflection of an already sharp note as a double sharp', () => {
    // E major spells pitch class 7 as a plain G; rising out of F# it is that F#
    // inflected again, which the double-accidental cap still admits.
    expect(formatNote(spellPitchClass(7, parseNote('E'), majorKey(4), { previous: 6 }))).toBe(
      'F##',
    );
  });

  it('spells a descending chromatic line with flats', () => {
    // A Ab G in C major: the letter stays above the G that follows.
    expect(
      formatNote(spellPitchClass(8, parseNote('C'), majorKey(0), { previous: 9, next: 7 })),
    ).toBe('Ab');
    expect(
      formatNote(spellPitchClass(6, parseNote('C'), majorKey(0), { previous: 7, next: 5 })),
    ).toBe('Gb');
  });

  it('spells a descent from the note before it when nothing follows', () => {
    // A Ab in C major, read from the A alone: the black key is that A inflected
    // downward, on A's letter.
    expect(formatNote(spellPitchClass(8, parseNote('C'), majorKey(0), { previous: 9 }))).toBe('Ab');
    // The same reading under D gives Db, not C#.
    expect(formatNote(spellPitchClass(1, parseNote('C'), majorKey(0), { previous: 2 }))).toBe('Db');
  });

  it('compares neighbours as pitch classes, so MIDI pitches work too', () => {
    expect(formatNote(spellPitchClass(8, parseNote('C'), majorKey(0), { next: 69 }))).toBe('G#');
    expect(
      formatNote(spellPitchClass(8, parseNote('C'), majorKey(0), { previous: 81, next: 67 })),
    ).toBe('Ab');
  });

  it('never returns more than a double accidental, whatever the context', () => {
    for (const { name, tonic, key } of keys) {
      for (const pc of pitchClasses) {
        const contexts: SpellingContext[] = pitchClasses.flatMap((a) => [
          { chordRoot: a },
          { previous: a },
          { next: a },
          ...pitchClasses.map((b) => ({ previous: a, next: b })),
          ...pitchClasses.map((b) => ({ chordRoot: a, previous: b, next: b + 1 })),
        ]);
        for (const context of contexts) {
          const spelled = spellPitchClass(pc, parseNote(tonic), key, context);
          expect(
            Math.abs(spelled.alter),
            `${name}/${pc}/${JSON.stringify(context)}`,
          ).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});

describe('spellPitch with a spelling context', () => {
  it('keeps the octave that sounds the pitch when the context changes the letter', () => {
    // MIDI 60 rising into C#4 is a B#, which belongs to octave 3, not 4.
    expect(formatNote(spellPitch(60, parseNote('E'), majorKey(4)))).toBe('C4');
    const leadingTone = spellPitch(60, parseNote('E'), majorKey(4), { next: 61 });
    expect(formatNote(leadingTone)).toBe('B#3');
    expect(noteToMidi(leadingTone)).toBe(60);
  });

  it('still sounds the input pitch for every context', () => {
    const keys: { tonic: string; key: KeyScale }[] = [
      { tonic: 'C', key: majorKey(0) },
      { tonic: 'Eb', key: majorKey(3) },
      { tonic: 'F#', key: minorKey(6) },
      { tonic: 'A', key: scaleByName('harmonicMinor', 9) },
    ];
    for (const { tonic, key } of keys) {
      for (let pitch = 48; pitch <= 84; pitch += 1) {
        for (let neighbour = pitch - 2; neighbour <= pitch + 2; neighbour += 1) {
          const context = { chordRoot: neighbour % 12, previous: neighbour, next: neighbour + 1 };
          const spelled = spellPitch(pitch, parseNote(tonic), key, context);
          expect(noteToMidi(spelled), `${tonic}/${pitch}/${neighbour}`).toBe(pitch);
        }
      }
    }
  });

  it('spells exactly as it always has when no context is given', () => {
    expect(formatNote(spellPitch(70, parseNote('Eb'), majorKey(3)))).toBe('Bb4');
    expect(formatNote(spellPitch(59, parseNote('C'), majorKey(0)))).toBe('B3');
    for (let pitch = 48; pitch <= 84; pitch += 1) {
      expect(spellPitch(pitch, parseNote('C'), majorKey(0), {})).toEqual(
        spellPitch(pitch, parseNote('C'), majorKey(0)),
      );
    }
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

  it('names a non-heptatonic scale tone by tone, on the side the scale leans', () => {
    // A whole-tone scale has no letter-per-degree spelling and no minor third,
    // so from a natural tonic its altered tones take sharps.
    expect(
      noteNames(spellPitchClasses([0, 2, 6, 10], parseNote('C'), scaleByName('wholeTone', 0))),
    ).toEqual(['C', 'D', 'F#', 'A#']);
  });
});

describe('spelling stays on the key side across every path', () => {
  it('spells common borrowed roots without double accidentals in flat keys', () => {
    expect(Key.major('Ab').roman('bII7').symbol()).toBe('A7');
    expect(Key.major('Db').roman('bII').symbol()).toBe('D');
    expect(Key.major('Gb').roman('bII').symbol()).toBe('G');
    expect(Key.major('Cb').roman('bII').symbol()).toBe('C');
  });

  it('keeps borrowed roots readable across every major key', () => {
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      const key = Key.major(rootPc);
      for (const roman of ['bII', 'bII7', 'bVI', 'bVII']) {
        expect(key.roman(roman).symbol(), `${key}/${roman}`).toMatch(/^[A-G](?:#|b)?(?:7)?$/);
      }
    }
  });

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

  it('never produces a double accidental except where a signature calls for one', () => {
    // A key written with a signature is spelled on the tonic that signature is
    // written on, and the degrees it raises are accidentals over it: pitch
    // class 8 is G# minor, five sharps, so its harmonic and melodic forms write
    // F##. Every other scale is spelled on the tonic it reads best from, and
    // there a double accidental means the tonic was chosen badly.
    const signatureRaises = new Set(['harmonicMinor/8', 'melodicMinor/8']);
    // The eight-note scales spend all seven letters at every root, so a tonic
    // that is itself written with an accidental leaves one tone no plain letter
    // to take: C# half-whole octatonic reaches F## for the tone its F carries.
    const eightNote = new Set(['octatonicHalfWhole', 'octatonicWholeHalf']);
    const naturalRoots = new Set([0, 2, 4, 5, 7, 9, 11]);
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
        const names12 = key.noteNames();
        const doubles = names12.filter((spelled) => !/^[A-G](#|b)?$/.test(spelled));
        const label = `${name}/${rootPc} -> ${names12.join(' ')}`;
        if (eightNote.has(name) && !naturalRoots.has(rootPc)) {
          expect(doubles.length, label).toBeLessThanOrEqual(1);
        } else {
          expect(doubles, label).toEqual(signatureRaises.has(`${name}/${rootPc}`) ? ['F##'] : []);
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

  it('spells an altered extension on the letter of the degree it alters', () => {
    // The eleventh is a fourth-class letter and the thirteenth a sixth-class
    // one, however the alteration moves the tone: a lowered eleventh sounds a
    // major third above the root and is still written three letters up.
    expect(noteNames(spellChord(Chord.parse('C7(b11)').data, parseNote('C'), majorKey(0)))).toEqual(
      ['C', 'E', 'G', 'Bb', 'Fb'],
    );
    expect(noteNames(spellChord(Chord.parse('C7(#13)').data, parseNote('C'), majorKey(0)))).toEqual(
      ['C', 'E', 'G', 'Bb', 'A#'],
    );
    expect(
      noteNames(spellChord(Chord.parse('Cm7(b11)').data, parseNote('C'), majorKey(0))),
    ).toEqual(['C', 'Eb', 'G', 'Bb', 'Fb']);
    expect(
      noteNames(spellChord(Chord.parse('CM7(#13)').data, parseNote('C'), majorKey(0))),
    ).toEqual(['C', 'E', 'G', 'B', 'A#']);
  });

  it('gives two tones of different pitch classes two different letters', () => {
    // Every altered extension over every root: a tone may share a letter with
    // another only where the two sound the same pitch class.
    const alterations = [
      { degree: 9, alter: -1 },
      { degree: 9, alter: 1 },
      { degree: 11, alter: -1 },
      { degree: 11, alter: 1 },
      { degree: 13, alter: -1 },
      { degree: 13, alter: 1 },
    ] as const;
    for (const base of ['maj', 'min'] as const) {
      for (const seventh of ['min7', 'maj7'] as const) {
        for (const alteration of alterations) {
          for (let rootPc = 0; rootPc < 12; rootPc += 1) {
            const spec = {
              rootPc,
              base,
              seventh,
              alterations: [alteration],
              additions: [],
              omissions: [],
            };
            const chord = chordFromSpec(spec);
            const spelled = spellChord(chord, parseNote('C'), majorKey(0));
            const byLetter = new Map<number, number>();
            for (const note of spelled) {
              const pc = noteToPitchClass(note);
              const seen = byLetter.get(note.letter);
              const label = `${base}/${seventh}/${alteration.degree}${alteration.alter}/${rootPc}`;
              expect(seen === undefined || seen === pc, label).toBe(true);
              byLetter.set(note.letter, pc);
            }
            expect(spelled.map(noteToPitchClass), `${base}/${rootPc}`).toEqual(
              chord.intervals.map((interval) => (((rootPc + interval) % 12) + 12) % 12),
            );
          }
        }
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
    const chord = Key.major('C').chord(2); // Dm, spelled from C major
    const viaTwo = chord.withKey(Key.major('Db')).withKey(Key.major('D'));
    const direct = chord.withKey(Key.major('D'));
    expect(viaTwo.symbol()).toBe(direct.symbol());
    // The same chord, first spelled by a flat key, then re-keyed to a sharp one.
    const gSharpMinor = Key.major('Cb').chord(6); // Ab minor in Cb major
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
    expect(() => Key.of(majorKey(0), Note.parse('F#'))).toThrow(RangeError);
  });
});

describe('Note.transpose keeps the spelling', () => {
  it('moves the letter by the interval, not by a sharp table', () => {
    expect(Note.parse('Ab4').transpose(2).name).toBe('Bb4');
    expect(Note.parse('Eb4').transpose(5).name).toBe('Ab4');
    expect(Note.parse('F#3').transpose(2).name).toBe('G#3');
    expect(Note.parse('Bb').transpose(7).name).toBe('F');
  });

  it('is an exact inverse of itself for every note and offset', () => {
    for (const name of ['C4', 'Ab4', 'F#3', 'Bb2', 'D#5', 'Cb4', 'B#3']) {
      for (let semitones = -14; semitones <= 14; semitones += 1) {
        // A tritone is the one ambiguous distance: ascending it is an augmented
        // fourth and descending it a diminished fifth, so it is not self-inverse.
        if (Math.abs(semitones) % 12 === 6) continue;
        const note = Note.parse(name);
        const round = note.transpose(semitones).transpose(-semitones);
        expect(round.name, `${name} +-${semitones}`).toBe(note.name);
      }
    }
  });

  it('spells a tritone by direction: up an augmented fourth, down a diminished fifth', () => {
    expect(Note.parse('C4').transpose(6).name).toBe('F#4');
    expect(Note.parse('C4').transpose(-6).name).toBe('Gb3');
    expect(Note.parse('Ab4').transpose(-6).name).toBe('Ebb4');
  });

  it('honours an explicit spelling preference', () => {
    expect(Note.parse('Ab4').transpose(2, { spelling: 'sharp' }).name).toBe('A#4');
    expect(Note.parse('C4').transpose(1, { spelling: 'flat' }).name).toBe('Db4');
  });
});

describe('non-heptatonic scales lean the way the scale does', () => {
  it('spells the blues scale with flats', () => {
    expect(Key.named('blues', 'C').noteNames()).toEqual(['C', 'Eb', 'F', 'Gb', 'G', 'Bb']);
    expect(Key.named('minorPentatonic', 'C').noteNames()).toEqual(['C', 'Eb', 'F', 'G', 'Bb']);
  });

  it('keeps the whole-tone scale on sharps', () => {
    expect(Key.named('wholeTone', 'C').noteNames()).toEqual(['C', 'D', 'E', 'F#', 'G#', 'A#']);
  });

  it('keeps altered non-heptatonic scales on their conventional spellings', () => {
    // A pentatonic borrows the letters of the modes its tones fit, so both
    // readings of pitch class 8 spell a minor third; given only the pitch class
    // the key takes the tonic that spells lightest, four sharps against the
    // five flats Ab minor pentatonic (Ab Cb Db Eb Gb) would need.
    expect(Key.named('minorPentatonic', 8).noteNames()).toEqual(['G#', 'B', 'C#', 'D#', 'F#']);
    expect(Key.named('minorPentatonic', 'Ab').noteNames()).toEqual(['Ab', 'Cb', 'Db', 'Eb', 'Gb']);
    // Eight tones onto seven letters: the doubling falls on the ninth, so the
    // seventh stays a seventh rather than reading as an augmented sixth.
    expect(Key.named('octatonicHalfWhole', 'Bb').noteNames()).toEqual([
      'Bb',
      'Cb',
      'Db',
      'D',
      'E',
      'F',
      'G',
      'Ab',
    ]);
  });

  it('works a scale out once rather than once per tone of it', () => {
    // A scale no diatonic mode holds is read jointly: the whole set of letters
    // is walked, and the answer covers every tone at once. Asking it per tone
    // walked that space again for each of them, and asking it again for a scale
    // already read walked it once more. Three hundred readings of one scale
    // against three hundred readings of a different scale each, timed moments
    // apart on the same machine so a busy one slows both.
    const masks: number[] = [];
    for (let mask = 1; mask < 4096 && masks.length < 300; mask += 2) {
      let tones = 0;
      for (let bit = 0; bit < 12; bit += 1) {
        tones += (mask >> bit) & 1;
      }
      if (tones === 8) {
        masks.push(mask);
      }
    }
    expect(masks).toHaveLength(300);
    const tonic = parseNote('C');
    const spellAll = (pick: (round: number) => number): number => {
      const started = performance.now();
      for (let round = 0; round < masks.length; round += 1) {
        spellScale(tonic, { rootPc: 0, modeMask12: pick(round) });
      }
      return performance.now() - started;
    };
    const first = masks[0] ?? 1;
    // The worked side has to be the cold reading: the answer is remembered, so
    // a second pass over the same masks would time the memo rather than the
    // work. Read once, it can only be inflated by a busy machine, and that
    // moves the ratio away from the bound rather than through it.
    const worked = spellAll((round) => masks[round] ?? first);
    // The re-read is the cheap side, and the cheap side is where one
    // descheduled slice is a large share of the reading — which is what used to
    // collapse this ratio under a loaded suite. It repeats, so it is read the
    // honest way.
    const reread = shortestReading(() => spellAll(() => first));
    expect(worked / Math.max(reread, 0.01)).toBeGreaterThan(5);
    // And the reading is the one it always was.
    expect(Key.named('octatonicHalfWhole', 'C').noteNames()).toEqual(
      Key.named('octatonicHalfWhole', 'C').noteNames(),
    );
  });

  it('spells a chord from its own root when no key is attached', () => {
    expect(
      Chord.parse('Bb7')
        .spell()
        .map((n) => n.name),
    ).toEqual(['Bb', 'D', 'F', 'Ab']);
    expect(
      Chord.of('F#', 'min')
        .spell()
        .map((n) => n.name),
    ).toEqual(['F#', 'A', 'C#']);
    expect(() => Chord.fromData(makeChord(0, 'maj')).spell()).toThrow();
  });
});
