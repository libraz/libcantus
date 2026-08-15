import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/types.js';
import { imitate } from '../src/generate/countermelody/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

const C_MAJOR = majorKey(0);

/** A line of quarter notes from a list of pitches. */
function quarters(pitches: number[], startBeat = 0): NoteEvent[] {
  return pitches.map((pitch, index) => ({
    pitch,
    startBeat: startBeat + index,
    durationBeat: 1,
  }));
}

describe('real answers', () => {
  const lead = quarters([60, 62, 64, 65]);

  it('transposes the subject literally and enters where asked', () => {
    const answer = imitate(lead, { atBeat: 4, interval: 'P5', key: C_MAJOR });
    expect(answer.map((note) => note.pitch)).toEqual([67, 69, 71, 72]);
    expect(answer.map((note) => note.startBeat)).toEqual([4, 5, 6, 7]);
  });

  it('keeps every interval of the subject, in or out of the key', () => {
    const chromatic = quarters([60, 61, 64]);
    const answer = imitate(chromatic, { atBeat: 2, interval: 'M3', key: C_MAJOR });
    expect(answer.map((note) => note.pitch)).toEqual([64, 65, 68]);
  });

  it('answers below on a descending interval', () => {
    const answer = imitate(lead, { atBeat: 2, interval: '-P4', key: C_MAJOR });
    expect(answer.map((note) => note.pitch)).toEqual([55, 57, 59, 60]);
  });

  it('keeps the rhythm of the subject, gaps and all', () => {
    const dotted: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1.5 },
      { pitch: 64, startBeat: 2, durationBeat: 0.5 },
    ];
    const answer = imitate(dotted, { atBeat: 1, interval: 'P8', key: C_MAJOR });
    expect(answer).toEqual([
      { pitch: 72, startBeat: 1, durationBeat: 1.5 },
      { pitch: 76, startBeat: 3, durationBeat: 0.5 },
    ]);
  });
});

describe('tonal answers', () => {
  const lead = quarters([60, 62, 64, 67]);

  it('stays in the key, answering a fifth with a fourth where the scale says so', () => {
    const answer = imitate(lead, { atBeat: 4, interval: 'P5', key: C_MAJOR, answer: 'tonal' });
    // C D E G answered four degrees up: G A B D — the rising fifth becomes a fourth.
    expect(answer.map((note) => note.pitch)).toEqual([67, 69, 71, 74]);
  });

  it('differs from the real answer where the scale bends the interval', () => {
    // A leading tone rising a semitone to the tonic: answered a fifth up, the
    // real answer keeps the semitone (F# G) and the tonal answer takes the
    // degrees the key offers (F G).
    const subject = quarters([71, 72]);
    const real = imitate(subject, { atBeat: 2, interval: 'P5', key: C_MAJOR });
    const tonal = imitate(subject, { atBeat: 2, interval: 'P5', key: C_MAJOR, answer: 'tonal' });
    expect(real.map((note) => note.pitch)).toEqual([78, 79]);
    expect(tonal.map((note) => note.pitch)).toEqual([77, 79]);
  });

  it('keeps a chromatic note chromatic', () => {
    const answer = imitate(quarters([60, 61, 62]), {
      atBeat: 3,
      interval: 'P5',
      key: C_MAJOR,
      answer: 'tonal',
    });
    // The passing C# stays a semitone above the degree it decorates.
    expect(answer.map((note) => note.pitch)).toEqual([67, 68, 69]);
  });

  it('counts degrees of the key it is given, not of the major scale', () => {
    const answer = imitate(quarters([57, 59, 60]), {
      atBeat: 3,
      interval: 'P5',
      key: minorKey(9),
      answer: 'tonal',
    });
    expect(answer.map((note) => note.pitch)).toEqual([64, 65, 67]);
  });
});

describe('inversion', () => {
  it('mirrors the subject about its first note before transposing', () => {
    const answer = imitate(quarters([60, 64, 67]), {
      atBeat: 3,
      interval: 'P1',
      key: C_MAJOR,
      invert: true,
    });
    expect(answer.map((note) => note.pitch)).toEqual([60, 56, 53]);
  });

  it('inverts by scale degree for a tonal answer', () => {
    const answer = imitate(quarters([60, 62, 64]), {
      atBeat: 3,
      interval: 'P1',
      key: C_MAJOR,
      answer: 'tonal',
      invert: true,
    });
    // Up a second then a third becomes down a second then a third, in the key.
    expect(answer.map((note) => note.pitch)).toEqual([60, 59, 57]);
  });

  it('combines inversion with the transposition', () => {
    const answer = imitate(quarters([60, 64]), {
      atBeat: 2,
      interval: 'P5',
      key: C_MAJOR,
      invert: true,
    });
    expect(answer.map((note) => note.pitch)).toEqual([67, 63]);
  });
});

describe('imitate options', () => {
  const lead = quarters([60, 62, 64, 65, 67]);

  it('imitates only the chosen span', () => {
    const answer = imitate(lead, { atBeat: 8, interval: 'P8', key: C_MAJOR, from: 2, to: 4 });
    expect(answer.map((note) => note.pitch)).toEqual([76, 77]);
    expect(answer.map((note) => note.startBeat)).toEqual([8, 9]);
  });

  it('returns nothing when the span holds no notes', () => {
    expect(imitate(lead, { atBeat: 8, interval: 'P8', key: C_MAJOR, from: 20 })).toEqual([]);
  });

  it('scales the velocities it copies', () => {
    const voiced: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1, velocity: 100 }];
    const answer = imitate(voiced, {
      atBeat: 1,
      interval: 'P5',
      key: C_MAJOR,
      velocityScale: 0.8,
    });
    expect(answer[0]?.velocity).toBe(80);
  });

  it('leaves a note without a velocity without one', () => {
    const answer = imitate(quarters([60]), { atBeat: 1, interval: 'P5', key: C_MAJOR });
    expect(answer[0]).not.toHaveProperty('velocity');
  });

  it('rejects an entry before the start of the music', () => {
    expect(() => imitate(lead, { atBeat: -1, interval: 'P5', key: C_MAJOR })).toThrow(RangeError);
  });

  it('rejects a reversed span', () => {
    expect(() =>
      imitate(lead, { atBeat: 4, interval: 'P5', key: C_MAJOR, from: 4, to: 1 }),
    ).toThrow(/from <= to/);
  });

  it('rejects a transposition that leaves the keyboard', () => {
    expect(() => imitate(quarters([120]), { atBeat: 1, interval: 'P8', key: C_MAJOR })).toThrow(
      /MIDI range/,
    );
  });
});
