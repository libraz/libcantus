import { describe, expect, it } from 'vitest';
import {
  BASS_4_STRING,
  canSound,
  foldIntoRange,
  type InstrumentProfile,
  instrumentRange,
  type StringedProfile,
} from '../src/core/instrument/index.js';
import {
  detectNoteNameSystem,
  type NoteNameSystem,
  parseKeyName,
  parseNote,
  tryParseKeyName,
  tryParseNote,
} from '../src/core/pitch/index.js';
import { type BassSegment, generateBassLine } from '../src/generate/bass/index.js';
import { bandFloor, foldIntoBand, placePc } from '../src/generate/bass/internal.js';
import { makeChord } from '../src/theory/chord/index.js';
import { tryParseChordSymbol } from '../src/theory/symbol/index.js';

/**
 * The cost of one call, in milliseconds, as the best of several runs.
 *
 * The best rather than the mean: a scheduling interruption can only make a run
 * slower, so the fastest of them is the one least contaminated by the machine.
 */
function cost(run: () => void): number {
  run();
  let best = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < 5; sample += 1) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

/**
 * How much more than the input growth the cost may grow by.
 *
 * The assertion is on the ratio between two input sizes rather than on a
 * millisecond count, because a wall-clock threshold measures the machine that
 * runs the test. Quadrupling the input quadruples a linear cost and multiplies
 * a quadratic one by sixteen, so a bound of eight tells the two apart with room
 * for allocation, garbage collection and a busy CI box in between.
 */
const GROWTH_TOLERANCE = 8;

/**
 * Slack added to the bound, in milliseconds.
 *
 * A linear reading here is measured in microseconds, where the ratio between
 * two of them is timer noise rather than a growth rate. The slack lets any pair
 * of sub-millisecond readings pass and leaves the ratio to decide only once the
 * cost has grown enough to mean something — which is when a quadratic path has
 * come back.
 */
const GROWTH_SLACK_MS = 1;

/** The factor the input is grown by between the two measurements. */
const GROWTH = 4;

/**
 * Assert that quadrupling the input does not multiply the cost by sixteen.
 *
 * The smaller size is measured first and the larger second, so a warm-up
 * advantage works against the assertion rather than for it.
 */
function expectLinear(label: string, size: number, at: (n: number) => () => void): void {
  const small = cost(at(size));
  const large = cost(at(size * GROWTH));
  expect(
    large,
    `${label}: ${size} took ${small.toFixed(2)}ms, ${size * GROWTH} took ${large.toFixed(2)}ms`,
  ).toBeLessThan(small * GROWTH_TOLERANCE + GROWTH_SLACK_MS);
}

/**
 * A ceiling no linear parser approaches and no quadratic one meets.
 *
 * It backs up the growth ratio, which two sub-millisecond readings satisfy
 * whatever they are. A linear reading of the longest input here is under half a
 * millisecond and the quadratic readings it replaced were hundreds to tens of
 * thousands, so a ceiling of fifty leaves two orders of magnitude of headroom
 * for a loaded machine and still cannot be met by a quadratic path.
 */
const CEILING_MS = 50;

/** Digits followed by one non-digit: the text an octave pattern cannot match. */
function unparseable(n: number): string {
  return `${'1'.repeat(n)}z`;
}

/** A root this system reads, followed by text no quality suffix covers. */
const SYSTEM_ROOTS: Record<NoteNameSystem, string> = {
  english: 'C',
  german: 'cis',
  japanese: '嬰ト',
  italian: 'sol',
  fixedDo: 'sol',
};

describe('note-name parsing costs no more than the length of the name', () => {
  it.each([8000, 32000])('reads %i characters that name nothing, in linear time', (n) => {
    const text = unparseable(n);
    expect(cost(() => void tryParseNote(text))).toBeLessThan(CEILING_MS);
    expect(cost(() => void tryParseKeyName(text))).toBeLessThan(CEILING_MS);
  });

  it('grows linearly in the length of a name no system reads', () => {
    expectLinear('tryParseNote', 4000, (n) => {
      const text = unparseable(n);
      return () => void tryParseNote(text);
    });
    expectLinear('tryParseKeyName', 4000, (n) => {
      const text = unparseable(n);
      return () => void tryParseKeyName(text);
    });
  });

  it('grows linearly in the length of a tonic under a mode word', () => {
    // A run of the separators a German key name writes its mode word against,
    // which the trailing-separator trim scans.
    expectLinear('mode word', 4000, (n) => {
      const half = '-'.repeat(n / 2);
      const text = `${half}x${half}dur`;
      return () => void tryParseKeyName(text);
    });
  });

  it('detects the system of a long name in linear time', () => {
    expectLinear('detectNoteNameSystem', 4000, (n) => {
      const text = unparseable(n);
      return () => {
        try {
          detectNoteNameSystem(text);
        } catch {
          // Attribution failing is the case being measured.
        }
      };
    });
  });
});

