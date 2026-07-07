/**
 * Recognition: infer a chord name from a set of pitches, or a key from a set of
 * pitch classes. This is the inverse direction of the chord/scale builders,
 * which only go name -> notes.
 */

import type { Chord, ChordQuality } from '../chord/index.js';
import { chordPitchClasses, chordQualities, makeChord } from '../chord/index.js';
import {
  HARMONIC_MINOR_MASK,
  MAJOR_MASK,
  MELODIC_MINOR_MASK,
  majorKey,
  minorKey,
  NATURAL_MINOR_MASK,
} from '../scale/index.js';
import type { KeyScale } from '../types.js';

/**
 * A candidate chord interpretation of a pitch set.
 *
 * @category Recognition
 */
export type ChordMatch = {
  rootPc: number;
  quality: ChordQuality;
  /** Chord tones absent from the input (an incomplete voicing). */
  missingPcs: number[];
  /** Input pitch classes not belonging to the chord. */
  extraPcs: number[];
  /** True when the input pitch-class set equals the chord exactly. */
  exact: boolean;
  /** Inversion implied by the lowest note: 0 root position, 1 first, ... */
  inversion: number;
  /** Bass pitch class when inverted (the lowest note is not the root). */
  bassPc?: number;
};

/**
 * A candidate key interpretation of a pitch-class set.
 *
 * @category Recognition
 */
export type KeyMatch = {
  key: KeyScale;
  mode: 'major' | 'minor';
  /** Fraction of input pitch classes that are in the scale, in [0, 1]. */
  fit: number;
};

/** Reduce any integer to a pitch class in [0, 11]. */
function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

/** Unique pitch classes of the input, sorted ascending. */
function uniquePitchClasses(pitches: number[]): number[] {
  return [...new Set(pitches.map(pitchClass))].sort((a, b) => a - b);
}

/**
 * Identify chords matching a set of pitches.
 *
 * Every input pitch class is tried as a root against every known chord quality.
 * A match is reported when all of the chord's tones are present in the input, or
 * when the only absent tone is the perfect fifth (a common omission in shell
 * voicings); matches are ranked best-first by fewest extra notes, then fewest
 * missing notes, then most specific (largest) chord. An exact match (no extras,
 * no missing) is flagged and ranked first.
 *
 * @param pitches MIDI pitches or bare pitch classes (octave-agnostic).
 * @returns Ranked chord interpretations (may be empty).
 * @example
 * ```ts
 * import { detectChord } from '@libraz/libcantus';
 * const matches = detectChord([60, 64, 67]); // C E G
 * matches[0]; // { rootPc: 0, quality: 'maj', exact: true, ... }
 * ```
 * @category Recognition
 */
export function detectChord(pitches: number[]): ChordMatch[] {
  const input = uniquePitchClasses(pitches);
  if (input.length === 0) {
    return [];
  }
  const bassPc = pitchClass(Math.min(...pitches));
  const inputSet = new Set(input);
  const matches: ChordMatch[] = [];
  const qualities = chordQualities();
  for (const rootPc of input) {
    for (const quality of qualities) {
      const chord = makeChord(rootPc, quality);
      const tones = chordPitchClasses(chord);
      const toneSet = new Set(tones);
      const missingPcs = tones.filter((pc) => !inputSet.has(pc));
      // Accept an exact-tone match, or one whose only absent tone is the perfect
      // fifth; any other missing tone (third, sus tone, seventh, ...) rejects.
      const fifthPc = pitchClass(rootPc + 7);
      if (missingPcs.length > 1 || (missingPcs.length === 1 && missingPcs[0] !== fifthPc)) {
        continue;
      }
      const extraPcs = input.filter((pc) => !toneSet.has(pc));
      const bassIndex = chord.intervals.findIndex((iv) => pitchClass(rootPc + iv) === bassPc);
      const inversion = bassIndex > 0 ? bassIndex : 0;
      const match: ChordMatch = {
        rootPc,
        quality,
        missingPcs,
        extraPcs,
        exact: extraPcs.length === 0 && missingPcs.length === 0,
        inversion,
      };
      if (inversion > 0) {
        match.bassPc = bassPc;
      }
      matches.push(match);
    }
  }
  matches.sort((a, b) => {
    if (a.extraPcs.length !== b.extraPcs.length) {
      return a.extraPcs.length - b.extraPcs.length;
    }
    if (a.missingPcs.length !== b.missingPcs.length) {
      return a.missingPcs.length - b.missingPcs.length;
    }
    // Prefer root position (the bass is the chord root) on a tie.
    if ((a.inversion === 0) !== (b.inversion === 0)) {
      return a.inversion === 0 ? -1 : 1;
    }
    const aSize = chordPitchClasses(makeChord(a.rootPc, a.quality)).length;
    const bSize = chordPitchClasses(makeChord(b.rootPc, b.quality)).length;
    return bSize - aSize;
  });
  return matches;
}

