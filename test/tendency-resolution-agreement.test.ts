/**
 * The voicing search and the part-writing checker state one rule about a
 * tendency tone, so the search must never hand back a progression the checker
 * then reports. The sweep below walks the whole named chord vocabulary rather
 * than a list written by hand, so a quality added to the registry is covered by
 * the same run that publishes it.
 */

import { describe, expect, it } from 'vitest';
import type { Note } from '../src/core/pitch/index.js';
import {
  diatonicLetterOf,
  formatNote,
  noteToPitchClass,
  pitchClassOf,
} from '../src/core/pitch/index.js';
import type { KeyScale } from '../src/core/types.js';
import type { Chord, ChordQuality } from '../src/theory/chord/index.js';
import { chordQualities, makeChord } from '../src/theory/chord/index.js';
import type { PartWritingViolationKind } from '../src/theory/partwriting/index.js';
import { checkPartWriting, spellVoicing } from '../src/theory/partwriting/index.js';
import { majorKey, spelledKeyOf } from '../src/theory/scale/index.js';
import { noteNames, spellChord } from '../src/theory/spelling/index.js';
import { LEADING_TONE_QUALITIES, seventhPcOf } from '../src/theory/tendency/index.js';
import { voiceProgression } from '../src/theory/voicing/index.js';

/** Every major key, so both the sharp and the flat spelling of a degree appear. */
const KEYS = Array.from({ length: 12 }, (_, rootPc) => majorKey(rootPc));

/**
 * The degrees the chord is rooted on: the dominant, which every quality can be
 * heard on as an applied dominant, and the raised seventh, which only the
 * diminished qualities stand on.
 */
function approachDegrees(quality: ChordQuality): number[] {
  return LEADING_TONE_QUALITIES.has(quality) ? [7, 11] : [7];
}

/** The rules a tendency tone breaks when it is left the wrong way. */
const TENDENCY_KINDS: readonly PartWritingViolationKind[] = [
  'unresolvedSeventh',
  'unresolvedLeadingTone',
];

/**
 * Whether the arriving chord gives the seventh of the departing one somewhere to
 * go: it either holds that tone as a common tone, or it sounds the note a
 * written step below it.
 *
 * A step is a letter below, not a semitone below, which is the whole of what
 * this suite is about: the A# of a Bmaj7 is not resolved by the A of a C major
 * triad, because A# to A keeps its letter and is no step at all. Where the
 * arriving chord offers neither, the seventh has no resolution available and
 * there is nothing for the two layers to agree or disagree about.
 */
function offersSeventhResolution(chord: Chord, next: Chord, tonic: Note, key: KeyScale): boolean {
  const seventhPc = seventhPcOf(chord);
  if (seventhPc === undefined) {
    return false;
  }
  const seventh = spellChord(chord, tonic, key).find(
    (note) => noteToPitchClass(note) === seventhPc,
  );
  if (seventh === undefined) {
    return false;
  }
  return spellChord(next, tonic, key).some((note) => {
    if (noteToPitchClass(note) === seventhPc) {
      return true;
    }
    const fall = pitchClassOf(seventhPc - noteToPitchClass(note));
    return diatonicLetterOf(note.letter) === diatonicLetterOf(seventh.letter - 1) && fall <= 2;
  });
}

describe('the search and the checker judge a resolution by the same written interval', () => {
  it('leaves no tendency tone unresolved in any chord the vocabulary names', () => {
    const divergences: string[] = [];
    const covered = new Set<ChordQuality>();
    for (const quality of chordQualities()) {
      for (const key of KEYS) {
        const spelledTonic = spelledKeyOf(key).tonic;
        const tonic = formatNote(spelledTonic);
        for (const degree of approachDegrees(quality)) {
          const chords = [makeChord(key.rootPc + degree, quality), makeChord(key.rootPc, 'maj')];
          const [departing, arriving] = chords as [Chord, Chord];
          if (!offersSeventhResolution(departing, arriving, spelledTonic, key)) {
            continue;
          }
          covered.add(quality);
          const voiced = voiceProgression(chords, { key });
          const spelled = chords.map((chord, index) =>
            spellVoicing(voiced[index] ?? [], chord, key),
          );
          for (const violation of checkPartWriting(spelled, chords, key)) {
            if (TENDENCY_KINDS.includes(violation.kind)) {
              divergences.push(`${quality} on degree ${degree} of ${tonic}: ${violation.kind}`);
            }
          }
        }
      }
    }
    // Every quality that sounds a seventh was actually put to the question, so
    // an empty divergence list means the sweep ran rather than that it skipped.
    const bearsSeventh = chordQualities().filter(
      (quality) => seventhPcOf(makeChord(0, quality)) !== undefined,
    );
    expect([...covered].sort()).toEqual([...bearsSeventh].sort());
    expect(divergences).toEqual([]);
    // Twenty seconds of voicing searches with the machine to itself, and three
    // times that with the rest of the suite running beside it. The budget is
    // for catching a hang, as the suite-wide one is: a sweep that took long
    // enough to reach this is not slow, it is not finishing.
  }, 180_000);
});

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
