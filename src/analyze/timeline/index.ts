import { createNoteEventIndex } from '../../core/event-index/index.js';
import type { TimeSignature } from '../../core/meter/index.js';
import { beatsPerBar, metricWeight, parseTimeSignature } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertNoteEvents,
  assertRange,
  assertTimeSignature,
} from '../../core/validation/index.js';
import type { Chord, ChordQuality, ChordSpan } from '../../theory/chord/index.js';
import { chordFromSpan, chordPitchClasses, makeChord } from '../../theory/chord/index.js';
import { isScaleTone, majorKey } from '../../theory/scale/index.js';
import type { ChordMatch } from '../detect/index.js';
import { detectChord } from '../detect/index.js';
import type { CadenceResult } from '../functional/index.js';
import { detectCadence } from '../functional/index.js';
import type { WindowWeights } from '../histogram.js';
import { windowWeights } from '../histogram.js';
import type { KeyRegion } from '../keys/index.js';
import { attachPivots, keyLookup, keyTimelineFromNotes, prevailingKeyOf } from '../keys/index.js';
import type { KeyContext } from '../voice/index.js';

export type { ChordSegment } from '../../theory/chord/index.js';

import type { ChordSegment } from '../../theory/chord/index.js';

/**
 * A beat-indexed sequence of chord segments.
 *
 * @category Arrangement & Analysis
 */
export type ChordTimeline = {
  /** The chord sounding at a beat, or null when no segment covers it. */
  at: (beat: number) => Chord | null;
  segments: ChordSegment[];
};

/**
 * Build a chord timeline from placed chords.
 *
 * Each chord spans from its `startBeat` to the next chord's `startBeat`; the last
 * chord runs to `totalBeats`. Segments with no positive length (from duplicate
 * onsets or a last chord at or past `totalBeats`) are dropped. `at(beat)` returns
 * the covering segment's chord, or null when the beat lies outside every segment.
 *
 * @param chords Placed chords in time order.
 * @param totalBeats End of the timeline in beats.
 * @returns A queryable chord timeline.
 * @category Arrangement & Analysis
 */
export function chordTimelineFromChords(
  chords: readonly ChordSpan[],
  totalBeats: number,
): ChordTimeline {
  assertRange(totalBeats, 0, Number.MAX_SAFE_INTEGER, 'timeline totalBeats');
  assertGenerationBudget(chords.length, 'timeline chords');
  for (let index = 0; index < chords.length; index += 1) {
    assertRange(
      chords[index]?.startBeat ?? Number.NaN,
      0,
      Number.MAX_SAFE_INTEGER,
      `chords[${index}].startBeat`,
    );
  }
  const sorted = [...chords]
    .filter((chord) => chord.startBeat < totalBeats)
    .sort((a, b) => a.startBeat - b.startBeat);
  const segments: ChordSegment[] = sorted
    .map((gc, i) => {
      const next = sorted[i + 1];
      const nextBeat = next ? next.startBeat : totalBeats;
      const endBeat = Math.min(totalBeats, Math.max(gc.startBeat, nextBeat));
      return {
        startBeat: gc.startBeat,
        endBeat,
        chord: chordFromSpan(gc),
      };
    })
    .filter((seg) => seg.endBeat > seg.startBeat);

  return { at: segmentLookup(segments), segments };
}

/**
 * Build the `at(beat)` lookup over a segment list.
 *
 * Segments are disjoint and in beat order, so the covering one is found by
 * binary search. A linear scan here is the inner loop of arrangement analysis,
 * which queries it once per note per chord change.
 */
function segmentLookup(segments: ChordSegment[]): (beat: number) => Chord | null {
  return (beat) => {
    assertFiniteNumber(beat, 'timeline query beat');
    let low = 0;
    let high = segments.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((segments[middle]?.startBeat ?? Number.POSITIVE_INFINITY) <= beat) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const candidate = segments[low - 1];
    return candidate !== undefined && beat >= candidate.startBeat && beat < candidate.endBeat
      ? candidate.chord
      : null;
  };
}

