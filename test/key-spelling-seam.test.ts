import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { augmentedSixthChord, spellLine } from '../src/analyze/index.js';
import { formatNote, parseNote } from '../src/core/pitch/index.js';
import * as api from '../src/index.js';
import { Key } from '../src/model/key.js';
import { Voicing } from '../src/model/voicing.js';
import { figuredBassRealization } from '../src/theory/figured-bass/index.js';
import { spellVoicing } from '../src/theory/partwriting/index.js';
import { toChordData } from '../src/theory/symbol/index.js';
import { TRANSPOSING_INSTRUMENTS } from '../src/theory/transposition/index.js';
import { functionParams, type ParamInfo, sourceFiles } from './support/signatures.js';
import { SRC } from './support/source-files.js';

/**
 * A key crosses into the library carrying the tonic it is written on, and every
 * letter the answer is spelled with is derived from that tonic.
 *
 * The keys that make this visible are the ones whose pitch classes read best
 * from the other side of the circle: an A flat minor and a G sharp minor sound
 * alike, so a layer that reduces a key to its pitch classes and spells one back
 * hands an A flat minor exercise the sharps of a G sharp minor — or, where the
 * two sides differ by more than that, the double accidentals that make a chord
 * unbuildable.
 */

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
 * The convention read off the tree rather than off a list.
 *
 * Reducing a key to its pitch classes stays allowed — a function that asks only
 * which pitches are in the scale needs nothing else, and says so at the place it
 * reduces. What is not allowed is reducing a key and then deriving a tonic back
 * from what is left: that pair is where the caller's A flat minor becomes a G
 * sharp minor, and it is the shape every defect in this area has. So the tonic
 * is derived in exactly one place, the resolver, and an entry point that needs
 * one asks the resolver for it.
 *
 * The subject comes from the declarations, so an entry point added tomorrow is
 * held to the rule without anybody remembering it here.
 */
describe('a key reaching an entry point goes through the one resolver', () => {
  /** Entry points are the functions a caller can reach from the package root. */
  const reachable: ReadonlySet<string> = new Set(
    Object.entries(api as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name),
  );

  /** The source text of each file, indexed the way a parameter names its file. */
  const textByFile = new Map<string, string>(
    sourceFiles().map((file) => [
      path.relative(path.dirname(SRC), file).split(path.sep).join('/'),
      readFileSync(file, 'utf8'),
    ]),
  );

  /** A call to a function, ignoring the doc comments that merely name it. */
  function callsInto(text: string, fn: string): boolean {
    return text
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/)/.test(line))
      .some((line) => new RegExp(`\\b${fn}\\(`).test(line));
  }

  const keyParams: ParamInfo[] = functionParams().filter(
    (param) => param.exported && reachable.has(param.fn) && /\bKeyLike\b/.test(param.type),
  );

  /**
   * The modules that may spell a tonic from bare pitch classes, each with why.
   *
   * Short by design: a module added here without such a reason is a second
   * answer to "how is this key written", which is the split the resolver exists
   * to prevent.
   */
  const SPELLS_ITS_OWN_TONIC: readonly string[] = [
    // Where the reading lives: this is the resolver's own bare-scale branch.
    'src/theory/scale/identity.ts',
    // The function being defined, and the doc examples beside it.
    'src/theory/scale/relations.ts',
    // The key was built here out of pitch classes the detector weighed, so
    // there is no caller's spelling for the reading to lose.
    'src/analyze/detect/index.ts',
  ];

  it('derives a tonic in one place only', () => {
    const offenders = [...textByFile.entries()]
      .filter(([, text]) => callsInto(text, 'spelledKeyOf'))
      .map(([file]) => file)
      .filter((file) => !SPELLS_ITS_OWN_TONIC.includes(file));

    expect(offenders).toEqual([]);
  });

  it('holds no allowance for a module that no longer spells its own tonic', () => {
    const stale = SPELLS_ITS_OWN_TONIC.filter(
      (file) => !callsInto(textByFile.get(file) ?? '', 'spelledKeyOf'),
    );

    expect(stale).toEqual([]);
  });

  it('never derives a tonic inside an entry point that was handed a key', () => {
    const violations = keyParams
      .filter((param) => callsInto(textByFile.get(param.file) ?? '', 'spelledKeyOf'))
      .filter((param) => !SPELLS_ITS_OWN_TONIC.includes(param.file))
      .map(
        (param) =>
          `${param.file}:${param.line} ${param.fn}(${param.param}) spells a tonic of its own instead of resolving the key`,
      );

    expect(violations).toEqual([]);
  });

  it('reads a subject the tree supplies rather than a list', () => {
    // Without this the checks above would pass by measuring nothing at all.
    expect(keyParams.length).toBeGreaterThan(30);
    expect(textByFile.size).toBeGreaterThan(50);
  });
});
