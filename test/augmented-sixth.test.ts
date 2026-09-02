import { describe, expect, it } from 'vitest';
import {
  analyzeChord,
  augmentedSixthChord,
  augmentedSixthFromPitchClasses,
  augmentedSixthKind,
  chordToRoman,
  detectCadence,
  functionOf,
  romanToChord,
  spellAugmentedSixth,
} from '../src/analyze/functional/index.js';
import { chordTimelineFromNotes, detectCadences } from '../src/analyze/timeline/index.js';
import { noteToPitchClass, parseNote, spelledInterval } from '../src/core/pitch/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Chord, Key } from '../src/model/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { realizeFiguredBass } from '../src/theory/figured-bass/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';
import { noteNames, spellChord, spellChordFromRoot } from '../src/theory/spelling/index.js';

const cMajor = majorKey(0);
const cMinor = minorKey(0);

/**
 * The spelled tones every kind takes in a key, bass first. The point of the
 * table is the top note: it is the augmented sixth above the bass (F# over Ab,
 * A# over C, D over Fb), never the minor seventh a dominant seventh would put
 * there.
 */
const SPELLINGS = [
  {
    name: 'C major',
    key: cMajor,
    tonic: parseNote('C'),
    italian: ['Ab', 'C', 'F#'],
    french: ['Ab', 'C', 'D', 'F#'],
    german: ['Ab', 'C', 'Eb', 'F#'],
  },
  {
    name: 'C minor',
    key: cMinor,
    tonic: parseNote('C'),
    italian: ['Ab', 'C', 'F#'],
    french: ['Ab', 'C', 'D', 'F#'],
    german: ['Ab', 'C', 'Eb', 'F#'],
  },
  {
    name: 'E major',
    key: majorKey(4),
    tonic: parseNote('E'),
    italian: ['C', 'E', 'A#'],
    french: ['C', 'E', 'F#', 'A#'],
    german: ['C', 'E', 'G', 'A#'],
  },
  {
    name: 'Ab major',
    key: majorKey(8),
    tonic: parseNote('Ab'),
    italian: ['Fb', 'Ab', 'D'],
    french: ['Fb', 'Ab', 'Bb', 'D'],
    german: ['Fb', 'Ab', 'Cb', 'D'],
  },
] as const;

const KINDS = ['italian', 'french', 'german'] as const;
const SYMBOLS = { italian: 'It6', french: 'Fr6', german: 'Ger6' } as const;

describe('spellAugmentedSixth', () => {
  it.each(SPELLINGS)('spells all three augmented sixths in $name', (entry) => {
    for (const kind of KINDS) {
      expect(noteNames(spellAugmentedSixth(kind, entry.tonic)), kind).toEqual([...entry[kind]]);
    }
  });

  it.each(SPELLINGS)('spans an augmented sixth from bass to top note in $name', (entry) => {
    for (const kind of KINDS) {
      const tones = spellAugmentedSixth(kind, entry.tonic);
      const bass = tones[0];
      const top = tones[tones.length - 1];
      expect(bass, kind).toBeDefined();
      expect(top, kind).toBeDefined();
      if (bass === undefined || top === undefined) return;
      const outer = spelledInterval(bass, top);
      expect(
        { number: outer.number, quality: outer.quality, semitones: outer.semitones },
        kind,
      ).toEqual({ number: 6, quality: 'A', semitones: 10 });
    }
  });

  it('keeps the octave of an octave-bearing tonic, ascending from the bass', () => {
    expect(spellAugmentedSixth('german', parseNote('C4')).map((note) => note.octave)).toEqual([
      4, 5, 5, 5,
    ]);
  });

  it('rejects a kind it does not know', () => {
    expect(() => spellAugmentedSixth('swiss' as unknown as 'german', parseNote('C'))).toThrowError(
      /augmented sixth kind/,
    );
  });
});

/** The bare letter/alter a chord records as a spelling hint, from a note name. */
function hint(name: string): { letter: number; alter: number } {
  const note = parseNote(name);
  return { letter: note.letter, alter: note.alter };
}

/** The same, for a whole chord's worth of tones. */
function hints(...names: string[]): { letter: number; alter: number }[] {
  return names.map(hint);
}

