import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { parseNote } from '../src/core/pitch/index.js';
import type { Chord } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import type { PartWritingViolation } from '../src/theory/partwriting/index.js';
import { checkPartWriting, spellVoicing } from '../src/theory/partwriting/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';
import { noteNames } from '../src/theory/spelling/index.js';

const C_MAJOR = majorKey(0);
const A_HARMONIC_MINOR = scaleByName('harmonicMinor', 9);

/** Spell a whole exercise, one MIDI voicing per chord. */
function spellExercise(pitches: number[][], chords: Chord[], key = C_MAJOR) {
  return pitches.map((voicing, index) => {
    const chord = chords[index];
    if (chord === undefined) {
      throw new Error(`the exercise has no chord at index ${index}`);
    }
    return spellVoicing(voicing, chord, key);
  });
}

/** The kind/voices/position of each violation, for compact assertions. */
function summarize(violations: PartWritingViolation[]) {
  return violations.map((v) => ({
    kind: v.kind,
    voices: v.voices,
    fromIndex: v.fromIndex,
    toIndex: v.toIndex,
  }));
}

describe('spellVoicing', () => {
  it('spells chord tones by their interval above the root', () => {
    // D major in C major: the third is the leading tone of G, so it spells F#.
    const voicing = spellVoicing([50, 57, 66, 69], makeChord(2, 'maj'), C_MAJOR);
    expect(noteNames(voicing)).toEqual(['D3', 'A3', 'F#4', 'A4']);
  });

  it('spells the raised seventh of a harmonic minor key from the key', () => {
    const voicing = spellVoicing([52, 59, 64, 68], makeChord(4, 'maj'), A_HARMONIC_MINOR);
    expect(noteNames(voicing)).toEqual(['E3', 'B3', 'E4', 'G#4']);
  });
});

describe('parallel perfects', () => {
  it('flags a parallel fifth between the bass and tenor with its position', () => {
    // C major to D minor with the tenor a fifth above the bass throughout.
    const chords = [makeChord(0, 'maj'), makeChord(2, 'min')];
    const voicings = spellExercise(
      [
        [48, 55, 64, 72],
        [50, 57, 65, 69],
      ],
      chords,
    );
    expect(summarize(checkPartWriting(voicings, chords, C_MAJOR))).toEqual([
      { kind: 'parallelFifth', voices: [0, 1], fromIndex: 0, toIndex: 1 },
    ]);
  });

  it('names the musical reason rather than a rule identifier', () => {
    const chords = [makeChord(0, 'maj'), makeChord(2, 'min')];
    const voicings = spellExercise(
      [
        [48, 55, 64, 72],
        [50, 57, 65, 69],
      ],
      chords,
    );
    expect(checkPartWriting(voicings, chords, C_MAJOR)[0]?.rationale).toBe(
      'The two voices move into consecutive perfect fifths',
    );
  });

  it('flags a parallel octave between the outer voices', () => {
    // Bass and soprano an octave apart, both stepping up.
    const chords = [makeChord(0, 'maj'), makeChord(2, 'min')];
    const voicings = spellExercise(
      [
        [48, 52, 55, 60],
        [50, 53, 57, 62],
      ],
      chords,
    );
    const kinds = checkPartWriting(voicings, chords, C_MAJOR).filter(
      (v) => v.kind === 'parallelOctave',
    );
    expect(summarize(kinds)).toContainEqual({
      kind: 'parallelOctave',
      voices: [0, 3],
      fromIndex: 0,
      toIndex: 1,
    });
  });
});

describe('a clean textbook progression', () => {
  it('reports no violation at all for I-IV-V-I', () => {
    const chords = [
      makeChord(0, 'maj'),
      makeChord(5, 'maj'),
      makeChord(7, 'maj'),
      makeChord(0, 'maj'),
    ];
    const voicings = spellExercise(
      [
        [48, 60, 64, 67],
        [53, 60, 65, 69],
        [55, 59, 62, 67],
        [48, 60, 64, 67],
      ],
      chords,
    );
    expect(noteNames(voicings[2] ?? [])).toEqual(['G3', 'B3', 'D4', 'G4']);
    expect(checkPartWriting(voicings, chords, C_MAJOR)).toEqual([]);
  });
});

