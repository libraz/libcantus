/**
 * Hypermeter: the grouping of bars into hyperbars.
 *
 * Bars are felt in groups the way beats are felt in bars — four bars at a time
 * in most tonal and popular music, but two, three, six or eight elsewhere. The
 * grouping is not written in the score, so it has to be inferred from where the
 * music actually restarts: harmony changes on a hypermetric downbeat, and
 * cadences arrive at the end of a hyperbar.
 */

import type { MeterLike } from '../../core/meter/index.js';
import { barIndexAt, resolveMeters } from '../../core/meter/index.js';
import type { NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertNoteEvents,
  assertRange,
} from '../../core/validation/index.js';
import type { BarSlice } from './internal.js';
import { clamp01, EPS, floorMod, harmonicNovelty, sliceBars } from './internal.js';

/**
 * The bar groupings the search considers.
 *
 * Four is the norm, two and eight its halving and doubling, three and six the
 * triple-hypermetre alternatives. Anything else is better described as an
 * irregular succession of these than as a grouping of its own.
 */
const GROUP_CANDIDATES: readonly number[] = [2, 3, 4, 6, 8];

/**
 * How readily each grouping is believed before the music is consulted.
 *
 * The prior only settles ties: a piece that is plainly in three does not become
 * a piece in four because four is commoner. It is what decides a genuinely
 * ambiguous case, where two-bar and four-bar readings explain the accents
 * equally well.
 */
const GROUP_PRIOR: ReadonlyMap<number, number> = new Map([
  [2, 0.9],
  [3, 0.75],
  [4, 1],
  [6, 0.7],
  [8, 0.85],
]);

/** Share of the evidence carried by harmonic change landing on group heads. */
const CONTRAST_SHARE = 0.65;

/** Share of the evidence carried by cadences landing at group ends. */
const CADENCE_SHARE = 0.35;

/** How much of a cadence's fit a group-final arrival earns. */
const GROUP_FINAL_FIT = 1;

/**
 * How much of a cadence's fit an arrival on the next group's head earns.
 *
 * An elided cadence lands on the downbeat that starts the next hyperbar, so the
 * reading is real; it is weaker evidence than a group-final arrival only
 * because a chord on a hypermetric downbeat is unremarkable on its own.
 */
const ELIDED_FIT = 0.5;

/**
 * How many hyperbars the span must hold before a grouping is considered.
 *
 * One statement of a grouping is not evidence of a grouping: any span is
 * trivially one group of its own length.
 */
const MIN_GROUPS = 2;

/** Share of the confidence that survives a rival grouping scoring just as well. */
const MARGIN_FLOOR = 0.7;

/**
 * A bar grouping inferred from the music.
 *
 * @category Arrangement & Analysis
 */
export type Hypermeter = {
  /**
   * Bars per hyperbar. Falls back to the span's own bar count when the span is
   * too short to hold two of any candidate grouping.
   */
  groupBars: number;
  /**
   * Absolute beat of each hypermetric downbeat inside the analysed span, in
   * time order. A pickup bar is not a group head, so the first entry is the
   * first full bar that starts a group.
   */
  downbeats: number[];
  /**
   * How much the music supports the grouping, in [0, 1]: how strongly harmonic
   * change and cadences prefer these bars over the others, discounted when the
   * runner-up grouping explains the music nearly as well.
   */
  confidence: number;
  /** Why this grouping was chosen. */
  rationale: string;
};

/**
 * Options for {@link hypermeter}.
 *
 * @category Arrangement & Analysis
 */
