/**
 * Recognition: infer a chord name from a set of pitches, or a key from a set of
 * pitch classes. This is the inverse direction of the chord/scale builders,
 * which only go name -> notes.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertMidiPitch,
  assertNoteEvents,
} from '../../core/validation/index.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, chordQualities, makeChord } from '../../theory/chord/index.js';
import {
  HARMONIC_MINOR_MASK,
  MAJOR_MASK,
  MELODIC_MINOR_MASK,
  NATURAL_MINOR_MASK,
} from '../../theory/scale/index.js';
import type { KeyProfileName, KeyProfilePair } from './profiles.js';
import { profileScore, resolveKeyProfile } from './profiles.js';

export type { KeyProfileName, KeyProfilePair } from './profiles.js';

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

/**
 * Input interpretation for {@link detectChord} and {@link detectChordBest}.
 *
 * @category Recognition
 */
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
  /**
   * Which scale form `key` uses. Minor keys report whichever of the natural,
   * harmonic and melodic masks covers the most input weight; the variant does
   * not take part in ranking.
   */
  variant: KeyVariant;
  /**
   * Fraction of the distinct input pitch classes that belong to `key`, in
   * [0, 1]. Measured against the returned scale, so it always agrees with
   * `isScaleTone(pc, match.key)`. This is a coverage figure, not the ranking:
   * see `score`.
   */
  fit: number;
  /**
   * The value the results are ranked by, in [-1, 1]: the Pearson correlation
   * between the weighted pitch-class distribution of the input and this
   * candidate's key profile rotated onto its tonic. 1 is a distribution shaped
   * exactly like the profile, 0 no relationship, negative an anti-correlation.
   * Unlike `fit` it is a distribution measure, not a membership count, so where
   * the weight falls among the scale degrees is what separates a key from its
   * relative. Always a finite number; see {@link DetectKeyOptions.profile} for
   * the degenerate case.
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
  weights?: readonly number[];
  /**
   * Which key profile ranks the candidates: the 12 degree weights a key is
   * expected to distribute its music over, correlated against the distribution
   * actually observed.
   *
   * `'krumhansl'` (the default) uses the Krumhansl–Kessler probe-tone ratings,
   * `'temperley'` the Kostka–Payne corpus proportions, and `'flat'` a flat
   * profile over the scale, which reduces the ranking to plain scale membership
   * — the behaviour this detector had before profile correlation, kept as a way
   * back for a caller that depends on it. A custom pair supplies two 12-entry
   * vectors indexed from the tonic (index 0 = tonic, 1 = flat second, and so on
   * to 11 = major seventh).
   *
   * When either the distribution or the rotated profile has zero variance the
   * correlation is undefined; such a candidate is scored by the normalized dot
   * product (cosine similarity) of the same two vectors instead, so a result
   * never carries NaN.
   *
   * @defaultValue `'krumhansl'`
   */
  profile?: KeyProfileName | KeyProfilePair;
  /**
   * Upper bound on the input pitches processed by this detection call.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/** Unique pitch classes of the input, sorted ascending. */
function uniquePitchClasses(pitches: readonly number[]): number[] {
  return [...new Set(pitches.map(pitchClass))].sort((a, b) => a - b);
}

