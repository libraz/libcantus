import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import { tsdocExamples } from './support/doc-examples.js';
import { relativeTo } from './support/signatures.js';
import { SRC } from './support/source-files.js';

/**
 * A published example stands on its own.
 *
 * An `@example` is printed in the API reference and shown on hover, one block
 * at a time, so a reader copies one block and nothing else. The runner bundles
 * the blocks of a file into a single module and merges their imports, which
 * makes a block that imports none of what it calls pass while the version a
 * reader copies throws a `ReferenceError`. This reads each block by itself.
 */
describe('a published example imports what it uses and nothing else', () => {
  /** Every name the package root exports, which is all an example may call. */
  const EXPORTED: ReadonlySet<string> = new Set(Object.keys(api as Record<string, unknown>));

  /** A named import, spanning the lines it may be written across. */
  const NAMED_IMPORT = /import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"][^'"]+['"];?/g;

  /** The name an import binds locally, which an alias renames. */
  function localName(name: string): string {
    const parts = name.split(/\s+as\s+/);
    return (parts[parts.length - 1] ?? name).trim();
  }

  /** One block split into the names it binds and the code that follows them. */
  function readBlock(code: string): { bound: Set<string>; body: string } {
    const bound = new Set<string>();
    for (const match of code.matchAll(NAMED_IMPORT)) {
      for (const name of (match[1] ?? '').split(',')) {
        const local = localName(name);
        if (local !== '') {
          bound.add(local);
        }
      }
    }
    return { bound, body: code.replace(NAMED_IMPORT, '') };
  }

  /**
   * Every identifier the code names in its own right.
   *
   * String literals, member accesses and property names are dropped first: a
   * `Tuning.of(12).edo` names a method of a class it did import, and a
   * `{ tuplet: … }` names a field, so reading either as the free function of
   * the same name would report an import nobody needs. The comments stay,
   * because an expected value written as `// ConsonanceClass.Dissonance` is
   * part of what the example shows.
   */
  function mentions(body: string): Set<string> {
    const code = body
      .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ' ')
      .replace(/\.\s*[A-Za-z_$][\w$]*/g, ' ')
      .replace(/[A-Za-z_$][\w$]*\s*:/g, ' ');
    return new Set(code.match(/[A-Za-z_$][\w$]*/g) ?? []);
  }

  /**
   * The key relations, whose examples are the ones the merged module hid: two
   * of them called the tonic speller while importing a note parser they never
   * used, and ran only because a sibling block in the same file imported the
   * speller.
   */
  const SUBJECT = path.join(SRC, 'theory/scale/relations.ts');

  const blocks = tsdocExamples(readFileSync(SUBJECT, 'utf8'))
    .filter((block) => block.lang === 'ts')
    .map((block) => ({ label: `${relativeTo(SRC, SUBJECT)}:${block.line}`, code: block.code }));

  it('calls nothing it did not import', () => {
    const missing = blocks.flatMap(({ label, code }) => {
      const { bound, body } = readBlock(code);
      return [...mentions(body)]
        .filter((name) => EXPORTED.has(name) && !bound.has(name))
        .map((name) => `${label} calls ${name} without importing it`);
    });

    expect(missing).toEqual([]);
  });

  it('imports nothing it does not use', () => {
    const unused = blocks.flatMap(({ label, code }) => {
      const { bound, body } = readBlock(code);
      const used = mentions(body);
      return [...bound]
        .filter((name) => !used.has(name))
        .map((name) => `${label} imports ${name} without using it`);
    });

    expect(unused).toEqual([]);
  });

  it('reads every block the module publishes rather than a list of them', () => {
    // Without this the checks above would pass by reading no example at all.
    expect(blocks.length).toBeGreaterThan(5);
    expect(EXPORTED.size).toBeGreaterThan(100);
  });
});
