import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASS_4_STRING,
  BASS_5_STRING,
  canSound,
  fingeringsFor,
  foldIntoRange,
  GUITAR_DROP_D,
  GUITAR_STANDARD,
  instrumentRange,
  type PercussionProfile,
  type PlayabilityIssueType,
  playability,
} from '../src/core/instrument/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { type BassSegment, generateBassLine } from '../src/generate/bass/index.js';
import { DRUM_NOTES } from '../src/generate/drums/hit.js';
import { DRUM_KIT, generateDrums } from '../src/generate/drums/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import { filesUnder, ROOT, SRC } from './support/source-files.js';

const cMajor = majorKey(0);

/** A quarter note at `startBeat`. */
function note(pitch: number, startBeat: number, durationBeat = 1): NoteEvent {
  return { pitch, startBeat, durationBeat };
}

/** Every issue of one type, in report order. */
function issuesOfType(
  report: ReturnType<typeof playability>,
  type: PlayabilityIssueType,
): ReturnType<typeof playability>['issues'] {
  return report.issues.filter((issue) => issue.type === type);
}

describe('instrument range', () => {
  it('derives the range from the tuning and the fret count', () => {
    // Lowest open string to the top fret of the highest string; nothing about
    // the range is stored, so a retuned or extended neck needs no new case.
    expect(instrumentRange(BASS_4_STRING)).toEqual({ low: 28, high: 43 + 24 });
    expect(instrumentRange(GUITAR_STANDARD)).toEqual({ low: 40, high: 64 + 24 });
  });

  it('reaches the low B on a five-string but not on a four', () => {
    expect(instrumentRange(BASS_5_STRING).low).toBe(23);
    expect(canSound(BASS_5_STRING, 23)).toBe(true);
    expect(canSound(BASS_4_STRING, 23)).toBe(false);
  });

  it('reaches D2 in drop D but not in standard tuning', () => {
    expect(canSound(GUITAR_DROP_D, 38)).toBe(true);
    expect(canSound(GUITAR_STANDARD, 38)).toBe(false);
    expect(instrumentRange(GUITAR_DROP_D).low).toBe(38);
    // Only the lowest string moved; the rest of the neck is unchanged.
    expect(instrumentRange(GUITAR_DROP_D).high).toBe(instrumentRange(GUITAR_STANDARD).high);
  });

  it('names every position that sounds a pitch', () => {
    // A2 sits on the open fifth string and at fret 5 of the sixth.
    expect(fingeringsFor(GUITAR_STANDARD, 45)).toEqual([
      { string: 0, fret: 5 },
      { string: 1, fret: 0 },
    ]);
  });
});

describe('playability layer 1', () => {
  it('reports a note the instrument does not have', () => {
    const report = playability([note(27, 0)], BASS_4_STRING);
    const found = issuesOfType(report, 'noteOutOfRange');
    expect(found).toHaveLength(1);
    expect(found[0]?.layer).toBe(1);
    expect(found[0]?.impossible).toBe(true);
  });

  it('calls a note past the end of the neck impossible, not merely hard', () => {
    // The top string is E4; fret 25 of it would be F5, and the neck has 24.
    const beyond = 64 + 25;
    expect(canSound(GUITAR_STANDARD, beyond)).toBe(false);
    const report = playability([note(beyond, 0)], GUITAR_STANDARD, 60);
    const found = issuesOfType(report, 'noteOutOfRange');
    expect(found).toHaveLength(1);
    expect(found[0]?.impossible).toBe(true);
    expect(found[0]?.layer).toBe(1);
    // Not a matter of tempo or skill: nothing on the third layer fires, and a
    // slower tempo does not make it playable.
    expect(issuesOfType(report, 'tooFast')).toHaveLength(0);
    expect(
      issuesOfType(playability([note(beyond, 0)], GUITAR_STANDARD, 20), 'noteOutOfRange'),
    ).toHaveLength(1);
    // One fret lower is on the instrument, so the neck length is what decides.
    expect(canSound(GUITAR_STANDARD, beyond - 1)).toBe(true);
  });

  it('reports a technique the instrument cannot produce', () => {
    const report = playability(
      [{ pitch: 40, startBeat: 0, durationBeat: 1, articulation: 'flam' }],
      BASS_4_STRING,
    );
    const found = issuesOfType(report, 'articulationUnavailable');
    expect(found).toHaveLength(1);
    expect(found[0]?.layer).toBe(1);
  });

  it('folds an out-of-range pitch up an octave rather than replacing it', () => {
    expect(foldIntoRange(27, BASS_4_STRING)).toBe(39);
    expect(foldIntoRange(15, BASS_4_STRING)).toBe(39);
    // In range already: untouched.
    expect(foldIntoRange(40, BASS_4_STRING)).toBe(40);
    // The pitch class survives the fold, which is why an octave is the answer
    // and a fifth up is not.
    expect(foldIntoRange(27, BASS_4_STRING) % 12).toBe(27 % 12);
  });
});