describe('augmentedSixthChord', () => {
  it('builds each kind on the lowered submediant of C major', () => {
    expect(augmentedSixthChord('italian', cMajor)).toEqual({
      rootPc: 8,
      quality: 'dom7',
      intervals: [0, 4, 10],
      bassPc: 8,
      rootSpelling: hint('Ab'),
      bassSpelling: hint('Ab'),
      toneSpellings: hints('Ab', 'C', 'F#'),
    });
    // The French sixth is the only one that stacks in thirds, one rotation from
    // its bass: the supertonic seventh with a lowered fifth.
    expect(augmentedSixthChord('french', cMajor)).toEqual({
      rootPc: 2,
      quality: '7b5',
      intervals: [0, 4, 6, 10],
      bassPc: 8,
      rootSpelling: hint('D'),
      bassSpelling: hint('Ab'),
      toneSpellings: hints('D', 'F#', 'Ab', 'C'),
    });
    expect(augmentedSixthChord('german', cMajor)).toEqual({
      rootPc: 8,
      quality: 'dom7',
      intervals: [0, 4, 7, 10],
      bassPc: 8,
      rootSpelling: hint('Ab'),
      bassSpelling: hint('Ab'),
      toneSpellings: hints('Ab', 'C', 'Eb', 'F#'),
    });
  });

  it('sounds b6, 1, b3 and #4 whatever the mode', () => {
    for (const key of [cMajor, cMinor]) {
      expect(chordPitchClasses(augmentedSixthChord('italian', key))).toEqual([0, 6, 8]);
      expect(chordPitchClasses(augmentedSixthChord('french', key))).toEqual([0, 2, 6, 8]);
      expect(chordPitchClasses(augmentedSixthChord('german', key))).toEqual([0, 3, 6, 8]);
    }
  });

  it('rejects a kind it does not know', () => {
    expect(() => augmentedSixthChord('swiss' as unknown as 'german', cMajor)).toThrowError(
      /augmented sixth kind/,
    );
  });
});

describe('augmentedSixthKind', () => {
  it.each(KINDS)('identifies the %s sixth it builds', (kind) => {
    expect(augmentedSixthKind(augmentedSixthChord(kind, cMajor), cMajor)).toBe(kind);
    expect(augmentedSixthKind(augmentedSixthChord(kind, cMinor), cMinor)).toBe(kind);
  });

  it('needs the lowered submediant in the bass', () => {
    // With some other bass the same pitch classes are that chord inverted, not
    // an augmented sixth.
    expect(augmentedSixthKind(makeChord(8, 'dom7', 0), cMajor)).toBeNull();
  });

  it('needs the augmented sixth spelled as one', () => {
    // Ab C Eb Gb over an Ab bass: the same pitch classes, written as the
    // dominant seventh they stack into, which is an ordinary bVI7.
    expect(augmentedSixthKind(makeChord(8, 'dom7', 8), cMajor)).toBeNull();
    // The same chord naming no bass at all sounds its root lowest, so it is
    // read the same way rather than escaping the test.
    expect(augmentedSixthKind(makeChord(8, 'dom7'), cMajor)).toBeNull();
  });

  it('reads the chord from its sounding tones, not from the root it is measured from', () => {
    // The German sixth of C major, measured from its own third instead.
    const fromThird = makeChord(0, 'min', 8);
    fromThird.intervals = [0, 3, 6, 8];
    fromThird.toneSpellings = hints('C', 'Eb', 'F#', 'Ab');
    expect(augmentedSixthKind(fromThird, cMajor)).toBe('german');
  });

  it('does not fire in a key that has no augmented sixth on that bass', () => {
    expect(augmentedSixthKind(augmentedSixthChord('german', cMajor), majorKey(5))).toBeNull();
  });
});

