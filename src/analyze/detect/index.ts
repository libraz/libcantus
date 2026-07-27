/**
 * Recognition: infer a chord name from a set of pitches, or a key from a set of
 * pitch classes. This is the inverse direction of the chord/scale builders,
 * which only go name -> notes.
 */

import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import { assertFiniteNumber, assertGenerationBudget } from '../../core/validation/index.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, chordQualities, makeChord } from '../../theory/chord/index.js';
import {
  HARMONIC_MINOR_MASK,
  MAJOR_MASK,
  MELODIC_MINOR_MASK,
  NATURAL_MINOR_MASK,
} from '../../theory/scale/index.js';

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
  /**
   * Inversion implied by a known bass: 0 for root position, 1..n for an
   * inversion. Null when no inversion can be named — either the input is an
   * unordered pitch-class set with no bass, or the bass is not a chord tone (a
   * pedal or passing bass), in which case `bassPc` still reports it.
   */
  inversion: number | null;
  /** Bass pitch class when the lowest note is not the root. */
  bassPc?: number;
};

/** Input interpretation for {@link detectChord} and {@link detectChordBest}. */
export type DetectChordOptions = {
  /**
   * `midi` uses the numerically lowest pitch as bass; `pitchClass` treats the
   * input as unordered. `auto` (default) selects pitch-class mode only when all
   * values lie in 0..11.
   */
  input?: 'auto' | 'midi' | 'pitchClass';
  /** Explicit bass pitch class, including for an unordered pitch-class set. */
  bassPc?: number;
};

/**
 * A candidate key interpretation of a pitch-class set.
 *
 * @category Recognition
 */
export type KeyMatch = {
  /** The scale that scored best for this tonic and mode, `variant` included. */
  key: KeyScale;
  mode: 'major' | 'minor';
  /** Which scale form `key` uses; minor keys pick the best-scoring of the three. */
  variant: KeyVariant;
  /**
   * Fraction of the distinct input pitch classes that belong to `key`, in
   * [0, 1]. Measured against the returned scale, so it always agrees with
   * `isScaleTone(pc, match.key)`. This is a coverage figure, not the ranking:
   * see `score`.
   */
  fit: number;
  /**
   * The value the results are ranked by, in [0, 1.5]. Unlike `fit` it counts
   * every occurrence rather than every distinct pitch class, so a repeated tone
   * weighs more, and it adds half a count per sounding of the tonic itself to
   * break ties between keys that contain the same notes.
   */
  score: number;
};

/**
 * Which form of a scale a {@link KeyMatch} settled on.
 *
 * @category Recognition
 */
export type KeyVariant = 'major' | 'natural' | 'harmonic' | 'melodic';

/**
 * Input weighting for {@link detectKey}.
 *
 * @category Recognition
 */
export type DetectKeyOptions = {
  /**
   * How much each pitch counts toward the histogram, one entry per pitch.
   * Defaults to one per pitch, which weighs a thirty-second-note ornament as
   * heavily as the whole note under it. {@link detectKeyFromNotes} supplies
   * duration times velocity, matching how chord inference weighs its own
   * histogram.
   */
  weights?: number[];
};

/** Unique pitch classes of the input, sorted ascending. */
function uniquePitchClasses(pitches: number[]): number[] {
  return [...new Set(pitches.map(pitchClass))].sort((a, b) => a - b);
}

