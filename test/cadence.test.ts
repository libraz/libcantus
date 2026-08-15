import { describe, expect, it } from 'vitest';
import { detectCadence, functionOf } from '../src/analyze/functional/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

/** G major triad voiced G3-D4-B4, the dominant of C. */
const dominantVoicing = [55, 62, 71];

describe('authentic cadence strength', () => {
  it('grades V-I with a root-position tonic in the soprano as perfect', () => {
    const result = detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), cMajor, {
      // C3-E4-G4-C5: the tonic on top, both chords on their roots.
      voicing: [dominantVoicing, [48, 64, 67, 72]],
    });
    expect(result).toEqual({
      type: 'authentic',
      strength: 'perfect',
      soprano: 'root',
      rootPosition: true,
      evaded: false,
    });
  });

  it('grades the same chords with the third on top as imperfect', () => {
    const result = detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), cMajor, {
      // C3-G3-C4-E4: root position still, but the soprano lands on the third.
      voicing: [dominantVoicing, [48, 55, 60, 64]],
    });
    expect(result).toMatchObject({
      type: 'authentic',
      strength: 'imperfect',
      soprano: 'third',
      rootPosition: true,
    });
  });

  it('reports an unknown strength when no voicing names the soprano', () => {
    const result = detectCadence(makeChord(7, 'dom7'), makeChord(0, 'maj'), cMajor);
    expect(result).toEqual({
      type: 'authentic',
      strength: null,
      rootPosition: true,
      evaded: false,
    });
    expect(result.soprano).toBeUndefined();
  });

  it('never grades a leading-tone cadence perfect, whatever the soprano', () => {
    const result = detectCadence(makeChord(11, 'dim'), makeChord(0, 'maj'), cMajor, {
      // B3-D4-F4 to C3-E4-G4-C5: the tonic is in the soprano, but the dominant
      // root never sounds.
      voicing: [
        [59, 62, 65],
        [48, 64, 67, 72],
      ],
    });
    expect(result).toMatchObject({ type: 'authentic', strength: 'imperfect', soprano: 'root' });
  });

  it('grades an inverted dominant imperfect without calling it evaded', () => {
    // V6: the dominant on its third, resolving to a root-position tonic.
    const result = detectCadence(makeChord(7, 'maj', 11), makeChord(0, 'maj'), cMajor);
    expect(result).toMatchObject({
      type: 'authentic',
      strength: 'imperfect',
      rootPosition: false,
      evaded: false,
    });
  });

  it('leaves strength null for every cadence that is not authentic', () => {
    expect(detectCadence(makeChord(5, 'maj'), makeChord(0, 'maj'), cMajor).strength).toBeNull();
    expect(detectCadence(makeChord(2, 'min'), makeChord(7, 'maj'), cMajor).strength).toBeNull();
  });
});

describe('phrygian cadence', () => {
  it('reads iv6 to V in a minor key as phrygian', () => {
    // Dm/F to E: the bass falls a semitone from b6 to 5.
    const result = detectCadence(makeChord(2, 'min', 5), makeChord(4, 'maj'), aMinor);
    expect(result).toMatchObject({ type: 'phrygian', strength: null, rootPosition: false });
  });

  it('takes the bass from a voicing when the chords name none', () => {
    const result = detectCadence(makeChord(2, 'min'), makeChord(4, 'maj'), aMinor, {
      // F3-A3-D4 to E3-G#3-B3: the written chords are root position, the
      // sounding bass is not.
      voicing: [
        [53, 57, 62],
        [52, 56, 59],
      ],
    });
    expect(result.type).toBe('phrygian');
  });

  it('keeps a root-position iv to V a plain half cadence', () => {
    expect(detectCadence(makeChord(2, 'min'), makeChord(4, 'maj'), aMinor).type).toBe('half');
  });

  it('does not name the motion phrygian in a major key', () => {
    // Fm/Ab to G in C major: the same semitone bass descent, but the borrowed
    // predominant of a major key is not the Phrygian cadence.
    expect(detectCadence(makeChord(5, 'min', 8), makeChord(7, 'maj'), cMajor).type).toBe('half');
  });
});

describe('modal cadence', () => {
  it('reads bVII to I as modal', () => {
    const result = detectCadence(makeChord(10, 'maj'), makeChord(0, 'maj'), cMajor);
    expect(result).toMatchObject({ type: 'modal', strength: null, rootPosition: true });
  });

  it('leaves the subtonic subdominant-functioned', () => {
    // Cadencing on the tonic says nothing about the chord's function.
    expect(functionOf(makeChord(10, 'maj'), cMajor)).toBe('subdominant');
  });

  it('requires a major third: bVII of a minor key does not cadence', () => {
    expect(detectCadence(makeChord(7, 'min'), makeChord(9, 'min'), aMinor).type).toBeNull();
  });
});

describe('evaded cadence', () => {
  it('names the type but flags V to I6 as evaded', () => {
    const result = detectCadence(makeChord(7, 'dom7'), makeChord(0, 'maj', 4), cMajor);
    expect(result).toMatchObject({
      type: 'authentic',
      strength: 'imperfect',
      rootPosition: false,
      evaded: true,
    });
  });

  it('hears the evasion in the voicing over the written chord', () => {
    const result = detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), cMajor, {
      // E3-G3-C4-E4: the tonic arrives over its third whatever the symbol says.
      voicing: [dominantVoicing, [52, 55, 60, 64]],
    });
    expect(result).toMatchObject({ type: 'authentic', evaded: true, soprano: 'third' });
  });

  it('does not flag a plagal or deceptive arrival as evaded', () => {
    expect(detectCadence(makeChord(5, 'maj'), makeChord(0, 'maj', 4), cMajor).evaded).toBe(false);
    expect(detectCadence(makeChord(7, 'maj'), makeChord(9, 'min'), cMajor).evaded).toBe(false);
  });
});

describe('non-cadences', () => {
  it('does not treat a static V-to-V repeat as a cadence', () => {
    expect(detectCadence(makeChord(7, 'maj'), makeChord(7, 'maj'), cMajor)).toEqual({
      type: null,
      strength: null,
      rootPosition: true,
      evaded: false,
    });
  });

  it('still reports the inversions of a pair that cadences not at all', () => {
    expect(detectCadence(makeChord(0, 'maj'), makeChord(2, 'min', 5), cMajor)).toMatchObject({
      type: null,
      rootPosition: false,
    });
  });
});
