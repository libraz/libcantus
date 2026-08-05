import { describe, expect, it } from 'vitest';
import {
  modalInterchangePalette,
  negativeHarmonyMirror,
  substituteChord,
} from '../src/generate/reharmony/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';

describe('substituteChord', () => {
  it('tritone-substitutes G7 in C major with Db7', () => {
    const subs = substituteChord(makeChord(7, 'dom7'), majorKey(0));
    const tritone = subs.find((s) => s.type === 'tritone');
    expect(tritone).toBeDefined();
    expect(tritone?.chord.rootPc).toBe(1);
    expect(tritone?.chord.quality).toBe('dom7');
  });

  it('drops substitutions that would lose a melody chord tone', () => {
    // D (pc 2) is a chord tone of G7 but not of the tritone sub Db7 {1,5,8,11}.
    const subs = substituteChord(makeChord(7, 'dom7'), majorKey(0), { melodyPcs: [2] });
    for (const sub of subs) {
      expect(chordPitchClasses(sub.chord)).toContain(2);
    }
    const db7 = subs.find((s) => s.chord.rootPc === 1 && s.chord.quality === 'dom7');
    expect(db7).toBeUndefined();
  });

  it('counts only tones that actually exist in power and suspended chords', () => {
    const powerSubs = substituteChord(makeChord(0, '5'), majorKey(0));
    expect(
      powerSubs.find(
        (sub) => sub.type === 'relative' && sub.chord.rootPc === 9 && sub.chord.quality === 'min',
      ),
    ).toBeUndefined();

    const susSubs = substituteChord(makeChord(0, 'sus4'), majorKey(0));
    expect(
      susSubs.find(
        (sub) => sub.type === 'relative' && sub.chord.rootPc === 9 && sub.chord.quality === 'min',
      ),
    ).toBeUndefined();
  });
});

describe('substituteChord relative motion', () => {
  it('measures common tones against the source triad, not the seventh chord', () => {
    // Counting against the full pitch-class set makes the answer depend on how
    // many tensions the input carries: Cmaj7 overlaps Em in three tones and so
    // loses the substitution that plain C is offered.
    const relativesOf = (quality: 'maj' | 'maj7') =>
      substituteChord(makeChord(0, quality), majorKey(0))
        .filter((sub) => sub.type === 'relative')
        .map((sub) => sub.chord.rootPc)
        .sort((a, b) => a - b);
    expect(relativesOf('maj7')).toEqual(relativesOf('maj'));
    expect(relativesOf('maj7')).toEqual([4, 9]); // Em and Am
  });

  it('finds the relative substitution for a minor seventh source chord', () => {
    const relatives = substituteChord(makeChord(9, 'min7'), majorKey(0))
      .filter((sub) => sub.type === 'relative')
      .map((sub) => sub.chord.rootPc);
    expect(relatives).toContain(0); // Am -> C
  });
});

describe('substitution kinds', () => {
  it('names borrowed and chromatic-mediant replacements without a destructive secondary dominant', () => {
    const byType = (chord: Parameters<typeof substituteChord>[0], type: string) =>
      substituteChord(chord, majorKey(0)).filter((sub) => sub.type === type);

    // Borrowed: the parallel minor's chords with the same function as C major.
    const borrowed = byType(makeChord(0, 'maj'), 'borrowed');
    expect(borrowed.length).toBeGreaterThan(0);
    for (const sub of borrowed) {
      expect(sub.function).toBe('tonic');
    }

    // Chromatic mediant: a third away, one common tone, not in the key.
    const mediants = byType(makeChord(0, 'maj'), 'chromaticMediant');
    expect(mediants.length).toBeGreaterThan(0);
    for (const sub of mediants) {
      const shared = chordPitchClasses(sub.chord).filter((pc) =>
        chordPitchClasses(makeChord(0, 'maj')).includes(pc),
      );
      expect(shared).toHaveLength(1);
      expect([3, 4, 8, 9]).toContain((sub.chord.rootPc - 0 + 12) % 12);
    }

    expect(substituteChord(makeChord(0, 'maj'), majorKey(0))).not.toContainEqual(
      expect.objectContaining({ type: 'secondaryDominant' }),
    );
  });

  it('offers substitutions in a minor key too', () => {
    const subs = substituteChord(makeChord(9, 'min'), minorKey(9));
    expect(subs.length).toBeGreaterThan(0);
    for (const sub of subs) {
      expect(sub.roman.length).toBeGreaterThan(0);
    }
    // The relative major is a third away sharing two tones of the Am triad.
    expect(subs.filter((sub) => sub.type === 'relative').map((sub) => sub.chord.rootPc)).toContain(
      0,
    );
  });
});

