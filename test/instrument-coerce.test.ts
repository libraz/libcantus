import { describe, expect, it } from 'vitest';
import * as core from '../src/core/index.js';
import {
  BASS_4_STRING,
  DRUM_KIT,
  GUITAR_STANDARD,
  Instrument,
  InvalidInputError,
  toInstrumentProfile,
  toStringedProfile,
} from '../src/index.js';

/**
 * The instrument pair of the coercer family. They let a public entry point take
 * an instrument in whatever form the caller holds it — one of the built-in
 * profiles, the profile a project file stores, or the `Instrument` class — and
 * read one shape back, and they are published for the same reason the note, key
 * and chord coercers are: a caller widening an instrument by hand reaches the
 * reading every entry point widens through instead of writing a second one.
 */

describe('toInstrumentProfile', () => {
  it('reads a plain profile of either family', () => {
    expect(toInstrumentProfile(BASS_4_STRING)).toEqual(BASS_4_STRING);
    expect(toInstrumentProfile(DRUM_KIT)).toEqual(DRUM_KIT);
  });

  it('reads a model class through its toJSON', () => {
    const guitar = Instrument.guitar();
    expect(toInstrumentProfile(guitar)).toEqual(guitar.toJSON());
    expect(toInstrumentProfile(guitar)).toEqual(GUITAR_STANDARD);
  });

  it('names the instrument the caller called it in the error', () => {
    expect(() => toInstrumentProfile({} as never, 'lead instrument')).toThrow(/lead instrument/);
  });

  it('refuses what is not an instrument', () => {
    expect(() => toInstrumentProfile({ name: 'nothing' } as never)).toThrow(InvalidInputError);
    expect(() => toInstrumentProfile(null as never)).toThrow(InvalidInputError);
    expect(() => toInstrumentProfile('bass' as never)).toThrow(InvalidInputError);
  });

  it('refuses an instrument that contradicts itself', () => {
    expect(() => toInstrumentProfile({ ...BASS_4_STRING, tuning: [] })).toThrow(InvalidInputError);
    expect(() => toInstrumentProfile({ ...GUITAR_STANDARD, frets: -1 })).toThrow(RangeError);
    expect(() => toInstrumentProfile({ ...DRUM_KIT, limbs: [] })).toThrow(InvalidInputError);
  });
});

describe('toStringedProfile', () => {
  it('narrows a plain profile to the stringed family', () => {
    expect(toStringedProfile(BASS_4_STRING)).toEqual(BASS_4_STRING);
    expect(toStringedProfile(BASS_4_STRING).tuning).toEqual(BASS_4_STRING.tuning);
  });

  it('reads a model class through its toJSON', () => {
    expect(toStringedProfile(Instrument.bass4())).toEqual(BASS_4_STRING);
  });

  it('refuses an instrument with no strings to place a line on', () => {
    expect(() => toStringedProfile(DRUM_KIT)).toThrow(InvalidInputError);
    expect(() => toStringedProfile(DRUM_KIT, 'bass instrument')).toThrow(
      /bass instrument.*no strings/,
    );
  });

  it('refuses what names no instrument at all, as the wider coercer does', () => {
    expect(() => toStringedProfile(null as never)).toThrow(InvalidInputError);
    expect(() => toStringedProfile({ name: 'nothing' } as never)).toThrow(InvalidInputError);
  });
});

describe('the instrument coercers are reachable as the family they belong to', () => {
  it('is the same reading through the package root and through the core subpath', () => {
    expect(toInstrumentProfile).toBe(core.toInstrumentProfile);
    expect(toStringedProfile).toBe(core.toStringedProfile);
  });

  it('reads a class and its data the same way, as the sibling coercers do', () => {
    const bass = Instrument.bass4();
    expect(toInstrumentProfile(bass)).toEqual(toInstrumentProfile(bass.data));
    expect(toStringedProfile(bass)).toEqual(toStringedProfile(bass.data));
  });
});