/**
 * Longest an error message may be, whatever it was given.
 *
 * A message names what was rejected without reprinting it: the field it comes
 * from can hold a pasted document, and a message that grows with the paste
 * turns one bad keystroke into a log entry nobody can read.
 */
const MAX_MESSAGE_LENGTH = 500;

describe('a rejected name is named in the message, not reprinted', () => {
  const pasted = unparseable(300_000);

  it('bounds the message of every note-name entry point', () => {
    const thrown: Error[] = [];
    for (const parse of [() => parseNote(pasted), () => parseKeyName(pasted)]) {
      expect(parse).toThrow();
      try {
        parse();
      } catch (error) {
        thrown.push(error as Error);
      }
    }
    const note = tryParseNote(pasted);
    const key = tryParseKeyName(pasted);
    expect(note.ok).toBe(false);
    expect(key.ok).toBe(false);
    if (!note.ok) {
      thrown.push(note.error);
    }
    if (!key.ok) {
      thrown.push(key.error);
    }
    for (const error of thrown) {
      expect(error.message.length, error.message.slice(0, 120)).toBeLessThan(MAX_MESSAGE_LENGTH);
    }
  });

  it('bounds the message when no system reads the name', () => {
    try {
      detectNoteNameSystem(pasted);
      expect.unreachable('a name no system reads must be refused');
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(MAX_MESSAGE_LENGTH);
    }
  });

  it('bounds the message when the name mixes two systems', () => {
    try {
      parseKeyName(`${'-'.repeat(300_000)}dur`);
      expect.unreachable('a tonic no system reads must be refused');
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(MAX_MESSAGE_LENGTH);
    }
  });

  it('bounds the message of a key name carrying an octave', () => {
    try {
      parseKeyName(`C${'0'.repeat(300_000)} major`);
      expect.unreachable('a key name carrying an octave must be refused');
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(MAX_MESSAGE_LENGTH);
    }
  });
});

describe('chord symbols cost the same to read in every notation system', () => {
  it.each(Object.keys(SYSTEM_ROOTS) as NoteNameSystem[])(
    'reads 24,000 characters of %s under the ceiling',
    (system) => {
      const text = `${SYSTEM_ROOTS[system]}${'x'.repeat(24_000)}`;
      expect(cost(() => void tryParseChordSymbol(text, { system }))).toBeLessThan(CEILING_MS);
    },
  );

  it.each(Object.keys(SYSTEM_ROOTS) as NoteNameSystem[])('grows linearly in %s', (system) => {
    expectLinear(system, 2000, (n) => {
      const text = `${SYSTEM_ROOTS[system]}${'x'.repeat(n)}`;
      return () => void tryParseChordSymbol(text, { system });
    });
  });

  it.each(Object.keys(SYSTEM_ROOTS) as NoteNameSystem[])(
    'grows linearly in %s when the text also carries digits',
    (system) => {
      // Digits in the middle drove both the root scan and the octave split, so
      // each candidate root paid for the whole remaining text.
      expectLinear(`${system} with digits`, 1000, (n) => {
        const half = '1'.repeat(n / 2);
        const text = `${SYSTEM_ROOTS[system]}${half}z${half}`;
        return () => void tryParseChordSymbol(text, { system });
      });
    },
  );

  it('reads the same symbols it always did', () => {
    const cases: [string, NoteNameSystem, number][] = [
      ['H7', 'german', 11],
      ['B', 'german', 10],
      ['As7', 'german', 8],
      ['Asus4', 'german', 9],
      ['Assus4', 'german', 8],
      ['Ges/B', 'german', 6],
      ['嬰ト7', 'japanese', 8],
      ['変ロm7', 'japanese', 10],
      ['sol diesis m7', 'italian', 8],
      ['do bemolle maj7', 'italian', 11],
      ['sol doppio bemolle', 'fixedDo', 5],
      ['sol bemolle bemolle', 'fixedDo', 5],
    ];
    for (const [text, system, rootPc] of cases) {
      const parsed = tryParseChordSymbol(text, { system });
      expect(parsed.ok, `${text} (${system})`).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.rootPc, `${text} (${system})`).toBe(rootPc);
      }
    }
  });
});

