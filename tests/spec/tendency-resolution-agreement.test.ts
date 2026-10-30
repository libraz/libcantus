/**
 * The voicing search and the part-writing checker state one rule about a
 * tendency tone, so the search must never hand back a progression the checker
 * then reports. This file holds the two flat-side cases (Db and Gb major) that
 * every implementation runs; the sweep over the whole chord vocabulary needs
 * internals and lives in ts/test/tendency-resolution-agreement.test.ts.
 */

import {
  checkPartWriting,
  majorKey,
  makeChord,
  noteNames,
  spellChord,
  spelledKeyOf,
  spellVoicing,
  voiceProgression,
} from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

describe('an applied leading-tone seventh on the flat side', () => {
  it.each([
    ['Db', 1, 0, 'Bbb'],
    ['Gb', 6, 5, 'Ebb'],
  ])(
    'spells and resolves its diminished seventh in %s major',
    (_tonicName, tonicPc, rootPc, seventh) => {
      const key = majorKey(tonicPc);
      const dim7 = makeChord(rootPc, 'dim7');
      const chords = [dim7, makeChord(tonicPc, 'maj')];
      // Nine semitones above the root are the chord's seventh, six letters up,
      // so the tone is written as a double flat and can fall the diatonic step
      // the rule asks of a seventh.
      expect(noteNames(spellChord(dim7, spelledKeyOf(key).tonic, key))).toContain(seventh);
      const voiced = voiceProgression(chords, { key });
      const spelled = chords.map((chord, index) => spellVoicing(voiced[index] ?? [], chord, key));
      const written = noteNames(spelled[0] ?? []);
      expect(written.some((name) => name.startsWith(seventh))).toBe(true);
      expect(
        checkPartWriting(spelled, chords, key).map((violation) => violation.kind),
      ).not.toContain('unresolvedSeventh');
    },
  );
});