/**
 * The single best chord interpretation of a pitch set, or null if none.
 *
 * @param pitches MIDI pitches or bare pitch classes.
 * @returns The top-ranked chord, or null when nothing matches.
 * @example
 * ```ts
 * import { detectChordBest } from '@libraz/libcantus';
 * detectChordBest([60, 64, 67]); // C major triad: { rootPc: 0, quality: 'maj', ... }
 * ```
 * @category Recognition
 */
export function detectChordBest(pitches: number[]): Chord | null {
  const best = detectChord(pitches)[0];
  if (!best) {
    return null;
  }
  return makeChord(best.rootPc, best.quality, best.bassPc);
}

/**
 * Minor-scale variants scored for each minor-key candidate. Scoring against all
 * three lets the raised sixth and seventh (e.g. the leading tone G# in A minor)
 * count toward their own tonic instead of only penalizing it.
 */
const MINOR_MASK_VARIANTS = [NATURAL_MINOR_MASK, HARMONIC_MINOR_MASK, MELODIC_MINOR_MASK];

/**
 * Rank major and minor keys by how well they contain a set of pitch classes.
 *
 * The tonic is weighted so that, among equally-fitting keys, the one whose root
 * appears in the input is preferred. Minor candidates are scored against the
 * natural, harmonic, and melodic minor variants and keep the best of the three,
 * so a minor cadence containing the leading tone still resolves to its own
 * tonic; the returned key is always the natural-minor scale. Returns all 24
 * keys ranked best-first, or an empty array for an empty input (mirroring
 * {@link detectChord}).
 *
 * @param pitches MIDI pitches or bare pitch classes.
 * @returns Ranked key interpretations (empty for an empty input).
 * @example
 * ```ts
 * import { detectKey } from '@libraz/libcantus';
 * const keys = detectKey([60, 62, 64, 65, 67, 69, 71]); // C major scale
 * keys[0].mode; // 'major', with keys[0].key.rootPc === 0
 * ```
 * @category Recognition
 */
export function detectKey(pitches: number[]): KeyMatch[] {
  const input = uniquePitchClasses(pitches);
  if (input.length === 0) {
    return [];
  }
  const counts = new Map<number, number>();
  for (const pc of pitches.map(pitchClass)) {
    counts.set(pc, (counts.get(pc) ?? 0) + 1);
  }
  const total = pitches.length;
  const results: (KeyMatch & { score: number })[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const mode of ['major', 'minor'] as const) {
      const key = mode === 'major' ? majorKey(tonic) : minorKey(tonic);
      const masks = mode === 'major' ? [MAJOR_MASK] : MINOR_MASK_VARIANTS;
      // Score each scale variant and keep the best; ties keep the earlier
      // (more diatonic) variant.
      let inScale = 0;
      let weighted = Number.NEGATIVE_INFINITY;
      for (const mask of masks) {
        let variantInScale = 0;
        let variantWeighted = 0;
        for (const pc of input) {
          const offset = (pc - tonic + 12) % 12;
          if ((mask >> offset) & 1) {
            variantInScale += 1;
          }
        }
        for (const [pc, count] of counts) {
          const offset = (pc - tonic + 12) % 12;
          if ((mask >> offset) & 1) {
            variantWeighted += count;
          }
        }
        if (variantWeighted > weighted) {
          weighted = variantWeighted;
          inScale = variantInScale;
        }
      }
      weighted += (counts.get(tonic) ?? 0) * 0.5;
      results.push({
        key,
        mode,
        fit: inScale / input.length,
        score: weighted / total,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.map(({ key, mode, fit }) => ({ key, mode, fit }));
}
