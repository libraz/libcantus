/**
 * Every public entrance refuses malformed input as this library's own error.
 *
 * The documented contract is that a caller sees one of the library's error
 * classes for anything it passes in, and that a raw `TypeError` means a bug
 * inside the library rather than a constraint the caller broke. A host branches
 * on that distinction, so an entrance that reads a field off whatever it was
 * given breaks the host's error handling before it says anything about the
 * music.
 *
 * The subject is derived rather than listed: every published function that
 * takes one required argument is called with values a JavaScript caller or a
 * project file can produce. Taking the arity from the function itself is what
 * keeps the sweep honest — an entrance added tomorrow is swept on the run that
 * publishes it, and one that grows a second required argument leaves the sweep
 * by the same reading rather than by a line someone remembered to delete.
 */

import { describe, expect, it } from 'vitest';
import { isLibcantusError } from '../src/core/errors/index.js';
import * as api from '../src/index.js';

/**
 * The malformed values an entrance is offered.
 *
 * All of them are what a JavaScript caller reaches an entrance with: a field
 * that was never set, a JSON null where an object belongs, a hole in an array
 * restored from a file, and the two primitives a mistyped argument arrives as.
 */
const MALFORMED: readonly [string, unknown][] = [
  ['null', null],
  ['undefined', undefined],
  ['an array holding a hole', [null]],
  ['an empty object', {}],
  ['a string', 'x'],
  ['a number', 7],
];

/**
 * Entrances the sweep cannot judge, with the reason each one is exempt.
 *
 * An entry here is a claim about the entrance, not a note that it fails: a
 * function that answers rather than refuses is doing what it says, and the
 * sweep has no way to tell that from its shape alone.
 */
const NOT_A_REJECTION: Readonly<Record<string, string>> = {};

/** Every published function that takes exactly one required argument. */
function singleArgumentEntrances(): [string, (value: unknown) => unknown][] {
  const found: [string, (value: unknown) => unknown][] = [];
  for (const [name, value] of Object.entries(api as Record<string, unknown>)) {
    if (typeof value !== 'function' || /^[A-Z]/.test(name) || value.length !== 1) {
      continue;
    }
    found.push([name, value as (arg: unknown) => unknown]);
  }
  return found.sort(([a], [b]) => a.localeCompare(b));
}

describe('a public entrance refuses malformed input as a stated error', () => {
  const entrances = singleArgumentEntrances();

  it('finds the entrances to sweep', () => {
    // Derived from the package's own exports, so a sweep that stopped matching
    // anything would leave the check below passing over nothing.
    expect(entrances.length).toBeGreaterThan(80);
  });

  it.each(MALFORMED)('rejects %s with an error of this library', (_label, malformed) => {
    const leaked: string[] = [];
    for (const [name, entrance] of entrances) {
      if (name in NOT_A_REJECTION) {
        continue;
      }
      try {
        entrance(malformed);
      } catch (error) {
        if (!isLibcantusError(error)) {
          leaked.push(`${name}: ${(error as Error).constructor.name}`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });

  it('lists nothing as exempt that the sweep no longer reaches', () => {
    // The same decay every allowance list has: an entrance that was renamed or
    // grew a second required argument is described by an entry nobody reads.
    const swept = new Set(entrances.map(([name]) => name));
    expect(Object.keys(NOT_A_REJECTION).filter((name) => !swept.has(name))).toEqual([]);
  });
});
