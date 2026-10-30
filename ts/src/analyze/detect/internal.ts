import type { KeyVariant, ScaleName } from '../../theory/scale/index.js';
import {
  HARMONIC_MINOR_MASK,
  MAJOR_MASK,
  MELODIC_MINOR_MASK,
  NATURAL_MINOR_MASK,
} from '../../theory/scale/index.js';

/**
 * Minor-scale variants a minor-key candidate may report. Ranking does not
 * consult them: the minor profile already expects weight on the raised seventh
 * and treats the raised sixth as chromatic, so the variant is chosen
 * afterwards as the mask that covers the most input weight. Natural minor comes
 * first so it wins a tie as the most diatonic reading.
 */
export const MINOR_VARIANTS = [
  { variant: 'natural', mask: NATURAL_MINOR_MASK, scaleName: 'naturalMinor' },
  { variant: 'harmonic', mask: HARMONIC_MINOR_MASK, scaleName: 'harmonicMinor' },
  { variant: 'melodic', mask: MELODIC_MINOR_MASK, scaleName: 'melodicMinor' },
] as const satisfies readonly { variant: KeyVariant; mask: number; scaleName: ScaleName }[];

/** The single major form, kept in the same shape as the minor variants. */
export const MAJOR_VARIANTS = [
  { variant: 'major', mask: MAJOR_MASK, scaleName: 'major' },
] as const satisfies readonly { variant: KeyVariant; mask: number; scaleName: ScaleName }[];

/**
 * Tie-break order over the scales a candidate can report, applied last so that
 * two candidates on the same tonic which score and fit identically — as every
 * candidate does on a perfectly even distribution — still rank in an order the
 * input alone decides. Major before the minor forms reproduces the order the 24
 * keys have always ranked in; the modes follow, in candidate order.
 */
export const SCALE_NAME_ORDER: readonly ScaleName[] = [
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

/**
 * How many runners-up the winning match names in its `alternatives`.
 *
 * Every candidate below the winner was rejected, so the list has to stop
 * somewhere; three is the neighbourhood a disagreement actually lives in — the
 * relative, the parallel and the neighbouring fifth — and the caller holding
 * the full ranking can read further itself.
 */
export const EXPLAINED_RIVALS = 3;

/** Decimal places a correlation is quoted to in a rationale. */
export const SCORE_DIGITS = 2;

/**
 * Decimal places a comparison of two correlations may grow to.
 *
 * Two candidates can be separated by a margin the two quoted decimals hide,
 * which would read as "ranked below (0.68 against 0.68)" — the very thing a
 * rationale exists to prevent. The comparison quotes further digits until the
 * two differ, up to the point where the difference stops being a musical fact.
 */
export const MAX_SCORE_DIGITS = 6;
