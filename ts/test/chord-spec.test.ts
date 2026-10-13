import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChordSpec } from '../src/theory/chord/index.js';
import { chordFromSpec, chordSpecIntervals, chordSpecQuality } from '../src/theory/chord/index.js';

/**
 * The public entry points that read a caller's spec, discovered from source so
 * the sweep below cannot fall behind the module. A function is listed here when
 * its first parameter is a `ChordSpec` and the package exports it; a new one
 * fails this test until it is given a row in `SPEC_ENTRIES`.
 */
function publicSpecEntries(): string[] {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
  const surface = read('src/theory/index.ts');
  const declared = ['src/theory/chord/spec.ts', 'src/theory/chord/index.ts'].flatMap((path) => [
    ...read(path).matchAll(/^export function (\w+)\(\s*spec: ChordSpec/gm),
  ]);
  return declared
    .map((match) => match[1] ?? '')
    .filter((name) => new RegExp(`\\b${name},`).test(surface))
    .sort();
}

const SPEC_ENTRIES: Record<string, (input: ChordSpec) => unknown> = {
  chordFromSpec,
  chordSpecIntervals,
  chordSpecQuality,
};

describe('every public entry point that reads a spec checks it first', () => {
  it('discovers the spec-reading entry points from the package surface', () => {
    expect(publicSpecEntries()).toEqual(Object.keys(SPEC_ENTRIES).sort());
  });
});