describe('playability layer 2', () => {
  it('reports two notes that would need the same string at once', () => {
    // E1 and F1 are only on the lowest string, at frets 0 and 1.
    const report = playability([note(28, 0), note(29, 0)], BASS_4_STRING);
    const found = issuesOfType(report, 'stringConflict');
    expect(found).toHaveLength(1);
    expect(found[0]?.layer).toBe(2);
    expect(found[0]?.impossible).toBe(true);
    expect(found[0]?.notes).toEqual([0, 1]);
  });

  it('accepts the same two pitches when they do not overlap', () => {
    const report = playability([note(28, 0), note(29, 1)], BASS_4_STRING);
    expect(issuesOfType(report, 'stringConflict')).toHaveLength(0);
  });

  it('reports a stretch wider than one hand spans', () => {
    // Fret 1 of the lowest string against fret 12 of the highest.
    const report = playability([note(29, 0), note(55, 0)], BASS_4_STRING);
    const found = issuesOfType(report, 'stretchTooWide');
    expect(found).toHaveLength(1);
    expect(found[0]?.layer).toBe(2);
    expect(found[0]?.impossible).toBe(true);
    expect(found[0]?.message).toContain(`${BASS_4_STRING.maxStretch}`);
  });

  it('accepts a stretch inside the span', () => {
    const report = playability([note(29, 0), note(35, 0)], BASS_4_STRING);
    expect(issuesOfType(report, 'stretchTooWide')).toHaveLength(0);
  });

  it('reports more simultaneous strokes than the kit has limbs for', () => {
    // Snare, high tom and ride all want a hand, and there are two.
    const hits = [
      note(DRUM_NOTES.snare, 0, 0.25),
      note(DRUM_NOTES.highTom, 0, 0.25),
      note(DRUM_NOTES.ride, 0, 0.25),
    ];
    const found = issuesOfType(playability(hits, DRUM_KIT), 'limbConflict');
    expect(found).toHaveLength(1);
    expect(found[0]?.layer).toBe(2);
    expect(found[0]?.impossible).toBe(true);
  });

  it('accepts a stroke on each limb at once', () => {
    const hits = [
      note(DRUM_NOTES.kick, 0, 0.25),
      note(DRUM_NOTES.snare, 0, 0.25),
      note(DRUM_NOTES.closedHiHat, 0, 0.25),
      note(DRUM_NOTES.pedalHiHat, 0, 0.25),
    ];
    expect(issuesOfType(playability(hits, DRUM_KIT), 'limbConflict')).toHaveLength(0);
  });
});

