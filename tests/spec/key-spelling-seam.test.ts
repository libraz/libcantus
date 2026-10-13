import { augmentedSixthChord, spellLine } from '@libraz/libcantus/analyze';
import { formatNote, parseNote } from '@libraz/libcantus/core';
import { Key, Voicing } from '@libraz/libcantus/model';
import {
  enharmonicKeyOf,
  figuredBassRealization,
  resolveKey,
  spellVoicing,
  TRANSPOSING_INSTRUMENTS,
  toChordData,
} from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

/** The keys whose written spelling differs from the one their pitches read as. */
const FAR_SIDE_KEYS = [
  'F# major',
  'C# major',
  'Cb major',
  'Gb major',
  'Ab minor',
  'D# minor',
  'A# minor',
] as const;

/** Every pitch class, for the sweeps that have to cover the whole circle. */
const PITCH_CLASSES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Widest signature a key is written with, in either direction. */
const MAX_CONVENTIONAL_FIFTHS = 7;

describe('a key is spelled by the tonic it was handed in with', () => {
  it('realizes an unfigured bass on the tonic as that key own triad', () => {
    const realized = figuredBassRealization(parseNote('F#'), '', 'F# major');
    expect(realized.notes.map((note) => formatNote(note))).toEqual(['F#', 'A#', 'C#']);
  });

  it('builds a triad in every key the library can spell', () => {
    for (const name of FAR_SIDE_KEYS) {
      const key = Key.parse(name);
      const expected = [1, 3, 5].map((degree) => key.degree(degree).name);
      const realized = figuredBassRealization(key.tonic.data, '', key);
      expect(
        realized.notes.map((note) => formatNote(note)),
        name,
      ).toEqual(expected);
    }
  });

  it('spells a line with the letters the key writes its own scale with', () => {
    const key = Key.parse('Ab minor');
    const spelled = spellLine(
      [60, 61, 63, 65, 68].map((pitch, index) => ({ pitch, startBeat: index, durationBeat: 1 })),
      null,
      key,
    );
    // A flat-side key writes its accidentals as flats: read from the pitch
    // classes instead, the same five notes come back as the sharps of G# minor.
    for (const note of spelled) {
      expect(note.alter, formatNote(note)).toBeLessThanOrEqual(0);
    }
    // The tonic is spelled as the key spells its own tonic.
    expect(formatNote({ letter: spelled[4]?.letter ?? 0, alter: spelled[4]?.alter ?? 0 })).toBe(
      key.tonic.name,
    );
  });

  it('spells an augmented sixth on the flat side of a flat-side key', () => {
    const spelled = Key.parse('Ab minor')
      .augmentedSixth('german')
      .spell()
      .map((note) => note.name);
    expect(spelled).toEqual(['Fb', 'Ab', 'Cb', 'D']);
    const sharpSide = augmentedSixthChord('german', 'F# major');
    expect(sharpSide.toneSpellings?.map((tone) => formatNote(tone))).toEqual([
      'D',
      'F#',
      'A',
      'B#',
    ]);
  });

  it('spells a voicing the same through the class and through the function', () => {
    const pitches = [54, 61, 66, 70];
    for (const pc of PITCH_CLASSES) {
      for (const key of [Key.major(pc), Key.minor(pc)]) {
        for (const symbol of ['F#', 'Gb', 'C', 'Ab']) {
          const chord = toChordData(symbol);
          const viaClass = Voicing.of(pitches)
            .spell(key, symbol)
            .map((note) => note.name);
          const viaFunction = spellVoicing(pitches, chord, key).map((note) => formatNote(note));
          expect(viaClass, `${key} ${symbol}`).toEqual(viaFunction);
        }
      }
    }
  });
});

