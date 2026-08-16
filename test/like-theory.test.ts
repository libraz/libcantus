import { describe, expect, it } from 'vitest';
import {
  availableTensions,
  avoidNotes,
  Chord,
  chordFromDegree,
  chordScaleReport,
  chordScales,
  diatonicSeventh,
  diatonicTriad,
  dominantKeyOf,
  enharmonicKeyOf,
  figuredBassOf,
  figuredBassRealization,
  formatChordSymbol,
  InvalidInputError,
  Key,
  keySignatureFifths,
  majorKey,
  makeChord,
  Note,
  nearestScaleTone,
  nextVoicing,
  noteNames,
  parallelKeyOf,
  parseChordSymbol,
  parseNote,
  pitchToScaleDegree,
  realizeFiguredBass,
  relatedKeysOf,
  relativeKeyOf,
  roleOf,
  spellChord,
  spellChordFromRoot,
  spellPitch,
  spellPitchClass,
  spellPitchClasses,
  spellScale,
  subdominantKeyOf,
  toSoundingPitch,
  toWrittenPitch,
  voiceChord,
  voiceProgression,
} from '../src/index.js';

/**
 * The theory layer's entry points take a note, key or chord in whatever form
 * the caller holds it. Every case below asserts that the text form and the data
 * form of one value produce the same answer, so a widened parameter cannot
 * quietly read the two differently.
 */

describe('theory entry points taking a key by name', () => {
  it('reads the scale degrees of a key either way', () => {
    expect(nearestScaleTone(61, 'C major')).toBe(nearestScaleTone(61, majorKey(0)));
    expect(pitchToScaleDegree(67, 'C major')).toBe(pitchToScaleDegree(67, majorKey(0)));
  });

  it('builds a diatonic chord over a named key', () => {
    expect(diatonicTriad(1, 'C major')).toEqual(diatonicTriad(1, majorKey(0)));
    expect(diatonicSeventh(5, 'C major')).toEqual(diatonicSeventh(5, majorKey(0)));
    expect(chordFromDegree(2, 'min7', 'C major')).toEqual(chordFromDegree(2, 'min7', majorKey(0)));
  });

  it('spells a named key the same way as its data', () => {
    expect(keySignatureFifths('Bb', majorKey(10))).toBe(
      keySignatureFifths(parseNote('Bb'), majorKey(10)),
    );
  });

  it('relates a named key the same way as its data', () => {
    expect(relativeKeyOf('C', 'C major')).toEqual(relativeKeyOf(parseNote('C'), majorKey(0)));
    expect(parallelKeyOf('C', 'C major')).toEqual(parallelKeyOf(parseNote('C'), majorKey(0)));
    expect(dominantKeyOf('C', 'C major')).toEqual(dominantKeyOf(parseNote('C'), majorKey(0)));
    expect(subdominantKeyOf('C', 'C major')).toEqual(subdominantKeyOf(parseNote('C'), majorKey(0)));
    expect(enharmonicKeyOf('Db', 'Db major')).toEqual(
      enharmonicKeyOf(parseNote('Db'), majorKey(1)),
    );
    expect(relatedKeysOf('C', 'C major')).toEqual(relatedKeysOf(parseNote('C'), majorKey(0)));
  });
});

describe('theory entry points taking a note by name', () => {
  it('spells against a named tonic and key', () => {
    expect(spellPitchClass(6, 'C', 'C major')).toEqual(
      spellPitchClass(6, parseNote('C'), majorKey(0)),
    );
    expect(spellPitch(70, 'Eb', 'Eb major')).toEqual(spellPitch(70, parseNote('Eb'), majorKey(3)));
    expect(spellScale('C', majorKey(0))).toEqual(spellScale(parseNote('C'), majorKey(0)));
    expect(spellPitchClasses([0, 4, 7], 'C', 'C major')).toEqual(
      spellPitchClasses([0, 4, 7], parseNote('C'), majorKey(0)),
    );
    expect(noteNames(['C', 'E', 'G'])).toEqual(
      noteNames([parseNote('C'), parseNote('E'), parseNote('G')]),
    );
  });

  it('spells a chord from a named root', () => {
    const chord = makeChord(7, 'dom7');
    expect(spellChordFromRoot(chord, 'G')).toEqual(spellChordFromRoot(chord, parseNote('G')));
    expect(spellChord(chord, 'C', 'C major')).toEqual(
      spellChord(chord, parseNote('C'), majorKey(0)),
    );
  });

  it('transposes a named note for an instrument', () => {
    expect(toSoundingPitch('C4', 'clarinetA')).toEqual(
      toSoundingPitch(parseNote('C4'), 'clarinetA'),
    );
    expect(toWrittenPitch('Eb3', 'altoSax')).toEqual(toWrittenPitch(parseNote('Eb3'), 'altoSax'));
  });

  it('realizes figured bass over a named bass and key', () => {
    expect(figuredBassRealization('G', '4-3', 'C major')).toEqual(
      figuredBassRealization(parseNote('G'), '4-3', majorKey(0)),
    );
    expect(realizeFiguredBass('B', '6', 'C major')).toEqual(
      realizeFiguredBass(parseNote('B'), '6', majorKey(0)),
    );
  });
});