function assertPitches(
  pitches: readonly number[],
  name: string,
  budget: number | undefined = undefined,
): void {
  assertGenerationBudget(pitches.length, name, budget);
  for (let index = 0; index < pitches.length; index += 1) {
    assertMidiPitch(pitches[index] ?? Number.NaN, `pitches[${index}]`);
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
export function detectChord(
  pitches: readonly number[],
  opts: DetectChordOptions = {},
): ChordMatch[] {
  assertPitches(pitches, 'chord detection pitches');
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
  const toneCounts = new Map(
    qualities.map((quality) => [quality, chordPitchClasses(makeChord(0, quality)).length]),
  );
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
    const aSize = toneCounts.get(a.quality) ?? 0;
    const bSize = toneCounts.get(b.quality) ?? 0;
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
export function detectChordBest(
  pitches: readonly number[],
  opts: DetectChordOptions = {},
): Chord | null {
  const best = detectChord(pitches, opts)[0];
  if (!best) {
    return null;
  }
  return makeChord(best.rootPc, best.quality, best.bassPc);
}

/**
 * Minor-scale variants a minor-key candidate may report. Ranking no longer
 * consults them: the minor profile already expects weight on the raised sixth
 * and seventh, so the variant is chosen afterwards as the mask that covers the
 * most input weight. Natural minor comes first so it wins a tie as the most
 * diatonic reading.
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
 * Rank major and minor keys by how well a set of pitch classes is distributed
 * like each key.
 *
 * The input becomes a weighted pitch-class distribution, and every one of the
 * 24 candidates is scored by the Pearson correlation between that distribution
 * and its key profile rotated onto the candidate tonic (see
 * {@link DetectKeyOptions.profile}). Correlating against a profile rather than
 * counting scale members is what tells a key apart from its relative: C major
 * and A minor contain the same seven pitch classes, so a membership count can
 * only separate them by a tie-break, while their profiles expect the weight on
 * different degrees.
 *
 * Choosing the minor variant is deliberately not part of the ranking. A minor
 * candidate is ranked once, on the minor profile, which already expects some
 * weight on the raised sixth and seventh; only then does it report whichever of
 * the natural, harmonic and melodic masks covers the most input weight, and
 * `fit` is measured against that mask. That split is why a harmonic-minor
 * cadence ranks its own tonic first without the harmonic variant having to win
 * a scoring contest against the natural one.
 *
 * Ties are broken by `fit` descending, then tonic pitch class ascending, then
 * major before minor, so the order is fully determined by the input rather than
 * by the order candidates happen to be built in. Returns all 24 keys ranked
 * best-first, or an empty array for an empty input (mirroring
 * {@link detectChord}).
 *
 * @param pitches MIDI pitches or bare pitch classes.
 * @param opts How to weigh the input and which profile to rank with; see
 *   {@link DetectKeyOptions}.
 * @returns Ranked key interpretations (empty for an empty input), each carrying
 *   a finite `score` in [-1, 1].
 * @throws {InvalidInputError} When `weights` does not have one entry per pitch,
 *   or `profile` is not a known name or a valid pair of 12-entry vectors.
 * @throws {RangeError} When a pitch is outside the MIDI domain or the input
 *   exceeds the budget.
 * @example
 * ```ts
 * import { detectKey } from '@libraz/libcantus';
 * const keys = detectKey([60, 62, 64, 65, 67, 69, 71]); // C major scale
 * keys[0].mode; // 'major', with keys[0].key.rootPc === 0
 * keys[1].mode; // 'minor' on 9: A minor, the relative, ranked just below
 * ```
 * @category Recognition
 */
export function detectKey(pitches: readonly number[], opts: DetectKeyOptions = {}): KeyMatch[] {
  assertPitches(pitches, 'key detection pitches', opts.budget);
  const weights = opts.weights;
  if (weights !== undefined && weights.length !== pitches.length) {
    throw new InvalidInputError('weights must have one entry per pitch');
  }
  const profile = resolveKeyProfile(opts.profile);
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
  const input = [...counts.keys()];
  // The distribution the profiles are correlated against: one bin per pitch
  // class, holding the total weight that landed on it.
  const dist = new Array<number>(12).fill(0);
  for (const [pc, count] of counts) {
    dist[pc] = count;
  }
  const results: KeyMatch[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const mode of ['major', 'minor'] as const) {
      const vector = mode === 'major' ? profile.major : profile.minor;
      const score = profileScore(dist, vector, tonic);
      // Ranking is settled; the variant only decides which scale the caller is
      // handed, so it is the mask covering the most input weight. Ties keep the
      // earlier (more diatonic) variant, and `fit` is measured against the very
      // scale that wins here.
      const variants = mode === 'major' ? MAJOR_VARIANTS : MINOR_VARIANTS;
      let covered = Number.NEGATIVE_INFINITY;
      let inScale = 0;
      let best: { variant: KeyVariant; mask: number } = variants[0];
      for (const candidate of variants) {
        let candidateCovered = 0;
        let candidateInScale = 0;
        for (const [pc, count] of counts) {
          const offset = (pc - tonic + 12) % 12;
          if ((candidate.mask >> offset) & 1) {
            candidateCovered += count;
            candidateInScale += 1;
          }
        }
        if (candidateCovered > covered) {
          covered = candidateCovered;
          inScale = candidateInScale;
          best = candidate;
        }
      }
      results.push({
        key: { rootPc: tonic, modeMask12: best.mask },
        mode,
        variant: best.variant,
        fit: inScale / input.length,
        score,
      });
    }
  }
  // Floating-point scores tie often enough — a chromatic input ties all 24 —
  // that leaving the order to the sort's stability would make construction
  // order the contract. Rank on the reported fields instead.
  results.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    if (a.fit !== b.fit) {
      return b.fit - a.fit;
    }
    if (a.key.rootPc !== b.key.rootPc) {
      return a.key.rootPc - b.key.rootPc;
    }
    if (a.mode === b.mode) {
      return 0;
    }
    return a.mode === 'major' ? -1 : 1;
  });
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
 * or negative duration) are ignored. The weighted distribution is then ranked
 * exactly as {@link detectKey} ranks it, by correlation against a key profile,
 * so `score` is a finite correlation in [-1, 1].
 *
 * @param notes The note events to weigh.
 * @param opts Which profile to rank with, and the budget for processing
 *   imported note events; the weights are derived from the notes themselves.
 * @returns Ranked key interpretations (empty when nothing sounds).
 * @throws {InvalidInputError} When `profile` is not a known name or a valid
 *   pair of 12-entry vectors.
 * @throws {RangeError} When a note event is malformed or the input exceeds the
 *   budget.
 * @example
 * ```ts
 * import { detectKeyFromNotes } from '@libraz/libcantus';
 * detectKeyFromNotes([{ pitch: 60, startBeat: 0, durationBeat: 4 }])[0]?.key.rootPc; // 0
 * ```
 * @category Recognition
 */
