import { describe, expect, it } from 'vitest';
import type {
  Articulation,
  InstrumentProfile,
  PercussionProfile,
  StringedProfile,
} from '../src/core/index.js';
import {
  BASS_4_STRING,
  BASS_5_STRING,
  canSound,
  fingeringsFor,
  foldIntoRange,
  GUITAR_DROP_D,
  GUITAR_STANDARD,
  instrumentRange,
  playability,
} from '../src/core/index.js';
import { Instrument } from '../src/model/instrument.js';

/**
 * The class holds a profile and hands it to the instrument module, so every
 * method is checked against the function it delegates to on the same profile:
 * the class must reach the same verdict the functions reach.
 */

/** A kit, the family no built-in profile covers, described by what each limb reaches. */
const KIT: PercussionProfile = {
  kind: 'percussion',
  name: 'kit',
  limbs: ['rightHand', 'leftHand', 'rightFoot'],
  reach: { 36: ['rightFoot'], 38: ['rightHand', 'leftHand'], 42: ['rightHand'] },
  articulations: ['accent', 'ghost'],
  polyphony: 3,
};

/** Every built-in profile, with the named constructor that hands it out. */
const BUILT_INS: [string, InstrumentProfile, Instrument][] = [
  ['guitar', GUITAR_STANDARD, Instrument.guitar()],
  ['guitar (drop D)', GUITAR_DROP_D, Instrument.guitarDropD()],
  ['4-string bass', BASS_4_STRING, Instrument.bass4()],
  ['5-string bass', BASS_5_STRING, Instrument.bass5()],
];

/** A stand-in exposing only the public surface, as a second copy of the class is. */
function publicOnly(instrument: Instrument): Instrument {
  return {
    get data() {
      return instrument.data;
    },
  } as unknown as Instrument;
}

describe('Instrument plain data', () => {
  it.each(BUILT_INS)('%s names the profile it was built from', (name, profile, instrument) => {
    expect(instrument.name).toBe(name);
    expect(instrument.data).toEqual(profile);
    expect(instrument.toString()).toBe(name);
    expect(instrument.kind).toBe(profile.kind);
    expect(instrument.polyphony).toBe(profile.polyphony);
    expect(instrument.articulations).toEqual([...profile.articulations]);
  });

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

  it.each(BUILT_INS)('%s round-trips through its plain data', (_name, _profile, instrument) => {
    expect(instrument.toJSON()).toEqual(instrument.data);
    expect(JSON.parse(JSON.stringify(instrument))).toEqual(instrument.data);
    expect(Instrument.fromData(instrument.data).data).toEqual(instrument.data);
    expect(Instrument.fromJSON(JSON.parse(JSON.stringify(instrument))).equals(instrument)).toBe(
      true,
    );
  });

  it('round-trips a kit, limbs and reach alike', () => {
    const kit = Instrument.of(KIT);
    expect(kit.data).toEqual(KIT);
    expect(Instrument.fromData(kit.data).equals(kit)).toBe(true);
    expect(kit.range()).toEqual({ low: 36, high: 42 });
  });

  it('keeps the profile it was given out of its own state', () => {
    const profile: StringedProfile = {
      kind: 'stringed',
      name: 'three-string',
      tuning: [40, 45, 50],
      frets: 12,
      maxStretch: 4,
      articulations: ['open'],
      polyphony: 3,
    };
    const instrument = Instrument.of(profile);
    profile.tuning[0] = 0;
    profile.frets = 24;
    expect(instrument.data).toEqual({ ...profile, tuning: [40, 45, 50], frets: 12 });
  });

  it('carries the fretless flag only on a neck that has no frets', () => {
    const bass = Instrument.of({ ...BASS_4_STRING, fretless: true });
    expect('fretless' in Instrument.of({ ...BASS_4_STRING, fretless: false }).data).toBe(false);
    expect(bass.data).toHaveProperty('fretless', true);
    expect('fretless' in Instrument.bass4().data).toBe(false);
    expect(bass.equals(Instrument.bass4())).toBe(false);
  });
});