const EPS = 1e-9;

/** Fraction of the strongest pitch-class weight below which a pc is noise. */
const NOISE_THRESHOLD_RATIO = 0.2;

/** Maximum number of pitch classes fed to chord detection per window. */
const MAX_DETECTION_PCS = 6;

/** Confidence multiplier applied when the chosen chord match is inexact. */
const INEXACT_CONFIDENCE_FACTOR = 0.85;

/** Score bonus for a match whose tones are all in the key. */
const DIATONIC_BONUS = 0.5;

/** Score bonus for an exact match (no extra and no missing tones). */
const EXACT_BONUS = 0.5;

/** Score penalty per extra or missing tone in a match. */
const MISMATCH_PENALTY = 0.3;

/**
 * How {@link chordTimelineFromNotes} decides where one chord ends and the next
 * begins.
 *
 * `'dynamic'` searches for the boundaries the notes actually imply, so a bar
 * holding two chords yields two segments and a bar holding one yields one.
 * `'grid'` cuts a segment every `harmonicRhythm` beats regardless of what
 * sounds, which is only right when the harmonic rhythm is known to be fixed.
 *
 * @category Arrangement & Analysis
 */
export type ChordSegmentation = 'dynamic' | 'grid';

/**
 * Options controlling {@link chordTimelineFromNotes}.
 *
 * @category Arrangement & Analysis
 */
