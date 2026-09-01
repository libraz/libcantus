import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
import { createPositionalRng } from '../src/core/random/index.js';
import { Composer } from '../src/model/composer.js';
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
