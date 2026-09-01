import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * The freeze check: a shared table is shared, so nobody may write to it.
 *
 * The library hands out its vocabularies, masks and profiles as module-level
 * values. One caller mutating one of them changes what every later call in the
 * process reports, and the change survives into unrelated work — the failure
 * arrives far from its cause and reproduces only in the order it first
 * happened.
 *
 * Freezing at the definition is the fix, and the fix is easy to forget for the
 * table added next month. So the subject here is derived: whatever the barrel
 * exports is what gets checked, and a new table is covered without anybody
 * listing it.
 */

/** A value a caller could write into: an array or a plain object. */
function isWritableShape(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

/**
 * Every path within a value that reaches an object which is not frozen.
 *
 * Reported as paths rather than as a count, because a nested array inside a
 * frozen record is the case that is actually missed, and a bare failure count
 * would send the reader looking at the top-level name instead.
 */
function unfrozenPaths(root: unknown, name: string): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, path: string): void => {
    if (!isWritableShape(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    if (!Object.isFrozen(value)) {
      found.push(path);
      // One report per subtree: everything below an unfrozen node is reachable
      // for writing anyway, and listing it all buries the node that matters.
      return;
    }
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, `${path}.${childKey}`);
    }
  };
  visit(root, name);
  return found;
}

/** The runtime values the barrel hands out, excluding functions and classes. */
function exportedTables(): [string, unknown][] {
  return Object.entries(api as Record<string, unknown>)
    .filter(([, value]) => isWritableShape(value))
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Exported tables that are not frozen yet.
 *
 * Every line is a table a caller can write into and change what a later,
 * unrelated call reports. The list is the debt: it is complete when empty.
 */
const UNFROZEN_ALLOWED: readonly string[] = [];

describe('every table the barrel hands out is frozen', () => {
  const tables = exportedTables();

  it('freezes each one deeply', () => {
    const violations = tables
      .flatMap(([name, value]) => unfrozenPaths(value, name))
      .filter((path) => !UNFROZEN_ALLOWED.includes(path));

    expect(violations).toEqual([]);
  });

  it('holds no allowance for a table that is already frozen', () => {
    const offending = new Set(tables.flatMap(([name, value]) => unfrozenPaths(value, name)));
    const stale = UNFROZEN_ALLOWED.filter((path) => !offending.has(path));

    expect(stale).toEqual([]);
  });

  it('reads a subject the barrel supplies rather than a list', () => {
    expect(tables.length).toBeGreaterThan(25);
  });
});
