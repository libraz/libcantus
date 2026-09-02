/**
 * How a pass's cost grows with the size of what it is given.
 *
 * Some of what this library does is bounded only by an argument the caller
 * supplies, and the difference between reading a piece once and reading it once
 * per bar of itself shows in nothing but the time: the answer is the same
 * either way. A wall-clock bound states that badly — the suite runs its files
 * side by side, and a sweep in another worker slows a pass here by an order of
 * magnitude without anything being wrong with it. The ratio of two runs taken
 * moments apart on the same machine survives that, because a busy machine slows
 * both of them.
 *
 * ## When a growth assertion is worth writing
 *
 * A ratio only separates two implementations when the term it watches is the
 * one that dominates. A linear scan sitting inside a pass that is already
 * linear in the same input is not that term: replacing the scan with a binary
 * search leaves the ratio where it was, so an assertion written for it passes
 * before the change and after it, and stands for nothing. Worse, it reads as
 * though the scan were guarded.
 *
 * So measure first, then decide. Take the ratio with the scan in place. If it
 * does not move when the scan is replaced, the assertion does not belong here —
 * it would be a test of the pass's own shape wearing the label of a guard
 * against the scan.
 *
 * What to write instead, for a scan that is real but not dominant: give the
 * lookup one implementation, test that implementation directly for the answers
 * it owes at its edges, and route the call site through it. That is a guard
 * against the same defect — a second, subtly different search — and unlike a
 * timing bound it says what it means and cannot be passed by accident.
 */

/** Milliseconds a call takes. */
function elapsed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

/**
 * The factor by which `run` slows down when its input grows `times` over.
 *
 * A cost that grows with the input answers near `times`; one that grows with
 * its square answers near `times` squared. Assert against a threshold between
 * the two rather than against either, so the reading has room for the noise a
 * shared machine adds.
 *
 * @param times How much larger the second input is than the first.
 * @param run Builds and runs the pass at a scale — 1 for the smaller input.
 * @returns The ratio of the larger run's time to the smaller run's.
 */
export function growthFactor(times: number, run: (scale: number) => unknown): number {
  // Once through first, so the smaller run is not the one paying for the
  // compiler warming up on the code both of them execute.
  run(1);
  const small = Math.max(
    elapsed(() => run(1)),
    1,
  );
  const large = elapsed(() => run(times));
  return large / small;
}
