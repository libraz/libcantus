import { describe, expect, it } from 'vitest';
import type { NoteData } from '../src/index.js';
import {
  DORIAN_MASK,
  formatNote,
  HARMONIC_MINOR_MASK,
  Key,
  keyRelationBetween,
  keySignatureFifths,
  MAJOR_MASK,
  MELODIC_MINOR_MASK,
  majorKey,
  minorKey,
  NAMED_SCALES,
  NATURAL_MINOR_MASK,
  noteToPitchClass,
  relativeKeyOf,
  scaleByName,
  spelledKeyOf,
  spellScale,
  WHOLE_TONE_MASK,
  WORLD_SCALES,
} from '../src/index.js';
import * as theory from '../src/theory/index.js';
import * as scale from '../src/theory/scale/index.js';
import { isSignatureKey } from '../src/theory/scale/index.js';

/** Every scale the library names, the world scales included. */
const ALL_SCALE_NAMES = [...Object.keys(NAMED_SCALES), ...Object.keys(WORLD_SCALES)];

/** The spelled tonic of a key, as it is written. */
function tonicOf(key: { rootPc: number; modeMask12: number }): string {
  return formatNote(spelledKeyOf(key).tonic);
}

/**
 * The tonics a key is written on for a pitch class: those standing between Cb,
 * the tonic of the seven-flat major key, and A#, the tonic of the seven-sharp
 * minor one. E# and B# are outside it, which is why they name no key.
 */
function writtenTonicsOf(rootPc: number): NoteData[] {
  const tonics: NoteData[] = [];
  for (let letter = 0; letter < 7; letter += 1) {
    for (const alter of [-1, 0, 1]) {
      const tonic = { letter, alter };
      const position = keySignatureFifths(tonic, majorKey(rootPc));
      if (noteToPitchClass(tonic) === rootPc && position >= -7 && position <= 10) {
        tonics.push(tonic);
      }
    }
  }
  return tonics;
}

describe('spelledKeyOf', () => {
  it('spells every major key the way its signature is written', () => {
    // Each tonic is the one whose signature is closest to C major: pitch class
    // 1 is Db (five flats), not C# (seven sharps), and pitch class 11 is B
    // (five sharps), not Cb (seven flats).
    expect(Array.from({ length: 12 }, (_, pc) => tonicOf(majorKey(pc)))).toEqual([
      'C',
      'Db',
      'D',
      'Eb',
      'E',
      'F',
      // Pitch class 6 is a genuine tie — F# is +6 and Gb is -6, six accidentals
      // either way — and the scan runs from the flat end, so Gb wins.
      'Gb',
      'G',
      'Ab',
      'A',
      'Bb',
      'B',
    ]);
  });

  it('spells every minor key the way its signature is written', () => {
    // Pitch class 8 is G# (five sharps) rather than Ab (seven flats), and pitch
    // class 10 is Bb (five flats) rather than A# (seven sharps).
    expect(Array.from({ length: 12 }, (_, pc) => tonicOf(minorKey(pc)))).toEqual([
      'C',
      'C#',
      'D',
      // Pitch class 3 is the minor-mode tie: D# is +6 and Eb is -6, so the same
      // flat-end scan gives Eb, which is also the spelling in common use.
      'Eb',
      'E',
      'F',
      'F#',
      'G',
      'G#',
      'A',
      'Bb',
      'B',
    ]);
  });

  it('agrees with the signature the key is written with', () => {
    for (const key of [majorKey(1), majorKey(11), minorKey(8), minorKey(3)]) {
      const spelled = spelledKeyOf(key);
      expect(
        Math.abs(keySignatureFifths(spelled.tonic, key)),
        formatNote(spelled.tonic),
      ).toBeLessThanOrEqual(7);
    }
    expect(keySignatureFifths(spelledKeyOf(majorKey(1)).tonic, majorKey(1))).toBe(-5);
    expect(keySignatureFifths(spelledKeyOf(minorKey(8)).tonic, minorKey(8))).toBe(5);
  });

  it('spells gis moll on G# and keeps the scale it was given', () => {
    // G# harmonic minor is written with G# minor's five sharps and its seventh
    // as an accidental; the mask must come back untouched, not flattened to
    // natural minor and not respelled as Ab.
    for (const mask of [HARMONIC_MINOR_MASK, MELODIC_MINOR_MASK]) {
      const key = { rootPc: 8, modeMask12: mask };
      const spelled = spelledKeyOf(key);
      expect(formatNote(spelled.tonic), `mask ${mask}`).toBe('G#');
      expect(spelled.key).toBe(key);
      expect(spelled.key.modeMask12).toBe(mask);
      expect(keySignatureFifths(spelled.tonic, key)).toBe(5);
    }
    expect(tonicOf(scaleByName('harmonicMinor', 8))).toBe('G#');
  });

  it('answers for a church mode and for a scale with no third', () => {
    // D dorian has a minor third, so it is spelled from the minor circle: D.
    expect(tonicOf({ rootPc: 2, modeMask12: DORIAN_MASK })).toBe('D');
    // The whole-tone scale has a major third and so counts as major; on pitch
    // class 6 that is the major tie again.
    expect(tonicOf({ rootPc: 0, modeMask12: WHOLE_TONE_MASK })).toBe('C');
    expect(tonicOf({ rootPc: 6, modeMask12: WHOLE_TONE_MASK })).toBe('Gb');
    // A mask with neither third — root and fifth alone — falls back to major.
    expect(tonicOf({ rootPc: 7, modeMask12: 0b000010000001 })).toBe('G');
  });

  it('normalises a root outside [0, 11] instead of refusing it', () => {
    expect(tonicOf({ rootPc: -1, modeMask12: MAJOR_MASK })).toBe('B');
    expect(tonicOf({ rootPc: 13, modeMask12: MAJOR_MASK })).toBe('Db');
    expect(tonicOf({ rootPc: -25, modeMask12: NATURAL_MINOR_MASK })).toBe('B');
    // The key still comes back as it was passed, unnormalised root and all.
    expect(spelledKeyOf({ rootPc: -1, modeMask12: MAJOR_MASK }).key.rootPc).toBe(-1);
  });

  it('feeds the key relations', () => {
    for (let pc = 0; pc < 12; pc += 1) {
      for (const key of [majorKey(pc), minorKey(pc)]) {
        const spelled = spelledKeyOf(key);
        const relative = relativeKeyOf(spelled.tonic, spelled.key);
        expect(keyRelationBetween(spelled, relative), formatNote(spelled.tonic)).toBe('relative');
      }
    }
  });

  it('is reachable from the theory and scale barrels', () => {
    expect(formatNote(theory.spelledKeyOf(theory.majorKey(1)).tonic)).toBe('Db');
    expect(formatNote(scale.spelledKeyOf(scale.minorKey(8)).tonic)).toBe('G#');
  });
});

