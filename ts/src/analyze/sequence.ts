/**
 * Graded edit distance between two sequences, shared by every structural
 * comparison that has to align one ordered list against another.
 *
 * A flat substitution cost would make a third answered by a fourth as wrong as
 * a third answered by a ninth, or a chord root a semitone off as wrong as an
 * unrelated one; `cost` grades that per caller. The insertion/deletion cost is
 * a parameter rather than a fixed 1, because a caller aligning a chord
 * progression treats a passing chord as cheaper to skip than a wrong chord to
 * substitute.
 */

/**
 * Edit distance between two sequences under a graded substitution cost and a
 * caller-chosen gap cost for insertion or deletion.
 *
 * @param a The first sequence.
 * @param b The second sequence.
 * @param cost Cost of substituting one element for another.
 * @param gap Cost of inserting or deleting one element. Defaults to 1.
 * @returns The edit distance between `a` and `b`.
 */
export function gradedEditDistance<T>(
  a: readonly T[],
  b: readonly T[],
  cost: (x: T, y: T) => number,
  gap = 1,
): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i * gap);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array<number>(b.length + 1);
    row[0] = i * gap;
    for (let j = 1; j <= b.length; j += 1) {
      const ai = a[i - 1] as T;
      const bj = b[j - 1] as T;
      const substitution = (previous[j - 1] ?? 0) + cost(ai, bj);
      const deletion = (previous[j] ?? 0) + gap;
      const insertion = (row[j - 1] ?? 0) + gap;
      row[j] = Math.min(substitution, deletion, insertion);
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

/**
 * Turn an edit distance into a likeness in [0, 1].
 *
 * @param distance The edit distance between two sequences.
 * @param a Length of the first sequence.
 * @param b Length of the second sequence.
 * @returns 1 when both sequences are empty, else the distance normalised by
 *   the longer sequence's length and clamped to [0, 1].
 */
export function distanceToSimilarity(distance: number, a: number, b: number): number {
  const longest = Math.max(a, b);
  if (longest === 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, 1 - distance / longest));
}
