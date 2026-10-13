import { describe, expect, it } from 'vitest';
import { bandFloor, placeRoot } from '../src/generate/bass/internal.js';
import { placeLicks } from '../src/generate/bass/licks.js';
import { BASS_LICKS } from '../src/generate/bass/licks-data.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const KEY = majorKey(0);

const FIRST_SPAN = { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj7') };

const TIMELINE = [
  FIRST_SPAN,
  { startBeat: 4, endBeat: 8, chord: makeChord(9, 'min7') },
  { startBeat: 8, endBeat: 12, chord: makeChord(5, 'maj7') },
  { startBeat: 12, endBeat: 16, chord: makeChord(7, 'dom7') },
];

describe('placeLicks', () => {
  it("leads into a chord change from the figure's own last note", () => {
    // The beat before a chord change is where the line walks into it. The
    // connecting tone was fixed to the head of that beat, so in seven of the
    // nine genres the note that actually sounded into the change was the
    // figure's real final onset a sixteenth or two later — left on whatever
    // template degree it carried, and related to the next chord by nothing.
    const genres = [...new Set(BASS_LICKS.map((lick) => lick.genre))];
    for (const genre of genres) {
      const notes = placeLicks(TIMELINE, KEY, {
        genre,
        ctx: { seed: 1, bpm: 100, complexity: { rhythmic: 0.7 } },
      });
      for (const segment of TIMELINE.slice(1)) {
        const change = segment.startBeat;
        const inLastBeat = notes.filter(
          (note) => note.startBeat > change - 1 - 1e-9 && note.startBeat < change - 1e-9,
        );
        const last = inLastBeat[inLastBeat.length - 1];
        if (last === undefined) {
          // No figure was tiled into that beat, so there is nothing leading.
          continue;
        }
        const bass = placeRoot(
          segment.chord.bassPc ?? segment.chord.rootPc,
          bandFloor(36, undefined),
        );
        const step = Math.abs(last.pitch - bass);
        expect(step, `${genre} into ${change} from ${last.startBeat}`).toBeGreaterThanOrEqual(1);
        expect(step, `${genre} into ${change} from ${last.startBeat}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("takes the figure's final sixteenth as the connecting tone, not the beat before it", () => {
    // The motown figure states its last onset on the third sixteenth of the
    // beat, so that note is the one that leads into the next chord; nothing is
    // introduced ahead of it on the beat it already fills.
    const notes = placeLicks(TIMELINE, KEY, {
      genre: 'motown',
      ctx: { seed: 1, bpm: 100, complexity: { rhythmic: 0.7 } },
    });
    const inLastBeat = (line: readonly { startBeat: number; pitch: number }[]) =>
      line.filter((note) => note.startBeat > 3 - 1e-9 && note.startBeat < 4 - 1e-9);
    const leading = inLastBeat(notes);
    // The same figure with no chord change to lead into, which is the figure's
    // own rhythm: the connecting tone takes over one of these onsets rather
    // than adding one of its own.
    const alone = placeLicks([TIMELINE[0] as (typeof TIMELINE)[number]], KEY, {
      genre: 'motown',
      ctx: { seed: 1, bpm: 100, complexity: { rhythmic: 0.7 } },
    });
    expect(leading.map((note) => note.startBeat)).toEqual(
      inLastBeat(alone).map((note) => note.startBeat),
    );
    const last = leading[leading.length - 1];
    expect(last?.startBeat).toBe(3.5);
    const bass = placeRoot(TIMELINE[1]?.chord.rootPc ?? 0, bandFloor(36, undefined));
    expect(Math.abs((last?.pitch ?? 0) - bass)).toBeLessThanOrEqual(2);
  });
});
