import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  codeBlocks,
  expectedValue,
  markdownFiles,
  namesValue,
  splitComment,
  tsdocExamples,
  withoutComments,
} from './support/doc-examples.js';
import {
  DOCS_EN,
  DOCS_JA,
  PENDING_EXAMPLE_SOURCES,
  ROOT,
  SRC,
  sourceFiles,
} from './support/generate-doc-examples.js';

const english = markdownFiles(DOCS_EN);

const blocksOf = (file: string) => codeBlocks(readFileSync(file, 'utf8'));
const shapeOf = (file: string) => blocksOf(file).map((block) => [block.lang, block.code]);

describe('bilingual guides', () => {
  it('mirrors the English page set', () => {
    expect(markdownFiles(DOCS_JA)).toEqual(english);
  });

  it.each(english)('%s shares its code blocks with the Japanese page', (file) => {
    expect(shapeOf(path.join(DOCS_JA, file))).toEqual(shapeOf(path.join(DOCS_EN, file)));
  });

  // The README pair carries the same examples with translated code comments, so
  // the code is compared with the comments taken out rather than verbatim; the
  // guides under docs/ share their blocks whole and are checked above. Only the
  // English README is executed, so this is what keeps the Japanese one from
  // showing an API that no longer exists.
  it('README.md and README_ja.md carry the same examples', () => {
    const code = (file: string) =>
      blocksOf(path.join(ROOT, file)).map((block) => [block.lang, withoutComments(block.code)]);
    expect(code('README_ja.md')).toEqual(code('README.md'));
  });
});

describe('links', () => {
  const pages = [
    { file: 'README.md', dir: ROOT, lang: 'en' },
    { file: 'README_ja.md', dir: ROOT, lang: 'ja' },
    ...english.map((file) => ({ file, dir: DOCS_EN, lang: 'en' })),
    ...markdownFiles(DOCS_JA).map((file) => ({ file, dir: DOCS_JA, lang: 'ja' })),
  ];

  const targets = (source: string): string[] =>
    [...source.matchAll(/\]\(([^)]+)\)/g)]
      .map((match) => (match[1] as string).split('#')[0] as string)
      .filter((target) => target !== '' && !/^[a-z]+:/.test(target));

  it.each(pages)('$lang/$file resolves its relative links', ({ file, dir }) => {
    const source = readFileSync(path.join(dir, file), 'utf8');
    const broken = targets(source).filter(
      (target) => !existsSync(path.resolve(dir, path.dirname(file), target)),
    );
    expect(broken).toEqual([]);
  });

  it.each(pages)('$lang/$file does not link across languages', ({ file, dir, lang }) => {
    const source = readFileSync(path.join(dir, file), 'utf8');
    const other = lang === 'en' ? 'ja' : 'en';
    expect(targets(source).filter((target) => target.split('/').includes(other))).toEqual([]);
  });
});

describe('TSDoc examples', () => {
  const examplesOf = (file: string) =>
    tsdocExamples(readFileSync(path.join(SRC, file), 'utf8')).filter(
      (block) => block.lang === 'ts',
    );
  const documented = sourceFiles().filter((file) => examplesOf(file).length > 0);

  it('collects the examples the API reference prints', () => {
    // The examples in the sources outnumber the ones in the guides several
    // times over, and every one of them ships: in the reference, in an editor
    // tooltip, and in whatever reads the type declarations. A harness that
    // quietly went back to reading the guides alone would leave all of them
    // unrun, which is what this count is here to catch.
    const pending = new Set(PENDING_EXAMPLE_SOURCES);
    const collected = documented
      .filter((file) => !pending.has(file))
      .flatMap((file) => examplesOf(file));
    expect(collected.length).toBeGreaterThan(200);
  });

  // Every specifier an example imports from, across the whole tree. An example
  // ships in the reference and in the type declarations, where the repository is
  // not on disk, so a path into `src/` reads as a working line and is not one:
  // it resolves here only because the harness writes the generated module inside
  // the repository. The names a published package answers to are read from
  // `exports` rather than listed, so a new subpath is covered the day it is added.
  const IMPORT_SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]/g;
  const subpaths = Object.keys(
    (
      JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
        exports: Record<string, unknown>;
      }
    ).exports,
  );
  const published = new Set(
    subpaths.map((subpath) => path.posix.join('@libraz/libcantus', subpath)),
  );

  it('compares every example against the value it prints', () => {
    // The form a comment takes here is `// value — why`: the value the line
    // publishes, then the reason for it. Reading only the comments that spend
    // their whole length on the value left every explained one unchecked, so an
    // example could print an answer the library had stopped giving. The two
    // readings — what a reader takes as the published value, and what the
    // harness compares against — are held to each other here.
    const unasserted: string[] = [];
    const check = (label: string, code: string): void => {
      for (const line of code.split('\n')) {
        const { comment } = splitComment(line);
        if (comment === null || !namesValue(comment)) {
          continue;
        }
        if (expectedValue(comment) === null) {
          unasserted.push(`${label}: ${comment}`);
        }
      }
    };
    for (const file of documented) {
      for (const block of examplesOf(file)) {
        check(`${file}:${block.line}`, block.code);
      }
    }
    for (const file of english) {
      for (const block of blocksOf(path.join(DOCS_EN, file))) {
        check(`${file}:${block.line}`, block.code);
      }
    }
    expect(unasserted).toEqual([]);
  });

  it('imports the package by name in every example, never the source tree', () => {
    const foreign = documented.flatMap((file) =>
      examplesOf(file).flatMap((block) =>
        [...block.code.matchAll(IMPORT_SPECIFIER)]
          .map((match) => match[1] as string)
          .filter((specifier) => !published.has(specifier) && !specifier.startsWith('node:'))
          .map((specifier) => `${file}:${block.line} imports ${specifier}`),
      ),
    );
    expect(foreign).toEqual([]);
  });

  it('lists no source as pending that has no example to run', () => {
    for (const file of PENDING_EXAMPLE_SOURCES) {
      expect(existsSync(path.join(SRC, file)), `${file} is listed but absent`).toBe(true);
      expect(examplesOf(file).length, `${file} is listed but has no example`).toBeGreaterThan(0);
    }
  });
});