export type HypermeterOptions = {
  /**
   * End of the analysed span in beats; defaults to the end of the last note.
   *
   * @defaultValue the end of the last note
   */
  totalBeats?: number;
  /**
   * Beats at which cadences arrive, as {@link CadenceHit.atBeat} reports them.
   *
   * A cadence is the clearest hypermetric evidence there is — it arrives at the
   * end of a hyperbar — but finding one needs a chord timeline and a key, which
   * this function is not given. Callers that already hold cadences should pass
   * them; {@link phrasesFromTimeline} does.
   *
   * @defaultValue none
   */
  cadenceBeats?: readonly number[];
  /**
   * Upper bound on the work this call may do.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/** One grouping-and-phase reading, with the evidence behind it. */
type Reading = {
  groupBars: number;
  phase: number;
  contrast: number;
  cadenceFit: number;
  evidence: number;
  score: number;
};

/**
 * How much more the group heads are accented than the bars between them.
 *
 * The difference of the two means rather than the head mean alone: a piece
 * whose every bar changes harmony accents its group heads no more than anything
 * else, and a reading that cannot tell the two apart has found nothing.
 */
function accentContrast(
  novelty: readonly number[],
  slices: readonly BarSlice[],
  groupBars: number,
  phase: number,
): number {
  let headSum = 0;
  let headCount = 0;
  let otherSum = 0;
  let otherCount = 0;
  for (let i = 0; i < slices.length; i += 1) {
    const slice = slices[i];
    if (slice === undefined) {
      continue;
    }
    const value = novelty[i] ?? 0;
    if (floorMod(slice.index - phase, groupBars) === 0) {
      headSum += value;
      headCount += 1;
    } else {
      otherSum += value;
      otherCount += 1;
    }
  }
  if (headCount === 0 || otherCount === 0) {
    return 0;
  }
  return headSum / headCount - otherSum / otherCount;
}

/** Share of the cadences arriving where the grouping says a hyperbar ends. */
function cadenceFitOf(cadenceBars: readonly number[], groupBars: number, phase: number): number {
  if (cadenceBars.length === 0) {
    return 0;
  }
  let fit = 0;
  for (const bar of cadenceBars) {
    const position = floorMod(bar - phase, groupBars);
    if (position === groupBars - 1) {
      fit += GROUP_FINAL_FIT;
    } else if (position === 0) {
      fit += ELIDED_FIT;
    }
  }
  return clamp01(fit / cadenceBars.length);
}

/** The reading a span too short to hold two of any candidate grouping gets. */
function undecidedReading(slices: readonly BarSlice[]): Hypermeter {
  const groupBars = Math.max(1, slices.length);
  const first = slices[0];
  return {
    groupBars,
    downbeats: first === undefined ? [] : [first.startBeat],
    confidence: 0,
    rationale: `Span of ${slices.length} bar(s) is too short to establish a grouping; read as one group`,
  };
}

/**
 * Infer how a piece's bars group into hyperbars.
 *
 * Every grouping in {@link GROUP_CANDIDATES} is tried at every phase, and each
 * reading is scored on two counts: how much more harmonic change lands on the
 * bars it calls group heads than on the bars between them, and how many of the
 * cadences it is given arrive where it says a hyperbar ends. The commonest
 * groupings are believed a little more readily than the rare ones, which
 * settles ties without letting a prior overrule the music.
 *
 * The meter is read at the beat in question rather than at the start, so a
 * piece that changes metre keeps being cut at its own bar lines. Bar 0 is the
 * first full bar however much pickup precedes it, so an upbeat is bar -1 and is
 * never taken for a hypermetric downbeat.
 *
 * @param notes The notes to read, in any order. Notes that never sound are
 *   dropped.
 * @param meter A single time signature, or the piece's meter map; defaults to
 *   4/4 throughout.
 * @param opts Analysis options; see {@link HypermeterOptions}.
 * @returns The grouping, its downbeats, a confidence, and a rationale.
 * @example
 * ```ts
 * import { hypermeter } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 16 },
 *   { pitch: 65, startBeat: 16, durationBeat: 16 },
 * ];
 * hypermeter(notes).groupBars; // 4
 * ```
 * @category Arrangement & Analysis
 */
export function hypermeter(
  notes: readonly NoteEvent[],
  meter?: MeterLike,
  opts: HypermeterOptions = {},
): Hypermeter {
  const meters = meter ?? resolveMeters({});
  assertNoteEvents(notes, 'hypermeter notes', {
    allowNonPositiveDuration: true,
    budget: opts.budget,
  });
  const sounding = notes.filter((note) => note.durationBeat > 0);
  const firstOnset = sounding.reduce((first, n) => Math.min(first, n.startBeat), 0);
  const lastEnd = sounding.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  const spanEnd = opts.totalBeats ?? lastEnd;
  assertRange(spanEnd, 0, Number.MAX_SAFE_INTEGER, 'hypermeter totalBeats');
  const slices = sliceBars(sounding, meters, firstOnset, spanEnd, opts.budget);

  const candidates = GROUP_CANDIDATES.filter(
    (groupBars) => slices.length >= groupBars * MIN_GROUPS,
  );
  if (candidates.length === 0) {
    return undecidedReading(slices);
  }
  assertGenerationBudget(
    candidates.reduce((sum, groupBars) => sum + groupBars * slices.length, 0),
    'hypermeter readings',
    opts.budget,
  );

  const novelty = slices.map((_, index) => harmonicNovelty(slices, index));
  const cadenceBars = (opts.cadenceBeats ?? []).map((beat) => barIndexAt(beat, meters));

  const readings: Reading[] = [];
  for (const groupBars of candidates) {
    for (let phase = 0; phase < groupBars; phase += 1) {
      const contrast = accentContrast(novelty, slices, groupBars, phase);
      const cadenceFit = cadenceFitOf(cadenceBars, groupBars, phase);
      const evidence = clamp01(
        cadenceBars.length === 0
          ? contrast
          : CONTRAST_SHARE * contrast + CADENCE_SHARE * cadenceFit,
      );
      readings.push({
        groupBars,
        phase,
        contrast,
        cadenceFit,
        evidence,
        score: evidence * (GROUP_PRIOR.get(groupBars) ?? 0),
      });
    }
  }
  // Ties keep the commoner grouping, then the shorter one, then the earlier
  // phase, so the answer never depends on enumeration order.
  readings.sort(
    (a, b) =>
      b.score - a.score ||
      (GROUP_PRIOR.get(b.groupBars) ?? 0) - (GROUP_PRIOR.get(a.groupBars) ?? 0) ||
      a.groupBars - b.groupBars ||
      a.phase - b.phase,
  );
  const best = readings[0];
  if (best === undefined) {
    return undecidedReading(slices);
  }
  const runnerUp = readings.find((reading) => reading.groupBars !== best.groupBars);
  const margin =
    runnerUp === undefined || best.score <= EPS
      ? 1
      : clamp01((best.score - runnerUp.score) / best.score);

  const downbeats = slices
    .filter((slice) => floorMod(slice.index - best.phase, best.groupBars) === 0)
    .map((slice) => slice.startBeat);
  const cadencePart =
    cadenceBars.length === 0
      ? 'no cadences given'
      : `${Math.round(best.cadenceFit * 100)}% of cadences arriving at a group end`;

  return {
    groupBars: best.groupBars,
    downbeats,
    // Mostly the evidence, discounted when a rival grouping explains the
    // accents nearly as well. The discount is the smaller term because the
    // runner-up is nearly always a multiple or a divisor of the winner — four
    // bars nest inside eight — and a reading of the same accents at another
    // level is weaker counter-evidence than an unrelated rival would be.
    confidence: clamp01(best.evidence * (MARGIN_FLOOR + (1 - MARGIN_FLOOR) * margin)),
    rationale:
      `${best.groupBars}-bar groups from bar ${best.phase}: harmonic change ` +
      `${Math.round(best.contrast * 100)}% stronger on group heads, ${cadencePart}`,
  };
}
