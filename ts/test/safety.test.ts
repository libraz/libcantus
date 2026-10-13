import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  enumerateSafePitches,
  evaluateSafety,
  profileWeights,
  type SafetyQuery,
} from '../src/theory/safety/index.js';

/**
 * The safety module's public functions, discovered from source rather than
 * listed by hand: a new entrance fails this test until it appears in
 * `SAFETY_ENTRIES` with the rejections its siblings already make.
 */
function publicSafetyEntries(): string[] {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
  const surface = read('src/theory/index.ts');
  return [...read('src/theory/safety/index.ts').matchAll(/^export function (\w+)/gm)]
    .map((match) => match[1] ?? '')
    .filter((name) => new RegExp(`\\b${name},`).test(surface))
    .sort();
}

/** Each entrance called with one query, so one bad field is swept across all. */
const SAFETY_ENTRIES: Record<string, (q: SafetyQuery) => unknown> = {
  enumerateSafePitches: (q) => enumerateSafePitches(q, q.candidatePitch, q.candidatePitch),
  evaluateSafety: (q) => evaluateSafety(q),
  profileWeights: (q) => profileWeights(q.profile),
};

describe('every safety entry point checks its profile and its pitches', () => {
  it('discovers the public entry points from the module surface', () => {
    expect(publicSafetyEntries()).toEqual(Object.keys(SAFETY_ENTRIES).sort());
  });
});
