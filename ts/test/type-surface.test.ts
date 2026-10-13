import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every type named in a layer's public signatures must be importable from that
 * layer's own subpath. Deriving the check from the sources rather than listing
 * the names by hand is the point: a type that quietly stops being re-exported
 * breaks `import type { X } from '@libraz/libcantus/<layer>'` for consumers of
 * that subpath, and a hand-maintained list never notices.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAYERS = ['core', 'theory', 'analyze', 'generate', 'model'] as const;

describe('every layer names its own public types', () => {
  it('declares a build output for every subpath the exports map advertises', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      exports: Record<
        string,
        string | { import: Record<string, string>; require: Record<string, string> }
      >;
      typesVersions: Record<string, Record<string, string[]>>;
    };
    for (const [subpath, conditions] of Object.entries(pkg.exports)) {
      if (typeof conditions === 'string') {
        // A file exposed verbatim, such as the manifest itself.
        expect(subpath, subpath).toBe(conditions.replace(/^\./, '.'));
        continue;
      }
      expect(conditions.import.types, subpath).toMatch(/\.d\.ts$/);
      expect(conditions.require.types, subpath).toMatch(/\.d\.cts$/);
      expect(conditions.import.default, subpath).toMatch(/\.js$/);
      expect(conditions.require.default, subpath).toMatch(/\.cjs$/);
    }
    for (const layer of LAYERS) {
      expect(Object.keys(pkg.exports)).toContain(`./${layer}`);
      // The pre-`exports` resolver ignores the map entirely and reads this.
      expect(pkg.typesVersions['*']?.[layer], layer).toEqual([`./dist/${layer}/index.d.ts`]);
    }
  });
});
