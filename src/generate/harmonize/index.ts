import { isDiatonic, parallelKey } from '../../analyze/functional/index.js';
import { createNoteEventIndex } from '../../core/event-index/index.js';
import type { TimeSignature } from '../../core/meter/index.js';
import { isStrongBeat } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertNoteEvents,
  assertRange,
  assertTimeSignature,
  soundingNotesOnly,
} from '../../core/validation/index.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, diatonicTriad, makeChord } from '../../theory/chord/index.js';
import type { HarmonyRole } from '../../theory/harmony/index.js';
import { roleOf } from '../../theory/harmony/index.js';
import {
  isScaleTone,
  majorKey,
  minorKey,
  NATURAL_MINOR_MASK,
  scaleTonesInDegreeOrder,
} from '../../theory/scale/index.js';
import { type GenerationContextInput, resolveContextWith } from '../context/index.js';
import type { ChordSpan } from '../progression/index.js';
import { classifyMelodyTones } from './nct.js';

export type { ClassifiedMelodyTone, MelodyToneRole } from './nct.js';
export { classifyMelodyTones } from './nct.js';

/**
 * A melody note supplied to the harmonizer: a {@link NoteEvent}.
 *
 * @category Reharmonization
 */
export type MelodyNote = NoteEvent;

/**
 * Options controlling {@link harmonizeMelody}.
 *
 * @category Reharmonization
 */
export type HarmonizePlacement = {
  /**
   * Move the melody into the key it is harmonized in. The search reports the
   * shift it chose in `transposeSemitones`; transposing the melody by that many
   * semitones puts it in the returned `key`, so melody and harmony always agree.
   *
   * Use it for a melody notated in one key that has to be sung or played in
   * another. It never changes register on its own — that is `octaveSearch`.
   *
   * @defaultValue false
   */
  transposeSearch: boolean;
  /**
   * Search octave placements as well, so a melody written too high or too low
   * is moved into a comfortable register. Octaves leave every pitch class where
   * it was, so this changes neither the key nor the chords.
   *
   * @defaultValue false
   */
  octaveSearch: boolean;
};

/**
 * Options controlling {@link harmonizeMelody}.
 *
 * Only `melody` is required; every other knob has the default a first call
 * wants.
 *
 * @category Reharmonization
 */
export type HarmonizeOptions = {
  /** The melody to harmonize, in ascending onset order. */
  melody: readonly MelodyNote[];
  /**
   * The key to harmonize in, or `'infer'` to estimate it from the melody's
   * pitch-class weighting — which is what a caller who has only a melody
   * wants, and so the default.
   *
   * @defaultValue `'infer'`
   */
  key?: KeyScale | 'infer';
  /**
   * Length of each chord slot in beats. Harmonization places chords on a fixed
   * grid of this length — unlike {@link chordTimelineFromNotes}, which searches
   * for the boundaries an existing piece already implies. Any positive value is
   * honoured; a value fine enough to make the search explode is rejected by the
   * generation budget rather than rounded up.
   *
   * @defaultValue 2
   */
  harmonicRhythm?: number;
  /**
   * Time signature used to weight metric accents; defaults to 4/4. A waltz or
   * a jig harmonized against a 4/4 accent grid gets its chords placed on the
   * wrong beats, and the error accumulates bar by bar.
   *
   * @defaultValue `4/4`
   */
  ts?: TimeSignature;
  /**
   * How far beyond the key's own triads the chord vocabulary reaches:
   * `'diatonic'` uses only them, `'secondaryDominant'` adds the dominants that
   * tonicize each degree, and `'borrowed'` adds the parallel mode's chords too.
   *
   * Sugar for `ctx: { complexity: { harmonic } }` at the three dial positions
   * these names have always stood for; a context names how far the vocabulary
   * reaches instead of which of three steps it stops at, and wins where both
   * are given.
   *
   * @defaultValue `'diatonic'`
   */
  reharmonize?: 'diatonic' | 'secondaryDominant' | 'borrowed';
  /**
   * Whether to search transpositions and octave placements for the melody.
   * Both are off by default, so the melody is harmonized where it was written.
   *
   * @defaultValue both false
   */
  placement?: HarmonizePlacement;
  /**
   * Seed for the deterministic tie-break perturbation. Sugar for
   * `ctx: { seed }`; the context wins where both are given.
   *
   * @defaultValue 0
   */
  seed?: number;
  /**
   * The generation context. Its `complexity.harmonic` is how far the chord
   * vocabulary reaches beyond the key's own triads — 0 uses them alone, 0.5 has
   * every secondary dominant, 1 the parallel mode's chords as well — and its
   * `seed` replaces `seed`.
   */
  ctx?: GenerationContextInput;
};

