/**
 * Recognition: infer a chord name from a set of pitches, or a key from a set of
 * pitch classes. This is the inverse direction of the chord/scale builders,
 * which only go name -> notes.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import { formatNote, pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertArray,
  assertFiniteNumber,
  assertGenerationBudget,
  assertMidiPitch,
  assertNoteEvents,
  assertRecord,
} from '../../core/validation/index.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, chordQualities, makeChord } from '../../theory/chord/index.js';
import type { KeyVariant, ScaleName } from '../../theory/scale/index.js';
import {
  HARMONIC_MINOR_MASK,
  MAJOR_MASK,
  MELODIC_MINOR_MASK,
  NATURAL_MINOR_MASK,
  spelledKeyOf,
} from '../../theory/scale/index.js';
import type { RejectedCandidate } from '../functional/rationale.js';
import { noteWeight } from '../histogram.js';
import type { ModalScaleName } from './modes.js';
import { modalProfileVector, resolveModalCandidates } from './modes.js';
import type { KeyProfileName, KeyProfilePair } from './profiles.js';
import { profileScore, resolveKeyProfile } from './profiles.js';

export type { ModalCandidate, ModalScaleName } from './modes.js';
export { MODAL_SCALE_NAMES } from './modes.js';
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
  /**
   * The major or minor key this match is closest to. A modal match reports the
   * mode it leans on — dorian, phrygian and locrian are minor, lydian and
   * mixolydian major — so a caller that reads nothing but `mode` still gets a
   * musically sane answer; `scaleName` is where the mode itself is named.
   */
  mode: 'major' | 'minor';
  /**
   * Which scale form `key` uses. Minor keys report whichever of the natural,
   * harmonic and melodic masks covers the most input weight; the variant does
   * not take part in ranking. A church mode reports `'modal'`, since its scale
   * is neither of the major nor one of the three minor forms.
   */
  variant: KeyVariant;
  /**
   * The entry of `NAMED_SCALES` whose mask is `key.modeMask12`, naming the scale
   * exactly where `mode` and `variant` only place it: `'major'`,
   * `'naturalMinor'`, `'harmonicMinor'`, `'melodicMinor'`, or one of the church
   * modes when {@link DetectKeyOptions.modes} put them in the running. Ionian
   * and Aeolian are reported as `'major'` and `'naturalMinor'`, the names of the
   * candidates they are the same scale as.
   */
  scaleName: ScaleName;
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
  /**
   * Why this candidate scored what it did, in the phrasing
   * {@link analyzeVoice} uses for a note.
   *
   * Present only when {@link DetectKeyOptions.explain} asked for it: a ranking
   * is 24 candidates before the modes are counted, and most callers read the
   * first one or two.
   */
  rationale?: string;
  /**
   * The candidates that were considered and rejected, and why each ranked
   * below this one.
   *
   * Carried by the top-ranked match alone — the rivals of a runner-up are the
   * rest of the list, which the caller already holds — and only when
   * {@link DetectKeyOptions.explain} asked for it.
   */
  alternatives?: RejectedCandidate[];
};

/**
 * Which form of a scale a {@link KeyMatch} settled on.
 *
 * Defined with the rest of a key's identity, and re-exported here because a
 * detection result is where most callers first meet it.
 *
 * @category Recognition
 */
