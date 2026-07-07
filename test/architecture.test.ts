import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the one-directional layer dependency graph:
 *   core <- theory <- analyze <- generate <- model
 * A module may import only from its own layer or layers to its left.
 */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

const LAYER_ORDER = ['core', 'theory', 'analyze', 'generate', 'model'] as const;
type Layer = (typeof LAYER_ORDER)[number];

function layerOf(file: string): Layer | null {
  const rel = path.relative(SRC, file).split(path.sep);
  return (LAYER_ORDER as readonly string[]).includes(rel[0] ?? '') ? (rel[0] as Layer) : null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;

describe('layer architecture', () => {
  it('never imports from a higher layer', () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const from = layerOf(file);
      if (!from) continue;
      const fromRank = LAYER_ORDER.indexOf(from);
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1] ?? '';
        if (!spec.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), spec);
        const to = layerOf(target);
        if (!to) continue;
        const toRank = LAYER_ORDER.indexOf(to);
        if (toRank > fromRank) {
          violations.push(`${path.relative(SRC, file)} (${from}) -> ${spec} (${to})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
