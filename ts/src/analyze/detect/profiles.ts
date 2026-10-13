/**
 * Key-profile vectors for {@link detectKey}.
 *
 * A key profile is a 12-entry vector indexed from the tonic (0 = tonic, 1 = flat
 * second, ... 11 = major seventh) giving how strongly each chromatic degree is
 * expected to sound in that key. Ranking a candidate key means rotating its
 * profile onto the candidate tonic and correlating it with the pitch-class
 * distribution of the music, which is what separates a key from its relative:
 * C major and A minor contain the same seven pitch classes, but they expect the
 * weight to fall on different degrees.
 *
 * The published vectors below are transcribed from their sources and are not
 * tuned for this library; a citation accompanies each so a reader can check the
 * digits.
 */

import { InvalidInputError } from '../../core/errors/index.js';

/**
 * A pair of 12-entry key profiles, one per mode, each indexed from its own
 * tonic (index 0 = tonic, 1 = flat second, ... 11 = major seventh).
 *
 * @category Recognition
 */
export type KeyProfilePair = {
  /** Degree weights for a major candidate, indexed from the major tonic. */
  major: readonly number[];
  /** Degree weights for a minor candidate, indexed from the minor tonic. */
  minor: readonly number[];
};

/**
 * Name of a built-in key profile accepted by {@link DetectKeyOptions.profile}.
 *
 * @category Recognition
 */
export type KeyProfileName = 'krumhansl' | 'temperley' | 'flat';

/**
 * Krumhansl–Kessler probe-tone profiles, the vectors the Krumhansl–Schmuckler
 * key-finding algorithm was defined over.
 *
 * Source: Krumhansl, Carol L. *Cognitive Foundations of Musical Pitch*, Oxford
 * Psychology Series No. 17, Oxford University Press, 1990, p. 37 (the averaged
 * probe-tone ratings of Krumhansl & Kessler 1982); the key-finding algorithm
 * itself is Chapter 4. These are the digits key-finding tools carry as the
 * Krumhansl–Schmuckler weight set.
 *
 * Each entry is a mean rating on a 1..7 scale, so the tonic (6.35 major, 6.33
 * minor) and the dominant (5.19 major) dominate, and the raised submediant of
 * minor is deliberately weaker than its flat form.
 */
export const KRUMHANSL_KESSLER_PROFILE: KeyProfilePair = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

/**
 * Temperley's Kostka–Payne profiles: the proportion of segments of a key in
 * which each scale degree appears, counted over the Kostka–Payne harmony
 * textbook corpus.
 *
 * Source: Temperley, David. *Music and Probability*, MIT Press, 2007, p. 85.
 * These are the digits key-finding tools carry as the Temperley–Kostka–Payne
 * weight set.
 *
 * These are presence proportions rather than listener ratings, so chromatic
 * degrees fall much closer to zero than in {@link KRUMHANSL_KESSLER_PROFILE};
 * that makes the profile decisive on diatonic music and blunt on chromatic
 * music. Note the corpus quirk that the dominant outweighs the tonic in minor.
 */
export const TEMPERLEY_KOSTKA_PAYNE_PROFILE: KeyProfilePair = {
  major: [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4],
  minor: [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33],
};

/**
 * A flat profile over the scale, reproducing plain scale-membership scoring.
 *
 * Every scale degree carries the same weight and every chromatic degree carries
 * none, so correlating against this vector ranks candidates by the share of the
 * input weight that lands inside the scale — the behaviour key detection had
 * before profile correlation. The tonic carries 1.5 rather than 1, which is the
 * same half-a-count tonic bonus that scoring used to add on top of the
 * membership sum.
 *
 * The major and minor vectors are permutations of one another (both are seven
 * ones-with-a-1.5-tonic in a field of five zeros), which is what keeps the two
 * modes commensurable: correlation against either is then a strictly increasing
 * function of the in-scale weight, so the ranking matches the membership sum
 * exactly rather than approximately.
 *
 * The minor vector is the natural minor. Membership scoring used to rank a
 * minor candidate by whichever of the three minor variants scored best; profile
 * ranking picks the variant after the fact instead (see {@link detectKey}), so
 * this profile reproduces the membership ranking, not that per-candidate
 * maximum.
 */
export const FLAT_SCALE_PROFILE: KeyProfilePair = {
  major: [1.5, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1],
  minor: [1.5, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0],
};

/** Number of entries every key profile must have, one per chromatic degree. */
const PROFILE_LENGTH = 12;

/**
 * Reciprocal of the quantum {@link profileScore} rounds to.
 *
 * Rotating a profile sums the same twelve products in twelve different orders,
 * so candidates that are mathematically equal — every rotation of a chromatic
 * input, for instance — come out differing by a unit in the last place. Left
 * alone that noise decides the ranking, which would make the order an artefact
 * of summation order rather than of the music. Rounding to 1e-12, eleven orders
 * of magnitude coarser than the noise and far finer than any musically
 * meaningful difference, makes equal candidates compare equal so the documented
 * tie-break can do its job.
 */
const SCORE_QUANTUM = 1e12;

/** Built-in profiles addressable by name. */
const NAMED_PROFILES: Record<KeyProfileName, KeyProfilePair> = {
  krumhansl: KRUMHANSL_KESSLER_PROFILE,
  temperley: TEMPERLEY_KOSTKA_PAYNE_PROFILE,
  flat: FLAT_SCALE_PROFILE,
};