describe('cross relation', () => {
  // F major to D major: the soprano's F is contradicted by the alto's F#.
  const chords = [makeChord(5, 'maj'), makeChord(2, 'maj')];

  it('flags the same letter differently inflected in two voices', () => {
    const voicings = spellExercise(
      [
        [57, 60, 69, 77],
        [50, 62, 66, 69],
      ],
      chords,
    );
    const crossRelations = checkPartWriting(voicings, chords, C_MAJOR).filter(
      (v) => v.kind === 'crossRelation',
    );
    expect(summarize(crossRelations)).toEqual([
      { kind: 'crossRelation', voices: [3, 2], fromIndex: 0, toIndex: 1 },
    ]);
    expect(crossRelations[0]?.rationale).toBe('F is contradicted by F# in another voice');
  });

  it('does not flag the same motion inside a single voice', () => {
    // The soprano itself moves F5 to F#5: an ordinary chromatic inflection.
    const voicings = spellExercise(
      [
        [57, 60, 69, 77],
        [50, 62, 69, 78],
      ],
      chords,
    );
    const violations = checkPartWriting(voicings, chords, C_MAJOR);
    expect(violations.filter((v) => v.kind === 'crossRelation')).toEqual([]);
    // The augmented unison is that same inflection, so it is not a forbidden
    // melodic interval either.
    expect(violations.filter((v) => v.kind === 'augmentedMelodicInterval')).toEqual([]);
  });
});

describe('tendency tones', () => {
  it('flags a chordal seventh that rises instead of falling by step', () => {
    // G7 to C with the tenor taking its F up to G.
    const chords = [makeChord(7, 'dom7'), makeChord(0, 'maj')];
    const voicings = spellExercise(
      [
        [43, 53, 59, 62],
        [48, 55, 60, 64],
      ],
      chords,
    );
    expect(summarize(checkPartWriting(voicings, chords, C_MAJOR))).toEqual([
      { kind: 'unresolvedSeventh', voices: [1], fromIndex: 0, toIndex: 1 },
    ]);
  });

  it('accepts the seventh when it falls by step', () => {
    const chords = [makeChord(7, 'dom7'), makeChord(0, 'maj')];
    const voicings = spellExercise(
      [
        [43, 53, 59, 62],
        [48, 52, 60, 64],
      ],
      chords,
    );
    expect(checkPartWriting(voicings, chords, C_MAJOR)).toEqual([]);
  });

  it('flags a leading tone that does not rise to the tonic', () => {
    // The alto's B falls to G instead of stepping up to C.
    const chords = [makeChord(7, 'maj'), makeChord(0, 'maj')];
    const voicings = spellExercise(
      [
        [55, 59, 62, 67],
        [48, 55, 64, 67],
      ],
      chords,
    );
    const unresolved = checkPartWriting(voicings, chords, C_MAJOR).filter(
      (v) => v.kind === 'unresolvedLeadingTone',
    );
    expect(summarize(unresolved)).toEqual([
      { kind: 'unresolvedLeadingTone', voices: [1], fromIndex: 0, toIndex: 1 },
    ]);
  });
});

describe('augmented melodic intervals', () => {
  it('flags the augmented second of a harmonic minor exercise', () => {
    // VI to V in A harmonic minor with the soprano moving F4 to G#4.
    const chords = [makeChord(5, 'maj'), makeChord(4, 'maj')];
    const voicings = spellExercise(
      [
        [53, 57, 60, 65],
        [52, 59, 64, 68],
      ],
      chords,
      A_HARMONIC_MINOR,
    );
    const violations = checkPartWriting(voicings, chords, A_HARMONIC_MINOR);
    expect(summarize(violations)).toEqual([
      { kind: 'augmentedMelodicInterval', voices: [3], fromIndex: 0, toIndex: 1 },
    ]);
    expect(violations[0]?.rationale).toBe('The voice moves by an augmented second');
  });

  it('flags the augmented fourth and leaves the enharmonic diminished fifth alone', () => {
    // Both sopranos rise by the same six semitones; only the spelling differs,
    // which is the whole reason the checker reads spelled notes.
    const rising = [makeChord(5, 'maj'), makeChord(7, 'maj')];
    const augmented = spellExercise(
      [
        [53, 57, 60, 65],
        [55, 59, 62, 71],
      ],
      rising,
    );
    // The soprano moves F4 to B4: an augmented fourth.
    expect(noteNames(augmented[0] ?? [])).toEqual(['F3', 'A3', 'C4', 'F4']);
    expect(noteNames(augmented[1] ?? [])).toEqual(['G3', 'B3', 'D4', 'B4']);
    expect(
      summarize(
        checkPartWriting(augmented, rising, C_MAJOR).filter(
          (v) => v.kind === 'augmentedMelodicInterval',
        ),
      ),
    ).toEqual([{ kind: 'augmentedMelodicInterval', voices: [3], fromIndex: 0, toIndex: 1 }]);

    const falling = [makeChord(7, 'maj'), makeChord(5, 'maj')];
    const diminished = spellExercise(
      [
        [55, 62, 67, 71],
        [53, 60, 69, 77],
      ],
      falling,
    );
    // The soprano moves B4 to F5 instead: a diminished fifth across the same
    // six semitones.
    expect(noteNames(diminished[0] ?? [])).toEqual(['G3', 'D4', 'G4', 'B4']);
    expect(noteNames(diminished[1] ?? [])).toEqual(['F3', 'C4', 'A4', 'F5']);
    expect(
      checkPartWriting(diminished, falling, C_MAJOR).filter(
        (v) => v.kind === 'augmentedMelodicInterval',
      ),
    ).toEqual([]);
  });

  it('leaves the minor third that the augmented second is spelled against alone', () => {
    // iv to VI in C natural minor: the soprano moves F4 to Ab4, the same three
    // semitones the harmonic-minor F to G# spans, spelled as a minor third.
    const chords = [makeChord(5, 'min'), makeChord(8, 'maj')];
    const voicings = spellExercise(
      [
        [53, 56, 60, 65],
        [51, 56, 60, 68],
      ],
      chords,
      minorKey(0),
    );
    expect(noteNames(voicings[1] ?? [])).toEqual(['Eb3', 'Ab3', 'C4', 'Ab4']);
    expect(
      checkPartWriting(voicings, chords, minorKey(0)).filter(
        (v) => v.kind === 'augmentedMelodicInterval',
      ),
    ).toEqual([]);
  });
});

