import type { Chord } from '../chord/index.js';
import { chordPitchClasses } from '../chord/index.js';
import { NAMED_SCALES } from '../scale/index.js';

/** Reduce a value to a pitch class in [0, 11]. */
function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

/** Count the set bits (scale tones) in a 12-bit mode mask. */
function popcount12(mask: number): number {
  let count = 0;
  for (let n = 0; n < 12; n += 1) {
    count += (mask >> n) & 1;
  }
  return count;
}

/** Test whether a pitch class belongs to a mode mask rooted on `scaleRootPc`. */
function maskHasPitchClass(mask: number, scaleRootPc: number, pc: number): boolean {
  const offset = pitchClass(pc - scaleRootPc);
  return ((mask >> offset) & 1) === 1;
}

/**
 * Test whether every chord pitch class is contained in a scale.
 *
 * @param chordPcs The chord's pitch classes (0..11).
 * @param scaleMask The scale's 12-bit mode mask.
 * @param scaleRootPc The pitch class the mask is rooted on.
 * @returns True if the scale is a superset of the chord.
 */
export function scaleMatchesChord(
  chordPcs: number[],
  scaleMask: number,
  scaleRootPc: number,
): boolean {
  for (const pc of chordPcs) {
    if (!maskHasPitchClass(scaleMask, scaleRootPc, pc)) {
      return false;
    }
  }
  return true;
}

/** A named scale rooted on a pitch class that fits over a chord. */
export type ChordScaleMatch = {
  name: string;
  rootPc: number;
};

/**
 * List the scales that fit over a chord, best fit first.
 *
 * Only the chord root is considered as the scale root, matching the
 * conventional chord-scale relationship. Every entry of {@link NAMED_SCALES}
 * whose pitch-class set is a superset of the chord's is returned, ranked by
 * fewest extra scale tones beyond the chord, then by scale size (heptatonic
 * before larger scales), then by scale name. The chromatic scale is only
 * returned as a fallback when no other scale contains the chord.
 *
 * @param chord The chord to fit scales over.
 * @returns The matching scales rooted on the chord root, best fit first.
 */