export type ChordTimelineOptions = {
  /**
   * Key context held across the whole span. Omit it to have the key searched
   * for over time with {@link keyTimelineFromNotes}, which is what lets a piece
   * that modulates be analysed against the key actually in force.
   */
  key?: KeyScale;
  /**
   * Time signature used for metric accents; defaults to 4/4.
   *
   * @defaultValue `4/4`
   */
  ts?: TimeSignature;
  /**
   * Where chord boundaries may fall; defaults to `'dynamic'`.
   *
   * @defaultValue `'dynamic'`
   */
  segmentation?: ChordSegmentation;
  /**
   * Expected chord length in beats; defaults to one bar of `ts`.
   *
   * Under `'grid'` segmentation this is the exact window length. Under
   * `'dynamic'` it is a prior: the longer a chord is expected to last, the more
   * evidence a change needs before the search will place one.
   *
   * @defaultValue one bar of `ts`
   */
  harmonicRhythm?: number;
  /**
   * Shortest chord the `'dynamic'` search may report, in beats; defaults to one
   * beat. Lower it to catch changes on off-beats, at the cost of proportionally
   * more work. Values above `harmonicRhythm` are clamped to it, and the option
   * is ignored under `'grid'` segmentation.
   *
   * @defaultValue `1`
   */
  minChordBeats?: number;
  /**
   * End of the analyzed span in beats; defaults to the end of the last note.
   *
   * @defaultValue the end of the last note
   */
  totalBeats?: number;
  /**
   * Upper bound on the work this call may do — note counts, windows, and
   * candidate counts are each checked against it before anything is allocated.
   *
   * Raise it to analyse a piece larger than the default allows; the default is
   * {@link DEFAULT_GENERATION_BUDGET}, chosen so a runaway input fails fast
   * rather than blocking the thread.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/**
 * The result of {@link chordTimelineFromNotes}.
 *
 * @category Arrangement & Analysis
 */
export type ChordTimelineResult = {
  /** The inferred timeline, with adjacent identical chords merged. */
  timeline: ChordTimeline;
  /**
   * The key regions the analysis ran against, in time order. A piece that does
   * not modulate yields one region covering the whole span; a given `key`
   * yields exactly one region too, since the caller has already answered the
   * question. Pivot chords are filled in where the chords support one.
   */
  keys: KeyRegion[];
  /**
   * The key held longest across {@link ChordTimelineResult.keys} — the one to
   * print on a key signature or hand to a generator that takes a single key.
   */
  prevailingKey: KeyScale;
  /** One confidence value in [0, 1] per segment, in segment order. */
  segmentConfidence: number[];
};

/** A window's inferred chord and its confidence, or null for an empty window. */
type WindowChord = {
  chord: Chord;
  confidence: number;
};

/**
 * Score a chord match against a window's pitch-class weights: a heavily
 * weighted root, in-key tones, and exactness all raise the score; extra or
 * missing tones lower it.
 */
function scoreMatch(
  match: ChordMatch,
  weights: number[],
  maxWeight: number,
  key: KeyScale,
): number {
  const rootWeight = maxWeight > 0 ? (weights[match.rootPc] ?? 0) / maxWeight : 0;
  const tones = chordPitchClasses(makeChord(match.rootPc, match.quality));
  let score = rootWeight;
  if (tones.every((pc) => isScaleTone(pc, key))) {
    score += DIATONIC_BONUS;
  }
  if (match.exact) {
    score += EXACT_BONUS;
  }
  score -= MISMATCH_PENALTY * (match.extraPcs.length + match.missingPcs.length);
  return score;
}

/** Confidence of a chord for a window: chord-tone weight over total weight. */
function chordConfidence(
  chord: Chord,
  weights: number[],
  totalWeight: number,
  exact: boolean,
): number {
  const tones = new Set(chordPitchClasses(chord));
  let chordWeight = 0;
  for (let pc = 0; pc < 12; pc += 1) {
    if (tones.has(pc)) {
      chordWeight += weights[pc] ?? 0;
    }
  }
  const raw = totalWeight > 0 ? chordWeight / totalWeight : 0;
  const confidence = Math.min(1, Math.max(0, raw));
  return exact ? confidence : confidence * INEXACT_CONFIDENCE_FACTOR;
}

/**
 * Infer the chord sounding in one window from the notes overlapping it.
 *
 * Builds a pitch-class weight histogram (overlap duration x velocity x
 * metric-accent bonus for onsets inside the window), keeps the significantly
 * weighted pitch classes, and picks the best {@link detectChord} match by
 * root weight, key membership, and exactness.
 */
function analyzeWindow(
  notes: readonly NoteEvent[],
  windowStart: number,
  windowEnd: number,
  ts: TimeSignature,
  key: KeyScale,
): WindowChord | null {
  const { weights, totalWeight, maxWeight, lowestPitch } = windowWeights(
    notes,
    windowStart,
    windowEnd,
    ts,
  );
  if (totalWeight <= EPS) {
    return null;
  }

  // Keep pitch classes with meaningful weight, strongest first.
  const ranked = weights
    .map((weight, pc) => ({ pc, weight }))
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight || a.pc - b.pc);
  const selected = ranked
    .filter(({ weight }) => weight >= maxWeight * NOISE_THRESHOLD_RATIO)
    .slice(0, MAX_DETECTION_PCS)
    .map(({ pc }) => pc);

  // Feed detection with the window's true bass as the lowest pitch so inversion
  // detection works. If that pitch class was removed as noise, detection must
  // become unordered instead: promoting the strongest remaining tone to bass
  // manufactures a slash chord that the input never established.
  const bassPc = pitchClass(lowestPitch);
  const hasBass = selected.includes(bassPc);
  const detectionPitches = hasBass
    ? selected.map((pc) => (pc === bassPc ? pc : pc + 12))
    : selected;

  const matches = detectChord(detectionPitches, { input: hasBass ? 'midi' : 'pitchClass' });
  let bestMatch: ChordMatch | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const match of matches) {
    const score = scoreMatch(match, weights, maxWeight, key);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = match;
    }
  }
  if (bestMatch) {
    const chord = makeChord(bestMatch.rootPc, bestMatch.quality, bestMatch.bassPc);
    return { chord, confidence: chordConfidence(chord, weights, totalWeight, bestMatch.exact) };
  }

  return null;
}