describe('augmentedSixthFromPitchClasses', () => {
  it.each(KINDS)('reads the %s sixth from pitch classes that carry no spelling', (kind) => {
    for (const key of [cMajor, cMinor]) {
      const built = augmentedSixthChord(kind, key);
      const read = augmentedSixthFromPitchClasses(chordPitchClasses(built), built.bassPc ?? 0, key);
      // The reading a MIDI caller has to make: the same chord, spelling and all,
      // so it keeps identifying as an augmented sixth rather than as a bVI7.
      expect(read).toEqual(built);
      expect(read && augmentedSixthKind(read, key)).toBe(kind);
    }
  });

  it('needs the lowered submediant in the bass', () => {
    const german = augmentedSixthChord('german', cMajor);
    expect(augmentedSixthFromPitchClasses(chordPitchClasses(german), 0, cMajor)).toBeNull();
  });

  it('answers null for tones that spell no augmented sixth', () => {
    expect(augmentedSixthFromPitchClasses([8, 0, 3], 8, cMajor)).toBeNull();
  });

  it('takes duplicated and unreduced pitch classes', () => {
    const german = augmentedSixthChord('german', cMajor);
    expect(augmentedSixthFromPitchClasses([20, 8, 12, 3, 6, 6], 20, cMajor)).toEqual(german);
  });
});

describe('romanToChord with augmented-sixth symbols', () => {
  it.each(KINDS)('parses the %s sixth into the chord the builder makes', (kind) => {
    expect(romanToChord(SYMBOLS[kind], cMajor)).toEqual(augmentedSixthChord(kind, cMajor));
    expect(romanToChord(SYMBOLS[kind], cMinor)).toEqual(augmentedSixthChord(kind, cMinor));
  });

  it('reads Ger65 as the German sixth under its figured name', () => {
    expect(romanToChord('Ger65', cMajor)).toEqual(romanToChord('Ger6', cMajor));
    // The figured-bass slash is normalized like any other, so `Ger6/5` is the
    // same symbol rather than an applied chord.
    expect(romanToChord('Ger6/5', cMajor)).toEqual(romanToChord('Ger6', cMajor));
  });

  it('applies an augmented sixth to a degree', () => {
    // The German sixth of G: Eb G Bb C#, bass Eb.
    expect(romanToChord('Ger6/V', cMajor)).toEqual(augmentedSixthChord('german', majorKey(7)));
    expect(noteNames(spellAugmentedSixth('german', parseNote('G')))).toEqual([
      'Eb',
      'G',
      'Bb',
      'C#',
    ]);
  });

  it('still rejects text that is neither a numeral nor a known symbol', () => {
    expect(() => romanToChord('Sw6', cMajor)).toThrowError();
    expect(() => romanToChord('It7', cMajor)).toThrowError();
  });
});

describe('chordToRoman with augmented-sixth symbols', () => {
  it.each(KINDS)('renders the %s sixth and round-trips it', (kind) => {
    for (const key of [cMajor, cMinor, majorKey(4), majorKey(8)]) {
      const chord = romanToChord(SYMBOLS[kind], key);
      expect(chordToRoman(chord, key)).toBe(SYMBOLS[kind]);
      expect(romanToChord(chordToRoman(chord, key), key)).toEqual(chord);
    }
  });

  it('renders Ger65 under the one canonical German-sixth symbol', () => {
    expect(chordToRoman(romanToChord('Ger65', cMajor), cMajor)).toBe('Ger6');
  });

  it('leaves an unbassed bVI7 and its function alone', () => {
    const flatSubmediantSeventh = makeChord(8, 'dom7');
    expect(chordToRoman(flatSubmediantSeventh, cMajor)).toBe('bVI7');
    expect(functionOf(flatSubmediantSeventh, cMajor)).toBe('dominant');
  });

  it('leaves a bVI7 standing on its own root alone', () => {
    // Ab7 with the Ab sounding in the bass is where the two chords sound alike;
    // its seventh is a Gb, so it is the numeral and not the symbol.
    expect(chordToRoman(makeChord(8, 'dom7', 8), cMajor)).toBe('bVI7');
  });

  it('leaves a minor seventh the figures spelled alone', () => {
    // `b7` over an Ab bass in C minor writes a Gb, a minor seventh above the
    // bass — the note an augmented sixth is precisely not.
    const chord = realizeFiguredBass(parseNote('Ab'), 'b7', cMinor);
    expect(noteNames(spellChord(chord, parseNote('C'), cMinor))).toEqual(['Ab', 'C', 'Eb', 'Gb']);
    expect(chordToRoman(chord, cMinor)).toBe('VI7');
  });
});

