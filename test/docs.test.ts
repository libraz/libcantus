import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeBlocks, markdownFiles } from './support/doc-examples.js';
import { DOCS_EN, DOCS_JA, ROOT } from './support/generate-doc-examples.js';

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
  // only the block structure is compared; the guides under docs/ share their
  // blocks verbatim and are checked above.
  it('README.md and README_ja.md carry the same example blocks', () => {
    const shape = (file: string) => blocksOf(path.join(ROOT, file)).map((block) => block.lang);
    expect(shape('README_ja.md')).toEqual(shape('README.md'));
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
