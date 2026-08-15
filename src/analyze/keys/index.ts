/**
 * The key as it changes over time.
 *
 * A piece that modulates has no single key, so a whole-piece answer is wrong
 * for every bar after the modulation. This module answers instead with a run of
 * regions, each carrying the key in force over one span, how it relates to the
 * key before it, and — when chords are available — the chord the modulation
 * turned on.
 */

import type { TimeSignature } from '../../core/meter/index.js';
import { beatsPerBar, metricWeight, parseTimeSignature } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertNoteEvents,
  assertRange,
  assertTimeSignature,
} from '../../core/validation/index.js';
import type { Chord, ChordSegment } from '../../theory/chord/index.js';
import { chordPitchClasses } from '../../theory/chord/index.js';
import type { KeyRelation } from '../../theory/scale/index.js';
import {
  isScaleTone,
  keyRelationBetween,
  majorKey,
  minorKey,
  spelledKeyOf,
} from '../../theory/scale/index.js';
import type { KeyProfileName, KeyProfilePair } from '../detect/index.js';
import { profileScore, resolveKeyProfile } from '../detect/profiles.js';
import type { PivotChord } from '../functional/index.js';
import { pivotChords } from '../functional/index.js';
import { windowWeights } from '../histogram.js';

const EPS = 1e-9;

/** The largest value {@link metricWeight} returns (a downbeat). */
const MAX_METRIC_WEIGHT = 3;

/**
 * A span of the piece over which one key is in force.
 *
 * @category Arrangement & Analysis
 */
export type KeyRegion = {
  /** First beat of the region. */
  startBeat: number;
  /** End of the region, exclusive. */
  endBeat: number;
  /** The key in force across the region. */
  key: KeyScale;
  /**
   * How well the region's music fits the key, in [0, 1]: the correlation
   * between the span's pitch-class distribution and the key's profile, with
   * negative correlations reported as 0.
   */
  confidence: number;
  /**
   * How this key relates to the previous region's — `'dominant'` for a move to
   * the dominant, `'relative'` for a move to the relative minor, and so on.
   * Absent on the first region, and absent when the two keys stand in none of
   * the named relations.
   */
  modulation?: KeyRelation;
  /**
   * The chord the modulation turned on, when one was identified. Only the
   * chord-aware entry points fill this in: a pivot is a chord that reads in
   * both keys, so it cannot be named without knowing which chord sounded.
   */
  pivot?: PivotChord;
};

/**
 * Options shared by the key-region entry points.
 *
 * @category Arrangement & Analysis
 */