/**
 * The chosen transpose, key, chord path, and per-note roles.
 *
 * @category Reharmonization
 */
export type HarmonizeResult = {
  /**
   * How far the melody was moved, in semitones. Transposing the melody by this
   * much puts it in `key`, which is the key the chords are in.
   */
  transposeSemitones: number;
  key: KeyScale;
  /** One span per chord change, each starting on a harmonic-rhythm boundary. */
  chords: ChordSpan[];
  /** Each melody note's role in the chord sounding under it, once chosen. */
  melodyRoles: { noteIndex: number; role: HarmonyRole }[];
};

type Candidate = {
  rootPc: number;
  quality: ChordQuality;
  degree?: number;
  secondaryDominant: boolean;
  targetDegree?: number;
  base: number;
  /**
   * The candidate's pitch classes, resolved once. The emission cost is
   * evaluated for every transpose, segment, and candidate, and the chord's
   * pitch classes depend on none of those.
   */
  pcs: number[];
};

type Segment = {
  startBeat: number;
  endBeat: number;
  /** Every sounding note overlapping the segment, by index in the sounding melody. */
  noteIndices: number[];
  /**
   * The notes that drive the segment's emission cost: its structural tones,
   * falling back to all of its notes when ornaments are all it has. A chord slot
   * with no note left to explain would be chosen by chord flow alone.
   */
  costIndices: number[];
};

const FALLBACK: Candidate = {
  rootPc: 0,
  quality: 'maj',
  secondaryDominant: false,
  base: 0,
  pcs: chordPitchClasses(makeChord(0, 'maj')),
};

/** Chord slot length assumed when the caller names none: one chord per half bar. */
const DEFAULT_HARMONIC_RHYTHM = 2;

/** Placement assumed when the caller names none: harmonize the melody as written. */
const DEFAULT_PLACEMENT: HarmonizePlacement = { transposeSearch: false, octaveSearch: false };

/** Default meter used to weight metric accents when none is supplied. */
const DEFAULT_METER: TimeSignature = { numerator: 4, denominator: 4 };

/** Comfortable melodic range (MIDI) and the per-semitone cost of leaving it. */
const COMFORT_LOW = 55;
const COMFORT_HIGH = 79;
const TESSITURA_WEIGHT = 0.001;

/**
 * The cost table, in one place because only the *ratios* between these terms
 * decide anything. Every term is on the same order of magnitude, so covering one
 * more melody note can never outweigh a functional progression: a chord that
 * leaves an accented structural tone unexplained pays about what a cadence or a
 * dominant resolution is worth, not several times more.
 *
 * ```text
 * emission   per structural note, weighted by the beats it sounds in the segment
 *   non-chord tone on a strong beat                    +4
 *   non-chord tone on a weak beat                      +1
 *   note outside the key, on top of the above        +0.5
 * vocabulary per segment
 *   degree, by tonal weight: I 0, V 0.1, IV 0.15,
 *   ii and vi 0.3, iii 0.45, vii 0.9
 *   secondary dominant                               +0.8
 *   borrowed chord                                   +0.5
 * transition per chord change
 *   descending-fifth root motion                     -0.5
 *   ascending-fifth root motion                      +0.2
 *   root motion by step or third                +0.15..0.2
 *   root motion by tritone                           +0.4
 *   V -> I                                           -0.8
 *   secondary dominant reaching its target           -1.0
 *   secondary dominant going anywhere else           +1.0
 *   secondary dominant of the chord before it        +0.8
 * phrase end per phrase-final segment
 *   lands on the tonic                               -2.5
 *   approached from V, on top of the above           -0.5
 * placement per candidate placement of the melody
 *   note outside the target key, per beat            +3.0
 *   semitone outside the comfortable range          +0.001
 * ```
 *
 * Ornamental tones are removed before the emission term is computed (see
 * {@link classifyMelodyTones}), so these numbers weigh structural tones only.
 */