describe('augmented sixths in analysed music', () => {
  /** The three sixths of C major as sounding pitches, over their Ab bass. */
  const SOUNDING = {
    italian: [56, 60, 66],
    french: [56, 60, 62, 66],
    german: [56, 60, 63, 66],
  } as const;

  /** The chord held for a bar, then the dominant it resolves onto. */
  function ontoTheDominant(pitches: readonly number[]): NoteEvent[] {
    return [
      ...pitches.map((pitch) => ({ pitch, startBeat: 0, durationBeat: 4 })),
      ...[55, 59, 62, 67].map((pitch) => ({ pitch, startBeat: 4, durationBeat: 4 })),
    ];
  }

  it.each(KINDS)('reads the %s sixth off the notes rather than as a bVI7', (kind) => {
    const { timeline } = chordTimelineFromNotes(ontoTheDominant(SOUNDING[kind]), { key: cMajor });
    const chord = timeline.segments[0]?.chord;
    expect(chord).toBeDefined();
    if (chord === undefined) return;
    // The pitches carry no accidentals, so the analysis makes the reading and
    // hands back the chord that keeps it: same tones, spelled as the family.
    expect(chord).toEqual(augmentedSixthChord(kind, cMajor));
    expect(chordToRoman(chord, cMajor)).toBe(SYMBOLS[kind]);
    expect(augmentedSixthKind(chord, cMajor)).toBe(kind);
  });

  it('names the half cadence the analysis walks into', () => {
    const { timeline } = chordTimelineFromNotes(ontoTheDominant(SOUNDING.german), { key: cMajor });
    expect(detectCadences(timeline, cMajor).map((hit) => hit.cadence.type)).toEqual(['half']);
  });

  /** The chords of a progression, one bar each, as sounding pitches. */
  function bars(...chords: readonly (readonly number[])[]): NoteEvent[] {
    return chords.flatMap((pitches, bar) =>
      pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
    );
  }

  /** The tonic of C major in root position, and the dominant under it. */
  const TONIC = [48, 60, 64, 67];
  const CADENTIAL_SIX_FOUR = [55, 60, 64, 72];
  const DOMINANT = [55, 59, 62, 67];

  /** The chord the analysis reports for the first bar of a progression. */
  function firstChord(notes: NoteEvent[]) {
    const { timeline } = chordTimelineFromNotes(notes, { key: cMajor });
    const chord = timeline.segments[0]?.chord;
    expect(chord).toBeDefined();
    return chord;
  }

  it('reads a bVI7 that resolves to the tonic as a bVI7, seventh and all', () => {
    const chord = firstChord(bars(SOUNDING.german, TONIC));
    if (chord === undefined) return;
    // Ab7 walking into C is a backdoor dominant, not a predominant resolving
    // outward, so its tenth semitone above the bass is a minor seventh.
    expect(noteNames(spellChord(chord, parseNote('C'), cMajor))).toEqual(['Ab', 'C', 'Eb', 'Gb']);
    expect(chordToRoman(chord, cMajor)).toBe('bVI7');
    expect(augmentedSixthKind(chord, cMajor)).toBeNull();
  });

  it('reads the same tones resolving to the dominant as the German sixth', () => {
    const chord = firstChord(bars(SOUNDING.german, DOMINANT));
    if (chord === undefined) return;
    expect(noteNames(spellChord(chord, parseNote('C'), cMajor))).toEqual(['Ab', 'C', 'Eb', 'F#']);
    expect(chordToRoman(chord, cMajor)).toBe('Ger6');
  });

  it('accepts a sixth resolving through a cadential six-four', () => {
    const chord = firstChord(bars(SOUNDING.german, CADENTIAL_SIX_FOUR, DOMINANT));
    if (chord === undefined) return;
    // The six-four stands on the dominant bass: the dominant has arrived, under
    // the suspension it resolves.
    expect(augmentedSixthKind(chord, cMajor)).toBe('german');
  });

  it('rejects a six-four that never reaches its dominant', () => {
    const chord = firstChord(bars(SOUNDING.german, CADENTIAL_SIX_FOUR, TONIC));
    if (chord === undefined) return;
    expect(augmentedSixthKind(chord, cMajor)).toBeNull();
  });

  it('accepts a sixth left unresolved at the end of the piece', () => {
    const chord = firstChord(bars(SOUNDING.german));
    if (chord === undefined) return;
    expect(augmentedSixthKind(chord, cMajor)).toBe('german');
  });

  it.each(KINDS)('holds the rule for the %s sixth both ways', (kind) => {
    const onto = (next: readonly number[]) => firstChord(bars(SOUNDING[kind], next));
    expect(augmentedSixthKind(onto(DOMINANT) ?? makeChord(0, 'maj'), cMajor)).toBe(kind);
    expect(augmentedSixthKind(onto(TONIC) ?? makeChord(0, 'maj'), cMajor)).toBeNull();
  });
});