export type KeyTimelineOptions = {
  /**
   * Time signature used for metric accents; defaults to 4/4.
   *
   * @defaultValue `4/4`
   */
  ts?: TimeSignature;
  /**
   * Expected length of one key area in beats; defaults to four bars of `ts`.
   *
   * This is a prior, not a window: the longer a key is expected to hold, the
   * more evidence a modulation needs before the search will report one. Keys
   * change far more slowly than chords do, which is why the default is measured
   * in bars rather than beats.
   *
   * @defaultValue four bars of `ts`
   */
  expectedKeyBeats?: number;
  /**
   * Shortest key area the search may report, in beats; defaults to one bar of
   * `ts`. Values above `expectedKeyBeats` are clamped to it.
   *
   * @defaultValue one bar of `ts`
   */
  minKeyBeats?: number;
  /**
   * End of the analyzed span in beats; defaults to the end of the last note or
   * chord segment.
   *
   * @defaultValue the end of the input
   */
  totalBeats?: number;
  /**
   * Key profile used to score candidates; defaults to `'krumhansl'`. Same
   * meaning as the option of the same name on the key detectors.
   *
   * @defaultValue `'krumhansl'`
   */
  profile?: KeyProfileName | KeyProfilePair;
  /**
   * Upper bound on the work this call may do.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/**
 * Cost of one modulation, as a fraction of one expected key area's evidence.
 *
 * The scores this is weighed against are correlations, and neighbouring keys
 * correlate strongly with the same music — a bar of plain C major still scores
 * 0.45 as G major. The evidence that actually separates two keys is therefore a
 * fraction of the raw score, and the cost is set against that margin rather
 * than against the score itself. Charging the full score would make no
 * modulation between related keys ever worth reporting, which is precisely the
 * modulation tonal music spends most of its time making.
 */
const MODULATION_COST = 0.15;

/**
 * How loudly a slot hears the slot before it when the key is read.
 *
 * Key moves more slowly than harmony, so a single bar is not enough to settle
 * one. Below 1 the bar still speaks for itself, which is what keeps a boundary
 * on the bar the music turns on rather than a bar either side of it.
 */
const PAST_CONTEXT_SHARE = 0.5;

/**
 * How loudly a slot hears the slot after it.
 *
 * Quieter than the past, because a key is established by what has already
 * sounded and only confirmed by what follows. Hearing the future as loudly as
 * the past makes the search hand the closing chord of one key area to the next,
 * which reads a cadence's own resolution as the first bar of the key it was
 * cadencing away from.
 */
const FUTURE_CONTEXT_SHARE = 0.25;

/** How much of the modulation cost a maximally strong beat waives. */
const STRONG_BEAT_DISCOUNT = 0.4;

/**
 * How much each step around the circle of fifths adds to the modulation cost.
 *
 * A move to the dominant or the relative is what tonal music mostly does; a
 * move to the tritone is what it mostly does not. Charging by distance is what
 * stops a passing chromatic bar from being read as a remote modulation.
 */
const FIFTHS_DISTANCE_COST = 0.18;

/** The 24 major and minor keys, in the order the search indexes them. */
const KEY_CANDIDATES: readonly { key: KeyScale; rootPc: number; minor: boolean }[] = (() => {
  const candidates: { key: KeyScale; rootPc: number; minor: boolean }[] = [];
  for (let rootPc = 0; rootPc < 12; rootPc += 1) {
    candidates.push({ key: majorKey(rootPc), rootPc, minor: false });
    candidates.push({ key: minorKey(rootPc), rootPc, minor: true });
  }
  return candidates;
})();

/** Position of a key on the circle of fifths, as a signed count of accidentals. */
function fifthsOf(rootPc: number, minor: boolean): number {
  // A minor key carries its relative major's signature, three semitones up.
  const majorRoot = pitchClass(minor ? rootPc + 3 : rootPc);
  const raw = (majorRoot * 7) % 12;
  return raw > 6 ? raw - 12 : raw;
}

/** Steps around the circle of fifths between two candidates, 0 to 6. */
function fifthsDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 12;
  return Math.min(diff, 12 - diff);
}

/** Circle-of-fifths distance between every ordered pair of candidates. */
const CANDIDATE_DISTANCE: readonly (readonly number[])[] = KEY_CANDIDATES.map((from) =>
  KEY_CANDIDATES.map((to) =>
    fifthsDistance(fifthsOf(from.rootPc, from.minor), fifthsOf(to.rootPc, to.minor)),
  ),
);

/** A slot of the search: what sounds in it, and how strongly. */
type KeySlot = {
  startBeat: number;
  endBeat: number;
  /** Score of each candidate over this slot, already weighted by prominence. */
  scores: number[];
  /** Total prominence of the slot, used to calibrate the modulation cost. */
  weight: number;
};

/**
 * Choose one key per slot, trading each slot's fit against a cost per
 * modulation.
 *
 * Unlike the chord search, the cost here depends on which key is left as well
 * as which is entered — a modulation to the dominant is ordinary and one to the
 * tritone is not — so the previous stage cannot collapse to a single cheapest
 * predecessor and every pair is considered. With 24 candidates that is 576
 * comparisons per slot, which is nothing next to building the slots.
 */
