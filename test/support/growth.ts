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