export type { KeyVariant };

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
   * Whether the church modes join the 24 major and minor keys as candidates.
   *
   * Off by default, because a modal candidate can only change a ranking by
   * outranking something: a caller working in common-practice repertoire, where
   * a raised sixth over a minor tonic is a melodic-minor inflection rather than
   * a dorian tonality, should keep reading the answer it reads today. Turn it on
   * (`true` for all five, or a list to name the modes a repertoire actually
   * uses) and each enabled mode adds one candidate per tonic, ranked on a
   * profile derived from its parallel major or minor key.
   *
   * Ionian and Aeolian are not on the list: they are the major and natural minor
   * candidates, which already carry `scaleName` `'major'` and `'naturalMinor'`.
   *
   * @defaultValue `false`
   */
  modes?: boolean | readonly ModalScaleName[];
  /**
   * Attach a {@link KeyMatch.rationale} to every candidate, and
   * {@link KeyMatch.alternatives} to the top-ranked one.
   *
   * Off by default, and the one explanation in the library that is: the other
   * entry points explain a single reading, while a ranking explains 24 of them
   * (36 or more with the modes on), each needing a phrase built for a candidate
   * nobody asked about. That cost outweighs the detection itself, so it is paid
   * only on request.
   *
   * @defaultValue false
   */
  explain?: boolean;
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
  assertArray(pitches, name);
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
 * missing notes, then root position over an inversion, then most specific
 * (largest) chord. An exact match (no extras, no missing) is flagged and ranked
 * first.
 *
 * The root-position step decides between readings of the same pitches that are
 * otherwise equally good: `[55, 59, 62, 64]` is read as G6 rather than Em7,
 * because G is in the bass.
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
  const qualityRank = new Map(qualities.map((quality, index) => [quality, index]));
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
    if (aSize !== bSize) {
      return bSize - aSize;
    }
    // Past size, two readings of the same pitches are told apart by the chord
    // they name and by nothing else: leaving it to the sort's stability would
    // hand the decision to the order the pitch classes were pushed in, which is
    // their numeric order, so the same set of intervals would be named one
    // chord here and another a fourth higher. The canonical quality order
    // decides instead, and only a chord symmetrical under transposition — a
    // diminished seventh, which has no one root — reaches the root below it.
    const aRank = qualityRank.get(a.quality) ?? qualities.length;
    const bRank = qualityRank.get(b.quality) ?? qualities.length;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return a.rootPc - b.rootPc;
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
 * Minor-scale variants a minor-key candidate may report. Ranking does not
 * consult them: the minor profile already expects weight on the raised sixth
 * and seventh, so the variant is chosen afterwards as the mask that covers the
 * most input weight. Natural minor comes first so it wins a tie as the most
 * diatonic reading.
 */
const MINOR_VARIANTS = [
  { variant: 'natural', mask: NATURAL_MINOR_MASK, scaleName: 'naturalMinor' },
  { variant: 'harmonic', mask: HARMONIC_MINOR_MASK, scaleName: 'harmonicMinor' },
  { variant: 'melodic', mask: MELODIC_MINOR_MASK, scaleName: 'melodicMinor' },
] as const satisfies readonly { variant: KeyVariant; mask: number; scaleName: ScaleName }[];

/** The single major form, kept in the same shape as the minor variants. */
const MAJOR_VARIANTS = [
  { variant: 'major', mask: MAJOR_MASK, scaleName: 'major' },
] as const satisfies readonly { variant: KeyVariant; mask: number; scaleName: ScaleName }[];

/**
 * Tie-break order over the scales a candidate can report, applied last so that
 * two candidates on the same tonic which score and fit identically — as every
 * candidate does on a perfectly even distribution — still rank in an order the
 * input alone decides. Major before the minor forms reproduces the order the 24
 * keys have always ranked in; the modes follow, in candidate order.
 */
const SCALE_NAME_ORDER: readonly ScaleName[] = [
  'major',
  'naturalMinor',
  'harmonicMinor',
  'melodicMinor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'locrian',
];

/** Rank of a reported scale in {@link SCALE_NAME_ORDER}. */
function scaleNameRank(name: ScaleName): number {
  return SCALE_NAME_ORDER.indexOf(name);
}

/**
 * How many runners-up the winning match names in its `alternatives`.
 *
 * Every candidate below the winner was rejected, so the list has to stop
 * somewhere; three is the neighbourhood a disagreement actually lives in — the
 * relative, the parallel and the neighbouring fifth — and the caller holding
 * the full ranking can read further itself.
 */
const EXPLAINED_RIVALS = 3;

/** Decimal places a correlation is quoted to in a rationale. */
const SCORE_DIGITS = 2;

/**
 * Decimal places a comparison of two correlations may grow to.
 *
 * Two candidates can be separated by a margin the two quoted decimals hide,
 * which would read as "ranked below (0.68 against 0.68)" — the very thing a
 * rationale exists to prevent. The comparison quotes further digits until the
 * two differ, up to the point where the difference stops being a musical fact.
 */
const MAX_SCORE_DIGITS = 6;

/** Two correlations, quoted to enough digits to tell them apart. */
function quoteScores(rival: number, winner: number): string {
  let digits = SCORE_DIGITS;
  while (digits < MAX_SCORE_DIGITS && rival.toFixed(digits) === winner.toFixed(digits)) {
    digits += 1;
  }
  return `${rival.toFixed(digits)} against ${winner.toFixed(digits)}`;
}