describe('Instrument rejects a profile it cannot hold', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses %s in every number of the profile',
    (poison) => {
      expect(() => Instrument.fromData({ ...GUITAR_STANDARD, frets: poison })).toThrow(RangeError);
      expect(() => Instrument.fromData({ ...GUITAR_STANDARD, maxStretch: poison })).toThrow(
        RangeError,
      );
      expect(() => Instrument.fromData({ ...GUITAR_STANDARD, polyphony: poison })).toThrow(
        RangeError,
      );
      expect(() => Instrument.fromData({ ...GUITAR_STANDARD, tuning: [40, poison] })).toThrow(
        RangeError,
      );
      expect(() => Instrument.fromData({ ...KIT, polyphony: poison })).toThrow(RangeError);
    },
  );

  it('refuses a profile that describes no instrument', () => {
    expect(() => Instrument.of({ ...GUITAR_STANDARD, tuning: [] })).toThrow(RangeError);
    expect(() => Instrument.of({ ...GUITAR_STANDARD, frets: -1 })).toThrow(RangeError);
    expect(() => Instrument.of({ ...GUITAR_STANDARD, frets: 1.5 })).toThrow(RangeError);
    expect(() => Instrument.of({ ...KIT, reach: {} })).toThrow(RangeError);
  });
});

describe('Instrument equality', () => {
  it('compares through the public surface alone', () => {
    const guitar = Instrument.guitar();
    expect(guitar.equals(publicOnly(guitar))).toBe(true);
    expect(guitar.equals(Instrument.of(GUITAR_STANDARD))).toBe(true);
    expect(guitar.equals(Instrument.guitarDropD())).toBe(false);
    expect(guitar.equals(Instrument.bass4())).toBe(false);
  });

  it('separates a kit from another kit and from a neck', () => {
    const kit = Instrument.of(KIT);
    expect(kit.equals(Instrument.of(KIT))).toBe(true);
    expect(kit.equals(Instrument.of({ ...KIT, limbs: ['rightHand'] }))).toBe(false);
    expect(kit.equals(Instrument.of({ ...KIT, reach: { 36: ['rightFoot'] } }))).toBe(false);
    expect(
      kit.equals(Instrument.of({ ...KIT, reach: { 36: ['rightHand'], 38: [], 42: [] } })),
    ).toBe(false);
    expect(kit.equals(Instrument.guitar())).toBe(false);
  });
});

describe('Instrument answers what the instrument functions answer', () => {
  it.each(BUILT_INS)('%s reports the range of its profile', (_name, profile, instrument) => {
    expect(instrument.range()).toEqual(instrumentRange(profile));
  });

  it.each(BUILT_INS)('%s sounds the pitches its profile sounds', (_name, profile, instrument) => {
    for (let pitch = 0; pitch <= 127; pitch += 1) {
      expect(instrument.canSound(pitch)).toBe(canSound(profile, pitch));
      expect(instrument.foldIntoRange(pitch)).toBe(foldIntoRange(pitch, profile));
    }
  });

  it.each(BUILT_INS)('%s fingers a pitch where its profile does', (_name, profile, instrument) => {
    for (let pitch = 20; pitch <= 96; pitch += 1) {
      expect(instrument.fingerings(pitch)).toEqual(
        fingeringsFor(profile as StringedProfile, pitch),
      );
    }
    expect(instrument.fingerings(64).length).toBeGreaterThan(0);
  });

  it('has no neck to finger a pitch on when it is a kit', () => {
    expect(() => Instrument.of(KIT).fingerings(38)).toThrow(RangeError);
    expect(Instrument.of(KIT).canSound(38)).toBe(true);
    expect(Instrument.of(KIT).canSound(37)).toBe(false);
  });

  it('reads a passage the way the playability function reads it', () => {
    const notes = [
      { pitch: 27, startBeat: 0, durationBeat: 1 },
      { pitch: 40, startBeat: 1, durationBeat: 1 },
      { pitch: 43, startBeat: 1, durationBeat: 1 },
    ];
    const bass = Instrument.bass4();
    expect(bass.playability(notes)).toEqual(playability(notes, BASS_4_STRING));
    expect(bass.playability(notes, 180)).toEqual(playability(notes, BASS_4_STRING, 180));
    expect(bass.playability(notes).issues[0]?.type).toBe('noteOutOfRange');
    // The tempo is the only difference between the two readings.
    expect(bass.playability(notes, 600).difficulty).toBeGreaterThan(
      bass.playability(notes).difficulty,
    );
  });

  it('reads a kit passage limb by limb', () => {
    const hits = [
      { pitch: 36, startBeat: 0, durationBeat: 0.5 },
      { pitch: 38, startBeat: 0, durationBeat: 0.5 },
      { pitch: 42, startBeat: 0.5, durationBeat: 0.5 },
    ];
    expect(Instrument.of(KIT).playability(hits, 120)).toEqual(playability(hits, KIT, 120));
    expect(Instrument.of(KIT).playability(hits).placements[0]?.limb).toBe('rightFoot');
  });
});
