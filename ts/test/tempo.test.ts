import { describe, expect, it } from 'vitest';
import { beatsToSeconds, type TempoMap } from '../src/core/tempo/index.js';
import { shortestReading } from './support/growth.js';

/**
 * A recorded accelerando: a tempo event every `every` beats, rising as it goes.
 *
 * This is what a MIDI import gives — a sequencer writes a tempo event per tick
 * through a ritardando, and the interoperability guide sends a caller here with
 * exactly that map.
 */
function accelerando(count: number, every = 1): TempoMap {
  return Array.from({ length: count }, (_, index) => ({
    startBeat: index * every,
    bpm: 60 + (index % 120),
  }));
}

describe('a tempo map is bounded and read once', () => {
  // A map handed to a conversion is validated by it, and a caller converting
  // position after position hands over the same map every time. Validating it
  // afresh each time — the range of every tempo, the ordering of every onset,
  // and the messages built to describe them — costs the whole map per question.
  // A map already validated and unchanged since is recognised instead, which
  // leaves a comparison per entry rather than a validation.
  it('validates a map once however many positions are converted against it', () => {
    // Two maps of the same size and the same conversions over each. One is left
    // alone, so every call after the first recognises it; the other is written
    // to between calls, so every call validates it afresh — which is what the
    // first map used to cost as well. The two runs are timed moments apart on
    // the same machine, so what is left between them is the validation.
    const size = 10_000;
    const remembered = accelerando(size);
    const rewritten = accelerando(size).map((event) => ({ ...event }));
    const convert = (map: TempoMap, touch: boolean): number => {
      let last = 0;
      for (let beat = 0; beat < size; beat += 1) {
        if (touch) {
          rewritten[0] = { startBeat: 0, bpm: 60 + (beat % 2) };
        }
        last = beatsToSeconds(beat, map);
      }
      return last;
    };
    convert(remembered, false);
    expect(convert(remembered, false)).toBeGreaterThan(0);
    expect(convert(rewritten, true)).toBeGreaterThan(0);
    // Each side read more than once and kept at its shortest: both are cheap
    // enough that one descheduled slice is a large share of a single reading.
    const recognised = shortestReading(() => convert(remembered, false));
    const revalidated = shortestReading(() => convert(rewritten, true));
    // A map recognised as the one already validated is not walked again. How
    // much that saves depends on the machine and on whether coverage is
    // counting every call, so the bound separates the saving from none at all
    // rather than stating its size.
    expect(revalidated / Math.max(recognised, 0.01)).toBeGreaterThan(2);
    // Ten thousand entries converted ten thousand times, twice: seconds on a
    // machine to itself and a minute or more with the rest of the suite running
    // beside it. The budget is for catching a hang, as the suite-wide one is —
    // a run that took long enough to reach it is not slow, it is quadratic
    // again, which is the very thing the comparison above is about.
  }, 180_000);
});