/** Reject a vector that cannot be correlated against a distribution. */
function assertProfileVector(vector: readonly number[], name: string): void {
  if (vector.length !== PROFILE_LENGTH) {
    throw new InvalidInputError(`${name} must have ${PROFILE_LENGTH} entries`);
  }
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvalidInputError(`${name}[${index}] must be a finite number`);
    }
  }
}

/**
 * Resolve the `profile` option of {@link detectKey} to a validated profile pair.
 *
 * @param profile A built-in profile name, an explicit pair of 12-entry vectors,
 *   or undefined for the default ({@link KRUMHANSL_KESSLER_PROFILE}).
 * @returns The profile pair to rank candidates with.
 * @throws {InvalidInputError} When a custom pair is missing a vector, a vector
 *   is not 12 entries long, or an entry is not a finite number.
 * @example
 * ```ts
 * import { detectKey } from '@libraz/libcantus';
 * const pitches = [60, 62, 64, 65, 67, 69, 71, 60];
 * // The named default, spelled out and left out, rank the same way.
 * detectKey(pitches, { profile: 'krumhansl' })[0]?.score ===
 *   detectKey(pitches)[0]?.score; // true
 * ```
 */
export function resolveKeyProfile(
  profile: KeyProfileName | KeyProfilePair | undefined,
): KeyProfilePair {
  if (profile === undefined) {
    return KRUMHANSL_KESSLER_PROFILE;
  }
  if (typeof profile === 'string') {
    const named = NAMED_PROFILES[profile];
    if (named === undefined) {
      throw new InvalidInputError(
        `unknown key profile '${profile}'; expected one of ${Object.keys(NAMED_PROFILES).join(', ')}`,
      );
    }
    return named;
  }
  if (typeof profile !== 'object' || profile === null) {
    throw new InvalidInputError('profile must be a profile name or a { major, minor } pair');
  }
  const { major, minor } = profile;
  if (!Array.isArray(major) || !Array.isArray(minor)) {
    throw new InvalidInputError('profile must carry a major and a minor vector');
  }
  assertProfileVector(major, 'profile.major');
  assertProfileVector(minor, 'profile.minor');
  return { major, minor };
}

/**
 * Cosine similarity of a distribution with a rotated profile, the fallback used
 * when Pearson correlation is undefined.
 *
 * @param dist Weighted pitch-class distribution, 12 entries indexed by pitch class.
 * @param vector Key profile indexed from its own tonic.
 * @param tonic Pitch class the profile is rotated onto.
 * @returns The normalized dot product, 0 when either vector is all zeros.
 */
function normalizedDot(dist: readonly number[], vector: readonly number[], tonic: number): number {
  let dot = 0;
  let distSquares = 0;
  let profileSquares = 0;
  for (let pc = 0; pc < PROFILE_LENGTH; pc += 1) {
    const d = dist[pc] ?? 0;
    const p = vector[(pc - tonic + PROFILE_LENGTH) % PROFILE_LENGTH] ?? 0;
    dot += d * p;
    distSquares += d * d;
    profileSquares += p * p;
  }
  const norm = Math.sqrt(distSquares * profileSquares);
  return norm > 0 ? dot / norm : 0;
}

/**
 * Score one key candidate: the Pearson correlation between a pitch-class
 * distribution and a profile rotated onto the candidate tonic.
 *
 * Pearson r is undefined when either side has zero variance — a distribution
 * that spreads its weight perfectly evenly across all twelve pitch classes, or
 * a caller-supplied profile whose entries are all equal. Rather than emit NaN,
 * such a candidate falls back to the cosine similarity of the same two vectors,
 * which stays in [0, 1], preserves the relative ordering of the candidates that
 * do differ, and is deterministic.
 *
 * The result is rounded to a quantum of 1e-12 so that candidates which differ
 * only by the order their products were summed in compare exactly equal, and
 * the caller's tie-break rather than float noise decides between them.
 *
 * @param dist Weighted pitch-class distribution, 12 entries indexed by pitch class.
 * @param vector Key profile indexed from its own tonic.
 * @param tonic Pitch class the profile is rotated onto.
 * @returns A finite score in [-1, 1]; never NaN.
 * @example
 * ```ts
 * import { detectKey } from '@libraz/libcantus';
 * // Weight on the tonic, the fifth and the third, spread as a major key
 * // expects it: the score is the correlation this returns.
 * const best = detectKey([60, 60, 60, 60, 64, 64, 64, 67, 67, 65, 69, 62, 71])[0];
 * best?.score !== undefined && best.score > 0.8; // true
 * ```
 */
export function profileScore(
  dist: readonly number[],
  vector: readonly number[],
  tonic: number,
): number {
  let distSum = 0;
  let profileSum = 0;
  for (let pc = 0; pc < PROFILE_LENGTH; pc += 1) {
    distSum += dist[pc] ?? 0;
    profileSum += vector[pc] ?? 0;
  }
  const distMean = distSum / PROFILE_LENGTH;
  const profileMean = profileSum / PROFILE_LENGTH;
  let covariance = 0;
  let distVariance = 0;
  let profileVariance = 0;
  for (let pc = 0; pc < PROFILE_LENGTH; pc += 1) {
    const d = (dist[pc] ?? 0) - distMean;
    const p = (vector[(pc - tonic + PROFILE_LENGTH) % PROFILE_LENGTH] ?? 0) - profileMean;
    covariance += d * p;
    distVariance += d * d;
    profileVariance += p * p;
  }
  const denominator = Math.sqrt(distVariance * profileVariance);
  const raw = denominator > 0 ? covariance / denominator : normalizedDot(dist, vector, tonic);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(-1, raw));
  return Math.round(clamped * SCORE_QUANTUM) / SCORE_QUANTUM;
}
