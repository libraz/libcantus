import { describe, expect, it } from 'vitest';
import type { TimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { humanize } from '../src/generate/groove/index.js';
import { classifyMelodyTones, harmonizeMelody } from '../src/generate/harmonize/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const fourFour: TimeSignature = { numerator: 4, denominator: 4 };
const cMajor = majorKey(0);

/** Quarter notes from beat 0, which is what the metric criteria are read against. */
function quarters(pitches: readonly number[]): NoteEvent[] {
  return pitches.map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
}

function roles(melody: readonly NoteEvent[], ts: TimeSignature = fourFour): string[] {
  return classifyMelodyTones(melody, ts).map((tone) => tone.role);
}

describe('classifyMelodyTones', () => {
  it('hears a stepwise weak-beat note between two chord tones as passing', () => {
    // C D E C: D fills the third, on a weaker beat than the notes framing it.
    expect(roles(quarters([60, 62, 64, 60]))).toEqual([
      'structural',
      'passing',
      'structural',
      'structural',
    ]);
  });

  it('hears a step away and back as a neighbor', () => {
    expect(roles(quarters([60, 62, 60, 64]))[1]).toBe('neighbor');
  });

  it('hears a weak-beat repeat of the coming downbeat as an anticipation', () => {
    expect(roles(quarters([60, 64, 69, 72, 72, 67]))[3]).toBe('anticipation');
  });

  it('hears a held-over note leaning on the downbeat as a suspension', () => {
    expect(roles(quarters([60, 62, 64, 65, 65, 64, 60]))[4]).toBe('suspension');
  });

  it('hears a leap onto an accented note that steps back down as an appoggiatura', () => {
    expect(roles(quarters([60, 62, 64, 60, 69, 67, 65]))[4]).toBe('appoggiatura');
  });

  it('hears a step up followed by a leap away as an escape tone', () => {
    expect(roles(quarters([67, 69, 64, 60]))[1]).toBe('escape');
  });

  it('leaves the first and last notes structural, having nothing to frame them', () => {
    const classified = classifyMelodyTones(quarters([60, 62, 64, 65]), fourFour);
    expect(classified[0]?.role).toBe('structural');
    expect(classified.at(-1)?.role).toBe('structural');
    expect(classified.map((tone) => tone.noteIndex)).toEqual([0, 1, 2, 3]);
  });

  it('does not lead one note into another across a rest', () => {
    // The same three pitches, but the second note starts a beat after the first
    // one stops, so it is entered rather than passed through.
    const melody: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 62, startBeat: 2, durationBeat: 1 },
      { pitch: 64, startBeat: 3, durationBeat: 1 },
    ];
    expect(roles(melody)[1]).toBe('structural');
  });

  it('keeps a long accented note structural even between two steps', () => {
    // The half-note G of a nursery tune sits between A and F, but it is longer
    // and lands on a stronger beat than either, so it is what the harmony is for.
    const melody: NoteEvent[] = [
      { pitch: 69, startBeat: 4, durationBeat: 1 },
      { pitch: 69, startBeat: 5, durationBeat: 1 },
      { pitch: 67, startBeat: 6, durationBeat: 2 },
      { pitch: 65, startBeat: 8, durationBeat: 1 },
    ];
    expect(roles(melody)[2]).toBe('structural');
  });

  it('reads the accent grid from the time signature it is given', () => {
    // The same six quarter notes barred as a waltz put the accents elsewhere, so
    // the notes that count as decoration move with them.
    const melody = quarters([60, 62, 64, 65, 67, 65]);
    expect(roles(melody, { numerator: 3, denominator: 4 })).not.toEqual(roles(melody));
  });

  it('marks every role but structural as ornamental', () => {
    for (const tone of classifyMelodyTones(quarters([60, 62, 64, 60]), fourFour)) {
      expect(tone.ornamental).toBe(tone.role !== 'structural');
    }
  });

  it('rejects a melody it cannot classify instead of guessing', () => {
    expect(() =>
      classifyMelodyTones([{ pitch: Number.NaN, startBeat: 0, durationBeat: 1 }], fourFour),
    ).toThrow(RangeError);
    expect(() => classifyMelodyTones(quarters([60, 62]), { numerator: 0, denominator: 4 })).toThrow(
      RangeError,
    );
  });

  it('hears a played onset as the beat it is playing', () => {
    // A note event carries the timing of a performance, so an onset sits a few
    // milliseconds off the grid it was written on. The figures are the ones the
    // notation forms, not ones a hair of jitter invented.
    const written = quarters([60, 62, 64, 65, 67, 65, 64, 62]);
    const played = written.map((note, i) => ({
      ...note,
      startBeat: note.startBeat + (i % 2 === 0 ? 0.02 : -0.02),
    }));
    expect(roles(played)).toEqual(roles(written));
  });

  it('classifies a humanized melody as it classifies the melody itself', () => {
    const written = quarters([60, 62, 64, 65, 67, 65, 64, 62]);
    for (let seed = 0; seed < 16; seed += 1) {
      expect(roles(humanize(written, { timing: 0.02, ctx: { seed: seed } }))).toEqual(
        roles(written),
      );
    }
  });

  it('harmonizes a humanized melody as it harmonizes the melody itself', () => {
    // `harmonizeMelody` reads the same onsets, so a melody that has been through
    // `humanize` gets the chords its written form gets, at the default options.
    for (const pitches of [
      [60, 62, 64, 65, 67, 65, 64, 62],
      [60, 64, 67, 72, 67, 64, 60, 72],
      [67, 69, 71, 72, 71, 69, 67, 60],
    ]) {
      const written = quarters(pitches);
      const chords = harmonizeMelody({ melody: written }).chords;
      for (let seed = 0; seed < 16; seed += 1) {
        const played = humanize(written, { timing: 0.02, ctx: { seed: seed } });
        expect(harmonizeMelody({ melody: played }).chords).toEqual(chords);
      }
    }
  });

  it('keeps an ornament from buying itself a chord', () => {
    // The passing D shares its slot with the C it steps away from, and the chord
    // chosen there is the one the structural notes ask for, not one covering D.
    const result = harmonizeMelody({
      melody: quarters([60, 62, 64, 60]),
      key: cMajor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(result.chords).toHaveLength(1);
    expect(result.chords[0]).toMatchObject({ rootPc: 0, quality: 'maj', startBeat: 0 });
  });
});
