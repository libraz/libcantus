import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  codeBlocks,
  markdownFiles,
  renderTestModule,
  renderTestSuite,
  tsdocExamples,
} from './doc-examples.js';
import { filesUnder, ROOT, SRC } from './source-files.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export { ROOT, SRC };
export const DOCS_EN = path.join(ROOT, 'docs/en');
export const DOCS_JA = path.join(ROOT, 'docs/ja');
const OUT = path.resolve(here, '../generated');

/**
 * Source files whose TSDoc examples do not run yet, as paths relative to `src`.
 *
 * Empty, and meant to stay that way: every example the library publishes runs.
 * This list is the whole of what could be left out, so a new file of examples
 * is covered without anyone remembering to add it, and an example that cannot
 * be made to run is a visible line here rather than a silent omission.
 */
export const PENDING_EXAMPLE_SOURCES: readonly string[] = [];

/** Every TypeScript source file, as paths relative to `src`, sorted. */
export function sourceFiles(): string[] {
  return filesUnder(SRC, '.ts').map((file) => path.relative(SRC, file));
}

/** The English sources whose `ts` blocks are executed, as `label -> absolute path`. */
function sources(): { label: string; file: string }[] {
  const pending = new Set(PENDING_EXAMPLE_SOURCES);
  return [
    { label: 'README.md', file: path.join(ROOT, 'README.md') },
    ...markdownFiles(DOCS_EN).map((file) => ({
      label: `docs/en/${file}`,
      file: path.join(DOCS_EN, file),
    })),
    ...sourceFiles()
      .filter((file) => !pending.has(file))
      .map((file) => ({ label: `src/${file}`, file: path.join(SRC, file) })),
  ];
}

/** The `ts` blocks of one source of examples: markdown fences, or TSDoc `@example`. */
function blocksOf(label: string, source: string) {
  const blocks = label.endsWith('.md') ? codeBlocks(source) : tsdocExamples(source);
  return blocks.filter((block) => block.lang === 'ts');
}

/**
 * Turn every `ts` example the library publishes into a vitest module: the
 * fenced blocks of the English guides, and the `@example` blocks of the TSDoc
 * the API reference and every editor tooltip are generated from.
 *
 * One module per source, each block a test of its own inside it, so a failure
 * still names the file and line the example was written on while the library is
 * imported once for the whole source rather than once per example. A source
 * whose blocks bind one name from two different modules cannot share that
 * import and falls back to a module per block. The Japanese pages reuse the
 * same blocks verbatim, which `docs.test.ts` checks.
 */
export default function setup(): void {
  mkdirSync(OUT, { recursive: true });
  const written = new Set<string>();

  for (const { label, file } of sources()) {
    const blocks = blocksOf(label, readFileSync(file, 'utf8'));
    if (blocks.length === 0) continue;
    const slug = label
      .replace(/^docs\/en\//, '')
      .replace(/\.(md|ts)$/, '')
      .replace(/[/\\]/g, '-');
    const examples = blocks.map((block) => ({ label: `${label}:${block.line}`, code: block.code }));
    const suite = renderTestSuite(examples);
    if (suite !== null) {
      const name = `${slug}.test.ts`;
      written.add(name);
      writeFileSync(path.join(OUT, name), suite);
      continue;
    }
    // Snippets whose imports cannot be shared keep a module each.
    examples.forEach((example, index) => {
      const name = `${slug}-${index + 1}.test.ts`;
      written.add(name);
      writeFileSync(path.join(OUT, name), renderTestModule(example.label, example.code));
    });
  }
  // Rewrite in place and drop only what no example claims any more. Emptying
  // the directory first would leave a window in which the suite has no example
  // to collect at all.
  for (const name of readdirSync(OUT)) {
    if (!written.has(name)) rmSync(path.join(OUT, name), { force: true });
  }
}