const NON_CHORD_TONE_STRONG = 4;
const NON_CHORD_TONE_WEAK = 1;
const NON_SCALE_TONE = 0.5;
/**
 * What each degree costs to use, in degree order, standing for how much tonal
 * weight it carries: the tonic is free, the other primary triads are nearly so,
 * and the further a degree sits from them the more evidence the melody has to
 * supply. Without it every triad sharing a melody note is equally good and the
 * search wanders through the ones that chain by fifths. The same shape applies
 * in minor, where the slots are i, ii, III, iv, v, VI and VII.
 */
const DEGREE_BASE = [0, 0.3, 0.45, 0.15, 0.1, 0.3, 0.9];
const SECONDARY_DOMINANT_BASE = 0.8;
const BORROWED_BASE = 0.5;
const DESCENDING_FIFTH = -0.5;
const ASCENDING_FIFTH = 0.2;
const DOMINANT_TO_TONIC = -0.8;
const SECONDARY_RESOLVED = -1;
const SECONDARY_UNRESOLVED = 1;
const SECONDARY_AFTER_TARGET = 0.8;
/**
 * What other root motion costs, by the shorter distance in semitones between
 * the two roots: a third or a step asks a little, a tritone asks a lot. Motion
 * by a fifth is not priced here — it is the motion tonal harmony is built from
 * and is judged by direction instead, which is what keeps a chain of dominants
 * moving forward rather than cycling back and forth over one pair of chords.
 */
const ROOT_MOTION_COST = [0, 0.15, 0.15, 0.2, 0.2, 0, 0.4];
const PHRASE_TONIC = -2.5;
const PHRASE_AUTHENTIC = -0.5;
const OUT_OF_KEY_PER_BEAT = 3;

/**
 * Magnitude of the seed-driven per-candidate perturbation. Kept far below the
 * smallest real cost difference (transition/emission terms are on the order of
 * 0.1 and up), so it can only decide between candidates or paths whose costs are
 * otherwise exactly equal. The seed therefore breaks ties deterministically and
 * never overrides melody fit or functional flow.
 */
const TIE_BREAK_JITTER = 1e-6;

/**
 * Estimate the best-fit key from a melody's pitch-class weighting.
 *
 * Both major and natural-minor tonics are scored, so a minor melody is
 * recognized as its own minor key rather than being folded into the relative
 * major (which shares identical pitch-class content). Each in-scale note adds
 * its duration weight; notes matching the candidate tonic add a further
 * half-weight, and that tonic emphasis is what separates a minor key from its
 * relative major. For minor candidates the raised leading tone (the
 * harmonic-minor seventh) also counts as in-scale, so cadential leading tones do
 * not penalize the true minor key. Ties are broken toward the earlier candidate,
 * and major is scored before minor at each tonic.
 */
