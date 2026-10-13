import { describe, expect, it } from 'vitest';
import {
  augmentedSixthChord,
  augmentedSixthFromPitchClasses,
  romanToChord,
} from '../src/analyze/functional/index.js';
import type { Chord } from '../src/theory/chord/index.js';
import { chordToneRole, makeChord } from '../src/theory/chord/index.js';
import { checkPartWriting, spellVoicing } from '../src/theory/partwriting/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import { seventhPcOf } from '../src/theory/tendency/index.js';

const C_MAJOR = majorKey(0);

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

describe('augmented sixths in part writing', () => {
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
});
