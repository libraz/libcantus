/**
 * The search itself: one pass of dynamic programming over the segments.
 *
 * Every segment is scored against every candidate chord, and every pair of
 * consecutive segments against the move between them, so the cheapest reading
 * of the whole line is the cheapest path through that table. What the terms
 * mean is `cost.ts`; this module only adds them up and remembers the path.
 */

import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { emissionCost, phraseEndBonus, transitionCost } from './cost.js';
import type { Candidate, MelodyNote, Segment } from './internal.js';
import { FALLBACK } from './internal.js';

/** Whether two candidates are the same harmony, which is what holding a chord means. */
function sameHarmony(a: Candidate, b: Candidate): boolean {
  return a.rootPc === b.rootPc && a.quality === b.quality;
}
/** Run one Viterbi harmonization pass over a fixed melody and key. */
export function harmonizeOnce(
  melody: readonly MelodyNote[],
  key: KeyScale,
  candidates: Candidate[],
  segments: Segment[],
  jitter: number[],
  phraseEnds: ReadonlySet<number>,
  articulated: ReadonlySet<number>,
): { cost: number; path: number[] } {
  const tonicPc = pitchClass(key.rootPc);
  const n = candidates.length;
  const candAt = (i: number): Candidate => candidates[i] ?? FALLBACK;
  const seg0 = segments[0];

  // A phrase one segment long has no approach chord, so its close is judged on
  // the chord alone.
  let dp = candidates.map(
    (c, ci) =>
      (seg0 ? emissionCost(seg0, c, melody, key) : 0) +
      (seg0 && phraseEnds.has(0) ? phraseEndBonus(null, c, tonicPc, seg0, melody) : 0) +
      (jitter[ci] ?? 0),
  );
  const back: number[][] = [];

  for (let s = 1; s < segments.length; s += 1) {
    const seg = segments[s];
    if (!seg) {
      continue;
    }
    const closes = phraseEnds.has(s);
    // A beat the caller named as a phrase end is a cadence point, and a cadence
    // is harmonic motion into the close: the chord under it is not the chord
    // that was already sounding. The melody's own close is not held to this —
    // naming a beat is what asks for it — so a call that names none is scored
    // exactly as it was.
    const articulates = articulated.has(s);
    const next: number[] = [];
    const ptr: number[] = [];
    for (let c = 0; c < n; c += 1) {
      let best = Number.POSITIVE_INFINITY;
      let bestPrev = 0;
      for (let p = 0; p < n; p += 1) {
        if (articulates && sameHarmony(candAt(p), candAt(c))) {
          continue;
        }
        // The cadence bonus is part of the step into a phrase-final segment, not
        // an afterthought added to the finished path, so the approach chord is
        // chosen for the cadence it makes.
        const cost =
          (dp[p] ?? Number.POSITIVE_INFINITY) +
          transitionCost(candAt(p), candAt(c), tonicPc) * seg.beats +
          (closes ? phraseEndBonus(candAt(p), candAt(c), tonicPc, seg, melody) : 0);
        if (cost < best) {
          best = cost;
          bestPrev = p;
        }
      }
      next[c] = best + emissionCost(seg, candAt(c), melody, key) + (jitter[c] ?? 0);
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
