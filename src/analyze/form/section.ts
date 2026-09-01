/**
 * Sections: the largest unit this library reads, recovered from repetition.
 *
 * A section is found, not named. What the analysis can see is that a span of
 * music is a restatement of an earlier one, so the spans are labelled by order
 * of first appearance — A, B, C — and nothing more is claimed. Calling a
 * repeated span a chorus would be a guess dressed as a finding: repetition
 * alone cannot tell a chorus from a second verse, and the label a listener
 * would give depends on lyrics, arrangement and loudness that the notes do not
 * carry.
 */

import type { MeterLike } from '../../core/meter/index.js';
import { barIndexAt, barPositionToBeat, resolveMeters } from '../../core/meter/index.js';
import type { NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertNoteEvents,
  assertPositiveInt,
  assertRange,
} from '../../core/validation/index.js';
import { windowWeights } from '../histogram.js';
import { melodicSimilarity } from '../melody/index.js';
import { hypermeter } from './hypermeter.js';
import { clamp01, EPS, firstSoundingBeat, lastBarOf, weightSimilarity } from './internal.js';

/**
 * A span of music labelled by which earlier span it restates.
 *
 * @category Arrangement & Analysis
 */
export type FormSection = {
  /**
   * The section's letter, assigned in order of first appearance: the opening
   * material is A, the first material unlike it is B, and a later restatement
   * of A is A again. Past Z the letters double (AA, AB), the way spreadsheet
   * columns do. No functional name — verse, chorus, bridge — is ever inferred.
   */
  label: string;
  /** First beat of the section; negative when it opens with a pickup. */
  startBeat: number;
  /** End of the section, exclusive. */
  endBeat: number;
  /** The section's length in bars. */
  bars: number;
  /**
   * Index, in the returned array, of the first section carrying this label; the
   * section's own index when it is that first appearance.
   */
  firstOccurrence: number;
  /**
   * How alike this section and its first occurrence are, in [0, 1]; 1 on the
   * first occurrence itself. The mean over the units the section was merged
   * from, each scored against the unit it matched.
   */
  similarity: number;
  /** How the section came to carry its label. */
  rationale: string;
};

/**
 * Options for {@link sectionsFromNotes}.
 *
 * @category Arrangement & Analysis
 */