export function chordScales(chord: Chord): ChordScaleMatch[] {
  const chordPcs = chordPitchClasses(chord);
  const rootPc = pitchClass(chord.rootPc);
  const ranked: { name: string; extra: number; size: number }[] = [];
  for (const name of Object.keys(NAMED_SCALES)) {
    if (name === 'chromatic') {
      continue;
    }
    const mask = NAMED_SCALES[name];
    if (mask === undefined) {
      continue;
    }
    if (scaleMatchesChord(chordPcs, mask, rootPc)) {
      const size = popcount12(mask);
      ranked.push({ name, extra: size - chordPcs.length, size });
    }
  }
  if (ranked.length === 0) {
    // No diatonic-style scale contains the chord; fall back to the chromatic
    // scale, which trivially contains every pitch class.
    if (NAMED_SCALES.chromatic !== undefined) {
      return [{ name: 'chromatic', rootPc }];
    }
    return [];
  }
  ranked.sort((a, b) => {
    if (a.extra !== b.extra) {
      return a.extra - b.extra;
    }
    if (a.size !== b.size) {
      return a.size - b.size;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return ranked.map((entry) => ({ name: entry.name, rootPc }));
}

/**
 * List a scale's avoid notes over a chord.
 *
 * An avoid note is a non-chord scale tone that lies a semitone directly above a
 * chord tone; sounding it against the chord clashes. The scale is rooted on the
 * chord root. If the scale does not contain the chord, no avoid notes exist.
 *
 * @param chord The chord providing the chord tones.
 * @param scaleName A key of {@link NAMED_SCALES}.
 * @returns The avoid-note pitch classes, sorted ascending in [0, 11].
 */
export function avoidNotes(chord: Chord, scaleName: string): number[] {
  const mask = NAMED_SCALES[scaleName];
  if (mask === undefined) {
    return [];
  }
  const rootPc = pitchClass(chord.rootPc);
  const chordPcs = chordPitchClasses(chord);
  if (!scaleMatchesChord(chordPcs, mask, rootPc)) {
    return [];
  }
  const chordSet = new Set(chordPcs);
  const avoid: number[] = [];
  for (let pc = 0; pc < 12; pc += 1) {
    if (!maskHasPitchClass(mask, rootPc, pc) || chordSet.has(pc)) {
      continue;
    }
    if (chordSet.has(pitchClass(pc - 1))) {
      avoid.push(pc);
    }
  }
  return avoid.sort((a, b) => a - b);
}

/**
 * List a scale's available tensions over a chord.
 *
 * Available tensions are scale tones that are neither chord tones nor avoid
 * notes, i.e. the usable color tones (typically the 9/11/13 region). The scale
 * is rooted on the chord root. If the scale does not contain the chord, there
 * are no available tensions.
 *
 * @param chord The chord providing the chord tones.
 * @param scaleName A key of {@link NAMED_SCALES}.
 * @returns The available-tension pitch classes, sorted ascending in [0, 11].
 */
export function availableTensions(chord: Chord, scaleName: string): number[] {
  const mask = NAMED_SCALES[scaleName];
  if (mask === undefined) {
    return [];
  }
  const rootPc = pitchClass(chord.rootPc);
  const chordPcs = chordPitchClasses(chord);
  if (!scaleMatchesChord(chordPcs, mask, rootPc)) {
    return [];
  }
  const chordSet = new Set(chordPcs);
  const avoidSet = new Set(avoidNotes(chord, scaleName));
  const tensions: number[] = [];
  for (let pc = 0; pc < 12; pc += 1) {
    if (!maskHasPitchClass(mask, rootPc, pc) || chordSet.has(pc) || avoidSet.has(pc)) {
      continue;
    }
    tensions.push(pc);
  }
  return tensions.sort((a, b) => a - b);
}

/** A scale fit over a chord together with its avoid notes and tensions. */
export type ChordScaleReportEntry = {
  name: string;
  rootPc: number;
  avoid: number[];
  tensions: number[];
};

/**
 * Report the best-fitting scales for a chord with their avoid notes and tensions.
 *
 * Combines {@link chordScales}, {@link avoidNotes}, and {@link availableTensions}
 * into a single ergonomic result, ordered best fit first.
 *
 * @param chord The chord to analyze.
 * @param limit Optional maximum number of scales to report; all by default.
 * @returns One entry per reported scale, best fit first.
 */
export function chordScaleReport(chord: Chord, limit?: number): ChordScaleReportEntry[] {
  const matches = chordScales(chord);
  const chosen = limit === undefined ? matches : matches.slice(0, Math.max(0, limit));
  return chosen.map((match) => ({
    name: match.name,
    rootPc: match.rootPc,
    avoid: avoidNotes(chord, match.name),
    tensions: availableTensions(chord, match.name),
  }));
}

/** A chord paired with the scale chosen for it by {@link scalesForChanges}. */
export type ScaleChoice = {
  chord: Chord;
  scale: ChordScaleMatch;
};

/**
 * Small per-candidate penalty added in {@link scalesForChanges} so that, among
 * choices of otherwise-equal transition cost, the tighter best-fit scale wins.
 */
const RANK_PENALTY = 0.01;

/** Build the pitch-class set of a named scale rooted on `rootPc`. */
function scalePitchClassSet(name: string, rootPc: number): Set<number> {
  const mask = NAMED_SCALES[name];
  const pcs = new Set<number>();
  if (mask === undefined) {
    return pcs;
  }
  for (let n = 0; n < 12; n += 1) {
    if (((mask >> n) & 1) === 1) {
      pcs.add(pitchClass(rootPc + n));
    }
  }
  return pcs;
}

/** Count pitch classes that belong to exactly one of two sets. */
function symmetricDifferenceSize(a: Set<number>, b: Set<number>): number {
  let count = 0;
  for (const pc of a) {
    if (!b.has(pc)) {
      count += 1;
    }
  }
  for (const pc of b) {
    if (!a.has(pc)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Choose one scale per chord across a progression, favoring continuity.
 *
 * Each chord's {@link chordScales} candidates form a stage in a Viterbi-style
 * dynamic program. The transition cost between adjacent choices is the number
 * of pitch classes that differ between their pitch-class sets (the symmetric
 * difference), plus a small penalty for straying from a chord's best-fit scale
 * so that ties break toward the tighter fit. The minimum-total-cost path is
 * returned, one {@link ScaleChoice} per input chord in the original order.
 *
 * @param chords The chord sequence to choose scales for.
 * @returns One scale choice per chord, in input order.
 */
export function scalesForChanges(chords: Chord[]): ScaleChoice[] {
  if (chords.length === 0) {
    return [];
  }
  const candidateLists = chords.map((chord) => chordScales(chord));
  const pcSets = candidateLists.map((candidates) =>
    candidates.map((match) => scalePitchClassSet(match.name, match.rootPc)),
  );

  const first = candidateLists[0] ?? [];
  const dp: number[][] = [first.map((_, j) => j * RANK_PENALTY)];
  const back: number[][] = [first.map(() => -1)];

  for (let i = 1; i < candidateLists.length; i += 1) {
    const candidates = candidateLists[i] ?? [];
    const prevCosts = dp[i - 1] ?? [];
    const prevSets = pcSets[i - 1] ?? [];
    const curSets = pcSets[i] ?? [];
    const stageCosts: number[] = [];
    const stageBack: number[] = [];
    for (let j = 0; j < candidates.length; j += 1) {
      let bestCost = Number.POSITIVE_INFINITY;
      let bestPrev = -1;
      for (let k = 0; k < prevCosts.length; k += 1) {
        const transition = symmetricDifferenceSize(
          prevSets[k] ?? new Set(),
          curSets[j] ?? new Set(),
        );
        const cost = (prevCosts[k] ?? 0) + transition;
        if (cost < bestCost) {
          bestCost = cost;
          bestPrev = k;
        }
      }
      stageCosts.push(bestCost + j * RANK_PENALTY);
      stageBack.push(bestPrev);
    }
    dp.push(stageCosts);
    back.push(stageBack);
  }

  const lastCosts = dp[dp.length - 1] ?? [];
  let bestFinal = 0;
  for (let j = 1; j < lastCosts.length; j += 1) {
    if ((lastCosts[j] ?? Number.POSITIVE_INFINITY) < (lastCosts[bestFinal] ?? 0)) {
      bestFinal = j;
    }
  }

  const chosenIndices: number[] = new Array(candidateLists.length);
  let current = bestFinal;
  for (let i = candidateLists.length - 1; i >= 0; i -= 1) {
    chosenIndices[i] = current;
    current = back[i]?.[current] ?? -1;
  }

  return chords.map((chord, i) => {
    const candidates = candidateLists[i] ?? [];
    const scale = candidates[chosenIndices[i] ?? 0] ?? { name: 'chromatic', rootPc: chord.rootPc };
    return { chord, scale };
  });
}