function chooseKeys(slots: readonly KeySlot[], changeCost: number, ts: TimeSignature): number[] {
  const count = KEY_CANDIDATES.length;
  if (slots.length === 0) {
    return [];
  }
  let costs = (slots[0]?.scores ?? []).map((score) => -score);
  const cameFrom: Int32Array[] = [];
  for (let i = 1; i < slots.length; i += 1) {
    const slot = slots[i];
    const previous = costs;
    const accent = metricWeight(slot?.startBeat ?? 0, ts);
    const metricFactor = 1 - (STRONG_BEAT_DISCOUNT * accent) / MAX_METRIC_WEIGHT;
    const next = new Array<number>(count).fill(0);
    const back = new Int32Array(count);
    for (let to = 0; to < count; to += 1) {
      // Holding the key is free; every other predecessor pays by distance.
      let best = previous[to] ?? Number.POSITIVE_INFINITY;
      let bestFrom = to;
      for (let from = 0; from < count; from += 1) {
        if (from === to) {
          continue;
        }
        const distance = CANDIDATE_DISTANCE[from]?.[to] ?? 0;
        const penalty = changeCost * metricFactor * (1 + FIFTHS_DISTANCE_COST * distance);
        const cost = (previous[from] ?? Number.POSITIVE_INFINITY) + penalty;
        if (cost < best) {
          best = cost;
          bestFrom = from;
        }
      }
      back[to] = bestFrom;
      next[to] = best - (slot?.scores[to] ?? 0);
    }
    costs = next;
    cameFrom.push(back);
  }

  let best = 0;
  for (let c = 1; c < count; c += 1) {
    if ((costs[c] ?? Number.POSITIVE_INFINITY) < (costs[best] ?? Number.POSITIVE_INFINITY)) {
      best = c;
    }
  }
  const path = new Array<number>(slots.length);
  let current = best;
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    path[i] = current;
    if (i > 0) {
      current = cameFrom[i - 1]?.[current] ?? current;
    }
  }
  return path;
}

/** Group a per-slot key choice into regions, without relations or pivots. */
function regionsFromPath(
  slots: readonly KeySlot[],
  path: readonly number[],
): { startBeat: number; endBeat: number; candidate: number }[] {
  const regions: { startBeat: number; endBeat: number; candidate: number }[] = [];
  for (let i = 0; i < slots.length; i += 1) {
    const last = regions[regions.length - 1];
    const slot = slots[i];
    if (slot === undefined) {
      continue;
    }
    if (
      last !== undefined &&
      last.candidate === path[i] &&
      Math.abs(last.endBeat - slot.startBeat) < EPS
    ) {
      last.endBeat = slot.endBeat;
      continue;
    }
    regions.push({ startBeat: slot.startBeat, endBeat: slot.endBeat, candidate: path[i] ?? 0 });
  }
  return regions;
}

/**
 * Attach each region's relation to the one before it.
 *
 * The relation is asked of the conventionally spelled keys, not of raw pitch
 * classes, because that is the only way `'enharmonic'` can be told from
 * `'same'` — and telling them apart is the whole point of naming the relation.
 */