export type FormSectionOptions = {
  /**
   * A single time signature held across the whole span, as sugar for a
   * one-element `meters`; defaults to 4/4. Giving both is an input error.
   *
   * @defaultValue `4/4`
   */
  ts?: MeterLike;
  /**
   * The meter as it changes over the span, so a piece that changes metre is cut
   * at its own bar lines.
   *
   * @defaultValue 4/4 throughout
   */
  meters?: MeterLike;
  /**
   * Length of the unit spans are compared in, in bars; defaults to one hyperbar.
   *
   * Sections are found by comparing equal units and merging the neighbours that
   * match, so this is the resolution of the answer rather than the length of a
   * section: a section is any whole number of units long.
   *
   * @defaultValue the inferred hyperbar, in bars
   */
  unitBars?: number;
  /**
   * How alike two units must be before the later one is called a restatement of
   * the earlier, in [0, 1].
   *
   * @defaultValue `0.8`
   */
  threshold?: number;
  /**
   * End of the analysed span in beats; defaults to the end of the last note.
   *
   * @defaultValue the end of the last note
   */
  totalBeats?: number;
  /**
   * Upper bound on the work this call may do.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/** Share of a unit's likeness carried by its melodic line. */
const MELODY_SHARE = 0.6;

/** Share of a unit's likeness carried by its harmonic content. */
const HARMONY_SHARE = 0.4;

/** How alike two units must be before one is called a restatement of the other. */
const DEFAULT_THRESHOLD = 0.8;

/** One unit of comparison: a fixed run of bars and what sounds in it. */
type Unit = {
  startBeat: number;
  endBeat: number;
  /** The notes whose onsets fall inside the unit, in time order. */
  notes: NoteEvent[];
  /** Pitch-class weights over the unit. */
  weights: number[];
};

/**
 * The nth label in the sequence A, B, ... Z, AA, AB, ...
 *
 * Doubling the letters past Z rather than numbering them (A1, A2) keeps the
 * label free of digits, so nothing reads as "the second A" when it is in fact
 * the twenty-seventh distinct span.
 */
function labelAt(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/**
 * How alike two units are, in [0, 1].
 *
 * Melody and harmony are both asked, because either alone is fooled: the same
 * tune over new chords is a variation and not a restatement, and the same
 * chords under a new tune is a different section of the same song. A unit with
 * too little melody to compare falls back to its harmony alone.
 */
function unitSimilarity(a: Unit, b: Unit): number {
  const harmony = weightSimilarity(a.weights, b.weights);
  if (a.notes.length < 2 || b.notes.length < 2) {
    return a.notes.length === b.notes.length ? harmony : 0;
  }
  const melody = melodicSimilarity(a.notes, b.notes);
  return clamp01(MELODY_SHARE * melody + HARMONY_SHARE * harmony);
}

/**
 * Recover a piece's sections from what it repeats.
 *
 * The span is cut into equal units of `unitBars` bars, each unit is compared
 * with every unit before it, and a unit alike enough to an earlier one takes
 * that unit's label. Neighbouring units carrying the same label are then merged,
 * so an eight-bar section built of two like four-bar units is reported as one
 * section rather than two.
 *
 * Likeness is measured on the melodic line and on the harmonic content
 * together — the same tune under different harmony is a variation, not a
 * restatement — and the labels are letters in order of first appearance.
 * Nothing beyond "this is a restatement of that" is asserted: see
 * {@link FormSection.label}.
 *
 * A pickup belongs to the section it leads into, so material before the first
 * bar is folded into the opening unit rather than made a section of its own.
 *
 * @param notes The piece's notes, in any order. Notes that never sound are
 *   dropped.
 * @param opts Analysis options; see {@link FormSectionOptions}.
 * @returns The sections, in time order.
 * @example
 * ```ts
 * import { sectionsFromNotes } from '@libraz/libcantus';
 * const bar = (pitch: number, at: number) => ({ pitch, startBeat: at, durationBeat: 4 });
 * const notes = [bar(60, 0), bar(64, 4), bar(67, 8), bar(60, 12)];
 * sectionsFromNotes(notes, { unitBars: 2 }).map((section) => section.label);
 * ```
 * @category Arrangement & Analysis
 */
export function sectionsFromNotes(
  notes: readonly NoteEvent[],
  opts: FormSectionOptions = {},
): FormSection[] {
  const meters = resolveMeters(opts, 'section meters');
  assertNoteEvents(notes, 'section notes', {
    allowNonPositiveDuration: true,
    budget: opts.budget,
  });
  const sounding = notes.filter((note) => note.durationBeat > 0);
  if (sounding.length === 0) {
    // Nothing sounds, so there is no material to hear a form in. A section over
    // an empty span would name a stretch of silence as a statement.
    return [];
  }
  const firstOnset = firstSoundingBeat(sounding);
  const lastEnd = sounding.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  const spanEnd = Math.max(firstOnset, opts.totalBeats ?? lastEnd);
  assertRange(spanEnd, 0, Number.MAX_SAFE_INTEGER, 'section totalBeats');
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  assertRange(threshold, 0, 1, 'section threshold');
  const unitBars =
    opts.unitBars ??
    hypermeter(sounding, meters, { totalBeats: spanEnd, budget: opts.budget }).groupBars;
  assertPositiveInt(unitBars, 'section unitBars');

  const firstBar = barIndexAt(firstOnset, meters);
  const lastBar = lastBarOf(meters, firstOnset, spanEnd);
  // The units are counted from the bar the music starts in, not from bar 0: an
  // excerpt lifted from bar 9 has no bars 0 to 8 to divide. A pickup leads into
  // the first full bar rather than starting a unit of its own, so it is folded
  // into the opening one.
  const startBar = Math.max(0, firstBar);
  const unitCount = Math.max(1, Math.ceil((lastBar - startBar + 1) / unitBars));
  assertGenerationBudget(unitCount * unitCount, 'form section comparisons', opts.budget);
  assertGenerationBudget(unitCount * sounding.length, 'form section unit notes', opts.budget);

  const units: Unit[] = [];
  for (let index = 0; index < unitCount; index += 1) {
    const barStart = startBar + index * unitBars;
    const startBeat =
      index === 0 ? firstOnset : barPositionToBeat({ bar: barStart, beat: 0 }, meters);
    const endBeat =
      index === unitCount - 1
        ? spanEnd
        : barPositionToBeat({ bar: barStart + unitBars, beat: 0 }, meters);
    const unitNotes = sounding
      .filter((note) => note.startBeat >= startBeat - EPS && note.startBeat < endBeat - EPS)
      .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
    units.push({
      startBeat,
      endBeat,
      notes: unitNotes,
      weights: windowWeights(unitNotes, startBeat, endBeat, meters).weights,
    });
  }

  // Comparing two units runs an edit distance over their notes, so what the
  // comparisons cost is the sum over pairs of the product of what each holds —
  // not the pair count, and not the pair count times the piece. A piece whose
  // notes gather in a few units keeps both of those inside the budget while the
  // distances themselves run for seconds, so the sum is charged before the
  // first of them is run.
  let comparisons = 0;
  let earlierNotes = 0;
  for (const unit of units) {
    comparisons += unit.notes.length * earlierNotes;
    earlierNotes += unit.notes.length;
  }
  assertGenerationBudget(comparisons, 'form section melody comparisons', opts.budget);

  // Label every unit, then merge the neighbours that agree.
  const labels: string[] = [];
  const scores: number[] = [];
  let distinct = 0;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (unit === undefined) {
      continue;
    }
    let bestScore = -1;
    let bestIndex = -1;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const other = units[earlier];
      if (other === undefined) {
        continue;
      }
      const score = unitSimilarity(unit, other);
      // Ties keep the earlier match, which is the statement being restated.
      if (score > bestScore) {
        bestScore = score;
        bestIndex = earlier;
      }
    }
    if (bestIndex >= 0 && bestScore >= threshold) {
      labels.push(labels[bestIndex] ?? labelAt(distinct));
      scores.push(bestScore);
    } else {
      labels.push(labelAt(distinct));
      scores.push(1);
      distinct += 1;
    }
  }

  const sections: FormSection[] = [];
  const firstByLabel = new Map<string, number>();
  for (let index = 0; index < units.length; ) {
    const label = labels[index] ?? labelAt(0);
    let end = index;
    let scoreSum = 0;
    while (end < units.length && labels[end] === label) {
      scoreSum += scores[end] ?? 1;
      end += 1;
    }
    const startBeat = units[index]?.startBeat ?? 0;
    const endBeat = units[end - 1]?.endBeat ?? spanEnd;
    // Counted on the unit grid the sections were merged on, not from the raw
    // start beat: a pickup was folded into the opening unit, so re-deriving the
    // length from its beat would hand the first section a bar the grid does not
    // hold and leave it off the multiple of `unitBars` a section is built from.
    const sectionFirstBar = startBar + index * unitBars;
    const sectionLastBar = Math.max(
      sectionFirstBar,
      Math.min(lastBar, startBar + end * unitBars - 1),
    );
    const sectionIndex = sections.length;
    const first = firstByLabel.get(label);
    if (first === undefined) {
      firstByLabel.set(label, sectionIndex);
    }
    const similarity = first === undefined ? 1 : clamp01(scoreSum / (end - index));
    sections.push({
      label,
      startBeat,
      endBeat,
      bars: sectionLastBar - sectionFirstBar + 1,
      firstOccurrence: first ?? sectionIndex,
      similarity,
      rationale:
        first === undefined
          ? `Section ${label}: material first heard at beat ${startBeat}`
          : `Section ${label}: ${Math.round(similarity * 100)}% alike the ${label} at beat ${
              sections[first]?.startBeat ?? 0
            }`,
    });
    index = end;
  }
  return sections;
}