describe('a kit is bounded by the limbs the player has', () => {
  /** The same kit played by someone whose left foot is not available. */
  const THREE_LIMB_KIT: PercussionProfile = {
    ...DRUM_KIT,
    name: 'three-limb kit',
    limbs: ['rightHand', 'leftHand', 'rightFoot'],
  };

  it('does not sound a voice only an absent limb reaches', () => {
    // The pedal hi-hat is a left-foot voice and nothing else reaches it, so on
    // this kit it is not a voice at all. Reading `reach` without `limbs` would
    // report it as sounding.
    expect(DRUM_KIT.reach[DRUM_NOTES.pedalHiHat]).toEqual(['leftFoot']);
    expect(canSound(DRUM_KIT, DRUM_NOTES.pedalHiHat)).toBe(true);
    expect(canSound(THREE_LIMB_KIT, DRUM_NOTES.pedalHiHat)).toBe(false);
    // Every other voice is untouched: the kit lost a limb, not its drums.
    expect(canSound(THREE_LIMB_KIT, DRUM_NOTES.kick)).toBe(true);
    expect(canSound(THREE_LIMB_KIT, DRUM_NOTES.snare)).toBe(true);
  });

  it('reports the note the player cannot strike', () => {
    const report = playability([note(DRUM_NOTES.pedalHiHat, 0, 0.25)], THREE_LIMB_KIT);
    const found = issuesOfType(report, 'noteOutOfRange');
    expect(found).toHaveLength(1);
    expect(found[0]?.layer).toBe(1);
    expect(found[0]?.impossible).toBe(true);
    // The four-limb player has the same note under a foot, so nothing is wrong.
    expect(
      issuesOfType(playability([note(DRUM_NOTES.pedalHiHat, 0, 0.25)], DRUM_KIT), 'noteOutOfRange'),
    ).toHaveLength(0);
  });

  it('asks the reach table in one place, so no entrance can answer alone', () => {
    // What made this a bug was two answers to one question: `reachOf` read the
    // limbs and `canSound` read the raw table. Reading the table anywhere but
    // in the shared helper is how that comes back, whatever the next entrance
    // is, so the lookup itself is what is pinned rather than today's callers.
    const readers = filesUnder(SRC, '.ts').filter((file) =>
      readFileSync(file, 'utf8').includes('.reach['),
    );
    expect(readers.map((file) => relative(ROOT, file).split(sep).join('/'))).toEqual([
      'src/core/instrument/profile.ts',
    ]);
  });

  it('keeps the range and the note-by-note answer telling the same story', () => {
    const range = instrumentRange(THREE_LIMB_KIT);
    expect(canSound(THREE_LIMB_KIT, range.low)).toBe(true);
    expect(canSound(THREE_LIMB_KIT, range.high)).toBe(true);
    // A kit with one voice, and no limb to strike it, has nothing in range.
    const unplayable: PercussionProfile = {
      ...DRUM_KIT,
      name: 'no-limb kit',
      limbs: ['rightHand'],
      reach: { [DRUM_NOTES.pedalHiHat]: ['leftFoot'] },
    };
    expect(canSound(unplayable, DRUM_NOTES.pedalHiHat)).toBe(false);
    expect(instrumentRange(unplayable).low).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('playability layer 3', () => {
  /** A twelve-fret leap between two sixteenth notes. */
  const leap = [note(28, 0, 0.25), note(55, 0.25, 0.25)];

  it('stays silent without a tempo', () => {
    const report = playability(leap, BASS_4_STRING);
    expect(issuesOfType(report, 'tooFast')).toHaveLength(0);
    expect(report.issues.every((issue) => issue.layer < 3)).toBe(true);
  });

  it('stays silent at a tempo that leaves time for the shift', () => {
    expect(issuesOfType(playability(leap, BASS_4_STRING, 60), 'tooFast')).toHaveLength(0);
  });

  it('fires once the shift no longer fits in the time available', () => {
    const found = issuesOfType(playability(leap, BASS_4_STRING, 240), 'tooFast');
    expect(found).toHaveLength(1);
    expect(found[0]?.layer).toBe(3);
    // The third layer is degree, not existence: practice moves this one.
    expect(found[0]?.impossible).toBe(false);
  });

  it('fires for a limb asked to strike twice too quickly', () => {
    // Only the right foot reaches the kick, so both strokes are its own.
    const doubles = [note(DRUM_NOTES.kick, 0, 0.125), note(DRUM_NOTES.kick, 0.125, 0.125)];
    expect(issuesOfType(playability(doubles, DRUM_KIT), 'tooFast')).toHaveLength(0);
    expect(issuesOfType(playability(doubles, DRUM_KIT, 60), 'tooFast')).toHaveLength(0);
    expect(issuesOfType(playability(doubles, DRUM_KIT, 300), 'tooFast')).toHaveLength(1);
  });

  it('makes the same passage harder at a higher tempo', () => {
    const slow = playability(leap, BASS_4_STRING, 60).difficulty;
    const fast = playability(leap, BASS_4_STRING, 240).difficulty;
    expect(fast).toBeGreaterThan(slow);
    // The scale is bounded, so a ceiling can be compared against it.
    expect(slow).toBeGreaterThanOrEqual(1);
    expect(fast).toBeLessThanOrEqual(5);
  });

  it('rises with the amount of movement at a fixed tempo', () => {
    const still = [note(40, 0, 1), note(40, 1, 1), note(40, 2, 1), note(40, 3, 1)];
    const roaming = [note(40, 0, 1), note(52, 1, 1), note(41, 2, 1), note(53, 3, 1)];
    expect(playability(roaming, GUITAR_STANDARD, 120).difficulty).toBeGreaterThan(
      playability(still, GUITAR_STANDARD, 120).difficulty,
    );
  });
});

describe('playability placements', () => {
  it('names the string and fret of every note, issues or not', () => {
    const pitches = [28, 45, 55];
    const report = playability(
      pitches.map((pitch, index) => note(pitch, index)),
      BASS_4_STRING,
    );
    expect(report.issues).toEqual([]);
    expect(report.placements).toHaveLength(pitches.length);
    for (const placement of report.placements) {
      const fingering = placement.fingering;
      expect(fingering).toBeDefined();
      if (!fingering) {
        continue;
      }
      // The position sounds the note it was assigned to, and sits on the neck.
      const open = BASS_4_STRING.tuning[fingering.string] ?? Number.NaN;
      expect(open + fingering.fret).toBe(pitches[placement.note]);
      expect(fingering.fret).toBeGreaterThanOrEqual(0);
      expect(fingering.fret).toBeLessThanOrEqual(BASS_4_STRING.frets);
    }
  });

  it('names the limb behind every stroke of a generated groove', () => {
    const hits = generateDrums({
      bars: 2,
      ctx: { bpm: 100, complexity: { rhythmic: 0.5 } },
      style: 'standard',
      section: 'verse',
    });
    const report = playability(hits, DRUM_KIT, 100);
    expect(report.placements).toHaveLength(hits.length);
    for (const placement of report.placements) {
      expect(placement.limb).toBeDefined();
    }
    // The kick is the right foot's and the pedal hi-hat the left's throughout.
    for (const placement of report.placements) {
      const hit = hits[placement.note];
      if (hit?.pitch === DRUM_NOTES.kick) {
        expect(placement.limb).toBe('rightFoot');
      }
      if (hit?.pitch === DRUM_NOTES.pedalHiHat) {
        expect(placement.limb).toBe('leftFoot');
      }
    }
  });
});

describe('generateBassLine against an instrument', () => {
  const segments: BassSegment[] = [
    { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
    { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
  ];

  it('writes only notes a four-string bass has, whatever the octave', () => {
    for (const octave of [0, 1, 2, 3, 4, 8]) {
      for (const style of ['root', 'rootFifth', 'pop', 'walking', 'arpeggio'] as const) {
        for (let seed = 0; seed < 12; seed += 1) {
          const notes = generateBassLine({
            segments,
            key: cMajor,
            style,
            octave,
            ctx: { seed: seed },
            instrument: BASS_4_STRING,
          });
          for (const written of notes) {
            expect(canSound(BASS_4_STRING, written.pitch), `${style}/${octave}/${seed}`).toBe(true);
          }
          expect(playability(notes, BASS_4_STRING).issues).toEqual([]);
        }
      }
    }
  });

  it('folds the register instead of dropping or replacing notes', () => {
    for (const octave of [0, 1]) {
      const plain = generateBassLine({
        segments,
        key: cMajor,
        octave,
        style: 'pop',
        ctx: { seed: 4 },
      });
      const fitted = generateBassLine({
        segments,
        key: cMajor,
        octave,
        style: 'pop',
        ctx: { seed: 4 },
        instrument: BASS_4_STRING,
      });
      expect(fitted).toHaveLength(plain.length);
      expect(fitted.map((n) => n.startBeat)).toEqual(plain.map((n) => n.startBeat));
      expect(fitted.map((n) => n.durationBeat)).toEqual(plain.map((n) => n.durationBeat));
      // Pitch classes survive: the line is the same line, an octave or two up.
      expect(fitted.map((n) => n.pitch % 12)).toEqual(plain.map((n) => n.pitch % 12));
    }
  });

  it('reaches lower on a five-string than on a four', () => {
    const low = { segments, key: cMajor, octave: 0, style: 'root' as const };
    const four = generateBassLine({ ...low, instrument: BASS_4_STRING });
    const five = generateBassLine({ ...low, instrument: BASS_5_STRING });
    expect(Math.min(...five.map((n) => n.pitch))).toBeLessThan(
      Math.min(...four.map((n) => n.pitch)),
    );
  });
});

describe('an explicit request outranks a difficulty ceiling', () => {
  it('emits every pulse of a named Euclidean kick however hard it is to play', () => {
    const bpm = 300;
    const hits = generateDrums({
      bars: 1,
      ctx: { bpm: bpm, complexity: { rhythmic: 0.5 } },
      style: 'standard',
      section: 'chorus',
      euclideanKick: { pulses: 16, steps: 16 },
    });
    const kicks = hits.filter((hit) => hit.pitch === DRUM_NOTES.kick);
    // The caller named this pattern, so all sixteen onsets are there.
    expect(kicks).toHaveLength(16);
    // And it really is past what a foot can do at this tempo — the report says
    // so, and says so without having changed a single onset.
    const report = playability(kicks, DRUM_KIT, bpm);
    expect(issuesOfType(report, 'tooFast').length).toBeGreaterThan(0);
    expect(report.placements).toHaveLength(kicks.length);
  });
});
