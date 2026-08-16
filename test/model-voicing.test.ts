import { describe, expect, it } from 'vitest';
import { midiToNote, type Note as NoteData, parseNote } from '../src/core/pitch/index.js';
import { Voicing, type VoicingSafetyQuery } from '../src/model/voicing.js';
import { voiceIndependence } from '../src/theory/counterpoint/index.js';
import { checkPartWriting, checkSpecies, spellVoicing } from '../src/theory/partwriting/index.js';
import {
  enumerateSafePitches,
  evaluateSafety,
  NoteSafety,
  type SafetyQuery,
} from '../src/theory/safety/index.js';
import { majorKey, toKeyScale } from '../src/theory/scale/index.js';
import { spellPitch } from '../src/theory/spelling/index.js';
import { toChordData } from '../src/theory/symbol/index.js';
import {
  nextVoicing,
  SATB_RANGES,
  voiceChord,
  voiceChordStyled,
  voiceLeadingCost,
} from '../src/theory/voicing/index.js';

/**
 * `Voicing` is a skin over the functions that all take the same array of
 * voices, so most of what is checked here is equivalence: the class answer must
 * be the answer the underlying function gives for the same pitches and the same
 * context. The rest is the contract every model class holds — plain data out,
 * plain data back in, nothing shared with the caller, and no number it cannot
 * hold accepted from outside.
 */

/** The key every example below is written in. */
const C_MAJOR = majorKey(0);

/** A four-voice C major chord, and the D minor that follows it in fifths. */
const TONIC = [48, 55, 64, 72];
const SUPERTONIC = [50, 57, 65, 69];

/** Spell a line the way the class spells one, for the equivalence checks. */
const spellLine = (pitches: readonly number[]): NoteData[] =>
  pitches.map((pitch) => spellPitch(pitch, parseNote('C'), C_MAJOR));

describe('plain data', () => {
  it('hands out its pitches as a copy, not its own state', () => {
    const voicing = Voicing.of(TONIC);
    expect(voicing.data).not.toBe(voicing.data);
    expect(voicing.data).toEqual(voicing.data);
    expect(voicing.pitches).not.toBe(voicing.pitches);
    voicing.data[0] = 0;
    voicing.pitches[1] = 0;
    expect(voicing.pitches).toEqual(TONIC);
  });

  it('agrees with toJSON and round-trips through both factories', () => {
    const voicing = Voicing.of(TONIC);
    expect(voicing.data).toEqual(voicing.toJSON());
    expect(voicing.data).toEqual(JSON.parse(JSON.stringify(voicing)));
    expect(Voicing.fromData(voicing.data).data).toEqual(voicing.data);
    expect(Voicing.fromJSON(JSON.parse(JSON.stringify(voicing))).equals(voicing)).toBe(true);
  });

  it('keeps the order it was given rather than sorting it', () => {
    // A voicing whose voices are out of order is one whose voices cross, which
    // is a fault the part-writing check reports rather than one the class hides.
    expect(Voicing.of([64, 60]).pitches).toEqual([64, 60]);
    expect(Voicing.of([64, 60]).equals(Voicing.of([60, 64]))).toBe(false);
  });

  it('reports the compass it sounds, crossed voices included', () => {
    expect(Voicing.of(TONIC).range).toEqual({ min: 48, max: 72 });
    expect(Voicing.of([64, 60, 67]).range).toEqual({ min: 60, max: 67 });
  });

  it('reads as its pitches in a template literal', () => {
    expect(`${Voicing.of(TONIC)}`).toBe('48 55 64 72');
  });
});

describe('data arriving from outside is checked, not trusted', () => {
  it('rebuilds no voicing carrying a number it cannot hold', () => {
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (let index = 0; index < TONIC.length; index += 1) {
        const data = [...TONIC];
        data[index] = poison;
        expect(() => Voicing.fromData(data), `pitches[${index}] = ${poison}`).toThrow(RangeError);
        expect(() => Voicing.fromJSON(data), `pitches[${index}] = ${poison}`).toThrow(RangeError);
      }
    }
  });

  it('refuses a pitch no note event could carry, and an empty voicing', () => {
    expect(() => Voicing.of([60, 128])).toThrow(RangeError);
    expect(() => Voicing.of([-1])).toThrow(RangeError);
    expect(() => Voicing.of([60.5])).toThrow(RangeError);
    expect(() => Voicing.of([])).toThrow(RangeError);
  });
});

