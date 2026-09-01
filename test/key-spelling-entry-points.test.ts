import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { augmentedSixthChord, romanToChord } from '../src/analyze/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { formatNote, parseNote } from '../src/core/pitch/index.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import {
  modalInterchangePalette,
  negativeHarmonyMirror,
  substituteChord,
} from '../src/generate/reharmony/index.js';
import { Chord } from '../src/model/chord.js';
import { Key } from '../src/model/key.js';
import { makeChord, type PitchSpelling } from '../src/theory/chord/index.js';
import {
  majorKey,
  minorKey,
  NAMED_SCALES,
  resolveKey,
  scaleByName,
  spelledKeyOf,
} from '../src/theory/scale/index.js';
import { unionMembers } from './support/signatures.js';
import { SRC } from './support/source-files.js';

/**
 * A key names the letters its answers are written with, at every entry point
 * that takes one.
 *
 * The keys that make this visible are the ones whose pitch classes read best
 * from the other side of the circle. An A flat minor reduced to pitch classes
 * and spelled back is a G sharp minor, so a reharmonization asked for in one
 * comes back written in the other — and the chords a caller then prints carry
 * accidentals that key never uses.
 */

/** The keys written on the far side of the circle from what their pitches read as. */
const FAR_SIDE_KEYS = ['Ab minor', 'D# minor', 'Cb major', 'F# major'] as const;

/** Every pitch class, for the sweeps that cover the whole circle. */
const PITCH_CLASSES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** The side of the circle a spelling sits on: -1 flat, 0 natural, +1 sharp. */
function side(alter: number): number {
  return Math.sign(alter);
}

/** Every spelling hint a chord carries, root and bass alike. */
function hintsOf(chord: { rootSpelling?: PitchSpelling; bassSpelling?: PitchSpelling }) {
  return [chord.rootSpelling, chord.bassSpelling].filter(
    (hint): hint is PitchSpelling => hint !== undefined,
  );
}

describe('a reharmonization is spelled on the key it was asked for', () => {
  it('writes every proposal on the side of the circle the key is written on', () => {
    for (const pc of PITCH_CLASSES) {
      for (const key of [Key.major(pc), Key.minor(pc), ...FAR_SIDE_KEYS.map((k) => Key.parse(k))]) {
        const keySide = side(key.tonic.alter);
        if (keySide === 0) {
          // A key written on a natural tonic borrows from both sides — C major
          // takes its Eb from the flat side and B major its C from the natural
          // one — so there is no side for the proposals to agree with.
          continue;
        }
        const proposed = [
          ...modalInterchangePalette(key).map((borrowed) => borrowed.chord),
          ...substituteChord(makeChord((pc + 7) % 12, 'dom7'), key).map((sub) => sub.chord),
          negativeHarmonyMirror(makeChord(pc, 'maj'), key),
        ];
        for (const chord of proposed) {
          for (const hint of hintsOf(chord)) {
            expect(side(hint.alter) * keySide, `${key} spells ${formatNote(hint)}`).toBeGreaterThan(
              -1,
            );
          }
        }
      }
    }
  });

  it('spells a chord on the key tonic the way the key spells its own tonic', () => {
    for (const name of [
      ...FAR_SIDE_KEYS,
      ...PITCH_CLASSES.flatMap((pc) => [Key.major(pc).toString(), Key.minor(pc).toString()]),
    ]) {
      const key = Key.parse(name);
      const rooted = [
        ...modalInterchangePalette(key).map((borrowed) => borrowed.chord),
        ...substituteChord(makeChord(key.scale.rootPc, 'dom7'), key).map((sub) => sub.chord),
      ].filter((chord) => chord.rootPc % 12 === key.scale.rootPc);
      for (const chord of rooted) {
        expect(
          chord.rootSpelling === undefined ? undefined : formatNote(chord.rootSpelling),
          `${key} names its own tonic`,
        ).toBe(key.tonic.name);
      }
    }
  });

  it('answers the class API and the function API alike', () => {
    for (const name of FAR_SIDE_KEYS) {
      const key = Key.parse(name);
      const symbol = 'Eb7';
      expect(Chord.parse(symbol).withKey(key).substitutions(), name).toEqual(
        substituteChord(symbol, key),
      );
      expect(Chord.parse(symbol).withKey(key).modalInterchange(), name).toEqual(
        modalInterchangePalette(key),
      );
      expect(Chord.parse(symbol).withKey(key).negativeHarmony().toJSON(), name).toEqual(
        negativeHarmonyMirror(symbol, key),
      );
    }
  });
});

/**
 * The subject is the scale table, so a scale added to the library is swept
 * without anybody adding it here.
 */
describe('a written tonic has one derivation whatever asks for it', () => {
  it('names the same tonic through every path, for every named scale', () => {
    for (const name of Object.keys(NAMED_SCALES)) {
      for (const pc of PITCH_CLASSES) {
        const scale = scaleByName(name, pc);
        const written = formatNote(spelledKeyOf(scale).tonic);
        const where = `${name} on ${pc}`;
        expect(formatNote(resolveKey(scale).tonic), where).toBe(written);
        expect(Key.of(scale).tonic.name, where).toBe(written);
        const onTonic = modalInterchangePalette(scale)
          .map((borrowed) => borrowed.chord)
          .filter((chord) => chord.rootPc % 12 === pc)
          .map((chord) => (chord.rootSpelling === undefined ? '' : formatNote(chord.rootSpelling)));
        for (const spelled of onTonic) {
          expect(spelled, where).toBe(written);
        }
      }
    }
  });
});

