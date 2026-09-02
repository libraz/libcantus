import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
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
import { GROOVE_STYLES, PUBLIC_SECTIONS } from '../src/generate/drums/internal.js';
import { Instrument } from '../src/model/instrument.js';
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
  });

  it("refuses a kit whose every voice is out of the player's reach", () => {
    // One voice, and no limb to strike it: there is no instrument here to
    // answer for, so it is refused rather than answered with an empty range.
    const unplayable: PercussionProfile = {
      ...DRUM_KIT,
      name: 'no-limb kit',
      limbs: ['rightHand'],
      reach: { [DRUM_NOTES.pedalHiHat]: ['leftFoot'] },
    };
    expect(() => instrumentRange(unplayable)).toThrow(InvalidInputError);
    expect(() => instrumentRange(unplayable)).toThrow(/within reach/);
    expect(() => canSound(unplayable, DRUM_NOTES.pedalHiHat)).toThrow(InvalidInputError);
    expect(() => Instrument.of(unplayable)).toThrow(InvalidInputError);
    // Give the player the foot that reaches it and the kit is an instrument
    // again, with a range that names a pitch it really sounds.
    const played: PercussionProfile = { ...unplayable, limbs: ['rightHand', 'leftFoot'] };
    expect(instrumentRange(played)).toEqual({
      low: DRUM_NOTES.pedalHiHat,
      high: DRUM_NOTES.pedalHiHat,
    });
  });

  it('reports a finite range for every kit it accepts', () => {
    // The sentinels the range is accumulated from never leave the function: a
    // profile that would return them is not a profile the library takes.
    for (const limbs of [
      DRUM_KIT.limbs,
      ['rightHand', 'leftHand', 'rightFoot'],
      ['rightFoot'],
      ['leftFoot'],
    ] as PercussionProfile['limbs'][]) {
      const kit: PercussionProfile = { ...DRUM_KIT, limbs };
      const range = instrumentRange(kit);
      expect(Number.isFinite(range.low), `${limbs}`).toBe(true);
      expect(Number.isFinite(range.high), `${limbs}`).toBe(true);
      expect(range.low).toBeLessThanOrEqual(range.high);
      expect(canSound(kit, range.low)).toBe(true);
      expect(canSound(kit, range.high)).toBe(true);
    }
  });
});

describe('an instrument is read once, and read whole', () => {
  /** A kit that counts how often anything asks it for its reach table. */
  function countingKit(): { profile: PercussionProfile; reads: () => number } {
    const table = DRUM_KIT.reach;
    let reads = 0;
    const profile: PercussionProfile = { ...DRUM_KIT };
    Object.defineProperty(profile, 'reach', {
      get: () => {
        reads += 1;
        return table;
      },
      enumerable: true,
    });
    return { profile, reads: () => reads };
  }

  /** A run of strokes on a voice the kit sounds. */
  function strokes(count: number): NoteEvent[] {
    return Array.from({ length: count }, (_, index) => note(DRUM_NOTES.snare, index, 0.25));
  }

  it('reads the profile the same number of times whatever the passage costs', () => {
    // What the instrument is does not depend on how long the part is, so the
    // profile is read on the way in and not once more per note: a kit was
    // re-validated — and its reach table walked — for every stroke of a track.
    const brief = countingKit();
    playability(strokes(4), brief.profile);
    const long = countingKit();
    playability(strokes(400), long.profile);
    expect(brief.reads()).toBeGreaterThan(0);
    expect(long.reads()).toBe(brief.reads());
  });

  it('names the field of a profile it will not read a passage against', () => {
    // A profile out of a project file can be missing any field, and a missing
    // one does not fail where it is missing: an absent `maxStretch` made every
    // span comparison false, so a chord no hand can hold read as playable.
    const passage = [note(40, 0), note(52, 0)];
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ polyphony: undefined }, /polyphony/],
      [{ polyphony: 0 }, /polyphony/],
      [{ maxStretch: undefined }, /maxStretch/],
      [{ maxStretch: 1.5 }, /maxStretch/],
      [{ articulations: undefined }, /articulations/],
      [{ articulations: ['slap'] }, /articulations\[0\]/],
      [{ tuning: [] }, /at least one string/],
    ];
    for (const [broken, named] of cases) {
      const profile = { ...BASS_4_STRING, ...broken } as typeof BASS_4_STRING;
      expect(() => playability(passage, profile), JSON.stringify(broken)).toThrow(
        InvalidInputError,
      );
      expect(() => playability(passage, profile), JSON.stringify(broken)).toThrow(named);
    }
  });

  it('refuses a kit a neck was asked for, by whichever face was asked', () => {
    // The function and the class say the same thing about the same profile:
    // a kit has no neck, and neither of them places a pitch on one.
    expect(() => fingeringsFor(DRUM_KIT, DRUM_NOTES.snare)).toThrow(InvalidInputError);
    expect(() => Instrument.of(DRUM_KIT).fingerings(DRUM_NOTES.snare)).toThrow(InvalidInputError);
  });

  it('takes a MIDI pitch where it says it takes one', () => {
    expect(() => canSound(GUITAR_STANDARD, 40.5)).toThrow(InvalidInputError);
    expect(() => canSound(GUITAR_STANDARD, 9000)).toThrow(InvalidInputError);
    expect(() => fingeringsFor(GUITAR_STANDARD, 40.5)).toThrow(InvalidInputError);
    expect(() => foldIntoRange(40.5, GUITAR_STANDARD)).toThrow(InvalidInputError);
    expect(() => Instrument.guitar().canSound(40.5)).toThrow(InvalidInputError);
    expect(() => Instrument.guitar().fingerings(40.5)).toThrow(InvalidInputError);
    expect(() => Instrument.guitar().foldIntoRange(40.5)).toThrow(InvalidInputError);
  });
});

