import { describe, expect, it } from 'vitest';
import { detectCadence } from '../src/analyze/functional/index.js';
import { diatonicTriad, makeChord } from '../src/theory/chord/index.js';
import {
  majorKey,
  minorKey,
  scaleByName,
  scaleSystemOf,
  scaleTonesInDegreeOrder,
} from '../src/theory/scale/index.js';

/** The seven diatonic modes, each on a tonic of its own. */
const MODES = [
  { name: 'ionian', key: scaleByName('ionian', 0) },
  { name: 'dorian', key: scaleByName('dorian', 2) },
  { name: 'phrygian', key: scaleByName('phrygian', 4) },
  { name: 'lydian', key: scaleByName('lydian', 5) },
  { name: 'mixolydian', key: scaleByName('mixolydian', 7) },
  { name: 'aeolian', key: scaleByName('aeolian', 9) },
  { name: 'locrian', key: scaleByName('locrian', 11) },
];

/** The offset above the tonic of a scale degree of a heptatonic key. */
function degreeOffset(degreeNumber: number, key: { rootPc: number; modeMask12: number }): number {
  const tones = scaleTonesInDegreeOrder(key);
  return ((((tones[degreeNumber - 1] ?? 0) - key.rootPc) % 12) + 12) % 12;
}

describe('the deceptive cadence resolves onto the submediant the mode has', () => {
  it.each(MODES)('lands on the sixth degree of $name', ({ key }) => {
    // A major triad a fifth above the tonic is the dominant of any mode, raised
    // leading tone and all; where it resolves is what the mode decides.
    const dominant = makeChord((key.rootPc + 7) % 12, 'maj');
    const submediant = diatonicTriad(6, key);
    expect(detectCadence(dominant, submediant, key).type).toBe('deceptive');
    expect((submediant.rootPc - key.rootPc + 12) % 12).toBe(degreeOffset(6, key));
  });

  it.each(MODES)('leaves the sixth the mode does not have alone in $name', ({ key, name }) => {
    const dominant = makeChord((key.rootPc + 7) % 12, 'maj');
    const submediant = degreeOffset(6, key);
    const otherSixth = submediant === 8 ? 9 : 8;
    const arrival = makeChord((key.rootPc + otherSixth) % 12, submediant === 8 ? 'min' : 'maj');
    // A major key keeps the borrowed bVI as a deceptive arrival of its own; no
    // other mode borrows a second submediant.
    const expected = name === 'ionian' || name === 'lydian' || name === 'mixolydian';
    expect(detectCadence(dominant, arrival, key).type === 'deceptive').toBe(expected);
  });

  it('reads A major to B diminished in D dorian as deceptive', () => {
    const dDorian = scaleByName('dorian', 2);
    expect(detectCadence(makeChord(9, 'maj'), makeChord(11, 'dim'), dDorian).type).toBe(
      'deceptive',
    );
  });
});

describe('the half cadence rests on the dominant the mode has', () => {
  it.each(MODES)('accepts the diatonic chord on the fifth degree of $name', ({ key }) => {
    const predominant = diatonicTriad(4, key);
    const dominant = diatonicTriad(5, key);
    // A dominant with a major third rests anywhere. Without one the arrival
    // rests only where the key has no leading-tone dominant to be measured
    // against, which is the modes: aeolian is the natural minor, and a minor
    // key cadences through the raised seventh it writes as an accidental.
    const rests = dominant.quality === 'maj' || scaleSystemOf(key) === 'modal';
    expect(detectCadence(predominant, dominant, key).type).toBe(rests ? 'half' : null);
    expect((dominant.rootPc - key.rootPc + 12) % 12).toBe(degreeOffset(5, key));
  });

  it('reads G to Am in D dorian as a half cadence', () => {
    const dDorian = scaleByName('dorian', 2);
    expect(detectCadence(makeChord(7, 'maj'), makeChord(9, 'min'), dDorian).type).toBe('half');
  });

  it('refuses the minor v of a natural minor key and keeps its major dominant', () => {
    // A minor is not a mode being read as one: its cadence goes through E
    // major, so Am to Em rests on nothing and would put a phrase boundary
    // wherever the harmony merely touched the fifth degree.
    const aMinor = minorKey(9);
    expect(detectCadence(makeChord(9, 'min'), makeChord(4, 'min'), aMinor).type).toBeNull();
    expect(detectCadence(makeChord(9, 'min'), makeChord(4, 'maj'), aMinor).type).toBe('half');
  });

  it('keeps the major dominant of a minor key a half cadence', () => {
    // The relaxation adds the modal `v`; it does not take the raised dominant
    // that harmonic-minor practice cadences on away.
    expect(detectCadence(makeChord(2, 'min'), makeChord(4, 'maj'), minorKey(9)).type).toBe('half');
  });

  it('refuses a borrowed minor v in a major key', () => {
    // C major has its own leading tone in the dominant, so nothing else stands
    // in for it: Gm is not what the phrase was left resting on.
    expect(detectCadence(makeChord(5, 'maj'), makeChord(7, 'min'), majorKey(0)).type).toBeNull();
  });

  it('refuses an arrival on the fifth degree with no third to rest on', () => {
    // The relaxed reading rests on the third the mode gives its dominant, so a
    // chord that sounds none of it — a bare fifth, a suspension — is not it.
    const aAeolian = scaleByName('aeolian', 9);
    expect(detectCadence(makeChord(2, 'min'), makeChord(4, '5'), aAeolian).type).toBeNull();
    expect(detectCadence(makeChord(2, 'min'), makeChord(4, 'sus4'), aAeolian).type).toBeNull();
  });
});

describe('the plagal cadence falls from the fourth degree the mode has', () => {
  it.each(MODES)('reads the subdominant of $name as the plagal approach', ({ key }) => {
    const subdominant = diatonicTriad(4, key);
    const tonic = diatonicTriad(1, key);
    expect(detectCadence(subdominant, tonic, key).type).toBe('plagal');
    expect((subdominant.rootPc - key.rootPc + 12) % 12).toBe(degreeOffset(4, key));
  });

  it('hears the tritone subdominant of lydian, and leaves the natural fourth alone', () => {
    // C lydian puts its fourth degree on F#, so that is the chord a plagal
    // cadence falls from; F is not in the key at all and cadences onto nothing,
    // whatever its distance from the tonic.
    const cLydian = scaleByName('lydian', 0);
    expect(detectCadence(makeChord(6, 'maj'), makeChord(0, 'maj'), cLydian).type).toBe('plagal');
    expect(detectCadence(makeChord(5, 'maj'), makeChord(0, 'maj'), cLydian).type).not.toBe(
      'plagal',
    );
  });

  it('keeps the plagal cadence major and minor keys already had', () => {
    expect(detectCadence(makeChord(5, 'maj'), makeChord(0, 'maj'), majorKey(0)).type).toBe(
      'plagal',
    );
    expect(detectCadence(makeChord(5, 'min'), makeChord(0, 'min'), minorKey(0)).type).toBe(
      'plagal',
    );
  });
});