describe('theory entry points taking a chord by symbol', () => {
  it('reports the role of a pitch in a named chord', () => {
    expect(roleOf(64, 'C')).toEqual(roleOf(64, makeChord(0, 'maj')));
    expect(roleOf(64, 'Cmaj7')).toEqual(roleOf(64, parseChordSymbol('Cmaj7')));
  });

  it('formats a chord given as a symbol', () => {
    expect(formatChordSymbol('Cm7')).toBe(formatChordSymbol(parseChordSymbol('Cm7')));
  });

  it('fits scales over a chord given as a symbol', () => {
    expect(chordScales('Cmaj7')).toEqual(chordScales(parseChordSymbol('Cmaj7')));
    expect(avoidNotes('Cmaj7', 'ionian')).toEqual(avoidNotes(parseChordSymbol('Cmaj7'), 'ionian'));
    expect(availableTensions('G7', 'phrygianDominant', { resolvesTo: 'Cm' })).toEqual(
      availableTensions(parseChordSymbol('G7'), 'phrygianDominant', {
        resolvesTo: parseChordSymbol('Cm'),
      }),
    );
    expect(chordScaleReport('Dm7', 3)).toEqual(chordScaleReport(parseChordSymbol('Dm7'), 3));
  });

  it('figures a chord given as a symbol', () => {
    expect(figuredBassOf('G/B', 'C major')).toBe(
      figuredBassOf(makeChord(7, 'maj', 11), majorKey(0)),
    );
  });

  it('voices a chord given as a symbol', () => {
    expect(voiceChord('Cmaj7')).toEqual(voiceChord(parseChordSymbol('Cmaj7')));
    expect(voiceProgression(['Dm7', 'G7', 'Cmaj7'], { key: 'C major' })).toEqual(
      voiceProgression(
        ['Dm7', 'G7', 'Cmaj7'].map((symbol) => parseChordSymbol(symbol)),
        {
          key: majorKey(0),
        },
      ),
    );
    const current = voiceChord('Dm7');
    expect(nextVoicing(current, 'G7', { key: 'C major', previousChord: 'Dm7' })).toEqual(
      nextVoicing(current, parseChordSymbol('G7'), {
        key: majorKey(0),
        previousChord: parseChordSymbol('Dm7'),
      }),
    );
  });
});

describe('theory entry points taking a model instance', () => {
  it('reads a class through its toJSON, exactly as the data form reads', () => {
    expect(diatonicTriad(1, Key.major('Db'))).toEqual(diatonicTriad(1, majorKey(1)));
    expect(formatChordSymbol(Chord.parse('F#m7b5'))).toBe(
      formatChordSymbol(parseChordSymbol('F#m7b5')),
    );
    expect(toSoundingPitch(Note.parse('C4'), 'clarinetA')).toEqual(
      toSoundingPitch(parseNote('C4'), 'clarinetA'),
    );
    // A plain object carrying `toJSON` is enough: the coercers read the method,
    // never the class.
    expect(voiceChord({ toJSON: () => parseChordSymbol('Cmaj7') })).toEqual(voiceChord('Cmaj7'));
  });
});

describe('a widened parameter still refuses what names nothing', () => {
  it('rejects a key, note and chord that no name resolves', () => {
    expect(() => nearestScaleTone(60, 'H sharp major')).toThrow(InvalidInputError);
    expect(() => toSoundingPitch('not a note', 'clarinetA')).toThrow(InvalidInputError);
    expect(() => formatChordSymbol('Cmaj7(#')).toThrow(InvalidInputError);
  });
});