function assertPitches(pitches: number[]): void {
  assertGenerationBudget(pitches.length, 'detection pitches');
  for (let index = 0; index < pitches.length; index += 1) {
    assertFiniteNumber(pitches[index] ?? Number.NaN, `pitches[${index}]`);
  }
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
export function detectChord(pitches: number[], opts: DetectChordOptions = {}): ChordMatch[] {
  assertPitches(pitches);
  if (opts.bassPc !== undefined) assertFiniteNumber(opts.bassPc, 'bassPc');
  const input = uniquePitchClasses(pitches);
  if (input.length === 0) {
    return [];
  }
  const inputKind =
    opts.input === undefined || opts.input === 'auto'
      ? pitches.every((pitch) => Number.isInteger(pitch) && pitch >= 0 && pitch <= 11)
        ? 'pitchClass'
        : 'midi'
      : opts.input;
  const bassPc =
    opts.bassPc !== undefined
      ? pitchClass(opts.bassPc)
      : inputKind === 'midi'
        ? pitchClass(pitches.reduce((lowest, pitch) => Math.min(lowest, pitch), Infinity))
        : undefined;
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
      const bassIndex =
        bassPc === undefined
          ? -1
          : chord.intervals.findIndex((iv) => pitchClass(rootPc + iv) === bassPc);
      // A bass that is not a chord tone names no inversion; reporting it as 0
      // would be indistinguishable from root position for a caller that reads
      // `inversion === 0` as "no slash needed".
      const inversion = bassPc === undefined || bassIndex < 0 ? null : bassIndex;
      const match: ChordMatch = {
        rootPc,
        quality,
        missingPcs,
        extraPcs,
        exact: extraPcs.length === 0 && missingPcs.length === 0,
        inversion,
      };
      if (bassPc !== undefined && bassPc !== rootPc) {
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
export function detectChordBest(pitches: number[], opts: DetectChordOptions = {}): Chord | null {
  const best = detectChord(pitches, opts)[0];
  if (!best) {
    return null;
  }
  return makeChord(best.rootPc, best.quality, best.bassPc);
}

/**
 * Minor-scale variants scored for each minor-key candidate. Scoring against all
 * three lets the raised sixth and seventh (e.g. the leading tone G# in A minor)
 * count toward their own tonic instead of only penalizing it. Natural minor
 * comes first so it wins a tie as the most diatonic reading.
 */
const MINOR_VARIANTS = [
  { variant: 'natural', mask: NATURAL_MINOR_MASK },
  { variant: 'harmonic', mask: HARMONIC_MINOR_MASK },
  { variant: 'melodic', mask: MELODIC_MINOR_MASK },
] as const satisfies readonly { variant: KeyVariant; mask: number }[];

/** The single major form, kept in the same shape as the minor variants. */
const MAJOR_VARIANTS = [{ variant: 'major', mask: MAJOR_MASK }] as const satisfies readonly {
  variant: KeyVariant;
  mask: number;
}[];

/**
 * Rank major and minor keys by how well they contain a set of pitch classes.
 *
 * Ranking is by `score`, which counts repetitions and adds a tonic weight so
 * that, among equally-fitting keys, the one whose root is actually sounded is
 * preferred. Minor candidates are scored against the natural, harmonic, and
 * melodic minor variants and keep the best of the three, so a minor cadence
 * containing the leading tone still resolves to its own tonic; the winning
 * variant is what `key` and `variant` report, so `fit` describes the scale the
 * caller receives. Returns all 24 keys ranked best-first, or an empty array for
 * an empty input (mirroring {@link detectChord}).
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
export function detectKey(pitches: number[], opts: DetectKeyOptions = {}): KeyMatch[] {
  assertPitches(pitches);
  const input = uniquePitchClasses(pitches);
  if (input.length === 0) {
    return [];
  }
  const weights = opts.weights;
  if (weights !== undefined && weights.length !== pitches.length) {
    throw new RangeError('weights must have one entry per pitch');
  }
  const counts = new Map<number, number>();
  let total = 0;
  for (let index = 0; index < pitches.length; index += 1) {
    const weight = weights === undefined ? 1 : (weights[index] ?? 0);
    assertFiniteNumber(weight, `weights[${index}]`);
    if (weight <= 0) {
      continue;
    }
    const pc = pitchClass(pitches[index] ?? 0);
    counts.set(pc, (counts.get(pc) ?? 0) + weight);
    total += weight;
  }
  if (total === 0) {
    return [];
  }
  const results: KeyMatch[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const mode of ['major', 'minor'] as const) {
      const variants = mode === 'major' ? MAJOR_VARIANTS : MINOR_VARIANTS;
      // Score each scale variant and keep the best; ties keep the earlier
      // (more diatonic) variant. The winner is what the match reports, so its
      // fit is measured against the very scale the caller receives.
      let inScale = 0;
      let weighted = Number.NEGATIVE_INFINITY;
      let best: { variant: KeyVariant; mask: number } = variants[0];
      for (const candidate of variants) {
        let variantInScale = 0;
        let variantWeighted = 0;
        for (const pc of input) {
          const offset = (pc - tonic + 12) % 12;
          if ((candidate.mask >> offset) & 1) {
            variantInScale += 1;
          }
        }
        for (const [pc, count] of counts) {
          const offset = (pc - tonic + 12) % 12;
          if ((candidate.mask >> offset) & 1) {
            variantWeighted += count;
          }
        }
        if (variantWeighted > weighted) {
          weighted = variantWeighted;
          inScale = variantInScale;
          best = candidate;
        }
      }
      weighted += (counts.get(tonic) ?? 0) * 0.5;
      results.push({
        key: { rootPc: tonic, modeMask12: best.mask },
        mode,
        variant: best.variant,
        fit: inScale / input.length,
        score: weighted / total,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

/** Default MIDI velocity assumed when a note event does not carry one. */
const DEFAULT_VELOCITY = 100;

/**
 * Rank keys by how well they contain a set of note events, weighting each note
 * by how much of the music it actually occupies.
 *
 * {@link detectKey} counts every pitch once, which lets a run of fast ornamental
 * notes outvote the sustained harmony that establishes the key. This weighs
 * each note by duration times velocity, the same measure chord inference uses,
 * so the two agree on what the music emphasises. Notes that never sound (zero
 * or negative duration) are ignored.
 *
 * @param notes The note events to weigh.
 * @returns Ranked key interpretations (empty when nothing sounds).
 * @example
 * ```ts
 * import { detectKeyFromNotes } from '@libraz/libcantus';
 * detectKeyFromNotes([{ pitch: 60, startBeat: 0, durationBeat: 4 }])[0]?.key.rootPc; // 0
 * ```
 * @category Recognition
 */
export function detectKeyFromNotes(notes: NoteEvent[]): KeyMatch[] {
  const sounding = notes.filter((note) => note.durationBeat > 0);
  return detectKey(
    sounding.map((note) => note.pitch),
    { weights: sounding.map((note) => note.durationBeat * (note.velocity ?? DEFAULT_VELOCITY)) },
  );
}

/**
 * The single best key interpretation of a pitch set.
 *
 * The counterpart of {@link detectChordBest}: the ranked list is the general
 * answer, but a caller that just wants "what key is this" should not have to
 * index into it and assert the result is there.
 *
 * @param pitches MIDI pitches or bare pitch classes.
 * @param opts How to weigh the input; see {@link DetectKeyOptions}.
 * @returns The top-ranked key, or null when nothing sounds.
 * @example
 * ```ts
 * import { detectKeyBest } from '@libraz/libcantus';
 * detectKeyBest([0, 2, 4, 5, 7, 9, 11])?.mode; // 'major'
 * ```
 * @category Recognition
 */
export function detectKeyBest(pitches: number[], opts: DetectKeyOptions = {}): KeyMatch | null {
  return detectKey(pitches, opts)[0] ?? null;
}
