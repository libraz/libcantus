import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { filesUnder, SPEC_TESTS, SRC, TESTS } from './support/source-files.js';

/**
 * The budget guards, derived from the sources rather than listed by hand.
 *
 * A guard that is moved behind the allocation it was meant to precede, dropped
 * in a refactor, or renamed still leaves the library compiling and every other
 * test passing — the failure it prevents is a host freezing on an imported
 * file, which no unit test sees unless one asks for it. What makes that
 * catchable is that the subject is read out of the tree: a guard added later is
 * in the check the moment it is written, and one whose label has drifted from
 * what a test names is a guard nothing reaches any more.
 */

/** Every literal label an `assertGenerationBudget` call names, with its module. */
function budgetLabels(): { label: string; rel: string }[] {
  const found: { label: string; rel: string }[] = [];
  for (const file of filesUnder(SRC, '.ts')) {
    const source = readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file);
    for (const match of source.matchAll(/assertGenerationBudget\(([\s\S]*?)\);/g)) {
      const call = match[1] ?? '';
      // The label is the second argument. A call whose label is built from a
      // name the caller passed in carries no literal to look for, and the
      // guard it belongs to is reached through whichever entry point supplies
      // that name — those are covered under the entry point's own label.
      const label = call.match(/,\s*'([^']+)'/);
      if (label?.[1] !== undefined) {
        found.push({ label: label[1], rel });
      }
    }
  }
  return found;
}

/**
 * Guards whose label no test names, and why that is what it should be.
 *
 * An entry here is a statement that the guard cannot be reached with an input
 * a test can build, not that nobody has got round to it. Everything else
 * belongs in a test that gives the guard an estimate over its own cap and reads
 * the label back out of the refusal.
 */
const NOT_REACHED_BY_A_TEST: Readonly<Record<string, string>> = {
  'progression chords': 'the bar count is checked as a positive integer against the same cap first',
  'countermelody pitch candidates':
    'the register is clamped to the MIDI range first, so the widest one is 128 pitches',
  'safe pitch candidates':
    'both bounds are MIDI pitches, so the widest span enumerated is 128 pitches',
  'euclidean pattern steps':
    'the step count is checked as a positive integer against the same cap first',
  'groove template slots':
    'the slot count is checked as a positive integer against the same cap first',
};

describe('every budget guard is reached by a test', () => {
  const labels = budgetLabels();
  const suite = [TESTS, SPEC_TESTS]
    .flatMap((dir) => filesUnder(dir, '.ts'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('finds the guards to check', () => {
    // The scan reads sources rather than a list, so a parser that stopped
    // matching would leave the check below passing over nothing.
    expect(labels.length).toBeGreaterThan(30);
    expect(new Set(labels.map(({ label }) => label)).size).toBeGreaterThan(30);
  });

  it('names every label somewhere in the suite', () => {
    const unreached = [...new Set(labels.map(({ label }) => label))]
      .filter((label) => !(label in NOT_REACHED_BY_A_TEST))
      .filter((label) => !suite.includes(label))
      .sort();
    expect(unreached).toEqual([]);
  });

  it('lists nothing as unreachable that no guard names any more', () => {
    const live = new Set(labels.map(({ label }) => label));
    expect(Object.keys(NOT_REACHED_BY_A_TEST).filter((label) => !live.has(label))).toEqual([]);
  });
});