describe('equals compares through the public surface', () => {
  /**
   * A stand-in exposing only the public members, as the model contracts build
   * one: reading a `#private` field off it throws, so an `equals` that reaches
   * for one fails here exactly as it would against a second copy of the class.
   */
  function publicFacade<T extends object>(instance: T): T {
    const facade: Record<PropertyKey, unknown> = {};
    for (
      let proto: object | null = Object.getPrototypeOf(instance) as object | null;
      proto !== null && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      for (const key of Reflect.ownKeys(proto)) {
        if (key === 'constructor' || key in facade) {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        const getter = descriptor?.get;
        const value = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
        if (getter !== undefined) {
          Object.defineProperty(facade, key, {
            get: () => getter.call(instance),
            enumerable: true,
          });
        } else if (typeof value === 'function') {
          Object.defineProperty(facade, key, {
            value: (...args: unknown[]) => value.apply(instance, args),
            enumerable: true,
          });
        }
      }
    }
    return facade as T;
  }

  it('equals a stand-in that exposes only public members', () => {
    const voicing = Voicing.of(TONIC);
    expect(voicing.equals(publicFacade(voicing))).toBe(true);
  });

  it('separates a doubling from the thinner texture that drops it', () => {
    expect(Voicing.of(TONIC).equals(Voicing.of([48, 55, 64]))).toBe(false);
    expect(Voicing.of([60, 60, 67]).equals(Voicing.of([60, 67]))).toBe(false);
    expect(Voicing.of(TONIC).equals(Voicing.of(TONIC))).toBe(true);
  });
});

describe('realizing a chord', () => {
  it('voices into the SATB ranges as voiceChord does', () => {
    expect(Voicing.satb('Cmaj7').pitches).toEqual(voiceChord(toChordData('Cmaj7')));
    expect(Voicing.satb('C', { voices: 3 }).pitches).toEqual(
      voiceChord(toChordData('C'), { voices: 3 }),
    );
    const ranges = [
      { min: 40, max: 60 },
      { min: 55, max: 74 },
    ];
    expect(Voicing.satb('F/G', { ranges, key: C_MAJOR }).pitches).toEqual(
      voiceChord(toChordData('F/G'), { ranges, key: C_MAJOR }),
    );
  });

  it('builds a styled voicing as voiceChordStyled does', () => {
    for (const style of ['close', 'drop2', 'drop3', 'shell', 'rootless'] as const) {
      expect(Voicing.forChord('Dm7', { style }).pitches, style).toEqual(
        voiceChordStyled(toChordData('Dm7'), { style }),
      );
    }
    expect(Voicing.forChord('Cmaj7', { octave: 3, topNote: 4 }).pitches).toEqual(
      voiceChordStyled(toChordData('Cmaj7'), { octave: 3, topNote: 4 }),
    );
  });

  it('takes a chord in every form toChordData reads', () => {
    const symbol = Voicing.satb('Cmaj7');
    expect(Voicing.satb(toChordData('Cmaj7')).equals(symbol)).toBe(true);
    expect(Voicing.satb({ toJSON: () => toChordData('Cmaj7') }).equals(symbol)).toBe(true);
  });

  it('hands out the SATB ranges as a copy of the shared table', () => {
    expect(Voicing.satbRanges).toEqual(SATB_RANGES.map((range) => ({ ...range })));
    expect(Voicing.satbRanges).not.toBe(Voicing.satbRanges);
    const ranges = Voicing.satbRanges;
    const first = ranges[0] as { min: number };
    first.min = 0;
    expect(Voicing.satbRanges[0]?.min).toBe(SATB_RANGES[0]?.min);
  });
});

describe('voice leading', () => {
  it('follows a chord as nextVoicing does', () => {
    const tonic = Voicing.of(TONIC);
    expect(tonic.next('G7').pitches).toEqual(nextVoicing(TONIC, toChordData('G7')));
    expect(tonic.next('G7', { key: C_MAJOR }).pitches).toEqual(
      nextVoicing(TONIC, toChordData('G7'), { key: C_MAJOR }),
    );
    expect(tonic.next('G7', { voices: 4, maxSpacing: 9 }).pitches).toEqual(
      nextVoicing(TONIC, toChordData('G7'), { voices: 4, maxSpacing: 9 }),
    );
  });

  it('scores the motion as voiceLeadingCost does', () => {
    expect(Voicing.of(TONIC).costTo(Voicing.of(SUPERTONIC))).toBe(
      voiceLeadingCost(TONIC, SUPERTONIC),
    );
    // Voicings of different sizes are not comparable, which the cost says.
    expect(Voicing.of(TONIC).costTo(Voicing.of([48, 55, 64]))).toBe(Number.POSITIVE_INFINITY);
    const tonic = Voicing.satb('C');
    expect(tonic.costTo(tonic)).toBe(0);
  });

  it('inverts by moving the lowest voice up an octave', () => {
    expect(Voicing.of([60, 64, 67]).invert(1).pitches).toEqual([64, 67, 72]);
    expect(Voicing.of([60, 64, 67]).invert(2).pitches).toEqual([67, 72, 76]);
    expect(Voicing.of([60, 64, 67]).invert(0).pitches).toEqual([60, 64, 67]);
    // A whole turn round the texture is the same chord an octave higher.
    expect(Voicing.of([60, 64, 67]).invert(3).pitches).toEqual([72, 76, 79]);
    expect(Voicing.of([60, 64, 67]).invert(-1).pitches).toEqual([55, 60, 64]);
    // The voice that lands lowest is the one that moves next, which a fixed
    // rotation would get wrong: 60 up an octave is still under 80.
    expect(Voicing.of([60, 80, 90]).invert(2).pitches).toEqual([80, 84, 90]);
    expect(() => Voicing.of([120, 122]).invert(1)).toThrow(RangeError);
    expect(() => Voicing.of([60, 64]).invert(1.5)).toThrow(RangeError);
  });
});

describe('spelling', () => {
  it('spells against a chord as spellVoicing does', () => {
    const voicing = Voicing.of([50, 57, 66, 69]);
    const expected = spellVoicing([50, 57, 66, 69], toChordData('D'), C_MAJOR);
    expect(voicing.spell('C major', 'D').map((note) => note.data)).toEqual(expected);
    expect(voicing.spell('C major', 'D').map((note) => note.name)).toEqual([
      'D3',
      'A3',
      'F#4',
      'A4',
    ]);
  });

  it('spells by the key alone when no chord is given', () => {
    const voicing = Voicing.of([50, 57, 66, 69]);
    expect(voicing.spell('C major').map((note) => note.data)).toEqual(spellLine([50, 57, 66, 69]));
    // Without the chord under it there is nothing to say the third of a D major
    // chord is an F# rather than the Gb a flat key reaches for.
    expect(voicing.spell('Eb major').map((note) => note.name)).toEqual(['D3', 'A3', 'Gb4', 'A4']);
    expect(voicing.spell('Eb major', 'D').map((note) => note.name)).toEqual([
      'D3',
      'A3',
      'F#4',
      'A4',
    ]);
  });

  it('takes a key in every form toKeyScale reads', () => {
    const voicing = Voicing.of([60, 64, 67]);
    const names = voicing.spell('C major').map((note) => note.name);
    expect(voicing.spell(C_MAJOR).map((note) => note.name)).toEqual(names);
    expect(voicing.spell({ toJSON: () => ({ scale: C_MAJOR }) }).map((note) => note.name)).toEqual(
      names,
    );
  });
});

describe('part writing', () => {
  it('reports the violation the pair commits, as checkPartWriting does', () => {
    const from = Voicing.of(TONIC);
    const to = Voicing.of(SUPERTONIC);
    const chords = [toChordData('C'), toChordData('Dm')];
    const voicings = [
      spellVoicing(TONIC, chords[0] as never, C_MAJOR),
      spellVoicing(SUPERTONIC, chords[1] as never, C_MAJOR),
    ];
    const expected = checkPartWriting(voicings, chords, C_MAJOR);
    expect(from.checkTo(to, ['C', 'Dm'], 'C major')).toEqual(expected);
    // Not merely equal to the function: the pair really does break a rule.
    expect(expected.map((found) => found.kind)).toEqual(['parallelFifth']);
    expect(from.checkTo(to, ['C', 'Dm'], 'C major')[0]?.voices).toEqual([0, 1]);
  });

  it('reports a clean pair as clean', () => {
    const from = Voicing.of([48, 55, 64, 72]);
    const to = Voicing.of([47, 55, 62, 67]);
    expect(from.checkTo(to, ['C', 'G'], 'C major')).toEqual([]);
  });

  it('passes the ranges and the spacing limit through', () => {
    const from = Voicing.of(TONIC);
    const to = Voicing.of(SUPERTONIC);
    const ranges = [
      { min: 40, max: 47 },
      { min: 48, max: 67 },
      { min: 55, max: 74 },
      { min: 60, max: 79 },
    ];
    const chords = [toChordData('C'), toChordData('Dm')];
    const voicings = [
      spellVoicing(TONIC, chords[0] as never, C_MAJOR),
      spellVoicing(SUPERTONIC, chords[1] as never, C_MAJOR),
    ];
    expect(from.checkTo(to, ['C', 'Dm'], 'C major', { ranges })).toEqual(
      checkPartWriting(voicings, chords, C_MAJOR, { ranges }),
    );
    expect(from.checkTo(to, ['C', 'Dm'], 'C major', { maxSpacing: 4 })).toEqual(
      checkPartWriting(voicings, chords, C_MAJOR, { maxSpacing: 4 }),
    );
    // The narrowed range is reached: the bass sits above it in both chords.
    expect(
      from.checkTo(to, ['C', 'Dm'], 'C major', { ranges }).map((found) => found.kind),
    ).toContain('range');
    expect(
      from.checkTo(to, ['C', 'Dm'], 'C major', { maxSpacing: 4 }).map((found) => found.kind),
    ).toContain('spacing');
  });
});

describe('species counterpoint', () => {
  const CANTUS = ['C4', 'D4', 'E4', 'D4', 'C4'];
  const COUNTERPOINT = [72, 69, 67, 71, 72];

  it('marks the exercise as checkSpecies does', () => {
    const line = Voicing.of(COUNTERPOINT);
    const cantus = CANTUS.map((name) => parseNote(name));
    expect(line.species(CANTUS, 1, 'C major')).toEqual(
      checkSpecies(cantus, spellLine(COUNTERPOINT), 1, C_MAJOR),
    );
    expect(line.species(CANTUS, 1, 'C major')).toEqual([]);
  });

  it('spells a cantus firmus given as pitches in the same mode', () => {
    const line = Voicing.of(COUNTERPOINT);
    expect(line.species([60, 62, 64, 62, 60], 1, 'C major')).toEqual(
      line.species(CANTUS, 1, 'C major'),
    );
  });

  it('reports the fault a clashing counterpoint commits', () => {
    // Consecutive octaves against the cantus firmus, which the first species
    // does not allow.
    const line = Voicing.of([72, 74, 76, 74, 72]);
    const found = line.species(CANTUS, 1, 'C major');
    expect(found.length).toBeGreaterThan(0);
    expect(found).toEqual(
      checkSpecies(
        CANTUS.map((name) => parseNote(name)),
        spellLine([72, 74, 76, 74, 72]),
        1,
        C_MAJOR,
      ),
    );
  });

  it('passes the note lengths and the written side through', () => {
    const line = Voicing.of(COUNTERPOINT);
    const cantus = CANTUS.map((name) => parseNote(name));
    const durations = [1, 1, 1, 1, 1];
    expect(line.species(CANTUS, 1, 'C major', { durations })).toEqual(
      checkSpecies(cantus, spellLine(COUNTERPOINT), 1, C_MAJOR, { durations }),
    );
    expect(line.species(CANTUS, 1, 'C major', { counterpointAbove: false })).toEqual(
      checkSpecies(cantus, spellLine(COUNTERPOINT), 1, C_MAJOR, { counterpointAbove: false }),
    );
  });
});

describe('voice independence', () => {
  const LEAD = [72, 74, 76];
  const COUNTER = [64, 65, 67];

  it('measures the two lines as voiceIndependence does', () => {
    const lead = Voicing.of(LEAD);
    const counter = Voicing.of(COUNTER);
    expect(lead.independence(counter)).toEqual(
      voiceIndependence(
        LEAD.map((pitch) => midiToNote(pitch)),
        COUNTER.map((pitch) => midiToNote(pitch)),
      ),
    );
    expect(lead.independence(counter).motion.parallel).toBe(1);
  });

  it('spells both lines in the key when one is given', () => {
    const lead = Voicing.of(LEAD);
    const counter = Voicing.of(COUNTER);
    expect(lead.independence(counter, { key: 'C major' })).toEqual(
      voiceIndependence(spellLine(LEAD), spellLine(COUNTER)),
    );
  });

  it('passes the attack flags and the treatment of the fourth through', () => {
    const lead = Voicing.of([72, 72, 76]);
    const counter = Voicing.of([65, 67, 69]);
    const leadAttacks = [true, true, false];
    const opts = { leadAttacks, countFourths: true };
    expect(lead.independence(counter, opts)).toEqual(
      voiceIndependence(
        [72, 72, 76].map((pitch) => midiToNote(pitch)),
        [65, 67, 69].map((pitch) => midiToNote(pitch)),
        opts,
      ),
    );
    expect(lead.independence(counter, opts)).not.toEqual(lead.independence(counter));
  });
});

describe('safety', () => {
  /** The three voices a fourth is being placed against. */
  const SOUNDING = [48, 55, 64];

  /** The context those voices are judged in, and the plain query it becomes. */
  const query: VoicingSafetyQuery = {
    profile: 'pop',
    chord: 'C',
    key: 'C major',
    strongBeat: true,
  };
  const plain: Omit<SafetyQuery, 'candidatePitch'> = {
    profile: 'pop',
    chord: toChordData('C'),
    key: toKeyScale('C major'),
    otherVoices: SOUNDING.map((pitch) => ({ pitch })),
    strongBeat: true,
    prevPitch: undefined,
    vocalLow: undefined,
    vocalHigh: undefined,
  };

  it('judges a candidate as evaluateSafety does', () => {
    const voicing = Voicing.of(SOUNDING);
    expect(voicing.safetyOf(72, query)).toEqual(evaluateSafety({ ...plain, candidatePitch: 72 }));
    expect(voicing.safetyOf(72, query).safety).toBe(NoteSafety.Safe);
    expect(voicing.safetyOf(61, query)).toEqual(evaluateSafety({ ...plain, candidatePitch: 61 }));
    expect(voicing.safetyOf(61, query).safety).toBe(NoteSafety.Dissonant);
  });

  it('passes the suggestion search through', () => {
    const voicing = Voicing.of(SOUNDING);
    expect(voicing.safetyOf(61, query, { suggestions: false })).toEqual(
      evaluateSafety({ ...plain, candidatePitch: 61 }, { suggestions: false }),
    );
    expect(voicing.safetyOf(61, query, { suggestions: false }).suggestions).toBeUndefined();
    expect(voicing.safetyOf(61, query).suggestions?.length).toBeGreaterThan(0);
  });

  it('carries the range and the candidate line through', () => {
    const voicing = Voicing.of(SOUNDING);
    const bounded = { ...query, vocalLow: 60, vocalHigh: 70, prevPitch: 65 };
    expect(voicing.safetyOf(72, bounded)).toEqual(
      evaluateSafety({ ...plain, vocalLow: 60, vocalHigh: 70, prevPitch: 65, candidatePitch: 72 }),
    );
    expect(voicing.safetyOf(72, bounded).safety).not.toBe(NoteSafety.Safe);
  });

  it('gives each sounding voice the pitch it came from', () => {
    const voicing = Voicing.of([48, 55, 64]);
    const previous = Voicing.of([47, 55, 62]);
    const moving = { ...query, prevPitch: 71, previous };
    const withMotion: Omit<SafetyQuery, 'candidatePitch'> = {
      ...plain,
      prevPitch: 71,
      otherVoices: [
        { pitch: 48, prevPitch: 47 },
        { pitch: 55, prevPitch: 55 },
        { pitch: 64, prevPitch: 62 },
      ],
    };
    expect(voicing.safetyOf(72, moving)).toEqual(
      evaluateSafety({ ...withMotion, candidatePitch: 72 }),
    );
    // The motion is what the parallel rules read; without it they never fire.
    expect(voicing.safetyOf(72, moving).reasons).not.toBe(voicing.safetyOf(72, query).reasons);
  });

  it('enumerates the placeable pitches as enumerateSafePitches does', () => {
    const voicing = Voicing.of(SOUNDING);
    expect(voicing.safePitches(query, 60, 72)).toEqual(enumerateSafePitches(plain, 60, 72));
    expect(voicing.safePitches(query, 60, 72).length).toBeGreaterThan(0);
    expect(voicing.safePitches({ ...query, chord: null }, 60, 72)).toEqual(
      enumerateSafePitches({ ...plain, chord: null }, 60, 72),
    );
    expect(() => voicing.safePitches(query, 72, 60)).toThrow(RangeError);
  });
});