describe('one tonic spelling per key, wherever it is asked for', () => {
  it('spells every scale on every root the same way through the class as through the functions', () => {
    for (const name of ALL_SCALE_NAMES) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        expect(Key.named(name, rootPc).tonic.name, `${name}/${rootPc}`).toBe(
          tonicOf(scaleByName(name, rootPc)),
        );
        expect(Key.of(scaleByName(name, rootPc)).tonic.name, `${name}/${rootPc}`).toBe(
          tonicOf(scaleByName(name, rootPc)),
        );
      }
    }
  });

  it('spells a scale that borrows its signature on the side it reads from', () => {
    // The flat side of these pitch classes is only the shorter signature on
    // paper: it writes the scale with double flats, or with an augmented second
    // where the ear hears a minor third.
    expect(Key.named('altered', 1).noteNames()).toEqual(['C#', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect(Key.named('altered', 6).noteNames()).toEqual(['F#', 'G', 'A', 'Bb', 'C', 'D', 'E']);
    expect(Key.named('mixolydianB13', 1).noteNames()).toEqual([
      'C#',
      'D#',
      'E#',
      'F#',
      'G#',
      'A',
      'B',
    ]);
    expect(Key.named('miyakoBushi', 8).noteNames()).toEqual(['G#', 'A', 'C#', 'D#', 'E']);
    expect(Key.named('marwa', 6).noteNames()).toEqual(['F#', 'G', 'A#', 'B#', 'C#', 'D#', 'E#']);
    expect(Key.named('minorPentatonic', 1).noteNames()).toEqual(['C#', 'E', 'F#', 'G#', 'B']);
  });

  it('leaves a double accidental only where a signature calls for one', () => {
    // A key with a signature of its own keeps the tonic that signature is
    // written on, and its raised degrees are accidentals over it: G# harmonic
    // minor writes F##. Everywhere else, a double accidental means the other
    // written spelling of the tonic should have been taken.
    for (const name of ALL_SCALE_NAMES) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const scaleKey = scaleByName(name, rootPc);
        const chosen = spelledKeyOf(scaleKey).tonic;
        const spelled = spellScale(chosen, scaleKey);
        if (spelled.every((note) => Math.abs(note.alter) < 2) || isSignatureKey(scaleKey)) {
          continue;
        }
        for (const alternative of writtenTonicsOf(rootPc)) {
          expect(
            spellScale(alternative, scaleKey).some((note) => Math.abs(note.alter) >= 2),
            `${name}/${rootPc}: ${formatNote(chosen)} over ${formatNote(alternative)}`,
          ).toBe(true);
        }
      }
    }
  });

  it('names the same tonic in a detection result and in its own rationale', () => {
    // G# harmonic minor, the case where the class API used to print Ab while
    // the rationale beside it said G#.
    const matches = Key.detectMatches([68, 70, 71, 73, 75, 76, 79], { explain: true });
    const best = matches[0];
    expect(best?.key.toString()).toBe('G# harmonic minor');
    for (const match of matches) {
      expect(match.rationale, match.key.toString()).toMatch(
        new RegExp(`^${match.key.tonic.name.replace('#', '\\#')} `),
      );
    }
    // Each runner-up is labelled with the tonic that candidate's own key names.
    const labels = best?.alternatives?.map((rival) => rival.label) ?? [];
    expect(labels.length).toBeGreaterThan(0);
    for (const [index, label] of labels.entries()) {
      expect(label.startsWith(`${matches[index + 1]?.key.tonic.name} `), label).toBe(true);
    }
  });

  it('names one tonic per result for every scale a detection can land on', () => {
    // One reading, one spelling: whatever a caller reads off a match — the key
    // itself, the sentence explaining it, or the label of a runner-up — has to
    // name the same tonic, or the same piece is spelled two ways on one screen.
    let checked = 0;
    for (const name of ALL_SCALE_NAMES) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const pitches = Key.named(name, rootPc)
          .pitchClasses()
          .map((pitchClass) => 60 + pitchClass);
        const matches = Key.detectMatches(pitches, { explain: true });
        const where = `${name}/${rootPc}`;
        for (const match of matches) {
          checked += 1;
          expect(match.rationale, `${where}: ${match.key.toString()}`).toMatch(
            new RegExp(`^${match.key.tonic.name.replace('#', '\\#')} `),
          );
        }
        const labels = matches[0]?.alternatives?.map((rival) => rival.label) ?? [];
        for (const [index, label] of labels.entries()) {
          const rival = matches[index + 1];
          if (rival === undefined) {
            continue;
          }
          expect(label.startsWith(`${rival.key.tonic.name} `), `${where}: ${label}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
