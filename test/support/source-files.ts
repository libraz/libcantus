import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, as an absolute path. */
export const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

/** The library sources. */
export const SRC = path.join(ROOT, 'src');

/** The test suite. */
export const TESTS = path.join(ROOT, 'test');

/**
 * Every file under `dir` carrying the given extension, recursively, sorted.
 *
 * A check that walks the tree cannot be outrun by a module nobody remembered to
 * list, which is the whole point of the registries built on top of this, so the
 * walk is shared rather than copied into each of them.
 */
export function filesUnder(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...filesUnder(full, extension));
    } else if (entry.endsWith(extension)) {
      found.push(full);
    }
  }
  return found;
}
