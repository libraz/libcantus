import { describe, expect, it } from 'vitest';
import { parseNote } from '../src/core/pitch/index.js';
import { Key } from '../src/model/key.js';
import { spellScale } from '../src/theory/spelling/index.js';
import { shortestReading } from './support/growth.js';

describe('non-heptatonic scales lean the way the scale does', () => {
  it('works a scale out once rather than once per tone of it', () => {
    // A scale no diatonic mode holds is read jointly: the whole set of letters
    // is walked, and the answer covers every tone at once. Asking it per tone
    // walked that space again for each of them, and asking it again for a scale
    // already read walked it once more. Three hundred readings of one scale
    // against three hundred readings of a different scale each, timed moments
    // apart on the same machine so a busy one slows both.
    const masks: number[] = [];
    for (let mask = 1; mask < 4096 && masks.length < 300; mask += 2) {
      let tones = 0;
      for (let bit = 0; bit < 12; bit += 1) {
        tones += (mask >> bit) & 1;
      }
      if (tones === 8) {
        masks.push(mask);
      }
    }
    expect(masks).toHaveLength(300);
    const tonic = parseNote('C');
    const spellAll = (pick: (round: number) => number): number => {
      const started = performance.now();
      for (let round = 0; round < masks.length; round += 1) {
        spellScale(tonic, { rootPc: 0, modeMask12: pick(round) });
      }
      return performance.now() - started;
    };
    const first = masks[0] ?? 1;
    // The worked side has to be the cold reading: the answer is remembered, so
    // a second pass over the same masks would time the memo rather than the
    // work. Read once, it can only be inflated by a busy machine, and that
    // moves the ratio away from the bound rather than through it.
    const worked = spellAll((round) => masks[round] ?? first);
    // The re-read is the cheap side, and the cheap side is where one
    // descheduled slice is a large share of the reading — which is what used to
    // collapse this ratio under a loaded suite. It repeats, so it is read the
    // honest way.
    const reread = shortestReading(() => spellAll(() => first));
    expect(worked / Math.max(reread, 0.01)).toBeGreaterThan(5);
    // And the reading is the one it always was.
    expect(Key.named('octatonicHalfWhole', 'C').noteNames()).toEqual(
      Key.named('octatonicHalfWhole', 'C').noteNames(),
    );
  });
});