describe('a drum part is a kit take with voices dubbed over it', () => {
  /** The same kit read as a single take, with nothing dubbed over it. */
  const ONE_TAKE: PercussionProfile = { ...DRUM_KIT, overdub: [] };

  /** The groove the kit profile shows as its own example. */
  function exampleGroove(): ReturnType<typeof generateDrums> {
    return generateDrums({
      bars: 1,
      style: 'funk',
      section: 'chorus',
      ctx: { bpm: 120, complexity: { rhythmic: 0.8 } },
    });
  }

  it('sounds a tambourine over a backbeat that already takes both hands', () => {
    const hits = [
      note(DRUM_NOTES.snare, 1, 0.25),
      note(DRUM_NOTES.closedHiHat, 1, 0.25),
      note(DRUM_NOTES.tambourine, 1, 0.25),
    ];
    // The snare is in one hand and the hi-hat in the other, and the tambourine
    // sounds anyway: it is a second pass over the groove, not a third arm.
    expect(issuesOfType(playability(hits, DRUM_KIT), 'limbConflict')).toHaveLength(0);
    expect(issuesOfType(playability(hits, ONE_TAKE), 'limbConflict')).toHaveLength(1);
  });

  it('gives every dubbed voice a take of its own', () => {
    const hits = [
      note(DRUM_NOTES.snare, 1, 0.25),
      note(DRUM_NOTES.closedHiHat, 1, 0.25),
      note(DRUM_NOTES.tambourine, 1, 0.25),
      note(DRUM_NOTES.handClap, 1, 0.25),
      note(DRUM_NOTES.shaker, 1, 0.25),
    ];
    // Three overdubs at one instant are three passes, so they share no hand
    // with the kit and none with each other.
    const report = playability(hits, DRUM_KIT);
    expect(report.issues.filter((issue) => issue.impossible)).toEqual([]);
    for (const placement of report.placements) {
      expect(placement.limb).toBeDefined();
    }
  });

  it('leaves the four limbs the bound on the groove itself', () => {
    const hits = [
      note(DRUM_NOTES.snare, 0, 0.25),
      note(DRUM_NOTES.highTom, 0, 0.25),
      note(DRUM_NOTES.ride, 0, 0.25),
      note(DRUM_NOTES.shaker, 0, 0.25),
    ];
    const found = issuesOfType(playability(hits, DRUM_KIT), 'limbConflict');
    expect(found).toHaveLength(1);
    // Three voices of the kit for two hands is still unplayable, and the
    // shaker is not one of the strokes competing for them.
    expect(found[0]?.notes).toEqual([0, 1, 2]);
  });

  it('does not charge a dubbed stroke to the hand that plays the kit', () => {
    // Hi-hat sixteenths with a shaker between them: one hand playing both would
    // be striking twice too quickly, and the shaker is not that hand's.
    const hits = [
      note(DRUM_NOTES.closedHiHat, 0, 0.25),
      note(DRUM_NOTES.shaker, 0.125, 0.125),
      note(DRUM_NOTES.closedHiHat, 0.25, 0.25),
    ];
    expect(issuesOfType(playability(hits, DRUM_KIT, 240), 'tooFast')).toHaveLength(0);
    expect(issuesOfType(playability(hits, ONE_TAKE, 240), 'tooFast').length).toBeGreaterThan(0);
  });

  it('plays the example groove as recorded, auxiliary layer and all', () => {
    const hits = exampleGroove();
    expect(playability(hits, DRUM_KIT, 120).issues.filter((issue) => issue.impossible)).toEqual([]);
    // Playable with the auxiliary voices sounding, not by having lost them.
    for (const voice of ['handClap', 'tambourine', 'shaker'] as const) {
      expect(
        hits.some((hit) => hit.pitch === DRUM_NOTES[voice]),
        voice,
      ).toBe(true);
    }
    // Read as a single take, the same bar is what one player cannot do alone.
    expect(
      playability(hits, ONE_TAKE, 120).issues.filter((issue) => issue.impossible).length,
    ).toBeGreaterThan(0);
  });

  it('writes nothing impossible in any style, section or density', () => {
    for (const style of GROOVE_STYLES) {
      for (const section of PUBLIC_SECTIONS) {
        for (const rhythmic of [0.2, 0.5, 0.8]) {
          const hits = generateDrums({
            bars: 4,
            style,
            section,
            ctx: { bpm: 120, seed: 7, complexity: { rhythmic } },
          });
          const report = playability(hits, DRUM_KIT, 120);
          expect(
            report.issues.filter((issue) => issue.impossible),
            `${style}/${section}/${rhythmic}`,
          ).toEqual([]);
        }
      }
    }
  });

  it('holds a dubbed voice in a hand like any other', () => {
    const footwork: PercussionProfile = {
      ...DRUM_KIT,
      name: 'pedals only',
      limbs: ['rightFoot', 'leftFoot'],
    };
    // An overdub is a second pass, not a second instrument: the player still
    // has to hold the shaker, so without hands it is not on the kit at all.
    expect(canSound(DRUM_KIT, DRUM_NOTES.shaker)).toBe(true);
    expect(canSound(footwork, DRUM_NOTES.shaker)).toBe(false);
  });

  it('refuses a kit that dubs something that is not a pitch', () => {
    const malformed = { ...DRUM_KIT, name: 'bad kit', overdub: [999] } as PercussionProfile;
    expect(() => canSound(malformed, DRUM_NOTES.kick)).toThrow(/overdub pitch/);
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

describe('simultaneity is the distance between two onsets', () => {
  /** Two onsets a ten-thousandth of a beat apart, either side of a 128th. */
  const STRADDLING = [0.00385, 0.00395] as const;
  /** The same distance, both onsets well inside one 128th of a beat. */
  const TOGETHER = [0.0001, 0.0002] as const;

  /** Two kicks at the given onsets; the right foot is the only limb that reaches. */
  function kickPair([first, second]: readonly [number, number]): NoteEvent[] {
    return [note(DRUM_NOTES.kick, first, 0.25), note(DRUM_NOTES.kick, second, 0.25)];
  }

  /** What a report says, without the onset the two placements differ in. */
  function verdict(report: ReturnType<typeof playability>) {
    return report.issues.map(({ type, notes, impossible }) => ({ type, notes, impossible }));
  }

  it('hears two kicks a ten-thousandth of a beat apart as one foot struck twice', () => {
    const found = issuesOfType(playability(kickPair(STRADDLING), DRUM_KIT), 'limbConflict');
    expect(found).toHaveLength(1);
    expect(found[0]?.impossible).toBe(true);
    expect(found[0]?.notes).toEqual([0, 1]);
  });

  it('answers the same wherever a fixed grid would fall between them', () => {
    // A humanized part lands on no grid, so the two onsets must not be told
    // apart by which cell each one rounds into.
    expect(verdict(playability(kickPair(STRADDLING), DRUM_KIT))).toEqual(
      verdict(playability(kickPair(TOGETHER), DRUM_KIT)),
    );
  });

  it('holds a neck to one hand across the same distance', () => {
    const stretch = (onsets: readonly [number, number]): NoteEvent[] => [
      note(29, onsets[0]),
      note(55, onsets[1]),
    ];
    expect(verdict(playability(stretch(STRADDLING), BASS_4_STRING))).toEqual(
      verdict(playability(stretch(TOGETHER), BASS_4_STRING)),
    );
    expect(
      issuesOfType(playability(stretch(STRADDLING), BASS_4_STRING), 'stretchTooWide'),
    ).toHaveLength(1);
  });
});

describe('a note of no length is not a stroke', () => {
  it('takes no limb on a kit and no hand on a neck', () => {
    // A note-on and note-off at one instant sounds nothing, so it neither takes
    // a limb from the stroke it lands on nor widens the hand that is stopping.
    const strokes = [
      note(DRUM_NOTES.snare, 0, 0.25),
      note(DRUM_NOTES.highTom, 0, 0),
      note(DRUM_NOTES.ride, 0, 0),
    ];
    expect(issuesOfType(playability(strokes, DRUM_KIT), 'limbConflict')).toHaveLength(0);
    expect(issuesOfType(playability(strokes, DRUM_KIT), 'polyphonyExceeded')).toHaveLength(0);
    // Give those two strokes a length and the third hand is missing again.
    const sounding = strokes.map((hit) => note(hit.pitch, hit.startBeat, 0.25));
    expect(issuesOfType(playability(sounding, DRUM_KIT), 'limbConflict')).toHaveLength(1);
    // The same import read on a neck: the silent note is out of the stretch.
    const stopped = [note(29, 0, 1), note(55, 0, 0)];
    expect(issuesOfType(playability(stopped, BASS_4_STRING), 'stretchTooWide')).toHaveLength(0);
    expect(
      issuesOfType(playability([note(29, 0, 1), note(55, 0, 1)], BASS_4_STRING), 'stretchTooWide'),
    ).toHaveLength(1);
  });
});

describe('foldIntoRange answers with the nearest octave', () => {
  it('folds down when down is nearer, over a gapped range', () => {
    // MIDI 58 is not on the kit. The open hi-hat is an octave below it and the
    // shaker two octaves above, so folding upward first would change the voice
    // rather than the register.
    expect(canSound(DRUM_KIT, 58)).toBe(false);
    expect(DRUM_NOTES.openHiHat).toBe(46);
    expect(foldIntoRange(58, DRUM_KIT)).toBe(DRUM_NOTES.openHiHat);
  });

  it('never passes a nearer sounding octave by', () => {
    for (let pitch = 0; pitch <= 127; pitch += 1) {
      const folded = foldIntoRange(pitch, DRUM_KIT);
      expect(Math.abs(folded - pitch) % 12, `${pitch}`).toBe(0);
      for (let octave = pitch % 12; octave <= 127; octave += 12) {
        if (!canSound(DRUM_KIT, octave)) {
          continue;
        }
        expect(canSound(DRUM_KIT, folded), `${pitch}`).toBe(true);
        expect(Math.abs(octave - pitch), `${pitch}`).toBeGreaterThanOrEqual(
          Math.abs(folded - pitch),
        );
      }
    }
  });

  it('takes the upper octave when both are equally near', () => {
    const bookends: PercussionProfile = {
      ...DRUM_KIT,
      name: 'two-voice kit',
      reach: { 36: ['rightFoot'], 60: ['rightHand'] },
    };
    expect(foldIntoRange(48, bookends)).toBe(60);
  });
});

describe('playability reads the instrument before the passage', () => {
  it('refuses a profile that describes no instrument, empty passage or not', () => {
    const neckless = { ...GUITAR_STANDARD, name: 'stringless guitar', tuning: [] };
    expect(() => playability([], neckless)).toThrow(InvalidInputError);
    expect(() => playability([note(40, 0)], neckless)).toThrow(InvalidInputError);
    // A kit with no limbs is refused by the field that says so, rather than by
    // the consequence of it: what a caller can act on is the missing limbs.
    const handless: PercussionProfile = { ...DRUM_KIT, name: 'kit with no player', limbs: [] };
    expect(() => playability([], handless)).toThrow(/at least one limb/);
    expect(() => playability([note(DRUM_NOTES.kick, 0, 0.25)], handless)).toThrow(
      /at least one limb/,
    );
    // A player who has limbs, but none of the ones the kit's voices ask for,
    // is on an instrument with nothing on it.
    const wrongLimbs: PercussionProfile = {
      ...DRUM_KIT,
      name: 'kit nobody reaches',
      limbs: ['leftFoot'],
      reach: Object.fromEntries(
        Object.keys(DRUM_KIT.reach).map((pitch) => [Number(pitch), ['rightHand'] as const]),
      ),
    };
    expect(() => playability([], wrongLimbs)).toThrow(/within reach/);
    // A profile the instrument module accepts is read the same either way.
    expect(playability([], DRUM_KIT).issues).toEqual([]);
  });
});