/** Whether two chords are the same root, quality, and bass. */
function sameChord(a: Chord, b: Chord): boolean {
  return a.rootPc === b.rootPc && a.quality === b.quality && a.bassPc === b.bassPc;
}

/**
 * Chord qualities the boundary search considers.
 *
 * This lexicon only has to be rich enough to tell "the harmony changed here"
 * from "it did not": the chord a segment finally reports comes from
 * {@link analyzeWindow} over the settled span, which searches the full quality
 * table. Adding rarer qualities here would slow every slot down without
 * changing where the boundaries land.
 */
const SEGMENTATION_QUALITIES: readonly ChordQuality[] = [
  'maj',
  'min',
  'dim',
  'aug',
  'dom7',
  'maj7',
  'min7',
  'm7b5',
  'dim7',
  'sus4',
  '6',
  'min6',
];

/** A boundary-search candidate: a root plus the pitch classes it sounds. */
type SegmentationCandidate = {
  rootPc: number;
  tones: number[];
};

/** The 12 x {@link SEGMENTATION_QUALITIES} lexicon, built once. */
const SEGMENTATION_LEXICON: readonly SegmentationCandidate[] = (() => {
  const candidates: SegmentationCandidate[] = [];
  for (let rootPc = 0; rootPc < 12; rootPc += 1) {
    for (const quality of SEGMENTATION_QUALITIES) {
      candidates.push({ rootPc, tones: chordPitchClasses(makeChord(rootPc, quality)) });
    }
  }
  return candidates;
})();

/** Weight of a slot's non-chord tones, relative to its chord tones. */
const OUTSIDE_TONE_PENALTY = 1;

/** Penalty per absent chord tone, in units of the candidate's average tone weight. */
const MISSING_TONE_PENALTY = 0.5;

/** Extra credit for the candidate's root carrying weight of its own. */
const ROOT_PRESENCE_BONUS = 0.3;

/**
 * Cost of one chord change, as a fraction of the evidence an expected-length
 * chord carries. A change has to improve the fit by at least this much to be
 * worth making, which is what keeps passing tones and appoggiaturas from
 * splitting a segment.
 */
const CHANGE_COST = 0.35;

/** How much of the change cost a maximally strong beat waives. */
const STRONG_BEAT_DISCOUNT = 0.5;

/** The largest value {@link metricWeight} returns (a downbeat). */
const MAX_METRIC_WEIGHT = 3;

/**
 * Score how well one lexicon candidate explains a slot's weights.
 *
 * Chord tones earn their weight, everything else sounding costs it, and each
 * chord tone that never sounds costs a share of what the candidate would have
 * earned had it been complete — so a triad is not rewarded for the two thirds
 * of itself that are missing.
 */
function candidateScore(
  candidate: SegmentationCandidate,
  weights: readonly number[],
  totalWeight: number,
): number {
  let covered = 0;
  let missing = 0;
  for (const pc of candidate.tones) {
    const weight = weights[pc] ?? 0;
    covered += weight;
    if (weight <= EPS) {
      missing += 1;
    }
  }
  const outside = totalWeight - covered;
  const averageToneWeight = totalWeight / candidate.tones.length;
  return (
    covered -
    OUTSIDE_TONE_PENALTY * outside -
    MISSING_TONE_PENALTY * missing * averageToneWeight +
    ROOT_PRESENCE_BONUS * (weights[candidate.rootPc] ?? 0)
  );
}

/** A half-open span of slots the boundary search settled on. */
type BoundarySpan = { startBeat: number; endBeat: number };

/**
 * Choose chord boundaries over one run of slots by dynamic programming.
 *
 * Every slot is scored against the whole lexicon; the optimal path trades the
 * per-slot fit against a fixed cost per chord change, discounted on strong
 * beats so that a change lands on the bar line rather than a beat either side
 * of it. Because the change cost is the same whichever candidate is left
 * behind, the previous stage collapses to "stay on this candidate" versus
 * "come from the cheapest one", which keeps the search linear in the lexicon
 * rather than quadratic.
 */
