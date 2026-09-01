import { describe, expect, it } from 'vitest';
import {
  augmentedSixthChord,
  augmentedSixthFromPitchClasses,
  romanToChord,
} from '../src/analyze/functional/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { formatNote, noteToPitchClass, parseNote } from '../src/core/pitch/index.js';
import type { Chord } from '../src/theory/chord/index.js';
import { chordToneRole, makeChord } from '../src/theory/chord/index.js';
import type { PartWritingViolation } from '../src/theory/partwriting/index.js';
import { checkPartWriting, spellVoicing } from '../src/theory/partwriting/index.js';
import { majorKey, minorKey, scaleByName, spelledKeyOf } from '../src/theory/scale/index.js';
import { noteNames, spellChord } from '../src/theory/spelling/index.js';
import type { VoiceRange } from '../src/theory/voicing/index.js';
import { voiceProgression } from '../src/theory/voicing/index.js';
import { seventhPcOf } from '../src/theory/voicing/tendency.js';

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

  it('reports one clash per pair of voices, not one per direction', () => {
    // G7 doubling its seventh against a D major doubling its third: the two
    // voices are walked in both directions, so the same F/F# clash is met twice.
    const doubled = [makeChord(7, 'dom7'), makeChord(2, 'maj')];
    const voicings = spellExercise(
      [
        [43, 53, 59, 65],
        [50, 54, 62, 66],
      ],
      doubled,
    );
    expect(noteNames(voicings[0] ?? [])).toEqual(['G2', 'F3', 'B3', 'F4']);
    expect(noteNames(voicings[1] ?? [])).toEqual(['D3', 'F#3', 'D4', 'F#4']);
    expect(
      summarize(
        checkPartWriting(voicings, doubled, C_MAJOR).filter((v) => v.kind === 'crossRelation'),
      ),
    ).toEqual([{ kind: 'crossRelation', voices: [1, 3], fromIndex: 0, toIndex: 1 }]);
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

describe('cross relations the style admits', () => {
  /** Just the cross relations of an exercise, summarized. */
  function crossRelations(pitches: number[][], chords: Chord[], key = C_MAJOR) {
    return summarize(
      checkPartWriting(spellExercise(pitches, chords, key), chords, key).filter(
        (v) => v.kind === 'crossRelation',
      ),
    );
  }

  it('admits the chromatic tone an applied dominant brings with it', () => {
    // C: I - V7/vi - vi, written as a chorale would write it. The soprano's G
    // is contradicted by the tenor's G#, which is what tonicizing vi sounds
    // like; the seventh falls and the leading tone of vi rises.
    const chords = [makeChord(0, 'maj'), makeChord(4, 'dom7'), makeChord(9, 'min')];
    const voicings = spellExercise(
      [
        [48, 52, 60, 67],
        [52, 56, 59, 62],
        [45, 57, 57, 60],
      ],
      chords,
    );
    expect(noteNames(voicings[0] ?? [])).toEqual(['C3', 'E3', 'C4', 'G4']);
    expect(noteNames(voicings[1] ?? [])).toEqual(['E3', 'G#3', 'B3', 'D4']);
    expect(noteNames(voicings[2] ?? [])).toEqual(['A2', 'A3', 'A3', 'C4']);
    expect(checkPartWriting(voicings, chords, C_MAJOR)).toEqual([]);
  });

  it('still flags the same two letters where nothing is tonicized', () => {
    // The same G against G#, this time as a bare III with both voices leaping
    // into it and the soprano exposed. Nothing follows to be tonicized, so the
    // chord is a chromatic mediant rather than an applied dominant.
    const chords = [makeChord(0, 'maj'), makeChord(4, 'maj')];
    const voicings = spellExercise(
      [
        [48, 52, 60, 67],
        [52, 56, 59, 64],
      ],
      chords,
    );
    expect(noteNames(voicings[0] ?? [])).toEqual(['C3', 'E3', 'C4', 'G4']);
    expect(noteNames(voicings[1] ?? [])).toEqual(['E3', 'G#3', 'B3', 'E4']);
    expect(summarize(checkPartWriting(voicings, chords, C_MAJOR))).toEqual([
      { kind: 'crossRelation', voices: [3, 1], fromIndex: 0, toIndex: 1 },
    ]);
  });

  it('admits a chromatic tone that is led into by step', () => {
    // G7 to V/V: the soprano walks G4 down to F#4, so the tenor's F is
    // contradicted by a tone the line introduced rather than sprang.
    const chords = [makeChord(7, 'dom7'), makeChord(2, 'maj')];
    expect(
      crossRelations(
        [
          [43, 53, 62, 67],
          [50, 57, 62, 66],
        ],
        chords,
      ),
    ).toEqual([]);
    // The same two chords with the soprano leaping into the F# instead.
    expect(
      crossRelations(
        [
          [43, 53, 62, 71],
          [50, 57, 62, 66],
        ],
        chords,
      ),
    ).toEqual([{ kind: 'crossRelation', voices: [1, 3], fromIndex: 0, toIndex: 1 }]);
  });

  it('admits a cross relation buried in the inner voices', () => {
    // The same clash between tenor and alto, where the classical norm is far
    // milder than it is between the outer voices.
    const chords = [makeChord(7, 'dom7'), makeChord(2, 'maj')];
    expect(
      crossRelations(
        [
          [43, 53, 62, 71],
          [50, 57, 66, 69],
        ],
        chords,
      ),
    ).toEqual([]);
  });

  it('admits the Neapolitan contradicting the second degree', () => {
    // C minor: iio to N6. The flat second is what the chord is, so the tenor's
    // D natural and the soprano's Db are not the writer's mistake.
    const key = minorKey(0);
    const chords = [makeChord(2, 'dim'), makeChord(1, 'maj', 5)];
    const voicings = spellExercise(
      [
        [53, 62, 65, 68],
        [53, 65, 68, 73],
      ],
      chords,
      key,
    );
    expect(noteNames(voicings[1] ?? [])).toEqual(['F3', 'F4', 'Ab4', 'Db5']);
    expect(
      checkPartWriting(voicings, chords, key).filter((v) => v.kind === 'crossRelation'),
    ).toEqual([]);
  });

  it('admits the augmented sixth, and reads it off the written letters', () => {
    // IV to a German sixth: the bass Ab contradicts the tenor's A natural, and
    // the F# contradicts the bass's own F, both of which the chord is built of.
    const chords = [makeChord(5, 'maj'), makeChord(8, 'dom7')];
    const subdominant = spellVoicing([53, 57, 60, 65], chords[0] ?? makeChord(5, 'maj'), C_MAJOR);
    const german = ['Ab3', 'C4', 'Eb4', 'F#4'].map((name) => parseNote(name));
    expect(
      checkPartWriting([subdominant, german], chords, C_MAJOR).filter(
        (v) => v.kind === 'crossRelation',
      ),
    ).toEqual([]);
    // The same pitches spelled as a bVI7 sound no augmented sixth, and the
    // contradiction is then an ordinary one.
    const flatSixSeventh = ['Ab3', 'C4', 'Eb4', 'Gb4'].map((name) => parseNote(name));
    expect(
      summarize(
        checkPartWriting([subdominant, flatSixSeventh], chords, C_MAJOR).filter(
          (v) => v.kind === 'crossRelation',
        ),
      ),
    ).toEqual([{ kind: 'crossRelation', voices: [1, 0], fromIndex: 0, toIndex: 1 }]);
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
    // The tenor's B falls a fourth to F#, which is neither the tonic nor a tone
    // of the chord it lands in.
    const chords = [makeChord(7, 'maj'), makeChord(0, 'maj')];
    const voicings = spellExercise(
      [
        [55, 59, 62, 67],
        [48, 52, 64, 67],
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

  it('accepts an inner voice frustrating its leading tone onto the fifth', () => {
    // V7 to a complete I: the tenor's B falls a third to G, the one way the
    // tonic triad keeps its fifth. This is the second of the two textbook
    // answers, not a fault.
    const chords = [makeChord(7, 'dom7'), makeChord(0, 'maj')];
    const voicings = spellExercise(
      [
        [55, 59, 65, 74],
        [48, 55, 64, 72],
      ],
      chords,
    );
    expect(checkPartWriting(voicings, chords, C_MAJOR)).toEqual([]);
  });

  it('flags an outer voice that frustrates its leading tone', () => {
    // The same third down onto the fifth, this time in the soprano, where the
    // leading tone is exposed and must rise.
    const chords = [makeChord(7, 'maj'), makeChord(0, 'maj')];
    const voicings = spellExercise(
      [
        [43, 55, 62, 71],
        [48, 55, 64, 67],
      ],
      chords,
    );
    const unresolved = checkPartWriting(voicings, chords, C_MAJOR).filter(
      (v) => v.kind === 'unresolvedLeadingTone',
    );
    expect(summarize(unresolved)).toEqual([
      { kind: 'unresolvedLeadingTone', voices: [3], fromIndex: 0, toIndex: 1 },
    ]);
  });

  it('flags an inner leading tone that falls by step rather than a third', () => {
    // B down to A is not the frustrated resolution: it lands on no tone of the
    // tonic triad at all.
    const chords = [makeChord(7, 'maj'), makeChord(0, 'maj')];
    const voicings = spellExercise(
      [
        [55, 59, 62, 67],
        [48, 57, 64, 67],
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

  it('flags the root of a leading-tone chord that does not rise', () => {
    // viio to I with the bass B falling to G instead of stepping up to C.
    const chords = [makeChord(11, 'dim'), makeChord(0, 'maj')];
    const voicings = spellExercise(
      [
        [59, 62, 65, 67],
        [55, 60, 64, 67],
      ],
      chords,
    );
    const unresolved = checkPartWriting(voicings, chords, C_MAJOR).filter(
      (v) => v.kind === 'unresolvedLeadingTone',
    );
    expect(summarize(unresolved)).toEqual([
      { kind: 'unresolvedLeadingTone', voices: [0], fromIndex: 0, toIndex: 1 },
    ]);
  });

  it('leaves the leading tone alone where it is not functioning as one', () => {
    // iii to IV: the alto's B is the fifth of iii, free to fall to A, and the C
    // in F is that chord's fifth rather than a resolution the B owes.
    const toSubdominant = [makeChord(4, 'min'), makeChord(5, 'maj')];
    expect(
      checkPartWriting(
        spellExercise(
          [
            [52, 59, 64, 67],
            [53, 57, 65, 69],
          ],
          toSubdominant,
        ),
        toSubdominant,
        C_MAJOR,
      ).filter((v) => v.kind === 'unresolvedLeadingTone'),
    ).toEqual([]);
    // The same for iii to vi, where the B is again the fifth of the chord.
    const toSubmediant = [makeChord(4, 'min'), makeChord(9, 'min')];
    expect(
      checkPartWriting(
        spellExercise(
          [
            [52, 59, 64, 67],
            [57, 60, 64, 69],
          ],
          toSubmediant,
        ),
        toSubmediant,
        C_MAJOR,
      ).filter((v) => v.kind === 'unresolvedLeadingTone'),
    ).toEqual([]);
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

  it('rejects a spacing limit that would switch the rule off or invert it', () => {
    // An octave apart in the upper voices and the bass out of its range: the
    // exercise has something for both rules to find, so a limit that is quietly
    // accepted shows up as a rule that stopped reporting.
    const chords = [makeChord(0, 'maj')];
    const voicings = spellExercise([[36, 60, 64, 79]], chords);
    expect(checkPartWriting(voicings, chords, C_MAJOR).map((v) => v.kind)).toEqual([
      'spacing',
      'range',
    ]);
    for (const maxSpacing of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(() => checkPartWriting(voicings, chords, C_MAJOR, { maxSpacing })).toThrow(
        InvalidInputError,
      );
    }
  });

  it('rejects ranges that are empty, malformed, or too few for the voices', () => {
    const chords = [makeChord(0, 'maj')];
    const voicings = spellExercise([[48, 60, 64, 67]], chords);
    const cases: VoiceRange[][] = [
      [],
      [{ min: Number.NaN, max: Number.NaN }],
      [
        { min: 40, max: 60 },
        { min: 48, max: 67 },
        { min: 55, max: 74 },
        { min: 79, max: 60 },
      ],
      [
        { min: 40, max: 60 },
        { min: 48, max: 67 },
        { min: 55, max: 74 },
      ],
    ];
    for (const ranges of cases) {
      expect(() => checkPartWriting(voicings, chords, C_MAJOR, { ranges })).toThrow(
        InvalidInputError,
      );
    }
  });

  it('keeps deriving the four-voice defaults', () => {
    const chords = [makeChord(0, 'maj')];
    // Twelve semitones between the upper voices is the accepted limit, and the
    // bass is judged against the SATB compass without being asked.
    expect(checkPartWriting(spellExercise([[48, 55, 67, 79]], chords), chords, C_MAJOR)).toEqual(
      [],
    );
    expect(
      checkPartWriting(spellExercise([[38, 55, 67, 79]], chords), chords, C_MAJOR).map(
        (v) => v.kind,
      ),
    ).toEqual(['range']);
    // Three voices have no conventional compass, so the range rule stays out of
    // it until ranges are given.
    const trio = [makeChord(0, 'maj')];
    expect(checkPartWriting(spellExercise([[24, 55, 67]], trio), trio, C_MAJOR)).toEqual([]);
  });
});

describe('augmented sixths in part writing', () => {
  /** The three kinds, each built in C major with its own spelling. */
  const KINDS = ['italian', 'french', 'german'] as const;

  it.each(KINDS)('spells a voiced %s sixth as the chord speller does, in every key', (kind) => {
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      const key = majorKey(rootPc);
      const { tonic } = spelledKeyOf(key);
      const chord = augmentedSixthChord(kind, key);
      const tones = spellChord(chord, tonic, key);
      // One octave of the chord, so every tone is named through the voicing path.
      const voiced = spellVoicing(
        tones.map((tone) => 60 + noteToPitchClass(tone)),
        chord,
        key,
      );
      for (const tone of tones) {
        const sounded = voiced.find((note) => noteToPitchClass(note) === noteToPitchClass(tone));
        const label = `${kind} in ${rootPc}: ${formatNote(tone)}`;
        expect(sounded, label).toBeDefined();
        expect(
          formatNote({ letter: sounded?.letter ?? 0, alter: sounded?.alter ?? 0 }),
          label,
        ).toBe(formatNote({ letter: tone.letter, alter: tone.alter }));
      }
    }
  });

  it('spells the German sixth of C major on its F#', () => {
    const chord = augmentedSixthChord('german', C_MAJOR);
    expect(noteNames(spellVoicing([44, 60, 63, 66], chord, C_MAJOR))).toEqual([
      'Ab2',
      'C4',
      'Eb4',
      'F#4',
    ]);
  });

  it('reports nothing against a German sixth resolving outward', () => {
    const chords = [augmentedSixthChord('german', C_MAJOR), makeChord(0, 'maj', 7)];
    const voicings = spellExercise(
      [
        [44, 60, 63, 66],
        [43, 60, 63, 67],
      ],
      chords,
    );
    expect(checkPartWriting(voicings, chords, C_MAJOR)).toEqual([]);
  });

  it.each(['italian', 'german'] as const)(
    'asks no downward step of the augmented sixth of a %s sixth',
    (kind) => {
      // Both stand on their own bass, so the tone ten semitones above the root
      // — Ab up to F# in C major — is the sixth the chord is named for.
      const chord = augmentedSixthChord(kind, C_MAJOR);
      expect(chordToneRole(6, chord)).toBe('sixth');
      expect(seventhPcOf(chord)).toBeUndefined();
    },
  );

  it('reads the augmented sixth of a French sixth as the third of its root', () => {
    // The French sixth is measured from the supertonic, where the same sounding
    // tone is a major third and owes the seventh's rule nothing either.
    const chord = augmentedSixthChord('french', C_MAJOR);
    expect(chordToneRole(6, chord)).toBe('third');
  });

  it('keeps the true seventh of a French sixth falling by step', () => {
    // The French sixth is rooted on the supertonic, where the tone ten
    // semitones above the root really is a chordal seventh.
    const chord = augmentedSixthChord('french', C_MAJOR);
    expect(seventhPcOf(chord)).toBe(0);
    expect(chordToneRole(0, chord)).toBe('seventh');
    // Ab2 C4 D4 F#4 to G2 C4 D4 G4: the C stays put instead of falling, and
    // the rule reports it exactly as it does for any other chordal seventh.
    const chords = [chord, makeChord(7, 'maj')];
    const voicings = spellExercise(
      [
        [44, 60, 62, 66],
        [43, 60, 62, 67],
      ],
      chords,
    );
    expect(
      checkPartWriting(voicings, chords, C_MAJOR)
        .filter((violation) => violation.kind === 'unresolvedSeventh')
        .map((violation) => violation.voices),
    ).toEqual([[1]]);
  });

  it.each(['augmentedSixthChord', 'romanToChord', 'fromPitchClasses'] as const)(
    'reads a German sixth built through %s the same way',
    (route) => {
      const chord =
        route === 'augmentedSixthChord'
          ? augmentedSixthChord('german', C_MAJOR)
          : route === 'romanToChord'
            ? romanToChord('Ger6', C_MAJOR)
            : augmentedSixthFromPitchClasses([8, 0, 3, 6], 8, C_MAJOR);
      expect(chord).not.toBeNull();
      expect(seventhPcOf(chord as Chord)).toBeUndefined();
    },
  );

  it('resolves a German sixth outward when it voices a progression', () => {
    const chords = [
      augmentedSixthChord('german', C_MAJOR),
      makeChord(0, 'maj', 7),
      makeChord(7, 'maj'),
    ];
    const voiced = voiceProgression(chords, { key: C_MAJOR });
    const [first = [], second = []] = voiced;
    const sixth = first.findIndex((pitch) => pitch % 12 === 6);
    expect(sixth).toBeGreaterThanOrEqual(0);
    // The augmented sixth rises a semitone onto the dominant, and the bass
    // falls onto it from the other side.
    expect((second[sixth] ?? 0) - (first[sixth] ?? 0)).toBe(1);
    expect((second[0] ?? 0) - (first[0] ?? 0)).toBe(-1);
    const spelled = chords.map((chord, index) => spellVoicing(voiced[index] ?? [], chord, C_MAJOR));
    expect(
      checkPartWriting(spelled, chords, C_MAJOR).map((violation) => violation.kind),
    ).not.toContain('unresolvedSeventh');
  });
});