/** The key a match names, spelled the way its signature would be written. */
function keyLabel(match: KeyMatch): string {
  const tonic = formatNote(spelledKeyOf(match.key).tonic);
  // Scale names are camelCase identifiers; a rationale reads them as prose.
  const scale = match.scaleName.replace(/([A-Z])/g, ' $1').toLowerCase();
  return `${tonic} ${scale}`;
}

/** Why a candidate scored what it did: the correlation and the coverage. */
function describeKeyMatch(match: KeyMatch, inputSize: number): string {
  // `fit` is the coverage share; the count behind it is what a reader checks.
  const inScale = Math.round(match.fit * inputSize);
  return `${keyLabel(match)}: profile correlation ${match.score.toFixed(SCORE_DIGITS)}, with ${inScale} of ${inputSize} input pitch classes in the scale`;
}

/** Which link of the documented tie-break chain put a rival below the winner. */
function keyRivalReason(winner: KeyMatch, rival: KeyMatch): string {
  if (rival.score !== winner.score) {
    return `Ranked below on profile correlation (${quoteScores(rival.score, winner.score)})`;
  }
  if (rival.fit !== winner.fit) {
    return 'Tied on correlation, ranked below on the share of the input its scale covers';
  }
  if (rival.key.rootPc !== winner.key.rootPc) {
    return 'Tied on correlation and coverage, ranked below by tonic pitch class';
  }
  return 'Tied on correlation and coverage on the same tonic, ranked below by scale, which takes major before the minor forms and the modes last';
}

/** Attach the rationale to every candidate and the rivals to the winner. */
function explainMatches(results: KeyMatch[], inputSize: number): void {
  for (const match of results) {
    match.rationale = describeKeyMatch(match, inputSize);
  }
  const winner = results[0];
  if (winner === undefined) {
    return;
  }
  winner.alternatives = results
    .slice(1, EXPLAINED_RIVALS + 1)
    .map((rival) => ({ label: keyLabel(rival), reason: keyRivalReason(winner, rival) }));
}

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
 * {@link DetectKeyOptions.modes} adds the church modes to the same contest, one
 * candidate per mode per tonic, each ranked on a profile derived from its
 * parallel major or minor key. A modal winner reports the mode in `scaleName`
 * and still reports the key it leans on in `mode`. The option is off by default,
 * so a caller that does not ask for modes gets the ranking of the 24 keys it has
 * always got.
 *
 * Ties are broken by `fit` descending, then tonic pitch class ascending, then by
 * scale — major, the minor forms, then the modes — so the order is fully
 * determined by the input rather than by the order candidates happen to be built
 * in. Returns all 24 keys ranked best-first, plus 12 more per enabled mode, or
 * an empty array for an empty input (mirroring {@link detectChord}).
 *
 * {@link DetectKeyOptions.explain} adds a `rationale` to every candidate and,
 * to the winner, the runners-up it beat with the link of that tie-break chain
 * that separated each. It is off by default; see the option for why.
 *
 * @param pitches MIDI pitches or bare pitch classes.
 * @param opts How to weigh the input, which profile to rank with, and whether
 *   the modes take part; see {@link DetectKeyOptions}.
 * @returns Ranked key interpretations (empty for an empty input), each carrying
 *   a finite `score` in [-1, 1].
 * @throws {InvalidInputError} When `weights` does not have one entry per pitch,
 *   `profile` is not a known name or a valid pair of 12-entry vectors, or
 *   `modes` names something that is not a church mode.
 * @throws {RangeError} When a pitch is outside the MIDI domain or the input
 *   exceeds the budget.
 * @example
 * ```ts
 * import { detectKey } from '@libraz/libcantus';
 * const keys = detectKey([60, 62, 64, 65, 67, 69, 71]); // C major scale
 * keys[0].mode; // 'major', with keys[0].key.rootPc === 0
 * keys[1].mode; // 'minor' — on 9: A minor, the relative, ranked just below
 * const riff = detectKey([62, 62, 65, 69, 71, 69, 65, 62], { modes: true });
 * riff[0].scaleName; // 'dorian', on rootPc 2, still reported as mode 'minor'
 * ```
 * @category Recognition
 */
