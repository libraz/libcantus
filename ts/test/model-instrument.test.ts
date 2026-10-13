import { describe, expect, it } from 'vitest';
import type { Articulation, InstrumentProfile, StringedProfile } from '../src/core/index.js';
import {
  BASS_4_STRING,
  BASS_5_STRING,
  GUITAR_DROP_D,
  GUITAR_STANDARD,
  instrumentRange,
} from '../src/core/index.js';
import { Instrument } from '../src/model/instrument.js';

/** Every built-in profile, with the named constructor that hands it out. */
const BUILT_INS: [string, InstrumentProfile, Instrument][] = [
  ['guitar', GUITAR_STANDARD, Instrument.guitar()],
  ['guitar (drop D)', GUITAR_DROP_D, Instrument.guitarDropD()],
  ['4-string bass', BASS_4_STRING, Instrument.bass4()],
  ['5-string bass', BASS_5_STRING, Instrument.bass5()],
];

describe('Instrument plain data', () => {
  it.each(BUILT_INS)('%s hands out its profile as a fresh copy', (_name, profile, instrument) => {
    expect(instrument.data).not.toBe(instrument.data);
    expect(instrument.data).toEqual(instrument.data);
    // Editing what was handed out reaches neither the instrument nor the next
    // reader of it: the lists are copies too, not the profile's own.
    const handed = instrument.data as StringedProfile;
    (handed.tuning as number[])[0] = 0;
    (handed.articulations as Articulation[]).pop();
    expect(instrument.data).toEqual(profile);
    expect(instrument.articulations).toEqual([...profile.articulations]);
    expect(instrument.range()).toEqual(instrumentRange(profile));
  });
});