describe('augmented sixths as predominants', () => {
  it.each(KINDS)('gives the %s sixth subdominant function', (kind) => {
    expect(functionOf(augmentedSixthChord(kind, cMajor), cMajor)).toBe('subdominant');
    expect(functionOf(augmentedSixthChord(kind, cMinor), cMinor)).toBe('subdominant');
  });

  it.each(KINDS)('resolves the %s sixth onto the dominant as a half cadence', (kind) => {
    expect(
      detectCadence(augmentedSixthChord(kind, cMajor), romanToChord('V', cMajor), cMajor).type,
    ).toBe('half');
  });

  it('analyses the German sixth as a chromatic predominant', () => {
    expect(analyzeChord(augmentedSixthChord('german', cMajor), cMajor)).toEqual({
      function: 'subdominant',
      borrowed: false,
      source: null,
      roman: 'Ger6',
      rationale: expect.any(String),
      alternatives: [],
    });
  });
});

describe('the Neapolitan sixth', () => {
  it('builds the same chord as bII6', () => {
    expect(romanToChord('N6', cMajor)).toEqual(romanToChord('bII6', cMajor));
    expect(romanToChord('N6', cMinor)).toEqual(romanToChord('bII6', cMinor));
    expect(chordPitchClasses(romanToChord('N6', cMajor))).toEqual([1, 5, 8]);
    expect(romanToChord('N6', cMajor).bassPc).toBe(5);
  });

  it('renders as bII6 by default and as N6 on request', () => {
    const chord = romanToChord('N6', cMajor);
    expect(chordToRoman(chord, cMajor)).toBe('bII6');
    expect(chordToRoman(chord, cMajor, { neapolitan: true })).toBe('N6');
    expect(romanToChord(chordToRoman(chord, cMajor, { neapolitan: true }), cMajor)).toEqual(chord);
    expect(chordToRoman(romanToChord('N6', cMinor), cMinor, { neapolitan: true })).toBe('N6');
  });

  it('names only the first inversion N6, leaving the rest of bII as numerals', () => {
    const opts = { neapolitan: true };
    expect(chordToRoman(romanToChord('bII', cMajor), cMajor, opts)).toBe('bII');
    expect(chordToRoman(romanToChord('bII64', cMajor), cMajor, opts)).toBe('bII64');
    expect(chordToRoman(romanToChord('bII7', cMajor), cMajor, opts)).toBe('bII7');
  });

  it('applies to a degree like any other numeral', () => {
    expect(romanToChord('N6/V', cMajor)).toEqual(romanToChord('bII6', majorKey(7)));
  });
});

describe('the half-diminished glyph', () => {
  // The design note behind this work suspected `viiø7` was unsupported; it is
  // not, and the parser is left alone. Only the typographic glyph is accepted,
  // which is what these pin.
  it('parses viiø7 and viiø as the half-diminished seventh', () => {
    const expected = makeChord(11, 'm7b5');
    expect(romanToChord('viiø7', cMajor)).toEqual(expected);
    expect(romanToChord('viiø', cMajor)).toEqual(expected);
    expect(chordToRoman(expected, cMajor)).toBe('viiø7');
  });

  it('rejects the ASCII stand-in vii%7', () => {
    expect(() => romanToChord('vii%7', cMajor)).toThrowError(/Unsupported suffix/);
  });
});

