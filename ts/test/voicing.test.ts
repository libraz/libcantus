import { describe, expect, it } from 'vitest';
import type { Chord } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { checkPartWriting, spellVoicing } from '../src/theory/partwriting/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import { isFunctioningLeadingTone } from '../src/theory/tendency/index.js';
import { voiceProgression } from '../src/theory/voicing/index.js';

describe('the leading tone the voicer and the checker share', () => {
  const KEY = majorKey(0);
  const TONIC = makeChord(0, 'maj');
  /** C3 G3 C4 E4: it holds the tonic, drops the leading tone, and resolves nothing. */
  const TONIC_VOICING = [48, 55, 60, 64];

  // Each voicing sounds the key's leading tone in one voice, and every voice
  // moves somewhere other than a semitone up. Where the chord is one the leading
  // tone functions in, that voice is an outer one: an inner voice is allowed the
  // frustrated resolution, which would make the two rows disagree for a reason
  // this case is not about.
  const cases: { name: string; chord: Chord; voicing: number[] }[] = [
    { name: 'V', chord: makeChord(7, 'maj'), voicing: [43, 62, 67, 71] },
    { name: 'V7', chord: makeChord(7, 'dom7'), voicing: [43, 62, 65, 71] },
    { name: 'viio6', chord: makeChord(11, 'dim'), voicing: [50, 62, 65, 71] },
    { name: 'viim7b5', chord: makeChord(11, 'm7b5'), voicing: [50, 62, 65, 71] },
    { name: 'iii', chord: makeChord(4, 'min'), voicing: [52, 59, 64, 67] },
    { name: 'Imaj7', chord: makeChord(0, 'maj7'), voicing: [48, 55, 64, 71] },
    {
      name: 'a minor triad on the seventh degree',
      chord: makeChord(11, 'min'),
      voicing: [50, 62, 66, 71],
    },
  ];

  for (const { name, chord, voicing } of cases) {
    it(`treats ${name} the same way in the search and in the check`, () => {
      const functioning = isFunctioningLeadingTone(chord, KEY);
      const chords = [chord, TONIC];
      const spelled = [voicing, TONIC_VOICING].map((pitches, index) =>
        spellVoicing(pitches, chords[index] ?? TONIC, KEY),
      );
      const unresolved = checkPartWriting(spelled, chords, KEY).some(
        (violation) => violation.kind === 'unresolvedLeadingTone',
      );
      expect(unresolved, `checker on ${name}`).toBe(functioning);
      // The key only ever reaches the search through the same predicate, so a
      // chord the checker leaves alone must voice identically with and without
      // one.
      if (!functioning) {
        expect(voiceProgression(chords, { key: KEY }), `search on ${name}`).toEqual(
          voiceProgression(chords),
        );
      }
    });
  }
});
