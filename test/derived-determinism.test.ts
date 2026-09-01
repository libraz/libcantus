import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTimeSignature } from '../src/core/meter/index.js';
import { type BassSegment, generateBassLine } from '../src/generate/bass/index.js';
import { type DrumsOptions, generateDrums } from '../src/generate/drums/index.js';
import { generateMotif } from '../src/generate/motif/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { generateRhythm } from '../src/generate/rhythm/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import { ROOT } from './support/source-files.js';

/**
 * The determinism check: the same seed writes the same part, run after run.
 *
 * The promise a seed makes is that a part can be reproduced — tomorrow, on
 * another machine, from a project file that stores nothing but the seed. A test
 * that calls a generator twice in one process and compares the two results does
 * not measure that: it passes just as happily when the generator draws from a
 * source seeded once per process, or memoizes, or reads the clock and rounds.
 * Both calls see the same accident.
 *
 * So the reference is written down instead. The recorded output is the promise,
 * and a change to it is a change a reader has to approve rather than a diff two
 * calls agree to hide.
 *
 * Regenerate deliberately, never to make a red run green:
 *
 * ```
 * UPDATE_GOLDEN=1 yarn vitest run test/derived-determinism.test.ts
 * ```
 */

const GOLDEN = path.join(ROOT, 'test', 'golden', 'determinism.json');

const cMajor = majorKey(0);
const ts = parseTimeSignature('4/4');

const segments: BassSegment[] = [
  { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
  { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
  { startBeat: 8, endBeat: 12, chord: makeChord(5, 'maj') },
  { startBeat: 12, endBeat: 16, chord: makeChord(0, 'maj') },
];

const drums: DrumsOptions = {
  bars: 2,
  ctx: { bpm: 110, seed: 8 },
  style: 'funk',
  section: 'chorus',
};

/**
 * One recorded generation per seeded entry point.
 *
 * A seed is only worth recording where the generator draws on it, so each case
 * names the seed it fixes; changing one is changing the case.
 *
 * Unlike its siblings, this map is written rather than derived, and it covers
 * some of the seeded entry points rather than all of them. The rest are
 * recorded per algorithm version by the generation-golden check, so nothing is
 * unmeasured today — but that list is written too, and a generator added
 * tomorrow lands in neither until the seeded entry points are read off the
 * tree.
 */
const CASES: Readonly<Record<string, () => unknown>> = {
  'bass/pop@42': () => generateBassLine({ segments, key: cMajor, style: 'pop', ctx: { seed: 42 } }),
  'bass/walking@7': () =>
    generateBassLine({ segments, key: cMajor, style: 'walking', ctx: { seed: 7 } }),
  'drums/funk@8': () => generateDrums(drums),
  'drums/bossa@3': () => generateDrums({ ...drums, style: 'bossa', ctx: { bpm: 96, seed: 3 } }),
  'rhythm/4-4@4': () =>
    generateRhythm(ts, { ctx: { seed: 4, complexity: { rhythmic: 0.5 } }, bars: 2 }),
  'progression/rock@11': () =>
    generateProgression({ key: cMajor, style: 'rock', bars: 4, ctx: { seed: 11 } }),
  'motif@5': () => generateMotif({ key: cMajor, bars: 2, ctx: { seed: 5 } }),
};

/** The recorded outputs, in a form a diff reads. */
function record(): Record<string, unknown> {
  const written: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(CASES)) {
    written[name] = run();
  }
  return written;
}

describe('a seed reproduces its part', () => {
  const produced = record();

  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(path.dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, `${JSON.stringify(produced, null, 2)}\n`);
  }

  it('has a recorded reference to reproduce', () => {
    expect(existsSync(GOLDEN), 'run with UPDATE_GOLDEN=1 to record the reference').toBe(true);
  });

  it.each(Object.keys(CASES))('writes the recorded part for %s', (name) => {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown>;

    expect(name in golden, `${name} is not in the recorded reference`).toBe(true);
    expect(produced[name]).toEqual(golden[name]);
  });

  it('records every case and no others', () => {
    // A case dropped from the code but left in the file stops being checked
    // while the file still suggests it is.
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown>;

    expect(Object.keys(golden).sort()).toEqual(Object.keys(CASES).sort());
  });
});
