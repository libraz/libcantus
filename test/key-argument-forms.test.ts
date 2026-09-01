import { describe, expect, it } from 'vitest';
import { motifFromNotes, relateMotifs } from '../src/analyze/melody/index.js';
import { Key } from '../src/model/key.js';
import { makeChord } from '../src/theory/chord/index.js';
import { isLeadingToneResolution } from '../src/theory/counterpoint/index.js';
import { checkPartWriting, spellVoicing } from '../src/theory/partwriting/index.js';
import { checkSpecies } from '../src/theory/partwriting/species.js';
import { keySignatureFifths, minorKey } from '../src/theory/scale/index.js';
import { noteNames, spellPitch } from '../src/theory/spelling/index.js';

/**
 * Every entry point that takes a key takes the key a caller actually holds.
 *
 * The contract is checked structurally by the entry-contract test, which reads
 * signatures; this checks it is true when the functions are run — that the
 * three forms a caller has a key in reach the same answer, and that the one
 * carrying a spelling is written against that spelling rather than against the
 * one the library would have chosen for the bare scale.
 *
 * Ab minor is the case worth sweeping: the library spells that scale G# when
 * asked to choose, so a path that quietly reduces the key reports a different
 * key signature than the caller wrote.
 */

/** The three shapes a caller holds a key in, all naming Ab minor. */
const AB_MINOR = {
  scale: minorKey(8),
  name: 'Ab minor',
  instance: Key.minor('Ab'),
} as const;

describe('a key argument is taken in every form a caller has it', () => {
  it('reads the same key from a scale, a name and a Key', () => {
    const fifths = [
      keySignatureFifths('Ab', AB_MINOR.scale),
      keySignatureFifths('Ab', AB_MINOR.name),
      keySignatureFifths('Ab', AB_MINOR.instance),
    ];

    expect(new Set(fifths).size).toBe(1);
  });

  it('answers the counterpoint rule the same from every form', () => {
    const answers = [
      isLeadingToneResolution(67, 68, AB_MINOR.scale),
      isLeadingToneResolution(67, 68, AB_MINOR.name),
      isLeadingToneResolution(67, 68, AB_MINOR.instance),
    ];

    expect(new Set(answers).size).toBe(1);
  });

  it('relates two motifs the same from every form', () => {
    const motif = motifFromNotes(
      [68, 71, 75, 68].map((pitch, index) => ({
        pitch,
        startBeat: index,
        durationBeat: 1,
      })),
    );
    const answers = [
      relateMotifs(motif, motif, AB_MINOR.scale),
      relateMotifs(motif, motif, AB_MINOR.name),
      relateMotifs(motif, motif, AB_MINOR.instance),
    ];

    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
  });

  it('checks a species exercise the same from every form', () => {
    const tonic = AB_MINOR.instance.tonic.data;
    const line = (pitches: readonly number[]) =>
      pitches.map((pitch) => spellPitch(pitch, tonic, AB_MINOR.scale));
    const cantus = line([56, 61, 60, 56]);
    const counter = line([68, 73, 72, 68]);
    const run = (key: Parameters<typeof checkSpecies>[3]) =>
      JSON.stringify(checkSpecies(cantus, counter, 1, key));

    expect(new Set([run(AB_MINOR.scale), run(AB_MINOR.name), run(AB_MINOR.instance)]).size).toBe(1);
  });
});

describe('a spelled voicing follows the key it was handed', () => {
  const chord = makeChord(8, 'min');
  const voicing = [44, 63, 68, 72];

  it('writes flats for a key named on flats', () => {
    const spelled = noteNames(spellVoicing(voicing, chord, AB_MINOR.instance));

    expect(spelled.some((name) => name.includes('b'))).toBe(true);
    expect(spelled.some((name) => name.includes('#'))).toBe(false);
  });

  it('writes what the bare scale reads best when handed no spelling', () => {
    // The counterpart of the case above: with nothing but pitch classes there
    // is no caller spelling to honour, and the library picks. The two differ,
    // which is what makes the case above worth checking.
    const carried = noteNames(spellVoicing(voicing, chord, AB_MINOR.instance));
    const chosen = noteNames(spellVoicing(voicing, chord, AB_MINOR.scale));

    expect(chosen).not.toEqual(carried);
  });

  it('checks the part writing the same from every form', () => {
    const chords = [chord];
    const run = (key: Parameters<typeof checkPartWriting>[2]) =>
      JSON.stringify(checkPartWriting([spellVoicing(voicing, chord, key)], chords, key));

    expect(
      new Set([run(AB_MINOR.scale), run(AB_MINOR.name), run(AB_MINOR.instance)]).size,
    ).toBeLessThanOrEqual(2);
  });
});
