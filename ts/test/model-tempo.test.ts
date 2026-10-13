import { describe, expect, it } from 'vitest';
import { Tempo } from '../src/model/tempo.js';

describe('Tempo as a value', () => {
  it('hands out its plain data as a fresh copy', () => {
    const tempo = Tempo.of(96);
    expect(tempo.data).not.toBe(tempo.data);
    expect(tempo.data).toEqual(tempo.data);
    const taken = tempo.data;
    taken.bpm = 60;
    expect(tempo.bpm).toBe(96);
  });
});
