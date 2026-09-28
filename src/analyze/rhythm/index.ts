/**
 * Where a line places its onsets against the meter: how dense they are, which
 * metric positions they favour, and how far they push against the beat.
 *
 * A phrase and a whole piece are read the same way — a run of onsets over a
 * span of beats — so a single reading serves both a melodic line and a
 * harmonic-rhythm reading of chord changes turned into onsets of their own.
 */

import type { MeterLike, MeterMap, TimeSignature } from '../../core/meter/index.js';
import {
  barIndexAt,
  barPositionToBeat,
  barStartBeat,
  beatsPerBar,
  beatsPerBarAt,
  isCompound,
  meterAt,
  metricWeight,
  pulseBeats,
  resolveMeters,
} from '../../core/meter/index.js';
import type { NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertNoteEvents,
  assertRange,
} from '../../core/validation/index.js';
import { BEAT_EPS, HUMANIZE_ADJACENCY } from '../adjacency.js';
import { lastBarOf } from '../form/internal.js';
import { barGridStart } from '../grid.js';

/**
 * Options for {@link analyzeRhythm}.
 *
 * @category Arrangement & Analysis
 */
export type RhythmAnalysisOptions = {
  /**
   * A single time signature held across the whole span, as sugar for a
   * one-element `meters`; defaults to 4/4. Giving both is an input error.
   *
   * @defaultValue `4/4`
   */
  ts?: MeterLike;
  /**
   * The meter as it changes over the span, so a piece that changes metre is
   * read against its own bar lines throughout.
   *
   * @defaultValue 4/4 throughout
   */
  meters?: MeterLike;
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

/**
 * How a line's onsets sit against one time signature: which slot of its bar
 * they favour, mass-normalized.
 *
 * @category Arrangement & Analysis
 */
export type BarPositionProfile = {
  /** The time signature this profile's bar is read in. */
  ts: TimeSignature;
  /** Slots in one bar of `ts`, at one twelfth of a quarter-note beat each. */
  slotsPerBar: number;
  /** Onset mass per slot, in bar order starting at the downbeat; sums to 1. */
  shares: number[];
  /** Onsets read under this signature. */
  onsets: number;
};

/**
 * How a line places its onsets against the meter.
 *
 * @category Arrangement & Analysis
 */
export type RhythmAnalysis = {
  /** First beat of the analysed span. */
  startBeat: number;
  /** End of the analysed span, exclusive. */
  endBeat: number;
  /** The span's length in bars, counted across any meter changes it crosses. */
  bars: number;
  /** Onsets read, folding onsets within {@link HUMANIZE_ADJACENCY} into one. */
  onsets: number;
  /** Onsets per bar; 0 for a span with no bars. */
  onsetDensity: number;
  /** Onsets per bar of the span, one entry per bar including a part bar at either end. */
  barOnsets: number[];
  /**
   * Onset mass by rhythmic level, indexed 0–5: 0 off the first pulse
   * subdivision, 1 on it, 2–5 on a main pulse (`metricWeight` plus 2). Sums to 1.
   */
  onsetLevels: number[];
  /** Onset placement within the bar, one profile per time signature the span reads under. */
  barPositions: BarPositionProfile[];
  /** Inter-onset-interval mass, binned to {@link RHYTHM_IOI_BINS}; sums to 1. */
  interOnsetShares: number[];
  /** Share of the span during which nothing sounds. */
  restRatio: number;
  /** Longuet-Higgins & Lee syncopation, in [0, 1]. */
  syncopation: number;
  /** Share of onsets further than 1/32 beat from the nearest grid slot. */
  offGridRatio: number;
  /** Why the line reads as it does. */
  rationale: string;
};

/** Slots per quarter-note beat the onset grid is read against. */
const RHYTHM_SLOTS_PER_BEAT = 12;

/** Width of one grid slot, in quarter-note beats. */
const SLOT_WIDTH = 1 / RHYTHM_SLOTS_PER_BEAT;

/**
 * Distance from the nearest slot past which an onset reads as off grid.
 *
 * It has to sit under half a slot (1/24 beat), or no onset could ever miss the
 * grid: a performed ±0.03 beat stays on it, a thirty-second note does not.
 */
const RHYTHM_OFF_GRID_TOLERANCE = 1 / 32;

/**
 * Inter-onset intervals, in quarter-note beats, at half-octave steps from a
 * sixteenth of a beat to sixteen beats.
 *
 * @category Arrangement & Analysis
 */
export const RHYTHM_IOI_BINS: readonly number[] = Object.freeze(
  Array.from({ length: 17 }, (_, i) => 2 ** (-4 + i * 0.5)),
);

/** The record {@link analyzeRhythm} returns for a span with nothing sounding in it. */
function emptyAnalysis(): RhythmAnalysis {
  return {
    startBeat: 0,
    endBeat: 0,
    bars: 0,
    onsets: 0,
    onsetDensity: 0,
    barOnsets: [],
    onsetLevels: new Array(6).fill(0),
    barPositions: [],
    interOnsetShares: new Array(RHYTHM_IOI_BINS.length).fill(0),
    restRatio: 0,
    syncopation: 0,
    offGridRatio: 0,
    rationale: 'Nothing sounds, so there is no rhythm to place on a grid',
  };
}

/** Whether `value` is a whole multiple of `unit`, within float tolerance. */
function isMultipleOf(value: number, unit: number): boolean {
  if (unit <= 0) {
    return false;
  }
  const ratio = value / unit;
  return Math.abs(ratio - Math.round(ratio)) < BEAT_EPS;
}

/**
 * A position's rhythmic level: 2–5 on a main pulse (`metricWeight` plus 2), 1
 * on the pulse's first subdivision (half a pulse in a simple meter, a third in
 * a compound one), 0 elsewhere.
 */
function rhythmLevel(beatInQuarters: number, meters: MeterMap): number {
  const ts = meterAt(beatInQuarters, meters);
  const offset = beatInQuarters - barStartBeat(beatInQuarters, meters);
  const pulse = pulseBeats(ts);
  if (isMultipleOf(offset, pulse)) {
    return metricWeight(beatInQuarters, meters) + 2;
  }
  const subUnit = pulse / (isCompound(ts) ? 3 : 2);
  return isMultipleOf(offset, subUnit) ? 1 : 0;
}

/** One onset after folding near-simultaneous notes together. */
type Onset = {
  /** Earliest onset of the notes folded into this one. */
  beat: number;
  /** Latest end among them. */
  end: number;
};

/**
 * Fold onsets within {@link HUMANIZE_ADJACENCY} of the group's first note into
 * one, keeping the earliest onset and the latest end.
 */
function foldOnsets(sounding: readonly NoteEvent[]): Onset[] {
  const sorted = [...sounding].sort((a, b) => a.startBeat - b.startBeat);
  const onsets: Onset[] = [];
  for (const note of sorted) {
    const noteEnd = note.startBeat + note.durationBeat;
    const current = onsets[onsets.length - 1];
    if (current !== undefined && note.startBeat - current.beat <= HUMANIZE_ADJACENCY) {
      current.end = Math.max(current.end, noteEnd);
    } else {
      onsets.push({ beat: note.startBeat, end: noteEnd });
    }
  }
  return onsets;
}

/** An onset read against the grid: its snapped position, level, and whether it missed the grid. */
type SnappedOnset = Onset & {
  ts: TimeSignature;
  barStart: number;
  /** Nearest grid slot, relative to the bar's own downbeat. */
  slot: number;
  /** The onset's beat, moved to the nearest grid slot. */
  snapped: number;
  level: number;
  offGrid: boolean;
};

/** Read one onset against the twelfth-of-a-beat grid. */
function snapOnset(onset: Onset, meters: MeterMap): SnappedOnset {
  const ts = meterAt(onset.beat, meters);
  const barStart = barStartBeat(onset.beat, meters);
  const offset = onset.beat - barStart;
  const slot = Math.round(offset / SLOT_WIDTH);
  const snapped = barStart + slot * SLOT_WIDTH;
  const offGrid = Math.abs(onset.beat - snapped) > RHYTHM_OFF_GRID_TOLERANCE;
  return { ...onset, ts, barStart, slot, snapped, level: rhythmLevel(snapped, meters), offGrid };
}

/** A key identifying a time signature's content, for grouping bars that share one. */
function tsKey(ts: TimeSignature): string {
  return ts.grouping === undefined
    ? `${ts.numerator}/${ts.denominator}`
    : `${ts.numerator}/${ts.denominator}:${ts.grouping.join('+')}`;
}

/**
 * The span's real length in bars: whole bars between the two ends plus the
 * fraction of beats each end bar actually holds, so a span cut mid-bar counts
 * that bar as a fraction rather than a whole one.
 */
function realBars(startBeat: number, endBeat: number, meters: MeterMap): number {
  const firstBar = barIndexAt(startBeat, meters);
  const lastBar = barIndexAt(endBeat, meters);
  const fractionOf = (beat: number, bar: number): number => {
    const barStart = barPositionToBeat({ bar, beat: 0 }, meters);
    const barLength = beatsPerBarAt(barStart, meters);
    return barLength > 0 ? (beat - barStart) / barLength : 0;
  };
  return lastBar - firstBar + fractionOf(endBeat, lastBar) - fractionOf(startBeat, firstBar);
}

/** The pulse and first-subdivision beats of one bar, in bar order. */
function barGridBeats(bar: number, meters: MeterMap): number[] {
  const barStart = barPositionToBeat({ bar, beat: 0 }, meters);
  const ts = meterAt(barStart, meters);
  const barLength = beatsPerBarAt(barStart, meters);
  const subUnit = pulseBeats(ts) / (isCompound(ts) ? 3 : 2);
  const steps = Math.max(1, Math.round(barLength / subUnit));
  return Array.from({ length: steps }, (_, k) => barStart + k * subUnit);
}

/**
 * Share of `[windowStart, windowEnd)` during which nothing sounds, from the
 * union of the notes' sounding intervals; a gap no wider than
 * {@link HUMANIZE_ADJACENCY} is read as continuous sound.
 */
function restRatioOf(
  sounding: readonly NoteEvent[],
  windowStart: number,
  windowEnd: number,
): number {
  const span = windowEnd - windowStart;
  if (span <= 0) {
    return 0;
  }
  const intervals = sounding
    .map((note): [number, number] => [
      Math.max(windowStart, note.startBeat),
      Math.min(windowEnd, note.startBeat + note.durationBeat),
    ])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let curStart = 0;
  let curEnd = Number.NEGATIVE_INFINITY;
  for (const [from, to] of intervals) {
    if (from - curEnd > HUMANIZE_ADJACENCY) {
      if (curEnd > Number.NEGATIVE_INFINITY) {
        covered += curEnd - curStart;
      }
      curStart = from;
      curEnd = to;
    } else {
      curEnd = Math.max(curEnd, to);
    }
  }
  if (curEnd > Number.NEGATIVE_INFINITY) {
    covered += curEnd - curStart;
  }
  return 1 - covered / span;
}

/**
 * Longuet-Higgins & Lee syncopation over the onsets already read against the
 * grid: an onset that persists through a stronger, unattacked grid position
 * before the next onset (or its own end, for the last one) is charged the
 * excess of that position's level over its own.
 */
function syncopationOf(
  snapped: readonly SnappedOnset[],
  startBeat: number,
  endBeat: number,
  meters: MeterMap,
): number {
  if (snapped.length === 0) {
    return 0;
  }
  const firstBar = barIndexAt(startBeat, meters);
  const lastBar = barIndexAt(endBeat, meters);
  const points: { beat: number; level: number }[] = [];
  for (let bar = firstBar; bar <= lastBar; bar += 1) {
    for (const beat of barGridBeats(bar, meters)) {
      if (beat > startBeat + BEAT_EPS && beat <= endBeat + BEAT_EPS) {
        points.push({ beat, level: rhythmLevel(beat, meters) });
      }
    }
  }
  const normalizer = points.reduce((sum, p) => sum + p.level, 0);
  if (normalizer <= 0) {
    return 0;
  }
  let numerator = 0;
  let ptr = 0;
  for (let i = 0; i < snapped.length; i += 1) {
    const onset = snapped[i];
    if (onset === undefined) {
      continue;
    }
    const next = snapped[i + 1];
    const windowEnd = next !== undefined ? next.snapped : onset.end;
    while (
      ptr < points.length &&
      (points[ptr]?.beat ?? Number.POSITIVE_INFINITY) <= onset.snapped + BEAT_EPS
    ) {
      ptr += 1;
    }
    let scan = ptr;
    let maxLevel = 0;
    while (
      scan < points.length &&
      (points[scan]?.beat ?? Number.POSITIVE_INFINITY) < windowEnd - BEAT_EPS
    ) {
      maxLevel = Math.max(maxLevel, points[scan]?.level ?? 0);
      scan += 1;
    }
    if (maxLevel > onset.level) {
      numerator += maxLevel - onset.level;
    }
    ptr = scan;
  }
  return numerator / normalizer;
}

/** Bin an inter-onset interval to {@link RHYTHM_IOI_BINS}, clamped to its ends. */
function ioiBinIndex(ioi: number): number {
  const exponent = Math.min(4, Math.max(-4, Math.round(2 * Math.log2(ioi)) / 2));
  return Math.round((exponent + 4) / 0.5);
}

/**
 * How a line places its onsets against the meter: density, metric placement,
 * interval spacing, rest, and Longuet-Higgins & Lee syncopation.
 *
 * Onsets within {@link HUMANIZE_ADJACENCY} of one another read as one, and an
 * onset further than 1/32 beat from the nearest twelfth-of-a-beat slot is read
 * as off grid; every onset is moved to its nearest slot for everything
 * downstream of it, so an unquantized line reads a real but reduced
 * syncopation rather than a spurious one from a grid it never intended to sit
 * on.
 *
 * @param notes The line's notes, in any order. Notes that never sound
 *   (`durationBeat <= 0`) are dropped.
 * @param opts Analysis options; see {@link RhythmAnalysisOptions}.
 * @returns The rhythm reading; see {@link RhythmAnalysis}.
 * @category Arrangement & Analysis
 */
export function analyzeRhythm(
  notes: readonly NoteEvent[],
  opts: RhythmAnalysisOptions = {},
): RhythmAnalysis {
  const meters = resolveMeters(opts, 'rhythm meters');
  assertNoteEvents(notes, 'rhythm notes', { allowNonPositiveDuration: true, budget: opts.budget });
  const sounding = notes.filter((note) => note.durationBeat > 0);
  if (sounding.length === 0) {
    return emptyAnalysis();
  }

  const firstOnset = sounding.reduce(
    (min, n) => Math.min(min, n.startBeat),
    Number.POSITIVE_INFINITY,
  );
  const startBeat = barGridStart(firstOnset, meters);
  const lastEnd = sounding.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  const endBeat = Math.max(startBeat, opts.totalBeats ?? lastEnd);
  assertRange(endBeat, 0, Number.MAX_SAFE_INTEGER, 'rhythm totalBeats');

  const bars = realBars(startBeat, endBeat, meters);
  assertGenerationBudget(Math.ceil(bars) * 48, 'rhythm analysis slots', opts.budget);

  const onsets = foldOnsets(sounding);
  const snapped = onsets.map((onset) => snapOnset(onset, meters));

  const onsetDensity = bars > 0 ? onsets.length / bars : 0;

  const firstBar = barIndexAt(startBeat, meters);
  const barOnsets = new Array<number>(lastBarOf(meters, startBeat, endBeat) - firstBar + 1).fill(0);
  for (const onset of onsets) {
    const index = barIndexAt(onset.beat, meters) - firstBar;
    if (index >= 0 && index < barOnsets.length) {
      barOnsets[index] = (barOnsets[index] ?? 0) + 1;
    }
  }

  const onsetLevels = new Array<number>(6).fill(0);
  let offGridCount = 0;
  for (const onset of snapped) {
    onsetLevels[onset.level] = (onsetLevels[onset.level] ?? 0) + 1;
    if (onset.offGrid) {
      offGridCount += 1;
    }
  }
  for (let i = 0; i < onsetLevels.length; i += 1) {
    onsetLevels[i] = (onsetLevels[i] ?? 0) / onsets.length;
  }

  const profiles: BarPositionProfile[] = [];
  const profileIndex = new Map<string, number>();
  for (const onset of snapped) {
    const key = tsKey(onset.ts);
    let index = profileIndex.get(key);
    if (index === undefined) {
      index = profiles.length;
      profileIndex.set(key, index);
      const slotsPerBar = Math.ceil(beatsPerBar(onset.ts) * RHYTHM_SLOTS_PER_BEAT);
      profiles.push({
        ts: onset.ts,
        slotsPerBar,
        shares: new Array(slotsPerBar).fill(0),
        onsets: 0,
      });
    }
    const profile = profiles[index];
    if (profile !== undefined) {
      const slotIndex =
        ((onset.slot % profile.slotsPerBar) + profile.slotsPerBar) % profile.slotsPerBar;
      profile.shares[slotIndex] = (profile.shares[slotIndex] ?? 0) + 1;
      profile.onsets += 1;
    }
  }
  for (const profile of profiles) {
    for (let i = 0; i < profile.shares.length; i += 1) {
      profile.shares[i] = (profile.shares[i] ?? 0) / profile.onsets;
    }
  }

  const interOnsetShares = new Array<number>(RHYTHM_IOI_BINS.length).fill(0);
  for (let i = 0; i < onsets.length; i += 1) {
    const onset = onsets[i];
    if (onset === undefined) {
      continue;
    }
    const next = onsets[i + 1];
    const ioi = next !== undefined ? next.beat - onset.beat : onset.end - onset.beat;
    const bin = ioiBinIndex(ioi);
    interOnsetShares[bin] = (interOnsetShares[bin] ?? 0) + 1;
  }
  for (let i = 0; i < interOnsetShares.length; i += 1) {
    interOnsetShares[i] = (interOnsetShares[i] ?? 0) / onsets.length;
  }

  const restRatio = restRatioOf(sounding, startBeat, endBeat);
  const syncopation = syncopationOf(snapped, startBeat, endBeat, meters);
  const offGridRatio = offGridCount / onsets.length;

  return {
    startBeat,
    endBeat,
    bars,
    onsets: onsets.length,
    onsetDensity,
    barOnsets,
    onsetLevels,
    barPositions: profiles,
    interOnsetShares,
    restRatio,
    syncopation,
    offGridRatio,
    rationale: `${onsets.length} onsets over ${bars.toFixed(2)} bars (${onsetDensity.toFixed(2)} per bar), ${Math.round(restRatio * 100)}% rest, syncopation ${syncopation.toFixed(2)}`,
  };
}