describe('a key the library derives itself is one that can be written', () => {
  it('keeps a key taken from a scale degree inside the written signatures', () => {
    for (const name of ['blues', 'majorPentatonic', 'minorPentatonic', 'wholeTone', 'major']) {
      for (const pc of PITCH_CLASSES) {
        const key = Key.named(name, pc);
        for (let degree = 1; degree <= key.pitchClasses().length; degree += 1) {
          const derived = key.keyOnDegree(degree);
          expect(Math.abs(derived.fifths), `${key} degree ${degree}`).toBeLessThanOrEqual(
            MAX_CONVENTIONAL_FIFTHS,
          );
        }
      }
    }
  });

  it('writes a transposing part in a signature a player is handed', () => {
    for (const instrument of Object.keys(TRANSPOSING_INSTRUMENTS)) {
      for (const pc of PITCH_CLASSES) {
        for (const key of [Key.major(pc), Key.minor(pc), Key.parse('Cb major')]) {
          const part = key.forInstrument(instrument as keyof typeof TRANSPOSING_INSTRUMENTS);
          expect(Math.abs(part.fifths), `${key} on ${instrument}`).toBeLessThanOrEqual(
            MAX_CONVENTIONAL_FIFTHS,
          );
          expect(part.tonic.pitchClass, `${key} on ${instrument}`).toBe(part.scale.rootPc);
        }
      }
    }
    expect(Key.parse('F# major').forInstrument('clarinetBb').toString()).toBe('Ab major');
  });
});

/**
 * The class layer and the theory layer name the same written spelling.
 *
 * `Key.transpose`, `Key.keyOnDegree` and `Key.forInstrument` all end on the
 * same question — is this key written on this tonic — and the class answered it
 * for itself, under a private name the ownership check could not see. The two
 * answers differed wherever the class's own window disagreed with the theory's:
 * a window drawn from the major and minor keys cuts off the ends of the church
 * modes, so `D# phrygian` written for a B flat clarinet came back on an E sharp
 * the theory layer would have written as an F.
 */
describe('a written spelling is named the same by the class and by the function', () => {
  /** Every mode the library names, which is where the two windows disagree. */
  const MODAL_NAMES = [
    'ionian',
    'dorian',
    'phrygian',
    'lydian',
    'mixolydian',
    'aeolian',
    'locrian',
  ] as const;

  it('respells a transposed key onto the tonic the theory layer writes', () => {
    const offenders: string[] = [];
    for (const name of MODAL_NAMES) {
      for (const pc of PITCH_CLASSES) {
        for (let semitones = -11; semitones <= 11; semitones += 1) {
          const key = Key.named(name, pc).transpose(semitones);
          // Whatever tonic the class settled on, the theory layer agrees the
          // key is written there — or names the one enharmonic it would move to.
          const written = resolveKey(key);
          const other = enharmonicKeyOf(written.tonic, written.scale);
          if (Math.abs(key.fifths) > MAX_CONVENTIONAL_FIFTHS && other !== null) {
            offenders.push(`${name}/${pc} ${semitones} => ${key} (${key.fifths} fifths)`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('writes a transposing part on the tonic the theory layer writes', () => {
    const offenders: string[] = [];
    for (const instrument of Object.keys(TRANSPOSING_INSTRUMENTS)) {
      for (const name of MODAL_NAMES) {
        for (const pc of PITCH_CLASSES) {
          const part = Key.named(name, pc).forInstrument(
            instrument as keyof typeof TRANSPOSING_INSTRUMENTS,
          );
          const written = resolveKey(part);
          const other = enharmonicKeyOf(written.tonic, written.scale);
          if (Math.abs(part.fifths) > MAX_CONVENTIONAL_FIFTHS && other !== null) {
            offenders.push(`${name}/${pc} on ${instrument} => ${part} (${part.fifths} fifths)`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('answers the enharmonic relation in both directions for every mode', () => {
    // The relation is documented to be its own inverse for a key written on its
    // tonic, and the modes are where a window drawn from the major and minor
    // keys made it one-way.
    for (const name of MODAL_NAMES) {
      for (const pc of PITCH_CLASSES) {
        const key = Key.named(name, pc);
        const other = key.enharmonic();
        if (other === null) {
          continue;
        }
        expect(other.enharmonic()?.toString(), `${name}/${pc}`).toBe(key.toString());
      }
    }
  });

  it('reads a subject the tree supplies rather than a list', () => {
    expect(MODAL_NAMES.length * PITCH_CLASSES.length).toBeGreaterThan(80);
    expect(Object.keys(TRANSPOSING_INSTRUMENTS).length).toBeGreaterThan(3);
  });
});