describe('modalInterchangePalette', () => {
  it('lists the borrowed chords of C major with their sources', () => {
    const palette = modalInterchangePalette(majorKey(0));
    const byRoman = new Map(palette.map((b) => [b.roman, b]));

    expect(byRoman.get('iv')?.chord.rootPc).toBe(5); // F minor
    expect(byRoman.get('iv')?.source).toBe('parallelMinor');
    expect(byRoman.get('bVI')?.source).toBe('parallelMinor');
    expect(byRoman.get('bVII')?.source).toBe('parallelMinor');
    expect(byRoman.get('bII')?.chord.rootPc).toBe(1); // Db major (Neapolitan)
    expect(byRoman.get('bII')?.source).toBe('neapolitan');
  });

  it('borrows from the parallel major when the key is minor', () => {
    // The parallel mode flips, so a minor key borrows the major chords — the
    // direction a C-major-only test can never exercise.
    const palette = modalInterchangePalette(minorKey(9));
    const sources = palette.map((borrowed) => borrowed.source);
    expect(sources).toContain('parallelMajor');
    // The direction has to flip: nothing here is borrowed from a parallel minor.
    expect(sources).not.toContain('parallelMinor');
    // A major IV over an A minor tonic is the characteristic borrowing.
    expect(palette.map((borrowed) => borrowed.chord.rootPc)).toContain(2);
    expect(palette.map((borrowed) => borrowed.roman)).not.toContain('V');
    expect(palette.map((borrowed) => borrowed.roman)).not.toContain('#viio');
  });

  it('does not call the b2 chord a borrowing in a key that already has it', () => {
    // In Phrygian the flat second is native, so the Neapolitan is not added.
    const phrygian = scaleByName('phrygian', 0);
    const palette = modalInterchangePalette(phrygian);
    expect(palette.filter((borrowed) => borrowed.source === 'neapolitan')).toEqual([]);
  });
});

describe('negative harmony away from C', () => {
  it('mirrors about the axis of the actual tonic', () => {
    // The axis runs through the tonic and its dominant, so the reflection is
    // 2*tonic + 7 - p. In C the doubled-tonic term vanishes, which is why a
    // C-only test cannot tell the correct formula from `7 - p`.
    const cases: { tonic: number; chord: [number, 'maj' | 'dom7' | 'min']; expected: number[] }[] =
      [
        // In G major the axis maps p to (9 - p) mod 12, so D7 {2,6,9,0} becomes
        // {7,3,0,9}.
        { tonic: 7, chord: [2, 'dom7'], expected: [0, 3, 7, 9] },
        // In Eb major the axis maps p to (13 - p) mod 12, so Bb {10,2,5}
        // becomes {3,11,8}.
        { tonic: 3, chord: [10, 'maj'], expected: [3, 8, 11] },
      ];
    for (const { tonic, chord, expected } of cases) {
      const mirrored = negativeHarmonyMirror(makeChord(chord[0], chord[1]), majorKey(tonic));
      expect(
        chordPitchClasses(mirrored).sort((a, b) => a - b),
        `tonic ${tonic}`,
      ).toEqual(expected);
    }
  });

  it('is its own inverse, which the reflection formula guarantees', () => {
    for (const tonic of [0, 3, 5, 7, 10]) {
      const source = makeChord(7, 'dom7');
      const once = negativeHarmonyMirror(source, majorKey(tonic));
      const twice = negativeHarmonyMirror(once, majorKey(tonic));
      expect(
        chordPitchClasses(twice).sort((a, b) => a - b),
        `tonic ${tonic}`,
      ).toEqual(chordPitchClasses(source).sort((a, b) => a - b));
    }
  });
});

describe('negativeHarmonyMirror', () => {
  it('reflects G7 across the tonic-dominant axis of C major', () => {
    const key = majorKey(0);
    const mirrored = negativeHarmonyMirror(makeChord(7, 'dom7'), key);
    const expected = new Set(
      chordPitchClasses(makeChord(7, 'dom7')).map((pc) => (7 - pc + 12) % 12),
    );
    // The mirror of G7 is the {C, D, F, Ab} collection, recognized as a
    // root-position Dm7b5 (its subdominant-function negative).
    expect(new Set(chordPitchClasses(mirrored))).toEqual(expected);
    expect(mirrored.rootPc).toBe(2);
    expect(mirrored.quality).toBe('m7b5');
    // A chord given without a bass must not gain a spurious slash bass.
    expect(mirrored.bassPc).toBeUndefined();
  });
});
