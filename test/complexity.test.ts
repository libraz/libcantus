import { describe, expect, it } from 'vitest';
import { parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { type BassSegment, generateBassLine } from '../src/generate/bass/index.js';
import { type DrumsOptions, generateDrums } from '../src/generate/drums/index.js';
import { generateMotif } from '../src/generate/motif/index.js';
import { ornament } from '../src/generate/ornament/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { generateRhythm } from '../src/generate/rhythm/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const ts = parseTimeSignature('4/4');

/** The dial positions a slider actually visits, not three buckets. */
const DIAL = Array.from({ length: 21 }, (_, index) => index / 20);

const segments: BassSegment[] = [
  { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
  { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
  { startBeat: 8, endBeat: 12, chord: makeChord(5, 'maj') },
  { startBeat: 12, endBeat: 16, chord: makeChord(0, 'maj') },
];

const drums: DrumsOptions = {
  bars: 4,
  bpm: 110,
  style: 'funk',
  section: 'chorus',
  seed: 8,
};

/**
 * Onset positions of a generated part.
 *
 * The property is about when something sounds: filling a hi-hat in can hand an
 * instant from an open hat to a closed one, which changes the voice at an onset
 * that was already there rather than adding one.
 */
function onsetBeats(events: readonly { startBeat: number }[]): number[] {
  return [...new Set(events.map((event) => event.startBeat))].sort((a, b) => a - b);
}

/** ∀ c1 < c2 : events(c1) ⊆ events(c2), over one seed and one path space. */
function expectMonotone(label: string, at: (dial: number) => number[]): void {
  const sets = DIAL.map((dial) => ({ dial, beats: at(dial) }));
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const lower = sets[i];
      const higher = sets[j];
      if (!lower || !higher) {
        continue;
      }
      const present = new Set(higher.beats);
      for (const beat of lower.beats) {
        expect(present.has(beat), `${label}: ${lower.dial} -> ${higher.dial} lost ${beat}`).toBe(
          true,
        );
      }
    }
  }
}

/** How many distinct results the dial produces across its travel. */
function distinctAcrossDial(at: (dial: number) => unknown): number {
  return new Set(DIAL.map((dial) => JSON.stringify(at(dial)))).size;
}

describe('the rhythmic dial is continuous', () => {
  it('moves the drums at more than a handful of positions', () => {
    const counts = DIAL.map(
      (rhythmic) =>
        generateDrums({ ...drums, ctx: { seed: 8, bpm: 110, complexity: { rhythmic } } }).length,
    );
    // The dial used to be read as three buckets, so twenty-one positions gave
    // three answers. Anything near that is a slider that does nothing.
    expect(new Set(counts).size).toBeGreaterThanOrEqual(10);
    expect(counts[0]).toBeLessThan(counts[counts.length - 1] ?? 0);
    // And it never doubles back on itself.
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i], `dial ${DIAL[i]}`).toBeGreaterThanOrEqual(counts[i - 1] ?? 0);
    }
  });

  it('moves the rhythm generator at every step it is given', () => {
    expect(
      distinctAcrossDial((density) => generateRhythm(ts, { ctx: 4, bars: 4, density })),
    ).toBeGreaterThanOrEqual(10);
  });
});

describe('raising a dial only adds material', () => {
  it('holds for the drums', () => {
    expectMonotone('drums', (rhythmic) =>
      onsetBeats(generateDrums({ ...drums, ctx: { seed: 8, bpm: 110, complexity: { rhythmic } } })),
    );
  });

  it('holds for the drums under the ornament dial', () => {
    expectMonotone('drum ornament', (ornamentDial) =>
      onsetBeats(
        generateDrums({
          ...drums,
          ctx: { seed: 8, bpm: 110, complexity: { rhythmic: 0.5, ornament: ornamentDial } },
        }),
      ),
    );
  });

  it('holds for the rhythm generator', () => {
    expectMonotone('rhythm', (density) =>
      generateRhythm(ts, { ctx: 4, bars: 4, density }).map((event) => event.position),
    );
  });

  it('holds for the bass line', () => {
    expectMonotone('bass', (rhythmic) =>
      onsetBeats(
        generateBassLine({
          segments,
          key: cMajor,
          style: 'pop',
          ctx: { seed: 2, complexity: { rhythmic } },
        }),
      ),
    );
  });

  it('holds for an ornament pass', () => {
    const line: NoteEvent[] = Array.from({ length: 16 }, (_, index) => ({
      pitch: 40 + index,
      startBeat: index * 0.5,
      durationBeat: 0.5,
      velocity: 90,
    }));
    const ghosted = (amount: number) =>
      ornament(line, { style: 'ghost', amount, seed: 5 })
        .filter((note) => note.articulation === 'ghost')
        .map((note) => note.startBeat);
    expectMonotone('ornament', ghosted);
    expect(ghosted(0)).toHaveLength(0);
    expect(ghosted(1).length).toBeGreaterThan(0);
  });
});

describe('a dial nobody moved leaves the generator as it was', () => {
  it('keeps the motif on its contour until the ornament dial is raised', () => {
    const plain = generateMotif({ key: cMajor, bars: 2, contour: 'arch', seed: 3 });
    expect(generateMotif({ key: cMajor, bars: 2, contour: 'arch', ctx: 3 })).toEqual(plain);
    const decorated = generateMotif({
      key: cMajor,
      bars: 2,
      contour: 'arch',
      ctx: { seed: 3, complexity: { ornament: 1 } },
    });
    expect(decorated).not.toEqual(plain);
  });

  it('keeps a nudged motif note nudged as the dial rises', () => {
    const at = (dial: number) =>
      generateMotif({
        key: cMajor,
        bars: 4,
        contour: 'ascending',
        ctx: { seed: 6, complexity: { ornament: dial } },
      }).notes.map((note) => note.pitch);
    const straight = at(0);
    // The notes that have left the contour only ever accumulate: a nudge, once
    // taken, is the same nudge at every higher setting.
    let moved = new Set<number>();
    for (const dial of DIAL) {
      const pitches = at(dial);
      const nowMoved = new Set(
        pitches.flatMap((pitch, index) => (pitch === straight[index] ? [] : [index])),
      );
      for (const index of moved) {
        expect(nowMoved.has(index), `dial ${dial} put note ${index} back`).toBe(true);
        expect(pitches[index]).toBe(at(1)[index]);
      }
      moved = nowMoved;
    }
  });
});

describe('the harmonic dial reharmonizes by degrees', () => {
  const progression = (harmonic: number) =>
    generateProgression({
      key: cMajor,
      style: 'idol',
      presetId: 'fourChordPop',
      bars: 8,
      ctx: { seed: 9, complexity: { harmonic } },
    });

  it('leaves the progression alone at zero and reaches every allowed chord at one', () => {
    const secondaries = (harmonic: number) =>
      progression(harmonic).filter((chord) => chord.secondaryDominant).length;
    expect(secondaries(0)).toBe(0);
    expect(secondaries(1)).toBeGreaterThan(secondaries(0.5));
    expect(secondaries(0.5)).toBeGreaterThan(0);
  });

  it('says the same thing as the flag it replaces', () => {
    expect(
      generateProgression({
        key: cMajor,
        style: 'idol',
        presetId: 'fourChordPop',
        bars: 8,
        seed: 9,
        reharmonize: true,
      }),
    ).toEqual(progression(0.5));
  });
});
