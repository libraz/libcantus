import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeBlocks, markdownFiles, renderTestModule } from './doc-examples.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const DOCS_EN = path.join(ROOT, 'docs/en');
export const DOCS_JA = path.join(ROOT, 'docs/ja');
const OUT = path.resolve(here, '../generated');

/** The English sources whose `ts` blocks are executed, as `label -> absolute path`. */
function sources(): { label: string; file: string }[] {
  return [
    { label: 'README.md', file: path.join(ROOT, 'README.md') },
    ...markdownFiles(DOCS_EN).map((file) => ({
      label: `docs/en/${file}`,
      file: path.join(DOCS_EN, file),
    })),
  ];
}

/**
 * Turn every `ts` block in the English documentation into a vitest module.
 *
 * One module per block: blocks are independent and often import the same
 * symbols, so they cannot share a file. The Japanese pages reuse the same
 * blocks verbatim, which `docs.test.ts` checks.
 */
export default function setup(): void {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  for (const { label, file } of sources()) {
    const source = readFileSync(file, 'utf8');
    codeBlocks(source)
      .filter((block) => block.lang === 'ts')
      .forEach((block, index) => {
        const slug = `${label
          .replace(/^docs\/en\//, '')
          .replace(/\.md$/, '')
          .replace(/[/\\]/g, '-')}-${index + 1}`;
        writeFileSync(
          path.join(OUT, `${slug}.test.ts`),
          renderTestModule(`${label}:${block.line}`, block.code),
        );
      });
  }
}
