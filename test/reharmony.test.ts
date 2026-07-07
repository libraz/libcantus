import { describe, expect, it } from 'vitest';
import {
  modalInterchangePalette,
  negativeHarmonyMirror,
  substituteChord,
} from '../src/generate/reharmony/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

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
});

describe('modalInterchangePalette', () => {
  it('lists the borrowed chords of C major with their sources', () => {
    const palette = modalInterchangePalette(majorKey(0));
    const byRoman = new Map(palette.map((b) => [b.roman, b]));

    expect(byRoman.get('iv')?.chord.rootPc).toBe(5); // F minor
    expect(byRoman.get('iv')?.source).toBe('parallel-minor');
    expect(byRoman.get('bVI')?.source).toBe('parallel-minor');
    expect(byRoman.get('bVII')?.source).toBe('parallel-minor');
    expect(byRoman.get('bII')?.chord.rootPc).toBe(1); // Db major (Neapolitan)
    expect(byRoman.get('bII')?.source).toBe('neapolitan');
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
