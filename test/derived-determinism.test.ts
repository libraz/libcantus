import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { type BassSegment, generateBassLine } from '../src/generate/bass/index.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import { type DrumsOptions, generateDrums } from '../src/generate/drums/index.js';
import {
  applyGrooveTemplate,
  extractGrooveTemplate,
  humanize,
} from '../src/generate/groove/index.js';
import { generateMotif } from '../src/generate/motif/index.js';
import { ornament } from '../src/generate/ornament/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { generateRhythm } from '../src/generate/rhythm/index.js';
import type { Chord } from '../src/theory/chord/index.js';
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

/** One chord per bar: C, Am, F, G, against which the counter line is written. */
const counterProgression: Chord[] = [
  makeChord(0, 'maj'),
  makeChord(9, 'min'),
  makeChord(5, 'maj'),
  makeChord(7, 'maj'),
];
const counterChordAt = (beat: number): Chord | null =>
  counterProgression[Math.floor(beat / 4) % counterProgression.length] ?? null;

/** Quarter-note lead line, chord tones on the strong beats. */
const counterMelody: NoteEvent[] = [72, 71, 67, 64, 69, 67, 64, 60].map((pitch, i) => ({
  pitch,
  startBeat: i,
  durationBeat: 1,
  velocity: 100,
}));

/** Eighth notes spanning strong and weak positions, with every step a real move. */
const ornamentSource: NoteEvent[] = [60, 62, 64, 62, 60, 65, 64, 60].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
  velocity: 90,
}));

/** A loosely played performance, quantization deviations included, to learn a groove from. */
const grooveSource: NoteEvent[] = [
  { pitch: 36, startBeat: 0.02, durationBeat: 0.5, velocity: 100 },
  { pitch: 42, startBeat: 0.48, durationBeat: 0.5, velocity: 70 },
  { pitch: 38, startBeat: 1.05, durationBeat: 0.5, velocity: 95 },
  { pitch: 42, startBeat: 1.52, durationBeat: 0.5, velocity: 68 },
];

/** Stiff, quantized events the groove template is imposed on before humanizing. */
const grooveTarget: NoteEvent[] = [
  { pitch: 36, startBeat: 0, durationBeat: 0.5, velocity: 100 },
  { pitch: 42, startBeat: 0.5, durationBeat: 0.5, velocity: 70 },
  { pitch: 38, startBeat: 1, durationBeat: 0.5, velocity: 95 },
  { pitch: 42, startBeat: 1.5, durationBeat: 0.5, velocity: 70 },
];

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
  // `rhythm: 'complement'` is the seed-consuming onset strategy (`'follow'`
  // mirrors the melody and, per the generator's own doc, leaves the seed
  // nothing to decide); the default `'pop'` profile favors a run of parallel
  // thirds or sixths and the default `register: 'below'` writes under the melody.
  'countermelody/complement-pop@9': () =>
    generateCounterMelody({
      melody: counterMelody,
      chordAt: counterChordAt,
      key: cMajor,
      rhythm: 'complement',
      profile: 'pop',
      ctx: { seed: 9 },
    }),
  // `profile: 'strict'` swaps in the weights that favor contrary motion over a
  // parallel run, and `register: 'above'` takes the branch that writes over the
  // melody instead of under it — both distinct from the case above.
  'countermelody/complement-strict-above@3': () =>
    generateCounterMelody({
      melody: counterMelody,
      chordAt: counterChordAt,
      key: cMajor,
      rhythm: 'complement',
      profile: 'strict',
      register: 'above',
      ctx: { seed: 3 },
    }),
  // `'ghost'` is eligible on weak positions and scales velocity down.
  'ornament/ghost@6': () =>
    ornament(ornamentSource, { style: 'ghost', amount: 0.6, ctx: { seed: 6 } }),
  // `'slide'` is eligible wherever the line actually moves (any position, strong
  // or weak) and leaves velocity untouched — a different eligibility predicate
  // and a different velocity branch than `'ghost'`.
  'ornament/slide@6': () =>
    ornament(ornamentSource, { style: 'slide', amount: 0.6, ctx: { seed: 6 } }),
  // `extractGrooveTemplate` and `applyGrooveTemplate` are pure functions of their
  // input, with nothing seeded; `humanize` is the seed-consuming step, so the
  // case runs the whole pipeline and pins what the seed decides at the end of it.
  'groove/humanize@2': () => {
    const template = extractGrooveTemplate(grooveSource, ts, 4);
    const grooved = applyGrooveTemplate(grooveTarget, template, ts);
    return humanize(grooved, { ts, ctx: { seed: 2 } });
  },
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