describe('texture rules', () => {
  it('flags voice crossing, over-wide spacing, and a voice out of its range', () => {
    const chords = [makeChord(0, 'maj')];
    // Tenor above the alto, soprano more than an octave above the alto, and the
    // bass below the SATB bass range.
    const voicings = spellExercise([[36, 67, 64, 79]], chords);
    expect(summarize(checkPartWriting(voicings, chords, C_MAJOR))).toEqual([
      { kind: 'voiceCrossing', voices: [1, 2], fromIndex: 0, toIndex: 0 },
      { kind: 'spacing', voices: [2, 3], fromIndex: 0, toIndex: 0 },
      { kind: 'range', voices: [0], fromIndex: 0, toIndex: 0 },
    ]);
  });

  it('exempts the bass-tenor pair from the spacing limit', () => {
    const chords = [makeChord(0, 'maj')];
    const voicings = spellExercise([[40, 60, 64, 67]], chords);
    expect(checkPartWriting(voicings, chords, C_MAJOR)).toEqual([]);
  });

  it('honours an explicit spacing limit and explicit ranges', () => {
    const chords = [makeChord(0, 'maj')];
    const voicings = spellExercise([[48, 60, 64, 67]], chords);
    const violations = checkPartWriting(voicings, chords, C_MAJOR, {
      maxSpacing: 2,
      ranges: [
        { min: 40, max: 60 },
        { min: 48, max: 67 },
        { min: 55, max: 74 },
        { min: 60, max: 66 },
      ],
    });
    expect(summarize(violations)).toEqual([
      { kind: 'spacing', voices: [1, 2], fromIndex: 0, toIndex: 0 },
      { kind: 'spacing', voices: [2, 3], fromIndex: 0, toIndex: 0 },
      { kind: 'range', voices: [3], fromIndex: 0, toIndex: 0 },
    ]);
    expect(violations[0]?.rationale).toBe('Adjacent upper voices lie more than 2 semitones apart');
  });

  it('flags voice overlap between adjacent voices', () => {
    const chords = [makeChord(0, 'maj'), makeChord(5, 'maj')];
    // The alto drops below where the tenor just was.
    const voicings = spellExercise(
      [
        [48, 60, 64, 72],
        [53, 57, 57, 72],
      ],
      chords,
    );
    const overlaps = checkPartWriting(voicings, chords, C_MAJOR).filter(
      (v) => v.kind === 'overlap',
    );
    expect(summarize(overlaps)).toEqual([
      { kind: 'overlap', voices: [1, 2], fromIndex: 0, toIndex: 1 },
    ]);
  });

  it('flags a hidden perfect reached by a leap in the outer voices', () => {
    // Bass and soprano both rise into a fifth, the soprano by a leap.
    const chords = [makeChord(5, 'maj'), makeChord(7, 'maj')];
    const voicings = spellExercise(
      [
        [53, 57, 60, 69],
        [55, 59, 67, 74],
      ],
      chords,
    );
    expect(summarize(checkPartWriting(voicings, chords, C_MAJOR))).toEqual([
      { kind: 'hiddenPerfect', voices: [0, 3], fromIndex: 0, toIndex: 1 },
    ]);
  });
});

describe('input validation', () => {
  it('rejects a chord count that does not match the voicings', () => {
    const chords = [makeChord(0, 'maj')];
    const voicings = spellExercise([[48, 55, 64, 72]], chords);
    expect(() => checkPartWriting([...voicings, ...voicings], chords, C_MAJOR)).toThrow(
      InvalidInputError,
    );
  });

  it('rejects a note without an octave', () => {
    const chords = [makeChord(0, 'maj')];
    expect(() => checkPartWriting([[parseNote('C')]], chords, C_MAJOR)).toThrow(InvalidInputError);
  });
});
