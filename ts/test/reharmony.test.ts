import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SubstitutionType } from '../src/generate/reharmony/index.js';
import { REPO_ROOT } from './support/source-files.js';

describe('the substitution vocabulary is one list', () => {
  /** Every relationship the union declares; a fifth member fails to compile. */
  const DECLARED: Record<SubstitutionType, true> = {
    tritone: true,
    relative: true,
    borrowed: true,
    chromaticMediant: true,
  };

  it('lists the same relationships in the source doc and both guides', () => {
    const read = (file: string) =>
      readFileSync(
        file.startsWith('docs/')
          ? path.join(REPO_ROOT, file)
          : path.join(import.meta.dirname, '..', file),
        'utf8',
      );

    // The bullets of the `substituteChord` TSDoc.
    const documented = [...read('src/generate/reharmony/index.ts').matchAll(/^ \* - `(\w+)`:/gm)]
      .map((match) => match[1] as string)
      .sort();
    expect(documented).toEqual(Object.keys(DECLARED).sort());

    // The relationship table of each guide, whose first column is the type.
    for (const guide of ['docs/en/reharmonization.md', 'docs/ja/reharmonization.md']) {
      const rows = [...read(guide).matchAll(/^\| `(\w+)` \|/gm)]
        .map((match) => match[1] as string)
        .sort();
      expect(rows, guide).toEqual(Object.keys(DECLARED).sort());
    }
  });
});