function chooseBoundaries(
  slotWeights: readonly WindowWeights[],
  from: number,
  to: number,
  slotBeats: number,
  ts: TimeSignature,
  changeCost: number,
): BoundarySpan[] {
  const width = to - from;
  if (width <= 0) {
    return [];
  }
  const lexiconSize = SEGMENTATION_LEXICON.length;
  const scores: number[][] = [];
  for (let i = from; i < to; i += 1) {
    const slot = slotWeights[i];
    const row = new Array<number>(lexiconSize).fill(0);
    if (slot && slot.totalWeight > EPS) {
      for (let c = 0; c < lexiconSize; c += 1) {
        const candidate = SEGMENTATION_LEXICON[c];
        row[c] = candidate ? candidateScore(candidate, slot.weights, slot.totalWeight) : 0;
      }
    }
    scores.push(row);
  }

  // Costs are negated scores, so the search minimises.
  let costs = (scores[0] ?? []).map((score) => -score);
  const cameFrom: Int32Array[] = [];
  for (let i = 1; i < width; i += 1) {
    const previous = costs;
    let cheapest = Number.POSITIVE_INFINITY;
    let cheapestIndex = 0;
    for (let c = 0; c < lexiconSize; c += 1) {
      const cost = previous[c] ?? Number.POSITIVE_INFINITY;
      if (cost < cheapest) {
        cheapest = cost;
        cheapestIndex = c;
      }
    }
    const slotStart = (from + i) * slotBeats;
    const accent = metricWeight(slotStart, ts);
    const penalty = changeCost * (1 - (STRONG_BEAT_DISCOUNT * accent) / MAX_METRIC_WEIGHT);
    const row = scores[i] ?? [];
    const next = new Array<number>(lexiconSize).fill(0);
    const back = new Int32Array(lexiconSize);
    for (let c = 0; c < lexiconSize; c += 1) {
      const stay = previous[c] ?? Number.POSITIVE_INFINITY;
      const change = cheapest + penalty;
      // Ties hold the current chord: a change has to be strictly better.
      const carried = stay <= change ? stay : change;
      back[c] = stay <= change ? c : cheapestIndex;
      next[c] = carried - (row[c] ?? 0);
    }
    costs = next;
    cameFrom.push(back);
  }

  let best = 0;
  for (let c = 1; c < lexiconSize; c += 1) {
    if ((costs[c] ?? Number.POSITIVE_INFINITY) < (costs[best] ?? Number.POSITIVE_INFINITY)) {
      best = c;
    }
  }
  const path = new Array<number>(width);
  let current = best;
  for (let i = width - 1; i >= 0; i -= 1) {
    path[i] = current;
    if (i > 0) {
      current = cameFrom[i - 1]?.[current] ?? current;
    }
  }

  const spans: BoundarySpan[] = [];
  let runStart = 0;
  for (let i = 1; i <= width; i += 1) {
    if (i === width || path[i] !== path[runStart]) {
      spans.push({
        startBeat: (from + runStart) * slotBeats,
        endBeat: (from + i) * slotBeats,
      });
      runStart = i;
    }
  }
  return spans;
}

/** Shortest chord the dynamic search reports unless the caller asks for finer. */
const DEFAULT_MIN_CHORD_BEATS = 1;

/** One span per slot: the fixed grid, unchanged. */
function gridSpans(slotCount: number, slotBeats: number): BoundarySpan[] {
  return Array.from({ length: slotCount }, (_, i) => ({
    startBeat: i * slotBeats,
    endBeat: (i + 1) * slotBeats,
  }));
}

/**
 * Place chord boundaries where the notes imply them.
 *
 * Silence long enough to be a chord of its own ends the run: nothing sounds
 * across it, so nothing may be merged across it either, and `at(beat)` answers
 * null there. A shorter rest is absorbed — a chord is not over because the
 * players took a breath.
 */
