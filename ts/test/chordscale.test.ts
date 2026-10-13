import { describe, expect, it } from 'vitest';
import {
  type Chord,
  chordPitchClasses,
  chordQualities,
  displacedThirds,
  makeChord,
} from '../src/theory/chord/index.js';
import {
  availableTensions,
  avoidNotes,
  scaleMatchesChord,
  scalesForChanges,
} from '../src/theory/chordscale/index.js';
import { NAMED_SCALES } from '../src/theory/scale/index.js';

/**
 * The named-scale masks keyed by plain string: a chord-scale match names its
 * scale as text, so the lookups here are made by a name the table may not hold.
 */
const SCALE_MASKS: ReadonlyMap<string, number> = new Map(Object.entries(NAMED_SCALES));

/** Pitch-class set of a named scale rooted on `rootPc`. */
function scalePitchClasses(name: string, rootPc: number): Set<number> {
  const mask = SCALE_MASKS.get(name);
  const pcs = new Set<number>();
  if (mask === undefined) {
    return pcs;
  }
  for (let n = 0; n < 12; n += 1) {
    if (((mask >> n) & 1) === 1) {
      pcs.add((rootPc + n) % 12);
    }
  }
  return pcs;
}

/** Every built-in chord quality on every root: the whole chord vocabulary. */
function everyChord(): Chord[] {
  const chords: Chord[] = [];
  for (const quality of chordQualities()) {
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      chords.push(makeChord(rootPc, quality));
    }
  }
  return chords;
}

const SCALE_NAMES = Object.keys(NAMED_SCALES);

/**
 * Whether the chord-scale rules read this pair at all. A scale that does not
 * contain the chord has neither avoid notes nor tensions over it; the altered
 * scale is the documented exception, read over an ordinary dominant seventh
 * whose perfect fifth it does not contain.
 */
function analysed(chord: Chord, name: string): boolean {
  const mask = SCALE_MASKS.get(name) ?? 0;
  return (
    scaleMatchesChord(chordPitchClasses(chord), mask, chord.rootPc) ||
    (chord.quality === 'dom7' && name === 'altered')
  );
}

describe('suspended chords', () => {
  it('reports the displaced third the same way for every suspension in the vocabulary', () => {
    // Structural, not a list of quality names: the subject is every chord the
    // library reads as suspending its third, whichever tone stands there. It
    // used to be every chord sounding a fourth, which quietly left the whole
    // `sus2` family out of the sweep — and the `sus2` family was where the rule
    // was wrong.
    const failures: string[] = [];
    let swept = 0;
    for (const chord of everyChord()) {
      const displaced = displacedThirds(chord);
      if (displaced.length === 0) {
        continue;
      }
      swept += 1;
      // Both thirds, not one: a suspension does not say which it displaced.
      for (const third of displaced) {
        for (const name of SCALE_NAMES) {
          const tensions = availableTensions(chord, name);
          const avoid = avoidNotes(chord, name);
          const inScale = scalePitchClasses(name, chord.rootPc).has(third);
          if (tensions.includes(third)) {
            failures.push(`${chord.quality}@${chord.rootPc}/${name}: third offered as a tension`);
          }
          if (inScale && analysed(chord, name) && !avoid.includes(third)) {
            failures.push(`${chord.quality}@${chord.rootPc}/${name}: third not avoided`);
          }
        }
      }
    }
    // The sweep has to have found suspensions, and both families of them.
    expect(swept).toBeGreaterThan(0);
    expect(displacedThirds(makeChord(0, 'sus2'))).toHaveLength(2);
    expect(displacedThirds(makeChord(0, 'sus4'))).toHaveLength(2);
    expect(failures).toEqual([]);
  });

  it('leaves a chord that states its own third alone', () => {
    // The rule reads the tones, so a chord with a third keeps the plain
    // semitone-above rule and nothing else.
    expect(avoidNotes(makeChord(0, 'dom7'), 'mixolydian')).toEqual([5]);
    expect(displacedThirds(makeChord(0, 'dom7'))).toEqual([]);
  });
});

describe('scalesForChanges', () => {
  it('returns one choice per chord, rooted on each chord root', () => {
    const chords = [makeChord(2, 'min7'), makeChord(7, 'dom7'), makeChord(0, 'maj7')];
    const choices = scalesForChanges(chords);
    expect(choices).toHaveLength(chords.length);
    choices.forEach((choice, i) => {
      expect(choice.chord).toBe(chords[i]);
      expect(choice.scale.rootPc).toBe(chords[i]?.rootPc);
    });
  });
});