export function detectKeyFromNotes(
  notes: readonly NoteEvent[],
  opts: Omit<DetectKeyOptions, 'weights'> = {},
): KeyMatch[] {
  assertNoteEvents(notes, 'key detection notes', {
    allowNonPositiveDuration: true,
    budget: opts.budget,
  });
  const sounding = notes.filter((note) => note.durationBeat > 0);
  return detectKey(
    sounding.map((note) => note.pitch),
    {
      weights: sounding.map((note) => note.durationBeat * (note.velocity ?? DEFAULT_VELOCITY)),
      profile: opts.profile,
      budget: opts.budget,
    },
  );
}

/**
 * The single best key interpretation of a pitch set.
 *
 * The counterpart of {@link detectChordBest}: the ranked list is the general
 * answer, but a caller that just wants "what key is this" should not have to
 * index into it and assert the result is there. The winner is the candidate
 * whose key profile correlates best with the input distribution, with the same
 * deterministic tie-break {@link detectKey} applies, so its `score` is a finite
 * correlation in [-1, 1] rather than a membership share.
 *
 * @param pitches MIDI pitches or bare pitch classes.
 * @param opts How to weigh the input and which profile to rank with; see
 *   {@link DetectKeyOptions}.
 * @returns The top-ranked key, or null when nothing sounds.
 * @throws {InvalidInputError} When `weights` does not have one entry per pitch,
 *   or `profile` is not a known name or a valid pair of 12-entry vectors.
 * @throws {RangeError} When a pitch is outside the MIDI domain or the input
 *   exceeds the budget.
 * @example
 * ```ts
 * import { detectKeyBest } from '@libraz/libcantus';
 * detectKeyBest([0, 2, 4, 5, 7, 9, 11])?.mode; // 'major'
 * ```
 * @category Recognition
 */
export function detectKeyBest(
  pitches: readonly number[],
  opts: DetectKeyOptions = {},
): KeyMatch | null {
  return detectKey(pitches, opts)[0] ?? null;
}