function dynamicSpans(
  slotNotes: readonly NoteEvent[][],
  slotBeats: number,
  harmonicRhythm: number,
  totalBeats: number,
  ts: TimeSignature,
): BoundarySpan[] {
  const slotCount = slotNotes.length;
  const slotWeights: WindowWeights[] = [];
  let soundingSlots = 0;
  let weightSum = 0;
  for (let i = 0; i < slotCount; i += 1) {
    const start = i * slotBeats;
    const weights = windowWeights(
      slotNotes[i] ?? [],
      start,
      Math.min(start + slotBeats, totalBeats),
      ts,
    );
    slotWeights.push(weights);
    if (weights.totalWeight > EPS) {
      soundingSlots += 1;
      weightSum += weights.totalWeight;
    }
  }
  if (soundingSlots === 0) {
    return [];
  }
  // The change cost is expressed in the same weight units the slot scores are,
  // scaled to one expected chord's worth of evidence: a change must be worth
  // that much of the fit before the search will make it, whatever the absolute
  // loudness or note lengths of the piece happen to be.
  //
  // A slot's weight is proportional to its length, so the mean cancels the
  // slots-per-chord factor and the cost depends on `harmonicRhythm` alone. That
  // is what makes `minChordBeats` a resolution knob rather than a sensitivity
  // one: asking for finer slots finds a boundary in more places, but does not
  // change how much evidence placing one takes.
  const meanSlotWeight = weightSum / soundingSlots;
  const changeCost = CHANGE_COST * meanSlotWeight * (harmonicRhythm / slotBeats);

  const silent = slotWeights.map((slot) => slot.totalWeight <= EPS);
  const breaks = new Array<boolean>(slotCount).fill(false);
  for (let i = 0; i < slotCount; ) {
    if (!silent[i]) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < slotCount && silent[end]) {
      end += 1;
    }
    if ((end - i) * slotBeats >= harmonicRhythm - EPS) {
      for (let k = i; k < end; k += 1) {
        breaks[k] = true;
      }
    }
    i = end;
  }

  const spans: BoundarySpan[] = [];
  for (let i = 0; i < slotCount; ) {
    if (breaks[i]) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < slotCount && !breaks[end]) {
      end += 1;
    }
    spans.push(...chooseBoundaries(slotWeights, i, end, slotBeats, ts, changeCost));
    i = end;
  }
  return spans;
}

/** The distinct notes overlapping a span, gathered from the slots it covers. */
function notesOfSpan(
  slotNotes: readonly NoteEvent[][],
  span: BoundarySpan,
  slotBeats: number,
): NoteEvent[] {
  const first = Math.round(span.startBeat / slotBeats);
  const lastExclusive = Math.round(span.endBeat / slotBeats);
  if (lastExclusive - first === 1) {
    return [...(slotNotes[first] ?? [])];
  }
  // A note held across several slots appears in each of them; the histogram
  // weighs by overlap, so counting it twice would double its influence.
  const seen = new Set<NoteEvent>();
  for (let i = first; i < lastExclusive; i += 1) {
    for (const note of slotNotes[i] ?? []) {
      seen.add(note);
    }
  }
  return [...seen];
}