describe('spelling an augmented sixth through the ordinary chord speller', () => {
  it.each(SPELLINGS)('names the tones spellAugmentedSixth names in $name', (entry) => {
    for (const kind of KINDS) {
      const chord = romanToChord(SYMBOLS[kind], entry.key);
      // The chord is measured from one of its own tones, so it spells in a
      // rotation of the bass-first table; both name the same notes.
      expect([...noteNames(spellChord(chord, entry.tonic, entry.key))].sort(), kind).toEqual(
        [...entry[kind]].sort(),
      );
    }
  });

  it('spells the German and Italian sixths on their augmented sixth, root first', () => {
    // The note the whole family is named for: it resolves outward to the
    // dominant, where the minor seventh a dominant seventh would spell (Gb over
    // an Ab bass) resolves inward and belongs to another chord entirely.
    expect(noteNames(spellChord(romanToChord('Ger6', cMajor), parseNote('C'), cMajor))).toEqual([
      'Ab',
      'C',
      'Eb',
      'F#',
    ]);
    expect(noteNames(spellChord(romanToChord('It6', cMajor), parseNote('C'), cMajor))).toEqual([
      'Ab',
      'C',
      'F#',
    ]);
    // A sharp-side key, and a flat-side one far enough to need a double flat.
    const eMajor = majorKey(4);
    expect(noteNames(spellChord(romanToChord('Ger6', eMajor), parseNote('E'), eMajor))).toEqual([
      'C',
      'E',
      'G',
      'A#',
    ]);
    const abMajor = majorKey(8);
    expect(noteNames(spellChord(romanToChord('Ger6', abMajor), parseNote('Ab'), abMajor))).toEqual([
      'Fb',
      'Ab',
      'Cb',
      'D',
    ]);
    expect(noteNames(spellChord(romanToChord('It6', abMajor), parseNote('Ab'), abMajor))).toEqual([
      'Fb',
      'Ab',
      'D',
    ]);
  });

  it('leaves the French sixth on the letters its own stack of thirds gives', () => {
    // Rooted on the altered supertonic, so its tones are a tertian stack and
    // need no hint to spell right; the hint must not disturb them.
    expect(noteNames(spellChord(romanToChord('Fr6', cMajor), parseNote('C'), cMajor))).toEqual([
      'D',
      'F#',
      'Ab',
      'C',
    ]);
  });

  it("follows the root spelling it is handed rather than the hint's own letters", () => {
    // The hint carries letter distances, not letters: over a G# root the same
    // chord is the enharmonic G# B# D# E##, still an augmented sixth wide.
    expect(noteNames(spellChordFromRoot(romanToChord('Ger6', cMajor), parseNote('G#')))).toEqual([
      'G#',
      'B#',
      'D#',
      'E##',
    ]);
  });

  it("ignores tone spellings that no longer name the chord's own tones", () => {
    const chord = romanToChord('Ger6', cMajor);
    const shifted = {
      ...chord,
      toneSpellings: (chord.toneSpellings ?? []).map((tone) => ({
        letter: (tone.letter + 1) % 7,
        alter: tone.alter,
      })),
    };
    // Every letter is off by one, so no spelling sounds its own pitch class:
    // the chord falls back to the letters its quality implies rather than
    // renaming its tones.
    expect(noteNames(spellChord(shifted, parseNote('C'), cMajor))).toEqual(['Ab', 'C', 'Eb', 'Gb']);
    // A hint that does not cover the template is refused the same way.
    expect(
      noteNames(spellChord({ ...chord, toneSpellings: hints('Ab', 'C') }, parseNote('C'), cMajor)),
    ).toEqual(['Ab', 'C', 'Eb', 'Gb']);
  });
});

