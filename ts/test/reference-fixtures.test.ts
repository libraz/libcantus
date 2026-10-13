import { describe, expect, it } from 'vitest';
import { Score } from '../src/model/score.js';
import {
  SAME_STRUCTURE_SONG,
  SOURCE_SONG,
  TRANSPOSED_SONG,
  UNRELATED_SONG,
} from './support/reference-fixtures.js';

const FIXTURES = [SOURCE_SONG, SAME_STRUCTURE_SONG, TRANSPOSED_SONG, UNRELATED_SONG];

describe('reference fixtures', () => {
  for (const fixture of FIXTURES) {
    it(`reads the hand-annotated phrase boundaries of ${fixture.name}`, () => {
      const score = Score.of(fixture.notes, { meters: fixture.meters, key: fixture.key });
      const phrases = score.phrases();
      const boundaries = [phrases[0]?.startBeat, ...phrases.map((phrase) => phrase.endBeat)];
      expect(boundaries).toEqual(fixture.phraseBoundaries);
    });

    it(`draws the melody of ${fixture.name} from its own notes`, () => {
      const key = (n: { pitch: number; startBeat: number; durationBeat: number }): string =>
        `${n.pitch}@${n.startBeat}+${n.durationBeat}`;
      const all = new Set(fixture.notes.map(key));
      expect(fixture.melody.length).toBeGreaterThan(0);
      expect(fixture.melody.filter((n) => !all.has(key(n)))).toEqual([]);
    });
  }
});
