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
import { barGridStart } from '../grid.js';
import type { BarSlice } from './internal.js';
import {
  clamp01,
  EPS,
  firstSoundingBeat,
  floorMod,
  harmonicNovelty,
  sliceBars,
} from './internal.js';

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

/** How much of a group end's fit a cadence arriving in it earns. */
const GROUP_FINAL_FIT = 1;

/**
 * How much of a group end's fit an arrival on the next group's head earns.
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

/**
 * Share of the hyperbar ends the reading predicts that a cadence closes.
 *
 * Measured over the group ends rather than over the cadences, because the two
 * count different things: a cadence every four bars sits at a group end under a
 * two-bar reading as readily as under a four-bar one, so counting cadences
 * cannot tell the two apart. Counting group ends can — half the two-bar groups
 * end in nothing.
 */
function cadenceFitOf(
  cadenceBars: ReadonlySet<number>,
  slices: readonly BarSlice[],
  groupBars: number,
  phase: number,
): number {
  const lastBar = slices[slices.length - 1]?.index ?? -1;
  let ends = 0;
  let fit = 0;
  for (const slice of slices) {
    // A pickup heads no group, so it ends none either.
    if (slice.index < 0 || floorMod(slice.index - phase, groupBars) !== groupBars - 1) {
      continue;
    }
    ends += 1;
    if (cadenceBars.has(slice.index)) {
      fit += GROUP_FINAL_FIT;
    } else if (slice.index < lastBar && cadenceBars.has(slice.index + 1)) {
      // Elision needs a next group to arrive into. Past the last bar the span
      // holds there is none, so a cadence beat beyond the music is not evidence
      // about how the music that was read is grouped.
      fit += ELIDED_FIT;
    }
  }
  return ends === 0 ? 0 : clamp01(fit / ends);
}

/**
 * The reading a span too short to hold two of any candidate grouping gets.
 *
 * The pickup is dropped before the group is read, exactly as it is on the
 * decided path: an upbeat leads into the first hyperbar rather than heading one,
 * so it neither lengthens the group nor supplies its downbeat. A span in which
 * only the pickup sounds has no hypermetric downbeat at all.
 */
function undecidedReading(slices: readonly BarSlice[]): Hypermeter {
  const fullBars = slices.filter((slice) => slice.index >= 0);
  const groupBars = Math.max(1, fullBars.length);
  const first = fullBars[0];
  return {
    groupBars,
    downbeats: first === undefined ? [] : [first.startBeat],
    confidence: 0,
    rationale: `Span of ${fullBars.length} bar(s) is too short to establish a grouping; read as one group`,
  };
}

/**
 * Infer how a piece's bars group into hyperbars.
 *
 * Groupings of 2, 3, 4, 6, and 8 bars are tried at every phase, and each
 * reading is scored on two counts: how much more harmonic change lands on the
 * bars it calls group heads than on the bars between them, and how many of the
 * hyperbar ends it predicts are closed by one of the cadences it is given.
 * Where cadences are given they settle the phase, since a hyperbar is what a
 * cadence ends; the harmony then chooses among the phases they agree with. The
 * commonest groupings are believed a little more readily than the rare ones,
 * which settles ties without letting a prior overrule the music.
 *
 * The meter is read at the beat in question rather than at the start, so a
 * piece that changes metre keeps being cut at its own bar lines. Bar 0 is the
 * first full bar however much pickup precedes it, so an upbeat is bar -1 and is
 * never taken for a hypermetric downbeat. Whether there is an upbeat at all is
 * decided the way the rest of the analysis decides it: a note a millibeat early
 * is playing the downbeat, not anticipating it.
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
  // Read once, here: every bar question below is asked of the resolved map
  // rather than of whichever form the caller happened to hold.
  const meters = resolveMeters({ meters: meter }, 'meter');
  assertNoteEvents(notes, 'hypermeter notes', {
    allowNonPositiveDuration: true,
    budget: opts.budget,
  });
  const sounding = notes.filter((note) => note.durationBeat > 0);
  const firstOnset = firstSoundingBeat(sounding);
  const lastEnd = sounding.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  const spanEnd = opts.totalBeats ?? lastEnd;
  assertRange(spanEnd, 0, Number.MAX_SAFE_INTEGER, 'hypermeter totalBeats');
  // Whether the music starts before the downbeat is the analysis-wide pickup
  // question, and the slot grids of chord and key inference answer it here: a
  // note a millibeat early is playing beat 0, and only one a whole grid unit
  // early is an upbeat. Reading a hair-early onset as a pickup would hand the
  // phase search a silent bar of its own to group against. An excerpt that
  // begins later keeps the beat it begins on.
  const spanStart = barGridStart(firstOnset, meters);
  const slices = sliceBars(sounding, meters, spanStart, spanEnd, opts.budget);

  // Counted over the bars a grouping can actually occupy, which is the set
  // `undecidedReading` and the downbeats are read from: a pickup leads into the
  // first hyperbar rather than filling one, so it cannot be what makes a span
  // long enough to hold two groups.
  const fullBars = slices.reduce((count, slice) => (slice.index >= 0 ? count + 1 : count), 0);
  const candidates = GROUP_CANDIDATES.filter((groupBars) => fullBars >= groupBars * MIN_GROUPS);
  if (candidates.length === 0) {
    return undecidedReading(slices);
  }
  assertGenerationBudget(
    candidates.reduce((sum, groupBars) => sum + groupBars * slices.length, 0),
    'hypermeter readings',
    opts.budget,
  );

  const novelty = slices.map((_, index) => harmonicNovelty(slices, index));
  const cadenceBars = new Set((opts.cadenceBeats ?? []).map((beat) => barIndexAt(beat, meters)));
  const hasCadences = cadenceBars.size > 0;

  const readings: Reading[] = [];
  for (const groupBars of candidates) {
    const phases = Array.from({ length: groupBars }, (_, phase) => ({
      phase,
      contrast: accentContrast(novelty, slices, groupBars, phase),
      cadenceFit: cadenceFitOf(cadenceBars, slices, groupBars, phase),
    }));
    // Where the cadences are known, they decide the phase: a cadence is what a
    // hyperbar ends with, so a reading that leaves them mid-group has misread
    // the phase however the harmony moves. Harmonic contrast then chooses among
    // the phases the cadences agree with, and across the groupings.
    const bestFit = phases.reduce((best, reading) => Math.max(best, reading.cadenceFit), 0);
    for (const { phase, contrast, cadenceFit } of phases) {
      if (hasCadences && cadenceFit < bestFit - EPS) {
        continue;
      }
      const evidence = clamp01(
        hasCadences
          ? // Floored at zero rather than summed raw: group heads that restate
            // the harmony their group opened with — the commonest way a phrase
            // begins — change less than the bars between them, and a negative
            // contrast subtracted from the cadence term would count that
            // restatement as evidence against the very phase it confirms.
            CONTRAST_SHARE * clamp01(contrast) + CADENCE_SHARE * cadenceFit
          : contrast,
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

  // A pickup bar is bar -1, and a phase can put it on a group head — but an
  // upbeat is what leads into the first hyperbar, not what starts one, so it
  // never becomes a hypermetric downbeat however the phase falls.
  const downbeats = slices
    .filter((slice) => slice.index >= 0 && floorMod(slice.index - best.phase, best.groupBars) === 0)
    .map((slice) => slice.startBeat);
  const cadencePart = hasCadences
    ? `${Math.round(best.cadenceFit * 100)}% of group ends closed by a cadence`
    : 'no cadences given';

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