/**
 * Infer a chord timeline from raw multi-track notes.
 *
 * Chord boundaries are searched for rather than assumed: the span is examined
 * in `minChordBeats` slots, and the change points that best explain the notes
 * are chosen, trading each slot's harmonic fit against a cost per chord change
 * that a strong beat discounts. A bar holding two chords therefore yields two
 * segments and a bar holding one yields one, without the caller having to know
 * the harmonic rhythm in advance. Pass `segmentation: 'grid'` to cut a segment
 * every `harmonicRhythm` beats instead.
 *
 * Each settled segment's chord is inferred from a pitch-class weight histogram
 * of the notes overlapping it (weight = overlap duration x velocity x
 * metric-accent bonus for onsets in the segment). Adjacent segments carrying
 * the identical chord are merged; a stretch with no notes produces no segment,
 * so `at(beat)` returns null there. Each segment carries a confidence in [0, 1]
 * — the fraction of its weight explained by chord tones, reduced when the match
 * is inexact, and duration-weighted across anything merged into it.
 *
 * Notes with a zero or negative duration never sound, so they are dropped at
 * ingest: they contribute to neither the key inference, the span, nor any
 * window's histogram.
 *
 * @param notes The notes to analyze (any number of tracks, flattened).
 * @param opts Analysis options; see {@link ChordTimelineOptions}.
 * @returns The inferred timeline, the key used, and per-segment confidences.
 * @throws If `harmonicRhythm` is not positive.
 * @example
 * ```ts
 * import { chordTimelineFromNotes } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 2 }, // C
 *   { pitch: 64, startBeat: 0, durationBeat: 2 }, // E
 *   { pitch: 67, startBeat: 0, durationBeat: 2 }, // G
 * ];
 * const { timeline, key } = chordTimelineFromNotes(notes);
 * timeline.at(0); // the chord inferred over beat 0, or null
 * ```
 * @category Arrangement & Analysis
 */
export function chordTimelineFromNotes(
  notes: NoteEvent[],
  opts: ChordTimelineOptions = {},
): ChordTimelineResult {
  const ts = opts.ts ?? parseTimeSignature('4/4');
  assertTimeSignature(ts);
  const harmonicRhythm = opts.harmonicRhythm ?? beatsPerBar(ts);
  assertRange(harmonicRhythm, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'harmonic rhythm');
  const segmentation = opts.segmentation ?? 'dynamic';
  const minChordBeats = opts.minChordBeats ?? DEFAULT_MIN_CHORD_BEATS;
  assertRange(minChordBeats, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'minChordBeats');
  const budget = opts.budget;
  assertNoteEvents(notes, 'timeline notes', { allowNonPositiveDuration: true, budget });
  // Zero/negative-length notes never sound; drop them before any inference.
  const soundingIndex = createNoteEventIndex(
    notes.filter((note) => note.durationBeat > 0),
    { name: 'timeline notes', budget },
  );
  const sounding = soundingIndex.notes.map(({ note }) => note);
  const lastNoteEnd = sounding.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  const totalBeats = opts.totalBeats ?? lastNoteEnd;
  assertRange(totalBeats, 0, Number.MAX_SAFE_INTEGER, 'timeline totalBeats');
  // A given key is taken as read across the whole span: the caller has already
  // answered the question, and second-guessing it would make the option mean
  // "a hint" when it reads as an instruction. Otherwise the key is searched for
  // over time, so a piece that modulates is not analysed against the wrong key
  // for every bar after it does.
  const keys: KeyRegion[] =
    opts.key !== undefined
      ? [{ startBeat: 0, endBeat: totalBeats, key: opts.key, confidence: 1 }]
      : keyTimelineFromNotes(sounding, { ts, totalBeats, budget });
  const prevailingKey = prevailingKeyOf(keys) ?? majorKey(0);
  const keyAt = keyLookup(keys, prevailingKey);

  const segments: ChordSegment[] = [];
  const segmentConfidence: number[] = [];
  const slotBeats =
    segmentation === 'grid' ? harmonicRhythm : Math.min(minChordBeats, harmonicRhythm);
  const slotCount = Math.max(0, Math.ceil(totalBeats / slotBeats - EPS));
  assertGenerationBudget(slotCount, 'timeline windows', budget);
  const slotNotes: NoteEvent[][] = Array.from({ length: slotCount }, () => []);
  let memberships = 0;
  for (const indexed of soundingIndex.notes) {
    const first = Math.max(0, Math.floor(indexed.note.startBeat / slotBeats));
    const lastExclusive = Math.min(slotCount, Math.ceil(indexed.endBeat / slotBeats));
    memberships += Math.max(0, lastExclusive - first);
    assertGenerationBudget(memberships, 'timeline note-to-window memberships', budget);
    for (let slot = first; slot < lastExclusive; slot += 1) {
      slotNotes[slot]?.push(indexed.note);
    }
  }

  const spans =
    segmentation === 'grid'
      ? gridSpans(slotCount, slotBeats)
      : dynamicSpans(slotNotes, slotBeats, harmonicRhythm, totalBeats, ts);

  for (const span of spans) {
    const start = span.startBeat;
    const end = Math.min(span.endBeat, totalBeats);
    const inferred = analyzeWindow(
      notesOfSpan(slotNotes, span, slotBeats),
      start,
      end,
      ts,
      keyAt(start),
    );
    if (!inferred) {
      continue;
    }
    const last = segments[segments.length - 1];
    if (last && sameChord(last.chord, inferred.chord) && Math.abs(last.endBeat - start) < EPS) {
      // Merge into the previous segment, blending confidence by duration.
      const lastLength = last.endBeat - last.startBeat;
      const length = end - start;
      const lastConfidence = segmentConfidence[segmentConfidence.length - 1] ?? 0;
      segmentConfidence[segmentConfidence.length - 1] =
        (lastConfidence * lastLength + inferred.confidence * length) / (lastLength + length);
      last.endBeat = end;
    } else {
      segments.push({ startBeat: start, endBeat: end, chord: inferred.chord });
      segmentConfidence.push(inferred.confidence);
    }
  }

  return {
    timeline: { at: segmentLookup(segments), segments },
    keys: attachPivots(keys, segments),
    prevailingKey,
    segmentConfidence,
  };
}