/**
 * The subject is the kinds the family declares, so a fourth augmented sixth
 * would be checked the day it is named.
 */
describe('a chromatic chord named as a symbol is built from the key that named it', () => {
  const KINDS = unionMembers(
    path.join(SRC, 'analyze/functional/augmented-sixth.ts'),
    'AugmentedSixthKind',
  );

  /** The numeral each kind is written as. */
  const SYMBOL_BY_KIND: Readonly<Record<string, string>> = {
    italian: 'It6',
    french: 'Fr6',
    german: 'Ger6',
  };

  it('names a numeral for every kind the family declares', () => {
    // The kinds come from the declaration, so a fourth one leaves this failing
    // until its numeral is named and the check below covers it too.
    expect(Object.keys(SYMBOL_BY_KIND).sort()).toEqual([...KINDS].sort());
  });

  it('builds the same chord from the numeral as from the family', () => {
    for (const name of FAR_SIDE_KEYS) {
      for (const kind of KINDS) {
        const built = augmentedSixthChord(kind as 'italian' | 'french' | 'german', name);
        const symbol = SYMBOL_BY_KIND[kind] ?? '';
        expect(romanToChord(symbol, name), `${symbol} in ${name}`).toEqual(built);
        // The class API names the same letters, whatever order it reads them in.
        expect(
          Key.parse(name)
            .augmentedSixth(kind as 'german')
            .spell()
            .map((tone) => tone.name)
            .sort(),
          `${symbol} in ${name}`,
        ).toEqual((built.toneSpellings ?? []).map((tone) => formatNote(tone)).sort());
      }
    }
  });

  it('builds the Neapolitan its numeral counterpart builds', () => {
    for (const name of FAR_SIDE_KEYS) {
      expect(romanToChord('N6', name), name).toEqual(romanToChord('bII6', name));
    }
  });

  it('spells an applied augmented sixth from the degree the key names', () => {
    // The German sixth of the dominant of Ab minor stands on the b6 of Eb, the
    // dominant the key writes — Cb, not the B those pitch classes read as.
    const applied = romanToChord('Ger6/V', 'Ab minor');
    expect((applied.toneSpellings ?? []).map((tone) => formatNote(tone))).toEqual([
      'Cb',
      'Eb',
      'Gb',
      'A',
    ]);
  });
});

describe('a resolver refuses a key that contradicts itself', () => {
  it('refuses a tonic the scale is not rooted on, in the words the class uses', () => {
    const mismatched = { scale: majorKey(0), tonic: parseNote('F') };
    expect(() => resolveKey(mismatched)).toThrow(InvalidInputError);
    let fromResolver = '';
    let fromClass = '';
    try {
      resolveKey(mismatched);
    } catch (error) {
      fromResolver = (error as Error).message;
    }
    try {
      Key.of(mismatched);
    } catch (error) {
      fromClass = (error as Error).message;
    }
    expect(fromResolver).toBe(fromClass);
    expect(fromResolver).toContain('does not match the scale root pitch class');
  });

  it('refuses a scale form the mask does not hold', () => {
    expect(() => resolveKey({ scale: majorKey(0), variant: 'harmonic' })).toThrow(
      InvalidInputError,
    );
    expect(() => resolveKey({ scale: majorKey(0), variant: 'nonsense' as 'major' })).toThrow(
      InvalidInputError,
    );
    expect(() => Key.of({ scale: majorKey(0), variant: 'harmonic' })).toThrow(InvalidInputError);
  });

  it('leaves a key that agrees with itself exactly as it was', () => {
    for (const pc of PITCH_CLASSES) {
      for (const scale of [majorKey(pc), minorKey(pc)]) {
        const spelled = spelledKeyOf(scale);
        expect(resolveKey(scale)).toEqual(spelled);
        expect(resolveKey({ scale, tonic: spelled.tonic, variant: spelled.variant })).toEqual(
          spelled,
        );
      }
    }
    expect(formatNote(resolveKey('Ab minor').tonic)).toBe('Ab');
    expect(formatNote(resolveKey('G# minor').tonic)).toBe('G#');
  });
});

describe('a harmonization reports the key it worked in, whole', () => {
  const MELODY = [60, 63, 67, 68].map((pitch, index) => ({
    pitch,
    startBeat: index,
    durationBeat: 1,
  }));

  it('reports the key it was handed, spelled as it was handed in', () => {
    for (const name of ['Ab minor', 'G# minor', ...FAR_SIDE_KEYS]) {
      const reported = harmonizeMelody({ melody: MELODY, key: name }).key;
      expect(formatNote(reported.tonic), name).toBe(Key.parse(name).tonic.name);
      expect(reported.scale, name).toEqual(Key.parse(name).scale);
    }
  });

  it('reports a spelled key for an inferred one too', () => {
    const reported = harmonizeMelody({ melody: MELODY }).key;
    expect(formatNote(reported.tonic)).toBe(formatNote(spelledKeyOf(reported.scale).tonic));
  });

  it('reports the key of an empty melody the same way', () => {
    const reported = harmonizeMelody({ melody: [], key: 'Ab minor' }).key;
    expect(formatNote(reported.tonic)).toBe('Ab');
  });
});