function withRelations(regions: KeyRegion[]): KeyRegion[] {
  for (let i = 1; i < regions.length; i += 1) {
    const previous = regions[i - 1];
    const current = regions[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const relation = keyRelationBetween(spelledKeyOf(previous.key), spelledKeyOf(current.key));
    if (relation !== null) {
      current.modulation = relation;
    }
  }
  return regions;
}

/**
 * Infer where the key changes from raw notes.
 *
 * The span is examined in `minKeyBeats` slots. Each slot's pitch-class
 * distribution is correlated against all 24 major and minor key profiles, and
 * the run of keys that best explains the piece is chosen, paying a cost per
 * modulation that rises with the distance travelled around the circle of
 * fifths and falls on strong beats. Adjacent slots agreeing on a key become one
 * region.
 *
 * Pivot chords are not reported here: naming one requires knowing which chord
 * sounded at the boundary, which raw notes do not say. Use
 * {@link detectModulations} when a chord timeline is in hand.
 *
 * @param notes The notes to analyze (any number of tracks, flattened).
 * @param opts Analysis options; see {@link KeyTimelineOptions}.
 * @returns The key regions in time order; empty when nothing sounds.
 * @example
 * ```ts
 * import { keyTimelineFromNotes } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 4 },
 *   { pitch: 64, startBeat: 4, durationBeat: 4 },
 * ];
 * const regions = keyTimelineFromNotes(notes);
 * regions[0]?.key; // the key in force at the start
 * ```
 * @category Arrangement & Analysis
 */
export function keyTimelineFromNotes(
  notes: NoteEvent[],
  opts: KeyTimelineOptions = {},
): KeyRegion[] {
  const ts = opts.ts ?? parseTimeSignature('4/4');
  assertTimeSignature(ts);
  const bar = beatsPerBar(ts);
  const expectedKeyBeats = opts.expectedKeyBeats ?? bar * 4;
  assertRange(expectedKeyBeats, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'expectedKeyBeats');
  const minKeyBeats = opts.minKeyBeats ?? bar;
  assertRange(minKeyBeats, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'minKeyBeats');
  const budget = opts.budget;
  assertNoteEvents(notes, 'key timeline notes', { allowNonPositiveDuration: true, budget });
  const sounding = notes.filter((note) => note.durationBeat > 0);
  const lastEnd = sounding.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  const totalBeats = opts.totalBeats ?? lastEnd;
  assertRange(totalBeats, 0, Number.MAX_SAFE_INTEGER, 'key timeline totalBeats');

  const slotBeats = Math.min(minKeyBeats, expectedKeyBeats);
  const slotCount = Math.max(0, Math.ceil(totalBeats / slotBeats - EPS));
  assertGenerationBudget(slotCount, 'key timeline slots', budget);
  if (slotCount === 0 || sounding.length === 0) {
    return [];
  }

  const profile = resolveKeyProfile(opts.profile);
  const slots: KeySlot[] = [];
  let weightSum = 0;
  let soundingSlots = 0;
  for (let i = 0; i < slotCount; i += 1) {
    const startBeat = i * slotBeats;
    const endBeat = Math.min(startBeat + slotBeats, totalBeats);
    // One bar in isolation says very little — a bar of G major triad inside C
    // major looks exactly like a bar of tonic G — so the neighbouring bars are
    // heard too. They are heard more quietly than the bar itself, which is what
    // keeps the boundary where the music actually turns instead of smearing it
    // across the bars either side.
    const own = windowWeights(sounding, startBeat, endBeat, ts);
    const before = windowWeights(sounding, Math.max(0, startBeat - slotBeats), startBeat, ts);
    const after = windowWeights(sounding, endBeat, Math.min(totalBeats, endBeat + slotBeats), ts);
    const weights = own.weights.map(
      (weight, pc) =>
        weight +
        PAST_CONTEXT_SHARE * (before.weights[pc] ?? 0) +
        FUTURE_CONTEXT_SHARE * (after.weights[pc] ?? 0),
    );
    // Prominence comes from the slot itself, so a sparse slot does not inherit
    // the weight of its loud neighbours when the modulation cost is calibrated.
    const totalWeight = own.totalWeight;
    // A correlation is dimensionless; multiplying by the slot's prominence puts
    // the fit and the modulation cost into the same units, so a loud, long slot
    // carries more of the argument than a sparse one.
    const scores = KEY_CANDIDATES.map(
      (candidate) =>
        profileScore(weights, candidate.minor ? profile.minor : profile.major, candidate.rootPc) *
        totalWeight,
    );
    slots.push({ startBeat, endBeat, scores, weight: totalWeight });
    if (totalWeight > EPS) {
      weightSum += totalWeight;
      soundingSlots += 1;
    }
  }
  if (soundingSlots === 0) {
    return [];
  }

  const meanSlotWeight = weightSum / soundingSlots;
  const changeCost = MODULATION_COST * meanSlotWeight * (expectedKeyBeats / slotBeats);
  const path = chooseKeys(slots, changeCost, ts);
  const grouped = regionsFromPath(slots, path);

  const regions = grouped.map((region) => {
    const candidate = KEY_CANDIDATES[region.candidate];
    const key = candidate?.key ?? majorKey(0);
    const { weights } = windowWeights(sounding, region.startBeat, region.endBeat, ts);
    const correlation = profileScore(
      weights,
      candidate?.minor ? profile.minor : profile.major,
      candidate?.rootPc ?? 0,
    );
    return {
      startBeat: region.startBeat,
      endBeat: region.endBeat,
      key,
      confidence: Math.max(0, correlation),
    };
  });
  return withRelations(regions);
}

/** How much of a chord's weight a key must explain before it counts as fitting. */
const CHORD_TONE_CREDIT = 1;

/** Extra credit for a chord that is the key's dominant — the strongest signal. */
const DOMINANT_CREDIT = 0.7;

/** Extra credit for a chord that is the key's tonic. */
const TONIC_CREDIT = 0.4;

/** Extra credit for a tonic that its own dominant resolved onto. */
const CADENCE_CREDIT = 0.6;

/**
 * Cost of one modulation on the chord path, in beats of chord evidence.
 *
 * Higher than {@link MODULATION_COST} because chord fits are not correlations:
 * a chord either belongs to a key or does not, so the margin between two
 * readings is a large fraction of the score rather than a small one. Most of a
 * diatonic progression reads plausibly in its subdominant as well as its tonic
 * — C F G C is I IV V I in C and V I II V in F — so without a cost of this size
 * the search reports a modulation every time the harmony touches IV.
 */
const CHORD_MODULATION_COST = 0.6;

/** Score how strongly one chord argues for one key. */
function chordFitsKey(chord: Chord, candidate: { key: KeyScale; rootPc: number }): number {
  const tones = chordPitchClasses(chord);
  if (tones.length === 0) {
    return 0;
  }
  let inKey = 0;
  for (const pc of tones) {
    if (isScaleTone(pc, candidate.key)) {
      inKey += 1;
    }
  }
  // A tone outside the key counts against it rather than merely failing to
  // count for it: the F# in a D major triad is the reason to hear G rather
  // than C, and a rule that only rewarded the D and the A would miss it.
  let score = CHORD_TONE_CREDIT * ((inKey - (tones.length - inKey)) / tones.length);
  // A dominant seventh names its key almost by itself, which is what makes a
  // secondary dominant readable as a modulation rather than as a wrong note.
  const rootDegree = pitchClass(chord.rootPc - candidate.rootPc);
  if (rootDegree === 7 && (chord.quality === 'dom7' || chord.quality === 'maj')) {
    score += DOMINANT_CREDIT * (chord.quality === 'dom7' ? 1 : 0.5);
  }
  if (rootDegree === 0) {
    score += TONIC_CREDIT;
  }
  return score;
}

/**
 * Infer where the key changes from a chord sequence, naming the pivot chords.
 *
 * Each chord segment is one slot of the same search {@link keyTimelineFromNotes}
 * runs, scored by how well the chord belongs to each key rather than by a
 * pitch-class profile — a dominant seventh argues for its key far more strongly
 * than its three or four pitch classes alone would suggest. Where the key
 * changes, the chord sounding into the boundary is reported as the pivot if it
 * reads in both keys.
 *
 * @param chords The chord segments to analyze, in time order; pass a chord
 *   timeline's `segments`.
 * @param opts Analysis options; see {@link KeyTimelineOptions}. `minKeyBeats`
 *   is not used — the chords themselves supply the slots.
 * @returns The key regions in time order; empty when no chords were given.
 * @example
 * ```ts
 * import { chordTimelineFromNotes, detectModulations } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 4 },
 *   { pitch: 64, startBeat: 0, durationBeat: 4 },
 *   { pitch: 67, startBeat: 0, durationBeat: 4 },
 * ];
 * const { timeline } = chordTimelineFromNotes(notes);
 * const regions = detectModulations(timeline.segments);
 * ```
 * @category Arrangement & Analysis
 */
export function detectModulations(
  chords: readonly ChordSegment[],
  opts: KeyTimelineOptions = {},
): KeyRegion[] {
  const ts = opts.ts ?? parseTimeSignature('4/4');
  assertTimeSignature(ts);
  const bar = beatsPerBar(ts);
  const expectedKeyBeats = opts.expectedKeyBeats ?? bar * 4;
  assertRange(expectedKeyBeats, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'expectedKeyBeats');
  assertGenerationBudget(chords.length, 'modulation chord segments', opts.budget);
  const ordered = [...chords]
    .filter((segment) => segment.endBeat > segment.startBeat)
    .sort((a, b) => a.startBeat - b.startBeat);
  if (ordered.length === 0) {
    return [];
  }

  const slots: KeySlot[] = ordered.map((segment) => {
    const length = segment.endBeat - segment.startBeat;
    return {
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
      // A chord that holds for two bars argues twice as hard as one that
      // passes in half a bar, exactly as a heavier slot does in the note path.
      scores: KEY_CANDIDATES.map((candidate) => chordFitsKey(segment.chord, candidate) * length),
      weight: length,
    };
  });
  // A chord preceded by its own dominant is the clearest statement a key gets,
  // and it is the pair that makes it — so the cadential credit is folded into
  // the arriving chord, where the search can read it as ordinary slot evidence.
  for (let i = 1; i < slots.length; i += 1) {
    const arriving = ordered[i]?.chord;
    const approaching = ordered[i - 1]?.chord;
    const slot = slots[i];
    if (arriving === undefined || approaching === undefined || slot === undefined) {
      continue;
    }
    // Only a dominant seventh earns this. A plain major triad a fifth above is
    // just as readily heard as the chord it moves to being the subdominant —
    // C to F says nothing about whether the key is C or F. What makes a cadence
    // name its key is the tritone, and only the seventh has one.
    const isDominantMotion =
      pitchClass(approaching.rootPc - arriving.rootPc) === 7 && approaching.quality === 'dom7';
    if (!isDominantMotion) {
      continue;
    }
    const length = slot.endBeat - slot.startBeat;
    for (let c = 0; c < KEY_CANDIDATES.length; c += 1) {
      const candidate = KEY_CANDIDATES[c];
      if (candidate !== undefined && pitchClass(arriving.rootPc - candidate.rootPc) === 0) {
        slot.scores[c] = (slot.scores[c] ?? 0) + CADENCE_CREDIT * length;
      }
    }
  }
  // Here a slot's weight is its length in beats outright, so one expected key
  // area's worth of evidence is just `expectedKeyBeats` and no mean is needed.
  const changeCost = CHORD_MODULATION_COST * expectedKeyBeats;
  const path = chooseKeys(slots, changeCost, ts);
  const grouped = regionsFromPath(slots, path);

  const regions: KeyRegion[] = grouped.map((region) => {
    const candidate = KEY_CANDIDATES[region.candidate];
    const key = candidate?.key ?? majorKey(0);
    const covered = ordered.filter(
      (segment) =>
        segment.startBeat < region.endBeat - EPS && segment.endBeat > region.startBeat + EPS,
    );
    let fitSum = 0;
    let lengthSum = 0;
    for (const segment of covered) {
      const length = segment.endBeat - segment.startBeat;
      fitSum +=
        Math.min(1, chordFitsKey(segment.chord, { key, rootPc: candidate?.rootPc ?? 0 })) * length;
      lengthSum += length;
    }
    return {
      startBeat: region.startBeat,
      endBeat: region.endBeat,
      key,
      confidence: lengthSum > 0 ? Math.min(1, Math.max(0, fitSum / lengthSum)) : 0,
    };
  });

  return attachPivots(withRelations(regions), ordered);
}

/**
 * Name the chord each modulation turned on, where the chords support one.
 *
 * The pivot is the last chord to sound before the boundary, reported only when
 * it is diatonic to both keys — which is exactly what makes it a pivot rather
 * than simply the chord that happened to be playing.
 *
 * Not part of the public surface: it takes regions that some other pass already
 * decided, so exposing it would invite callers to pair regions and chords that
 * were never analysed together.
 *
 * @param regions The regions to annotate, modified in place and returned.
 * @param chords The chords that sounded, in time order.
 * @returns The same regions.
 */
export function attachPivots(regions: KeyRegion[], chords: readonly ChordSegment[]): KeyRegion[] {
  for (let i = 1; i < regions.length; i += 1) {
    const previous = regions[i - 1];
    const current = regions[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    let last: ChordSegment | undefined;
    for (const segment of chords) {
      if (segment.endBeat <= current.startBeat + EPS) {
        last = segment;
      }
    }
    if (last === undefined) {
      continue;
    }
    const held = last;
    const pivot = pivotChords(previous.key, current.key).find(
      (entry) =>
        entry.chord.rootPc === pitchClass(held.chord.rootPc) &&
        entry.chord.quality === held.chord.quality,
    );
    if (pivot !== undefined) {
      current.pivot = pivot;
    }
  }
  return regions;
}

/**
 * Build a `keyAt(beat)` lookup over a run of regions.
 *
 * Regions are disjoint and in beat order, so the covering one is found by
 * binary search. Beats outside every region — before the first note, or inside
 * a rest long enough to have ended a region — answer with the fallback rather
 * than with nothing, because every beat of an analysis has to be read against
 * some key.
 *
 * Not part of the public surface: it is an internal convenience for passes that
 * already hold both the regions and the beats.
 *
 * @param regions The regions to search, in time order.
 * @param fallback The key to answer with outside every region.
 * @returns The lookup.
 */
export function keyLookup(
  regions: readonly KeyRegion[],
  fallback: KeyScale,
): (beat: number) => KeyScale {
  return (beat) => {
    let low = 0;
    let high = regions.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((regions[middle]?.startBeat ?? Number.POSITIVE_INFINITY) <= beat) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const candidate = regions[low - 1];
    return candidate !== undefined && beat < candidate.endBeat ? candidate.key : fallback;
  };
}

/**
 * The single key that holds for most of a run of regions.
 *
 * Callers that only want one key — a key signature to print, a scale to offer —
 * need the one the piece spends the most time in, not the one it happens to
 * start on.
 *
 * @param regions The regions to weigh, as returned by the key-region entry points.
 * @returns The longest-held key, or null when there are no regions.
 * @example
 * ```ts
 * import { keyTimelineFromNotes, prevailingKeyOf } from '@libraz/libcantus';
 * const notes = [{ pitch: 60, startBeat: 0, durationBeat: 4 }];
 * const key = prevailingKeyOf(keyTimelineFromNotes(notes));
 * ```
 * @category Arrangement & Analysis
 */
export function prevailingKeyOf(regions: readonly KeyRegion[]): KeyScale | null {
  // Held time is summed per key, not per region: a key returned to after a
  // digression prevails over one stated once at length.
  const totals = new Map<string, { key: KeyScale; length: number }>();
  for (const region of regions) {
    const id = `${pitchClass(region.key.rootPc)}:${region.key.modeMask12}`;
    const entry = totals.get(id);
    const length = Math.max(0, region.endBeat - region.startBeat);
    if (entry === undefined) {
      totals.set(id, { key: region.key, length });
    } else {
      entry.length += length;
    }
  }
  let best: KeyScale | null = null;
  let bestLength = -1;
  for (const entry of totals.values()) {
    // Ties keep the earlier key, which is the one the piece established first.
    if (entry.length > bestLength) {
      bestLength = entry.length;
      best = entry.key;
    }
  }
  return best;
}
