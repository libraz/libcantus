import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
import { createPositionalRng } from '../src/core/random/index.js';
import { Composer } from '../src/model/composer.js';
import { Score } from '../src/model/score.js';
import { tsdocExamples } from './support/doc-examples.js';
import { ROOT } from './support/source-files.js';

/** A drawn part, for comparing what two composers would generate. */
const part = (composer: Composer) =>
  composer.drums({ bars: 2, style: 'funk', section: 'chorus' }).notes;

describe('comparing two composers', () => {
  const settings = { key: 'C major', bpm: 96, seed: 5 } as const;

  it('answers true for a composer and itself, source and all', () => {
    const composer = Composer.of({ ...settings, rng: createPositionalRng(1) });

    expect(composer.equals(composer)).toBe(true);
  });

  it('answers the same either way round', () => {
    const withSource = Composer.of({ ...settings, rng: createPositionalRng(1) });
    const withoutSource = Composer.of(settings);

    expect(withSource.equals(withoutSource)).toBe(false);
    expect(withoutSource.equals(withSource)).toBe(false);
  });

  it('answers true for a clone of a composer holding a source', () => {
    const composer = Composer.of({ ...settings, rng: createPositionalRng(1) });
    const clone = composer.with({});

    expect(part(clone)).toEqual(part(composer));
    expect(composer.equals(clone)).toBe(true);
    expect(clone.equals(composer)).toBe(true);
  });

  it('answers false for two composers drawing from different sources', () => {
    const one = Composer.of({ ...settings, rng: createPositionalRng(1) });
    const other = Composer.of({ ...settings, rng: createPositionalRng(2) });

    expect(part(one)).not.toEqual(part(other));
    expect(one.equals(other)).toBe(false);
    expect(other.equals(one)).toBe(false);
  });

  it('answers true for two composers built from the same plain settings', () => {
    const composer = Composer.of(settings);

    expect(composer.equals(Composer.of(composer.data))).toBe(true);
    expect(Composer.of(composer.data).equals(composer)).toBe(true);
  });
});

describe('a drum part needs one meter for the whole part', () => {
  const opts = { bars: 4, style: 'standard', section: 'verse' } as const;

  it('writes a part for a composer that stays in 4/4', () => {
    expect(Composer.of({ meters: '4/4' }).drums(opts).notes.length).toBeGreaterThan(0);
  });

  it('refuses a composer whose meter changes rather than laying 4/4 bars over it', () => {
    const composer = Composer.of({
      meters: [
        { startBeat: 0, ts: parseTimeSignature('4/4') },
        { startBeat: 8, ts: parseTimeSignature('3/4') },
      ],
    });

    expect(() => composer.drums(opts)).toThrow(InvalidInputError);
    expect(() => composer.drums(opts)).toThrow(/changes meter/);
  });

  it('refuses a composer in a meter the patterns are not written against', () => {
    expect(() => Composer.of({ meters: '3/4' }).drums(opts)).toThrow(InvalidInputError);
  });
});

describe('the examples on the composer', () => {
  it('import from the package rather than from the source tree', () => {
    const source = readFileSync(path.join(ROOT, 'src', 'model', 'composer.ts'), 'utf8');
    const specifiers = tsdocExamples(source)
      .flatMap((block) => block.code.split('\n'))
      .map((line) => line.match(/^import\s.*\sfrom\s+'([^']+)';?$/)?.[1])
      .filter((specifier): specifier is string => specifier !== undefined);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier, specifier).toMatch(/^@libraz\/libcantus(\/.+)?$/);
    }
  });
});

describe('a pitched part needs a key', () => {
  /** A melody long enough for the harmonizer to read a key off it. */
  const MELODY = [
    { pitch: 67, startBeat: 0, durationBeat: 2 },
    { pitch: 65, startBeat: 2, durationBeat: 2 },
    { pitch: 64, startBeat: 4, durationBeat: 2 },
    { pitch: 62, startBeat: 6, durationBeat: 2 },
    { pitch: 60, startBeat: 8, durationBeat: 4 },
  ];

  /** A composer holding everything but a key. */
  const keyless = () => Composer.of({ bpm: 96, seed: 5 });

  /** Two bars of harmony to write a bass line under. */
  const harmony = () =>
    Composer.of({ key: 'C major', seed: 5 }).progression({ style: 'dance', bars: 2 });

  it('refuses a progression rather than writing one in a key nobody named', () => {
    expect(() => keyless().progression({ style: 'dance', bars: 2 })).toThrow(InvalidInputError);
    expect(() => keyless().progression({ style: 'dance', bars: 2 })).toThrow(/names none/);
  });

  it('refuses a bass line rather than writing one in a key nobody named', () => {
    expect(() => keyless().bass(harmony(), { style: 'pop' })).toThrow(InvalidInputError);
  });

  it('refuses a counter line rather than writing one in a key nobody named', () => {
    expect(() => keyless().counterMelody(Score.of(MELODY))).toThrow(InvalidInputError);
  });

  it('names the two ways out of the refusal', () => {
    // A refusal that does not say what to do instead is a dead end: the two
    // ways on are naming the key, and taking the one the harmonizer found.
    let message = '';
    try {
      keyless().bass(harmony(), { style: 'pop' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toMatch(/give it one/);
    expect(message).toMatch(/with\(\{ key \}\)/);
  });

  it('writes a drum part and harmonizes a melody without one', () => {
    // Drums carry no key, and the harmonizer reads one off the melody, so
    // neither has a missing key to refuse over.
    expect(
      keyless().drums({ bars: 2, style: 'funk', section: 'chorus' }).notes.length,
    ).toBeGreaterThan(0);
    expect(keyless().harmonize(Score.of(MELODY)).chords.segments.length).toBeGreaterThan(0);
  });

  it('writes the parts in the key the harmonization found once it is carried', () => {
    const composer = keyless();
    const harmonized = composer.harmonize(Score.of(MELODY));
    const found = harmonized.chords.keys[0]?.key;
    expect(found).toBeDefined();
    const inKey = composer.with({ key: found });
    // The parts written after the key is carried are written in that key, and
    // in the same one the harmonization was: one piece, not two.
    expect(inKey.bass(harmonized.chords, { style: 'pop' }).key()?.data).toEqual(found);
    expect(
      inKey.counterMelody(harmonized.melody, { timeline: harmonized.chords }).key()?.data,
    ).toEqual(found);
    expect(inKey.progression({ style: 'dance', bars: 2 }).keys[0]?.key).toEqual(found);
  });
});
