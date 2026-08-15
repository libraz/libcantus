/**
 * Church-mode candidates for {@link detectKey}.
 *
 * A mode is not a key with a different scale bolted on: it is the same tonal
 * hierarchy — tonic strongest, dominant next, the remaining diatonic degrees
 * behind them — heard over a scale in which one degree has been replaced. Its
 * profile is therefore derived from the profile of the major or minor key it
 * sits closest to, rather than being a table of its own.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import {
  DORIAN_MASK,
  LOCRIAN_MASK,
  LYDIAN_MASK,
  MIXOLYDIAN_MASK,
  PHRYGIAN_MASK,
} from '../../theory/scale/index.js';
import type { KeyProfilePair } from './profiles.js';

/**
 * A church mode {@link detectKey} can rank alongside the major and minor keys.
 *
 * Ionian and Aeolian are absent because they are the major and the natural minor
 * scale: a piece in either is already reported by the plain major or minor
 * candidate, and adding a second candidate over the same pitch classes and the
 * same profile would only produce a tie with itself.
 *
 * @category Recognition
 */
export type ModalScaleName = 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian';

/**
 * How a modal candidate is built out of its parallel major or minor key.
 *
 * @category Recognition
 */
export type ModalCandidate = {
  /** The name reported as {@link KeyMatch.scaleName} when this candidate wins. */
  scaleName: ModalScaleName;
  /** The major or minor key this mode is closest to, reported as `mode`. */
  mode: 'major' | 'minor';
  /** The 12-bit scale mask of the mode. */
  mask: number;
  /**
   * Degree pairs the mode substitutes, as `[replaced, replacing]` semitone
   * offsets above the tonic. Applying them to the parallel scale yields `mask`,
   * and applying them to the parallel profile yields this candidate's profile.
   */
  substitutions: readonly (readonly [number, number])[];
};

/**
 * The modal candidates, in the order they break a tie among themselves.
 *
 * Each mode is described as its parallel major or minor key with one or two
 * degrees substituted — exactly the substitution that names the mode in
 * teaching: dorian is minor with a natural sixth, phrygian minor with a flat
 * second, lydian major with a raised fourth, mixolydian major with a flat
 * seventh, locrian minor with both a flat second and a flat fifth. Because the
 * same substitution defines both the scale and the profile, the two can never
 * drift apart: a degree that is not in the scale never carries the weight the
 * profile expected on the degree it replaced.
 */
export const MODAL_CANDIDATES: readonly ModalCandidate[] = Object.freeze([
  { scaleName: 'dorian', mode: 'minor', mask: DORIAN_MASK, substitutions: [[8, 9]] },
  { scaleName: 'phrygian', mode: 'minor', mask: PHRYGIAN_MASK, substitutions: [[2, 1]] },
  { scaleName: 'lydian', mode: 'major', mask: LYDIAN_MASK, substitutions: [[5, 6]] },
  { scaleName: 'mixolydian', mode: 'major', mask: MIXOLYDIAN_MASK, substitutions: [[11, 10]] },
  {
    scaleName: 'locrian',
    mode: 'minor',
    mask: LOCRIAN_MASK,
    substitutions: [
      [2, 1],
      [7, 6],
    ],
  },
] satisfies readonly ModalCandidate[]);

/**
 * Every mode {@link DetectKeyOptions.modes} accepts, in candidate order.
 *
 * @category Recognition
 */
export const MODAL_SCALE_NAMES: readonly ModalScaleName[] = Object.freeze(
  MODAL_CANDIDATES.map((candidate) => candidate.scaleName),
);

/**
 * Derive the key profile of a mode from the profile of its parallel key.
 *
 * The mode keeps the tonal hierarchy of the major or minor key it is closest to,
 * so its profile starts as that key's profile; the weight the parallel key
 * expected on each replaced degree then moves to the degree that replaced it.
 * Dorian therefore expects on its natural sixth the weight minor expects on its
 * flat sixth, and mixolydian expects on its flat seventh the weight major
 * expects on its leading tone, while both keep their tonic peak — which is what
 * separates a mode from its parent scale, since D dorian and C major hold the
 * same seven pitch classes and differ only in where the weight is expected to
 * fall.
 *
 * Moving weight rather than adding it makes every modal vector a permutation of
 * a published one, so it has the same mean and the same variance as the major
 * and minor vectors it competes with. Pearson correlations against them are then
 * directly comparable, and a mode can neither win nor lose a ranking through an
 * artefact of scaling.
 *
 * @param profile The profile pair the ranking is running on.
 * @param candidate The mode to derive a vector for.
 * @returns A 12-entry vector indexed from the modal tonic.
 * @example
 * ```ts
 * import { KRUMHANSL_KESSLER_PROFILE } from './profiles.js';
 * import { MODAL_CANDIDATES, modalProfileVector } from './modes.js';
 * const dorian = modalProfileVector(KRUMHANSL_KESSLER_PROFILE, MODAL_CANDIDATES[0]);
 * dorian[9]; // 3.98, the weight minor expects on its flat sixth
 * ```
 */
export function modalProfileVector(
  profile: KeyProfilePair,
  candidate: ModalCandidate,
): readonly number[] {
  const parent = candidate.mode === 'major' ? profile.major : profile.minor;
  const vector = [...parent];
  for (const [replaced, replacing] of candidate.substitutions) {
    vector[replacing] = parent[replaced] ?? 0;
    vector[replaced] = parent[replacing] ?? 0;
  }
  return vector;
}

/**
 * Resolve the `modes` option of {@link detectKey} to the candidates to rank.
 *
 * @param modes True for every mode, a list of mode names for a chosen few, or
 *   false/undefined for none (the default, which ranks the 24 keys alone).
 * @returns The modal candidates, always in {@link MODAL_CANDIDATES} order so a
 *   caller cannot reorder the ranking by reordering the request.
 * @throws {InvalidInputError} When `modes` is neither a boolean nor an array, or
 *   names a mode that is not a church mode.
 * @example
 * ```ts
 * import { resolveModalCandidates } from './modes.js';
 * resolveModalCandidates(undefined).length; // 0
 * resolveModalCandidates(['dorian']).map((c) => c.scaleName); // ['dorian']
 * ```
 */
export function resolveModalCandidates(
  modes: boolean | readonly ModalScaleName[] | undefined,
): readonly ModalCandidate[] {
  if (modes === undefined || modes === false) {
    return [];
  }
  if (modes === true) {
    return MODAL_CANDIDATES;
  }
  if (!Array.isArray(modes)) {
    throw new InvalidInputError('modes must be a boolean or an array of mode names');
  }
  const requested = new Set<string>(modes);
  for (const name of requested) {
    if (!MODAL_SCALE_NAMES.some((known) => known === name)) {
      throw new InvalidInputError(
        `unknown mode '${String(name)}'; expected one of ${MODAL_SCALE_NAMES.join(', ')}`,
      );
    }
  }
  return MODAL_CANDIDATES.filter((candidate) => requested.has(candidate.scaleName));
}