/** A profile whose numbers the instrument module has to refuse. */
function hostileTuning(open: number): StringedProfile {
  return { ...BASS_4_STRING, tuning: [open] };
}

describe('an instrument profile the library accepts cannot be walked forever', () => {
  it.each([
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN,
    Number.MAX_SAFE_INTEGER,
    -1,
    128,
    60.5,
  ])('refuses %p as an open-string pitch', (open) => {
    const profile = hostileTuning(open);
    expect(() => instrumentRange(profile)).toThrow(RangeError);
    expect(() => canSound(profile, 40)).toThrow(RangeError);
    expect(() => foldIntoRange(40, profile)).toThrow(RangeError);
  });

  it('refuses a neck longer than the MIDI compass', () => {
    expect(() => instrumentRange({ ...BASS_4_STRING, frets: Number.MAX_SAFE_INTEGER })).toThrow(
      RangeError,
    );
    expect(() => instrumentRange({ ...BASS_4_STRING, frets: 128 })).toThrow(RangeError);
    expect(instrumentRange({ ...BASS_4_STRING, frets: 127 }).high).toBe(43 + 127);
  });

  it('refuses a kit voice outside the MIDI compass', () => {
    const kit: InstrumentProfile = {
      kind: 'percussion',
      name: 'kit',
      limbs: ['rightHand'],
      reach: { [Number.MAX_SAFE_INTEGER]: ['rightHand'] },
      articulations: ['accent'],
      polyphony: 4,
    };
    expect(() => instrumentRange(kit)).toThrow(RangeError);
    expect(() => foldIntoRange(40, kit)).toThrow(RangeError);
  });

  it('folds a pitch far outside the instrument without walking to it', () => {
    // Before the octave counts were computed, each of these stepped by twelve
    // from the pitch to the instrument, which is where the process hung.
    expect(cost(() => void foldIntoRange(-1e9, BASS_4_STRING))).toBeLessThan(CEILING_MS);
    expect(cost(() => void foldIntoRange(1e9, BASS_4_STRING))).toBeLessThan(CEILING_MS);
    expect(cost(() => void bandFloor(1e9, BASS_4_STRING))).toBeLessThan(CEILING_MS);
    expect(cost(() => void bandFloor(-1e9, BASS_4_STRING))).toBeLessThan(CEILING_MS);
    expect(cost(() => void foldIntoBand(1e9, 36))).toBeLessThan(CEILING_MS);
    expect(cost(() => void foldIntoBand(-1e9, 36))).toBeLessThan(CEILING_MS);
    expect(cost(() => void placePc(0, 1e9, 36))).toBeLessThan(CEILING_MS);
  });

  it('folds and places exactly where it always did', () => {
    expect(foldIntoRange(27, BASS_4_STRING)).toBe(39);
    expect(foldIntoRange(40, BASS_4_STRING)).toBe(40);
    expect(foldIntoRange(100, BASS_4_STRING)).toBe(64);
    expect(bandFloor(36, BASS_4_STRING)).toBe(36);
    expect(bandFloor(12, BASS_4_STRING)).toBe(36);
    expect(bandFloor(96, BASS_4_STRING)).toBe(48);
    expect(bandFloor(36, undefined)).toBe(36);
    expect(foldIntoBand(20, 36)).toBe(44);
    expect(foldIntoBand(60, 36)).toBe(48);
    expect(foldIntoBand(40, 36)).toBe(40);
    expect(placePc(0, 61, 36)).toBe(48);
  });

  it('reports a malformed instrument instead of hanging on it', () => {
    const segments: BassSegment[] = [{ startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') }];
    expect(() =>
      generateBassLine({
        segments,
        key: 'C major',
        instrument: hostileTuning(Number.MAX_SAFE_INTEGER),
      }),
    ).toThrow(RangeError);
    expect(() =>
      generateBassLine({
        segments,
        key: 'C major',
        instrument: hostileTuning(Number.POSITIVE_INFINITY),
      }),
    ).toThrow(RangeError);
    expect(generateBassLine({ segments, key: 'C major', instrument: BASS_4_STRING })).toHaveLength(
      1,
    );
  });
});