export function detectKey(pitches: readonly number[], opts: DetectKeyOptions = {}): KeyMatch[] {
  // The default fills in only for an absent argument, so an explicit `null`
  // reaches the first field read as itself; a caller working in JavaScript, or
  // one passing on an options object it never built, arrives here with one.
  const asked = assertRecord<DetectKeyOptions>(opts, 'opts');
  assertPitches(pitches, 'key detection pitches', asked.budget);
  const weights = asked.weights;
  if (weights !== undefined && weights.length !== pitches.length) {
    throw new InvalidInputError('weights must have one entry per pitch');
  }
  const profile = resolveKeyProfile(opts.profile);
  // Derived once per call: a mode's vector depends on the profile, not on which
  // tonic it is being rotated onto.
  const modalCandidates = resolveModalCandidates(opts.modes).map((candidate) => ({
    candidate,
    vector: modalProfileVector(profile, candidate),
  }));
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
      let best: { variant: KeyVariant; mask: number; scaleName: ScaleName } = variants[0];
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
        scaleName: best.scaleName,
        fit: inScale / input.length,
        score,
      });
    }
    // A mode has one scale, so there is no variant to choose: it is ranked on
    // its derived profile and reports the mask it was ranked with.
    for (const { candidate, vector } of modalCandidates) {
      let inScale = 0;
      for (const pc of counts.keys()) {
        if ((candidate.mask >> ((pc - tonic + 12) % 12)) & 1) {
          inScale += 1;
        }
      }
      results.push({
        key: { rootPc: tonic, modeMask12: candidate.mask },
        mode: candidate.mode,
        variant: 'modal',
        scaleName: candidate.scaleName,
        fit: inScale / input.length,
        score: profileScore(dist, vector, tonic),
      });
    }
  }
  // Floating-point scores tie often enough — a chromatic input scores every
  // rotation of one mode the same, so the twelve major keys tie with each other
  // and the twelve minor keys tie with each other — that leaving the order to
  // the sort's stability would make construction order the contract. Rank on
  // the reported fields instead.
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
    return scaleNameRank(a.scaleName) - scaleNameRank(b.scaleName);
  });
  if (opts.explain === true) {
    // After the sort, so a rival's reason can name the link of the tie-break
    // chain that actually separated it from the winner.
    explainMatches(results, input.length);
  }
  return results;
}

/**
 * Rank keys by how well they contain a set of note events, weighting each note
 * by how much of the music it actually occupies.
 *
 * {@link detectKey} counts every pitch once, which lets a run of fast ornamental
 * notes outvote the sustained harmony that establishes the key. This weighs
 * each note by the same measure chord inference weighs its own histogram by, so
 * the two agree on what the music emphasises: duration times
 * velocity, with a note that carries no velocity counted at full weight rather
 * than at an assumed one. Notes that never sound (zero or negative duration)
 * are ignored. The weighted distribution is then ranked exactly as
 * {@link detectKey} ranks it, by correlation against a key profile, so `score`
 * is a finite correlation in [-1, 1].
 *
 * The one term of that measure this cannot share is the metric accent, which
 * chord inference adds to an onset by the beat it falls on: the notes arrive
 * here without the meter they are counted in, and reading them against an
 * assumed one would rank the same notes differently under a signature the
 * caller never named. Ranking a whole piece is the coarser question, and the
 * accents are what separate one window from the next rather than one key from
 * another.
 *
 * @param notes The note events to weigh.
 * @param opts Which profile to rank with, whether the modes take part, and the
 *   budget for processing imported note events; the weights are derived from the
 *   notes themselves.
 * @returns Ranked key interpretations (empty when nothing sounds).
 * @throws {InvalidInputError} When `profile` is not a known name or a valid
 *   pair of 12-entry vectors, or `modes` names something that is not a church
 *   mode.
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
      weights: sounding.map((note) => noteWeight(note, note.durationBeat)),
      profile: opts.profile,
      modes: opts.modes,
      explain: opts.explain,
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
 * This is where {@link DetectKeyOptions.explain} earns its keep: the winner is
 * the only match a caller of this function sees, and with `explain` it carries
 * both its own rationale and the candidates it beat.
 *
 * @param pitches MIDI pitches or bare pitch classes.
 * @param opts How to weigh the input, which profile to rank with, and whether
 *   the modes take part; see {@link DetectKeyOptions}.
 * @returns The top-ranked key, or null when nothing sounds.
 * @throws {InvalidInputError} When `weights` does not have one entry per pitch,
 *   `profile` is not a known name or a valid pair of 12-entry vectors, or
 *   `modes` names something that is not a church mode.
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
