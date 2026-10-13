import { describe, expect, it } from 'vitest';
import { detectCadence, functionOf } from '../src/analyze/functional/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';

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
      rationale: expect.any(String),
      alternatives: [],
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
      rationale: expect.any(String),
      alternatives: [],
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
      rationale: expect.any(String),
      alternatives: [],
    });
  });

  it('still reports the inversions of a pair that cadences not at all', () => {
    expect(detectCadence(makeChord(0, 'maj'), makeChord(2, 'min', 5), cMajor)).toMatchObject({
      type: null,
      rootPosition: false,
    });
  });
});

describe('one reading of what the dominant is', () => {
  // A cadence is read from both ends, and the two ends used to ask different
  // questions. The approach side asked the shared predicate; the arrival side
  // asked only for a major third, so the `V7sus4` gospel, pop and modal jazz
  // write the dominant as arrived at nothing — while the same file's six-four
  // reader accepted it as the dominant a moment earlier.

  /** G7sus4: the dominant with its third suspended into the fourth. */
  const suspendedDominant = makeChord(7, '7sus4');

  it('comes to a suspended dominant as it comes to a plain one', () => {
    expect(detectCadence(makeChord(0, 'maj'), suspendedDominant, cMajor).type).toBe('half');
  });

  it('leaves a suspended dominant as it leaves a plain one', () => {
    expect(detectCadence(suspendedDominant, makeChord(0, 'maj'), cMajor).type).toBe('authentic');
    expect(detectCadence(suspendedDominant, makeChord(9, 'min'), cMajor).type).toBe('deceptive');
  });

  it('never calls a chord the dominant and then reports no cadence to it', () => {
    // The six-four reader and the arrival reader are the two halves of one
    // question, so a pair the first accepts and the second refuses is a result
    // that contradicts its own rationale: "the arrival stands on the fifth
    // degree but sounds no third the key rests on", about a chord this file
    // has just called the dominant.
    const qualities = ['maj', 'dom7', '7sus4', 'sus4', 'min', 'maj7', '6', 'dim'] as const;
    const contradictions: string[] = [];
    let sixFours = 0;
    for (const key of [cMajor, aMinor]) {
      for (const quality of qualities) {
        const to = makeChord((key.rootPc + 7) % 12, quality);
        // The cadential six-four: the tonic triad over the dominant in the bass.
        const from = makeChord(key.rootPc, 'maj', (key.rootPc + 7) % 12);
        const result = detectCadence(from, to, key);
        if (!result.rationale.includes('six-four')) {
          continue;
        }
        sixFours += 1;
        if (result.type === null) {
          contradictions.push(`${key.rootPc}: ${quality}`);
        }
      }
    }
    expect(sixFours).toBeGreaterThan(0);
    expect(contradictions).toEqual([]);
  });

  it('keeps the modal relaxation a mode without its own leading tone needs', () => {
    // D dorian has no raised seventh, so its own minor `v` is the dominant it
    // has, and the arrival's own third serves. Widening the reading above must
    // not take that away.
    const dDorian = scaleByName('dorian', 2);
    expect(detectCadence(makeChord(2, 'min'), makeChord(9, 'min'), dDorian).type).toBe('half');
  });
});