function inferKey(melody: readonly MelodyNote[]): KeyScale {
  let best: KeyScale = majorKey(0);
  let bestScore = Number.NEGATIVE_INFINITY;
  const candidates: KeyScale[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    candidates.push(majorKey(tonic), minorKey(tonic));
  }
  for (const key of candidates) {
    const tonic = pitchClass(key.rootPc);
    const isMinor = key.modeMask12 === NATURAL_MINOR_MASK;
    const leadingTone = (tonic + 11) % 12;
    let score = 0;
    for (const n of melody) {
      const w = Math.max(0.25, n.durationBeat);
      const pc = pitchClass(n.pitch);
      if (isScaleTone(n.pitch, key) || (isMinor && pc === leadingTone)) {
        score += w;
      }
      if (pc === tonic) {
        score += 0.5 * w;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

/**
 * The degrees a secondary dominant conventionally tonicizes, in the order the
 * candidate list has always held them.
 */
const SECONDARY_DOMINANT_TARGETS = [2, 4, 5, 6];

/**
 * The order those dominants open up in as the harmonic dial rises, by the
 * degree each tonicizes: the dominant's own dominant is the one an arranger
 * reaches for first, then the relative minor's, and the subdominant's last.
 * Kept apart from {@link SECONDARY_DOMINANT_TARGETS} so that widening the
 * vocabulary adds to the candidate list without reordering it.
 */
const SECONDARY_DOMINANT_ENTRY_ORDER = [5, 6, 2, 4];

/**
 * The dial position at which the last secondary dominant has entered. Above it
 * the parallel mode's chords start arriving, so the two families open one after
 * the other rather than at once.
 */
const SECONDARY_DOMINANT_BAND = 0.5;

/** Where each named reharmonization strength sits on the harmonic dial. */
const REHARMONIZE_DIAL: Record<NonNullable<HarmonizeOptions['reharmonize']>, number> = {
  diatonic: 0,
  secondaryDominant: SECONDARY_DOMINANT_BAND,
  borrowed: 1,
};

/**
 * How many members of a vocabulary family a dial fraction opens: none at or
 * below 0, all at 1, and one more each time the fraction crosses another
 * `1 / size` of the way up. That is what makes the dial continuous — a small
 * move opens one more chord rather than a whole family — while leaving the
 * family complete at the top of its band, so the named strengths reach exactly
 * the vocabulary they always did.
 */
function admittedCount(fraction: number, size: number): number {
  return Math.max(0, Math.min(size, Math.ceil(fraction * size)));
}

/** Enumerate candidate chords for the key, gated by the harmonic dial. */
function buildCandidates(key: KeyScale, harmonic: number): Candidate[] {
  const tones = scaleTonesInDegreeOrder(key);
  const candidates: Candidate[] = tones.map((rootPc, index) => {
    // Scale degrees are 1-based across the library, while the array index is
    // not; the candidate records the degree, which is what reaches the caller.
    const degree = index + 1;
    const quality = diatonicTriad(degree, key).quality;
    return {
      rootPc,
      quality,
      degree,
      secondaryDominant: false,
      base: DEGREE_BASE[index] ?? 0.6,
      pcs: chordPitchClasses(makeChord(rootPc, quality)),
    };
  });

  // The degrees are kept in the same 1-based space as `Candidate.degree`, which
  // the voice-leading cost compares them against.
  const secondaryOpen = admittedCount(
    harmonic / SECONDARY_DOMINANT_BAND,
    SECONDARY_DOMINANT_TARGETS.length,
  );
  for (const target of SECONDARY_DOMINANT_TARGETS) {
    if (SECONDARY_DOMINANT_ENTRY_ORDER.indexOf(target) >= secondaryOpen) {
      continue;
    }
    const targetRoot = tones[target - 1] ?? 0;
    const rootPc = (targetRoot + 7) % 12;
    candidates.push({
      rootPc,
      quality: 'dom7',
      secondaryDominant: true,
      targetDegree: target,
      base: SECONDARY_DOMINANT_BASE,
      pcs: chordPitchClasses(makeChord(rootPc, 'dom7')),
    });
  }

  const parallel = parallelKey(key);
  const parallelTones = scaleTonesInDegreeOrder(parallel);
  const borrowed: Chord[] = [];
  for (let degree = 1; degree <= parallelTones.length; degree += 1) {
    const chord = diatonicTriad(degree, parallel);
    if (!isDiatonic(chord, key)) {
      borrowed.push(chord);
    }
  }
  const borrowedOpen = admittedCount(
    (harmonic - SECONDARY_DOMINANT_BAND) / (1 - SECONDARY_DOMINANT_BAND),
    borrowed.length,
  );
  for (const chord of borrowed.slice(0, borrowedOpen)) {
    candidates.push({
      rootPc: chord.rootPc,
      quality: chord.quality,
      secondaryDominant: false,
      base: BORROWED_BASE,
      pcs: chordPitchClasses(chord),
    });
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const id = `${candidate.rootPc}:${candidate.quality}`;
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

/**
 * Melody-fit cost of a candidate over a segment's structural notes.
 *
 * Only the segment's `costIndices` are charged: an ornament is explained by the
 * melodic figure it forms, not by the chord under it, so making the chord cover
 * it would be paying twice. Each note is weighted by the portion of its duration
 * that overlaps the segment, so a note sustained across a boundary contributes
 * to every segment it sounds in rather than only the one it starts in.
 */
function emissionCost(
  seg: Segment,
  cand: Candidate,
  melody: readonly MelodyNote[],
  key: KeyScale,
  ts: TimeSignature,
): number {
  const pcs = cand.pcs;
  let cost = cand.base;
  for (const idx of seg.costIndices) {
    const note = melody[idx];
    if (!note) {
      continue;
    }
    const overlapStart = Math.max(note.startBeat, seg.startBeat);
    const overlap = Math.min(note.startBeat + note.durationBeat, seg.endBeat) - overlapStart;
    if (overlap <= 0) {
      continue;
    }
    const w = Math.max(0.25, overlap);
    if (pcs.includes(pitchClass(note.pitch))) {
      continue;
    }
    const strong = isStrongBeat(overlapStart, ts);
    cost += (strong ? NON_CHORD_TONE_STRONG : NON_CHORD_TONE_WEAK) * w;
    if (!isScaleTone(note.pitch, key)) {
      cost += NON_SCALE_TONE * w;
    }
  }
  return cost;
}

/**
 * Register cost of a placed melody: a small penalty for notes pushed outside a
 * comfortable range. Kept far below emission/transition costs so it only breaks
 * ties between otherwise-equal octave placements.
 */
function tessituraCost(melody: readonly MelodyNote[]): number {
  let cost = 0;
  for (const n of melody) {
    if (n.pitch < COMFORT_LOW) {
      cost += (COMFORT_LOW - n.pitch) * TESSITURA_WEIGHT;
    } else if (n.pitch > COMFORT_HIGH) {
      cost += (n.pitch - COMFORT_HIGH) * TESSITURA_WEIGHT;
    }
  }
  return cost;
}

/** Whether a candidate is the key's dominant, in a quality that can act as one. */
function isDominantOf(cand: Candidate, tonicPc: number): boolean {
  return cand.rootPc === (tonicPc + 7) % 12 && (cand.quality === 'maj' || cand.quality === 'dom7');
}

/**
 * How badly a placed melody sits in the key it is about to be harmonized in.
 *
 * This is what makes a transposition search mean "move the melody into this
 * key": a shift is judged by the melody's own key membership, not by how many
 * chord tones a chord path can be talked into covering. The winning shift
 * therefore always agrees with the key the result reports.
 */
function keyFitCost(melody: readonly MelodyNote[], key: KeyScale): number {
  let cost = 0;
  for (const n of melody) {
    if (!isScaleTone(n.pitch, key)) {
      cost += Math.max(0.25, n.durationBeat) * OUT_OF_KEY_PER_BEAT;
    }
  }
  return cost;
}

/**
 * Collapse runs of the same chord into one span.
 *
 * The harmonic rhythm sets the grid the search may change chords on, not a
 * requirement to change on every slot; repeating a slot's chord is the same
 * harmony held longer, and reporting it once is what a chart shows.
 */
function mergeRepeats(spans: ChordSpan[]): ChordSpan[] {
  const merged: ChordSpan[] = [];
  for (const span of spans) {
    const prev = merged.at(-1);
    if (
      prev &&
      prev.rootPc === span.rootPc &&
      prev.quality === span.quality &&
      prev.degree === span.degree &&
      prev.secondaryDominant === span.secondaryDominant
    ) {
      continue;
    }
    merged.push(span);
  }
  return merged;
}

/** Functional-flow cost of moving from one candidate chord to the next. */
function transitionCost(prev: Candidate, cur: Candidate, tonicPc: number): number {
  let cost = 0;
  const down = (prev.rootPc - cur.rootPc + 12) % 12;
  if (down === 7) {
    cost += DESCENDING_FIFTH;
  } else if (down === 5) {
    cost += ASCENDING_FIFTH;
  } else {
    cost += ROOT_MOTION_COST[Math.min(down, 12 - down)] ?? 0;
  }
  if (isDominantOf(prev, tonicPc) && cur.rootPc === tonicPc) {
    cost += DOMINANT_TO_TONIC;
  }
  if (prev.secondaryDominant) {
    cost += cur.degree === prev.targetDegree ? SECONDARY_RESOLVED : SECONDARY_UNRESOLVED;
  }
  // Reaching a chord's own dominant from that chord leads straight back where it
  // came from. Once it is cheaper to tonicize than to stay put, a search with no
  // memory will otherwise rock between the two forever.
  if (cur.secondaryDominant && prev.degree !== undefined && prev.degree === cur.targetDegree) {
    cost += SECONDARY_AFTER_TARGET;
  }
  return cost;
}

/**
 * Bonus for closing a phrase. A phrase that ends anywhere but the tonic ends
 * open, and the bonus is worth as much as covering the melody is, so a chord
 * cannot buy the last slot by matching one more note.
 *
 * `prev` is the chord approaching the close, or null when the phrase is a single
 * chord long and there is nothing to approach it from.
 */
function phraseEndBonus(prev: Candidate | null, cur: Candidate, tonicPc: number): number {
  if (cur.rootPc !== tonicPc) {
    return 0;
  }
  return PHRASE_TONIC + (prev !== null && isDominantOf(prev, tonicPc) ? PHRASE_AUTHENTIC : 0);
}

/**
 * Segments that end a phrase and therefore have to cadence.
 *
 * The library has no phrase layer yet, so the whole melody is one phrase and
 * only its last segment closes. Everything else reads the boundaries from here,
 * so supplying real ones later is a change to this function alone.
 */
function phraseEndSegments(segmentCount: number): Set<number> {
  return new Set(segmentCount > 0 ? [segmentCount - 1] : []);
}

/** Run one Viterbi harmonization pass over a fixed melody and key. */
function harmonizeOnce(
  melody: readonly MelodyNote[],
  key: KeyScale,
  candidates: Candidate[],
  segments: Segment[],
  jitter: number[],
  ts: TimeSignature,
): { cost: number; path: number[] } {
  const tonicPc = pitchClass(key.rootPc);
  const n = candidates.length;
  const candAt = (i: number): Candidate => candidates[i] ?? FALLBACK;
  const phraseEnds = phraseEndSegments(segments.length);
  const seg0 = segments[0];

  // A phrase one segment long has no approach chord, so its close is judged on
  // the chord alone.
  let dp = candidates.map(
    (c, ci) =>
      (seg0 ? emissionCost(seg0, c, melody, key, ts) : 0) +
      (phraseEnds.has(0) ? phraseEndBonus(null, c, tonicPc) : 0) +
      (jitter[ci] ?? 0),
  );
  const back: number[][] = [];

  for (let s = 1; s < segments.length; s += 1) {
    const seg = segments[s];
    if (!seg) {
      continue;
    }
    const closes = phraseEnds.has(s);
    const next: number[] = [];
    const ptr: number[] = [];
    for (let c = 0; c < n; c += 1) {
      let best = Number.POSITIVE_INFINITY;
      let bestPrev = 0;
      for (let p = 0; p < n; p += 1) {
        // The cadence bonus is part of the step into a phrase-final segment, not
        // an afterthought added to the finished path, so the approach chord is
        // chosen for the cadence it makes.
        const cost =
          (dp[p] ?? Number.POSITIVE_INFINITY) +
          transitionCost(candAt(p), candAt(c), tonicPc) +
          (closes ? phraseEndBonus(candAt(p), candAt(c), tonicPc) : 0);
        if (cost < best) {
          best = cost;
          bestPrev = p;
        }
      }
      next[c] = best + emissionCost(seg, candAt(c), melody, key, ts) + (jitter[c] ?? 0);
      ptr[c] = bestPrev;
    }
    dp = next;
    back.push(ptr);
  }

  let bestCost = Number.POSITIVE_INFINITY;
  let bestEnd = 0;
  for (let c = 0; c < n; c += 1) {
    const total = dp[c] ?? Number.POSITIVE_INFINITY;
    if (total < bestCost) {
      bestCost = total;
      bestEnd = c;
    }
  }

  const path: number[] = new Array<number>(segments.length).fill(bestEnd);
  for (let s = segments.length - 2; s >= 0; s -= 1) {
    const ptr = back[s];
    const nextIdx = path[s + 1] ?? bestEnd;
    path[s] = ptr ? (ptr[nextIdx] ?? bestEnd) : bestEnd;
  }
  return { cost: bestCost, path };
}

/**
 * Harmonize a melody with a min-cost chord progression.
 *
 * The melody's ornaments are classified first, from the melody and the metre
 * alone (see {@link classifyMelodyTones}); the chords then have to explain the
 * structural tones only, so a passing tone no longer buys itself a chord. The
 * melody is segmented by `harmonicRhythm`; each segment is scored against the
 * candidate chords the harmonic dial opens — the key's own triads, then the
 * secondary dominants, then the parallel mode's chords, one at a time as
 * `ctx.complexity.harmonic` rises from 0 to 1 — by the fit of those structural
 * tones, and a Viterbi search picks the lowest-cost path using a
 * functional-flow transition cost and a cadence bonus
 * at the end of the phrase. Runs of the same chord are reported once, so the
 * chord count follows the harmony rather than the grid.
 *
 * With `placement.transposeSearch` the melody is moved into the key it is
 * harmonized in, and `transposeSemitones` reports how far; with
 * `placement.octaveSearch` it is moved by octaves into a comfortable register,
 * which leaves the key and the chords untouched. Both may be set, and the
 * reported shift is their sum.
 *
 * The `seed` drives a deterministic tie-break only: it perturbs candidates by a
 * magnitude far below any real cost difference (see `TIE_BREAK_JITTER`),
 * so it can decide between chords or paths of otherwise-equal cost but never
 * overrides melody fit or functional flow. For a well-determined melody the
 * result is identical across seeds; the same seed always yields the same result.
 *
 * @param opts The melody and, optionally, the generation context, key, harmonic
 *   rhythm, reharmonization strength, placement search, meter, and seed. Only
 *   `melody` is required.
 * @returns The chosen transpose, key, chord path, and per-note roles.
 * @example
 * ```ts
 * import { harmonizeMelody } from '@libraz/libcantus';
 * const result = harmonizeMelody({
 *   melody: [
 *     { pitch: 60, startBeat: 0, durationBeat: 1 },
 *     { pitch: 64, startBeat: 1, durationBeat: 1 },
 *   ],
 * });
 * result.chords; // one ChordSpan per chord change, on the harmonic-rhythm grid
 * ```
 * @category Reharmonization
 */
export function harmonizeMelody(opts: HarmonizeOptions): HarmonizeResult {
  assertNoteEvents(opts.melody, 'harmonize melody', { allowNonPositiveDuration: true });
  const soundingMelody = soundingNotesOnly(opts.melody);
  const noteIndex = createNoteEventIndex(soundingMelody);
  const ts = opts.ts ?? DEFAULT_METER;
  assertTimeSignature(ts);
  const requestedKey = opts.key ?? 'infer';
  const key = requestedKey === 'infer' ? inferKey(soundingMelody) : requestedKey;
  const placement = opts.placement ?? DEFAULT_PLACEMENT;
  const ctx = resolveContextWith(opts.ctx, { seed: opts.seed });
  // `reharmonize` names three points on the dial the context sets continuously,
  // so a caller who says `'secondaryDominant'` gets exactly the vocabulary that
  // name has always meant.
  const harmonic = ctx.harmonic ?? REHARMONIZE_DIAL[opts.reharmonize ?? 'diatonic'];
  // Nothing to harmonize: inventing a tonic bar here would silently insert a
  // ghost chord into a chart built by harmonizing sections and concatenating
  // them. The sibling generators return an empty result for empty input too.
  if (noteIndex.notes.length === 0) {
    return { transposeSemitones: 0, key, chords: [], melodyRoles: [] };
  }
  const candidates = buildCandidates(key, harmonic);
  const candAt = (i: number): Candidate => candidates[i] ?? FALLBACK;
  const draw = ctx.part('harmony');
  const jitter = candidates.map((_, index) => draw.at('jitter', index) * TIE_BREAK_JITTER);

  const melodyStart = noteIndex.notes.reduce(
    (start, indexed) => Math.min(start, indexed.note.startBeat),
    Number.POSITIVE_INFINITY,
  );
  const melodyEnd = noteIndex.notes.reduce((end, indexed) => Math.max(end, indexed.endBeat), 0);
  // Any positive value is honoured: a silent clamp would make the option mean
  // something different here than it does on the analysis side. A value small
  // enough to make the search explode is caught by the budget assertions below,
  // not rounded away.
  const hr = assertRange(
    opts.harmonicRhythm ?? DEFAULT_HARMONIC_RHYTHM,
    Number.MIN_VALUE,
    Number.MAX_SAFE_INTEGER,
    'harmonic rhythm',
  );
  const segmentStart = Math.floor(melodyStart / hr) * hr;
  const segCount = Math.max(1, Math.ceil((melodyEnd - segmentStart) / hr));
  assertGenerationBudget(segCount, 'harmonic segments');
  const segments: Segment[] = Array.from({ length: segCount }, (_, s) => ({
    startBeat: segmentStart + s * hr,
    endBeat: segmentStart + (s + 1) * hr,
    noteIndices: [],
    costIndices: [],
  }));
  // Associate each note only with the windows it actually spans. This replaces
  // the former per-window full melody scan and creates no temporary note objects.
  let memberships = 0;
  for (const indexed of noteIndex.notes) {
    const first = Math.max(0, Math.floor((indexed.note.startBeat - segmentStart) / hr));
    const lastExclusive = Math.min(
      segCount,
      Math.ceil((indexed.endBeat - segmentStart) / hr - Number.EPSILON),
    );
    memberships += Math.max(0, lastExclusive - first);
    assertGenerationBudget(memberships, 'note-to-segment memberships');
    for (let segment = first; segment < lastExclusive; segment += 1) {
      segments[segment]?.noteIndices.push(indexed.originalIndex);
    }
  }

  // Classify the ornaments before any chord exists, and keep only the structural
  // tones in each slot's emission term. Transposing a melody moves every note
  // alike, so the figures are the same at every placement and are found once.
  const tones = classifyMelodyTones(soundingMelody, ts);
  for (const segment of segments) {
    const structural = segment.noteIndices.filter((idx) => tones[idx]?.ornamental !== true);
    segment.costIndices = structural.length > 0 ? structural : segment.noteIndices;
  }

  // Two independent axes: the semitone shift that puts the melody in the key it
  // is harmonized in, and the octave that puts it in a comfortable register.
  // Octaves preserve pitch classes, so they can only move the register.
  const semitoneShifts: number[] = [0];
  if (placement.transposeSearch) {
    for (let s = -6; s <= 6; s += 1) {
      if (s !== 0) {
        semitoneShifts.push(s);
      }
    }
  }
  const octaveShifts: number[] = placement.octaveSearch ? [0, -12, 12] : [0];
  const transposes = semitoneShifts.flatMap((s) => octaveShifts.map((o) => s + o));
  assertGenerationBudget(
    transposes.length * segCount * candidates.length * candidates.length,
    'harmonization placement search',
  );

  let bestCost = Number.POSITIVE_INFINITY;
  let bestTs = 0;
  let bestPath: number[] = [];
  for (const shift of transposes) {
    const shifted = soundingMelody.map((n) => ({ ...n, pitch: n.pitch + shift }));
    const { cost, path } = harmonizeOnce(shifted, key, candidates, segments, jitter, ts);
    const total = cost + keyFitCost(shifted, key) + tessituraCost(shifted);
    if (total < bestCost) {
      bestCost = total;
      bestTs = shift;
      bestPath = path;
    }
  }

  const chords = mergeRepeats(
    bestPath.map((ci, s) => {
      const cand = candAt(ci);
      const chord: ChordSpan = {
        rootPc: cand.rootPc,
        quality: cand.quality,
        startBeat: segments[s]?.startBeat ?? segmentStart + s * hr,
      };
      if (cand.degree !== undefined) {
        chord.degree = cand.degree;
      }
      if (cand.secondaryDominant) {
        chord.secondaryDominant = true;
      }
      return chord;
    }),
  );

  const melodyRoles = opts.melody.map((note, noteIndex) => {
    const segIdx = Math.min(
      segments.length - 1,
      Math.max(0, Math.floor((note.startBeat - segmentStart) / hr)),
    );
    const cand = candAt(bestPath[segIdx] ?? 0);
    const chord: Chord = makeChord(cand.rootPc, cand.quality);
    return { noteIndex, role: roleOf(note.pitch + bestTs, chord).role };
  });

  return { transposeSemitones: bestTs, key, chords, melodyRoles };
}
