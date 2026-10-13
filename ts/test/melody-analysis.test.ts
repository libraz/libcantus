import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MotifRelationKind } from '../src/analyze/melody/index.js';
import { unionMembers } from './support/signatures.js';
import { REPO_ROOT } from './support/source-files.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Rows of the guide's correspondence table, as `[transform, relations]` cells. */
function tableRows(file: string): string[][] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((row) => row.startsWith('|'))
    .map((row) =>
      row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell)))
    .slice(1);
}

/** Names written in backticks, in the order they appear. */
function quoted(text: string): string[] {
  return [...text.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((match) => match[1] as string);
}

describe('the transform / relation correspondence the guide tabulates', () => {
  const transforms = unionMembers(path.join(ROOT, 'src/generate/motif/index.ts'), 'MotifTransform');
  const kinds = unionMembers(
    path.join(ROOT, 'src/analyze/melody/relation.ts'),
    'MotifRelationKind',
  );
  const guides = ['en', 'ja'].map((lang) => ({
    lang,
    file: path.join(REPO_ROOT, 'docs', lang, 'melody-and-motifs.md'),
  }));

  it.each(guides)('$lang tabulates every transform, in the order they are declared', ({ file }) => {
    // The two directions carry different names for the same devices, so the
    // table is the only thing tying them together; deriving both sides from the
    // sources is what stops a new member from being added on one side alone.
    expect(tableRows(file).map((cells) => quoted(cells[0] as string))).toEqual(
      transforms.map((name) => [name]),
    );
  });

  it.each(guides)('$lang names only real relations opposite them', ({ file }) => {
    const named = tableRows(file).flatMap((cells) => quoted(cells[1] as string));
    expect(named.filter((name) => !kinds.includes(name))).toEqual([]);
  });

  it.each(guides)('$lang accounts for every relation somewhere on the page', ({ file }) => {
    const prose = readFileSync(file, 'utf8').replace(/^```[\s\S]*?^```/gm, '');
    const named = new Set(quoted(prose));
    expect(kinds.filter((kind) => !named.has(kind))).toEqual([]);
  });

  /** What each transform's output has to come back from the analysis as. */
  const named: Readonly<Record<string, MotifRelationKind | null>> = {
    transposeDiatonic: 'tonalTransposition',
    transposeChromatic: 'transposition',
    invert: 'inversion',
    retrograde: 'retrograde',
    augment: 'augmentation',
    diminish: 'diminution',
    // A sequence states the cell and then answers it, so its output is two
    // statements rather than one transformed one; the halves are named below.
    // Null is the answer here, not a gap.
    sequence: null,
  };

  /** The relations reached by composing transforms rather than by one of them. */
  const composed: readonly MotifRelationKind[] = ['repetition', 'retrogradeInversion'];

  it('answers for every transform the generator declares', () => {
    // Derived from the union rather than listed twice: a transform added
    // tomorrow arrives here without anybody remembering to bring it.
    expect(Object.keys(named).sort()).toEqual([...transforms].sort());
  });

  it('accounts for every relation the analysis can report', () => {
    const reached = new Set<string>(
      [...Object.values(named), ...composed].filter((kind): kind is MotifRelationKind =>
        Boolean(kind),
      ),
    );
    expect(kinds.filter((kind) => !reached.has(kind))).toEqual([]);
  });
});
