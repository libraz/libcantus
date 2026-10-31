import { DRUM_KIT } from '@libraz/libcantus';
import { InvalidInputError, midiToNote } from '@libraz/libcantus/core';
import { resolveContext } from '@libraz/libcantus/generate';
import {
  Chord,
  Instrument,
  Interval,
  Motif,
  Note,
  Progression,
  Timeline,
} from '@libraz/libcantus/model';
import { chordFromSpec, toChordData } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

/** The error a call raises, so a host `TypeError` fails the test rather than passing as a throw. */
function raised(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('arguments that are not the expected kind are an input error, never a host error', () => {
  it('names a value with no string form by its type', () => {
    const error = raised(() => midiToNote(Object.create(null) as never));
    expect(error).toBeInstanceOf(InvalidInputError);
    // The wire carries no prototype, so a surface over the core names it as the plain object it
    // arrives as.
    const shown = (process.env.CANTUS_IMPL ?? 'ts') === 'ts' ? 'object' : '[object Object]';
    expect((error as Error).message).toBe(`midi must be finite; received ${shown}`);
  });

  it('refuses a progression member that is no chord', () => {
    for (const member of [{}, { toJSON: 5 }]) {
      const error = raised(() => Progression.of([member] as never));
      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toBe(
        'progression chords[0] must be a Chord; received object',
      );
    }
    const error = raised(() => Progression.of([5] as never));
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as Error).message).toMatch(/progression chords\[0\]/);
  });

  it('refuses a first argument to Timeline.fromProgression that is no progression', () => {
    for (const given of ['C', 60, null, undefined, {}, { chords: 5 }]) {
      const error = raised(() => Timeline.fromProgression(given as never, 5));
      expect(error, String(given)).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch(/^timeline progression must be a Progression/);
    }
    const error = raised(() => Timeline.fromProgression({ chords: [{}] } as never, 5));
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as Error).message).toMatch(/timeline progression chords\[0\]/);
    const progression = Progression.of([Chord.parse('C'), Chord.parse('G7')]);
    expect(Timeline.fromProgression(progression, 4).length).toBe(2);
  });

  it('refuses an argument to Interval.between that is no note', () => {
    const c4 = Note.parse('C4');
    for (const [a, b] of [
      [null, c4],
      ['C', c4],
      [c4, null],
      [c4, 'G4'],
      [c4, {}],
    ]) {
      const error = raised(() => Interval.between(a as never, b as never));
      expect(error, `${String(a)} ${String(b)}`).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch(/^interval [ab] must be a Note; received /);
    }
    expect(Interval.between(c4, Note.parse('G4')).name).toBe('P5');
  });

  it('refuses a Motif.generate options argument that is no object', () => {
    for (const opts of [null, 5, undefined, 'x', []]) {
      const error = raised(() => Motif.generate(opts as never));
      expect(error, String(opts)).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch(/^motif options must be an object; received /);
    }
  });

  it('refuses a Motif.fromNotes argument that is no array', () => {
    for (const notes of [5, {}, null, undefined, 'abc']) {
      const error = raised(() => Motif.fromNotes(notes as never));
      expect(error, String(notes)).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch(/^motif notes must be an array; received /);
    }
  });

  it('names a null chord or chord spec as null', () => {
    expect(raised(() => toChordData(null as never))).toMatchObject({
      message: 'chord must be a chord symbol or chord data; received null',
    });
    expect(raised(() => toChordData(5 as never))).toMatchObject({
      message: 'chord must be a chord symbol or chord data; received number',
    });
    expect(raised(() => chordFromSpec(null as never))).toMatchObject({
      message: 'chord spec must be an object; received null',
    });
  });
});

describe('every supplied generation context field is used as typed or refused', () => {
  const refused: [string, Record<string, unknown>, string][] = [
    ['complexity', { complexity: 0.95 }, 'ctx.complexity'],
    ['complexity', { complexity: 'high' }, 'ctx.complexity'],
    ['instruments', { instruments: 5 }, 'ctx.instruments'],
    ['instruments', { instruments: [] }, 'ctx.instruments'],
    ['vocabulary', { vocabulary: 'abc' }, 'ctx.vocabulary'],
    ['vocabulary', { vocabulary: {} }, 'ctx.vocabulary'],
    ['rng', { rng: 5 }, 'ctx.rng'],
    ['rng', { rng: {} }, 'ctx.rng.at'],
    ['rng', { rng: { at: 1 } }, 'ctx.rng.at'],
  ];

  it.each(refused)('refuses a wrong-typed %s', (_field, ctx, name) => {
    const error = raised(() => resolveContext(ctx as never));
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as Error).message).toContain(name);
  });

  it('still takes an absent or null optional field as left out', () => {
    expect(() =>
      resolveContext({ complexity: null, instruments: null, vocabulary: null } as never),
    ).not.toThrow();
    expect(() => resolveContext({ seed: 1, rng: { at: () => 0.5 } })).not.toThrow();
  });
});

describe('a positional float stays below its upper bound', () => {
  it('pulls a result that rounds up to hi back below it', () => {
    const lo = 2 ** 53;
    const hi = lo + 2;
    const nearOne = 1 - 2 ** -53;
    const value = resolveContext({ seed: 1, rng: { at: () => nearOne } })
      .part('x')
      .float(lo, hi, 'p');
    expect(value).toBeGreaterThanOrEqual(lo);
    expect(value).toBeLessThan(hi);
  });
});

describe('an instrument and the functions over its profile read the same kit', () => {
  it('leaves a reach key that is not the canonical spelling of its pitch off the instrument', () => {
    const kit = { ...DRUM_KIT, reach: { ...DRUM_KIT.reach, '001': ['rightHand'] } } as never;
    const instrument = Instrument.of(kit);
    expect(instrument.toJSON()).toEqual(DRUM_KIT);
    expect(instrument.canSound(1)).toBe(false);
  });
});