describe('an augmented sixth through the class API', () => {
  it('renders the German sixth as a chord symbol on the bass it stands on', () => {
    // Ab7, never the G#7 a bare pitch class would name.
    expect(Chord.fromData(romanToChord('Ger6', cMajor)).symbol()).toBe('Ab7');
    expect(Chord.fromData(romanToChord('It6', cMajor)).symbol()).toBe('Ab7');
    expect(Chord.fromData(romanToChord('Fr6', cMajor)).symbol()).toBe('D7b5/Ab');
    expect(Key.major('C').roman('Ger6').symbol()).toBe('Ab7');
  });

  it('spells itself with or without a key attached', () => {
    const chord = Chord.fromData(romanToChord('Ger6', cMajor));
    expect(chord.spell().map((note) => note.name)).toEqual(['Ab', 'C', 'Eb', 'F#']);
    expect(
      chord
        .withKey(Key.major('C'))
        .spell()
        .map((note) => note.name),
    ).toEqual(['Ab', 'C', 'Eb', 'F#']);
    expect(
      Chord.fromJSON(chord.toJSON())
        .spell()
        .map((note) => note.name),
    ).toEqual(['Ab', 'C', 'Eb', 'F#']);
  });

  it('carries its spelling through a transposition', () => {
    const chord = Chord.fromData(romanToChord('Ger6', cMajor));
    // The German sixth of D major: the augmented sixth above Bb is G#, not Ab.
    expect(chord.transpose(2).symbol()).toBe('Bb7');
    expect(
      chord
        .transpose(2)
        .spell()
        .map((note) => note.name),
    ).toEqual(['Bb', 'D', 'F', 'G#']);
    expect(
      chord
        .transposeBy('M2')
        .spell()
        .map((note) => note.name),
    ).toEqual(['Bb', 'D', 'F', 'G#']);
    expect(chord.transpose(2).data.toneSpellings).toEqual(hints('Bb', 'D', 'F', 'G#'));
  });

  it('drops a tone spelling that has fallen out of step with the template', () => {
    const chord = romanToChord('Ger6', cMajor);
    // A natural where the chord sounds a lowered submediant: the first
    // spelling no longer names the pitch class its interval names.
    expect(
      Chord.fromData({ ...chord, toneSpellings: hints('A', 'C', 'Eb', 'F#') }).data.toneSpellings,
    ).toBeUndefined();
  });
});

describe('spelled tones and pitch classes agree', () => {
  it.each(SPELLINGS)('names the same tones the chord sounds in $name', (entry) => {
    for (const kind of KINDS) {
      const fromSpelling = [
        ...new Set(spellAugmentedSixth(kind, entry.tonic).map(noteToPitchClass)),
      ].sort((a, b) => a - b);
      expect(fromSpelling, kind).toEqual(chordPitchClasses(augmentedSixthChord(kind, entry.key)));
    }
  });
});

/**
 * The window analysis is handed the key whole, not its pitch classes.
 *
 * An augmented sixth is spelled rather than scored: which pitch classes are in
 * the window decides that the tones are one, and the key decides how it is
 * written. Those two questions were answered from the same value, and that
 * value was the key reduced to pitch classes — so the German sixth of an
 * A flat minor came back written on the sharps of the G sharp minor those
 * pitch classes read best as, whatever the caller had said the key was.
 */
describe('a timeline spells its augmented sixths in the key it was given', () => {
  /** A German sixth on the lowered submediant, resolving onto the dominant. */
  const GERMAN_THEN_DOMINANT: NoteEvent[] = [
    { pitch: 40, startBeat: 0, durationBeat: 4 },
    { pitch: 56, startBeat: 0, durationBeat: 4 },
    { pitch: 59, startBeat: 0, durationBeat: 4 },
    { pitch: 62, startBeat: 0, durationBeat: 4 },
    { pitch: 39, startBeat: 4, durationBeat: 4 },
    { pitch: 55, startBeat: 4, durationBeat: 4 },
    { pitch: 58, startBeat: 4, durationBeat: 4 },
    { pitch: 63, startBeat: 4, durationBeat: 4 },
  ];

  /** How the first segment of that span is written under one key. */
  function spelledUnder(key: string): string[] {
    const { timeline } = chordTimelineFromNotes(GERMAN_THEN_DOMINANT, { key });
    const first = timeline.segments[0];
    return noteNames(first?.chord.toneSpellings ?? []);
  }

  it('writes the German sixth of a flat-side key on flats', () => {
    expect(spelledUnder('Ab minor')).toEqual(['Fb', 'Ab', 'Cb', 'D']);
  });

  it('writes the same sound on sharps in the key that is written on sharps', () => {
    expect(spelledUnder('G# minor')).toEqual(['E', 'G#', 'B', 'C##']);
  });

  it('tells the two apart, which is the whole of the guarantee', () => {
    expect(spelledUnder('Ab minor')).not.toEqual(spelledUnder('G# minor'));
  });
});