/**
 * A cadence found between two consecutive timeline segments.
 *
 * @category Arrangement & Analysis
 */
export type CadenceHit = {
  /** The beat where the cadence arrives (the second chord's onset). */
  atBeat: number;
  /**
   * The cadence formed by the pair. Its `type` is never null: a pair forming no
   * cadence is not a hit. A timeline names no voicing, so `strength` is null for
   * an authentic cadence whose chords are both in root position.
   */
  cadence: CadenceResult;
  from: Chord;
  to: Chord;
};

/**
 * Find cadences between consecutive segments of a chord timeline.
 *
 * Each temporally adjacent segment pair is classified with
 * {@link detectCadence}; pairs forming no cadence are skipped. Segments
 * separated by a gap (a rest in the timeline) are not a chord-to-chord
 * progression, so they are never paired.
 *
 * @param timeline The chord timeline to scan.
 * @param key The prevailing key, or the key in force at a given beat.
 * @returns The cadences found, in time order.
 * @example
 * ```ts
 * import { chordTimelineFromNotes, detectCadences } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 67, startBeat: 0, durationBeat: 4 }, // G, a dominant
 *   { pitch: 60, startBeat: 4, durationBeat: 4 }, // C, the tonic
 * ];
 * const { timeline, key } = chordTimelineFromNotes(notes);
 * const cadences = detectCadences(timeline, key);
 * ```
 * @category Arrangement & Analysis
 */
export function detectCadences(timeline: ChordTimeline, key: KeyContext): CadenceHit[] {
  // A cadence belongs to the key it arrives in, so a modulating piece is asked
  // for the key at the arrival beat rather than for one key for the whole span.
  const keyAt = typeof key === 'function' ? key : () => key;
  const hits: CadenceHit[] = [];
  for (let i = 1; i < timeline.segments.length; i += 1) {
    const prev = timeline.segments[i - 1];
    const cur = timeline.segments[i];
    if (!prev || !cur) {
      continue;
    }
    if (Math.abs(cur.startBeat - prev.endBeat) > EPS) {
      continue; // A rest separates the chords; no cadential motion across it.
    }
    const cadence = detectCadence(prev.chord, cur.chord, keyAt(cur.startBeat));
    if (cadence.type !== null) {
      hits.push({ atBeat: cur.startBeat, cadence, from: prev.chord, to: cur.chord });
    }
  }
  return hits;
}
