import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playability } from '../src/core/instrument/index.js';
import { DRUM_KIT, generateDrums } from '../src/generate/drums/index.js';
import { GROOVE_STYLES, PUBLIC_SECTIONS } from '../src/generate/drums/internal.js';
import { filesUnder, PACKAGE_ROOT, SRC } from './support/source-files.js';

describe('a kit is bounded by the limbs the player has', () => {
  it('asks the reach table in one place, so no entrance can answer alone', () => {
    // What made this a bug was two answers to one question: `reachOf` read the
    // limbs and `canSound` read the raw table. Reading the table anywhere but
    // in the shared helper is how that comes back, whatever the next entrance
    // is, so the lookup itself is what is pinned rather than today's callers.
    const readers = filesUnder(SRC, '.ts').filter((file) =>
      readFileSync(file, 'utf8').includes('.reach['),
    );
    expect(readers.map((file) => relative(PACKAGE_ROOT, file).split(sep).join('/'))).toEqual([
      'src/core/instrument/profile.ts',
    ]);
  });
});

describe('a drum part is a kit take with voices dubbed over it', () => {
  it('writes nothing impossible in any style, section or density', () => {
    for (const style of GROOVE_STYLES) {
      for (const section of PUBLIC_SECTIONS) {
        for (const rhythmic of [0.2, 0.5, 0.8]) {
          const hits = generateDrums({
            bars: 4,
            style,
            section,
            ctx: { bpm: 120, seed: 7, complexity: { rhythmic } },
          });
          const report = playability(hits, DRUM_KIT, 120);
          expect(
            report.issues.filter((issue) => issue.impossible),
            `${style}/${section}/${rhythmic}`,
          ).toEqual([]);
        }
      }
    }
  });
});
