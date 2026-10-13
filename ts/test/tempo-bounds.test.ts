import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { beatsToSeconds, secondsToBeats, type TempoMap } from '../src/core/tempo/index.js';
import { Tempo } from '../src/model/tempo.js';

/** The slowest marking the library holds: one beat every ten minutes. */
const MIN_BPM = 0.1;

describe('the tempo floor is the same on both surfaces', () => {
  it('accepts the slowest marking and refuses anything under it', () => {
    expect(Tempo.of(MIN_BPM).bpm).toBe(MIN_BPM);
    expect(() => Tempo.of(MIN_BPM - 0.01)).toThrow(InvalidInputError);
    expect(() => Tempo.of(Number.MIN_VALUE)).toThrow(InvalidInputError);
    expect(() => beatsToSeconds(1, [{ startBeat: 0, bpm: MIN_BPM - 0.01 }])).toThrow(
      InvalidInputError,
    );
    expect(beatsToSeconds(1, [{ startBeat: 0, bpm: MIN_BPM }])).toBe(600);
  });

  it('names bounds a caller can act on', () => {
    // The message reaches whoever is holding the broken project file, so a
    // denormal floor printed as `5e-324` told them nothing they could use.
    expect(() => Tempo.of(0)).toThrow(/\[0\.1, 1000\]/);
  });

  it('keeps every conversion of a validated tempo finite', () => {
    for (const bpm of [MIN_BPM, 0.5, 1, 120, 999, 1000]) {
      const tempo = Tempo.of(bpm);
      for (const beat of [-8, 0, 1, 1024]) {
        expect(Number.isFinite(tempo.secondsAt(beat))).toBe(true);
        expect(Number.isFinite(tempo.beatAtSeconds(tempo.secondsAt(beat)))).toBe(true);
        expect(tempo.beatAtSeconds(tempo.secondsAt(beat))).toBeCloseTo(beat, 6);
      }
      expect(Number.isFinite(tempo.secondsOf(64))).toBe(true);
      const map: TempoMap = [{ startBeat: 0, bpm }];
      expect(Number.isFinite(beatsToSeconds(1024, map))).toBe(true);
      expect(Number.isFinite(secondsToBeats(3600, map))).toBe(true);
    }
  });
});
