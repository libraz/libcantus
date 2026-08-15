import { describe, expect, it } from 'vitest';
import {
  compareMelodies,
  extractMotifs,
  melodicContour,
  melodicSimilarity,
  motifFromNotes,
  relateMotifs,
} from '../src/analyze/melody/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** A line of even notes: one pitch per beat from `startBeat`. */
function line(startBeat: number, pitches: number[], step = 1): NoteEvent[] {
  return pitches.map((pitch, i) => ({
    pitch,
    startBeat: startBeat + i * step,
    durationBeat: step,
  }));
}

describe('real versus tonal restatement', () => {
  // Subject C D E, answered a step higher. The literal answer keeps the major
  // second and needs an F#; the diatonic one stays in C major and turns the
  // second minor. Both are the same gesture a step up, and they are different
  // devices.
  const subject = motifFromNotes(line(0, [60, 62, 64]));
  const realAnswer = motifFromNotes(line(3, [62, 64, 66]));
  const tonalAnswer = motifFromNotes(line(3, [62, 64, 65]));

  it('names the literal answer a real sequence', () => {
    const relation = relateMotifs(subject, realAnswer, cMajor);
    expect(relation?.kind).toBe('transposition');
    expect(relation?.sequence).toBe(true);
    expect(relation?.semitones).toBe(2);
    expect(relation?.interval).toMatchObject({ number: 2, quality: 'M' });
    expect(relation?.rationale).toContain('Real sequence');
  });

  it('names the diatonic answer a tonal sequence', () => {
    const relation = relateMotifs(subject, tonalAnswer, cMajor);
    expect(relation?.kind).toBe('tonalTransposition');
    expect(relation?.sequence).toBe(true);
    expect(relation?.degrees).toBe(1);
    expect(relation?.rationale).toContain('Tonal sequence');
  });

  it('does not collapse the two into one relation', () => {
    const real = relateMotifs(subject, realAnswer, cMajor);
    const tonal = relateMotifs(subject, tonalAnswer, cMajor);
    expect(real?.kind).not.toBe(tonal?.kind);
  });

  it('cannot read the diatonic answer without a key', () => {
    expect(relateMotifs(subject, tonalAnswer)).toBeNull();
    // The literal answer needs no key: every interval is preserved outright.
    expect(relateMotifs(subject, realAnswer)?.kind).toBe('transposition');
  });

  it('calls a literal restatement elsewhere a transposition, not a sequence', () => {
    const later = motifFromNotes(line(16, [67, 69, 71]));
    const relation = relateMotifs(subject, later, cMajor);
    expect(relation?.kind).toBe('transposition');
    expect(relation?.sequence).toBe(false);
    expect(relation?.rationale).toContain('Transposition by P5');
  });
});

describe('named transformations of a motif', () => {
  // Intervals +2 then +5, so the cell is not symmetrical and each transform has
  // exactly one name.
  const model = motifFromNotes(line(0, [60, 62, 67]));

  it('names an exact repetition', () => {
    const relation = relateMotifs(model, motifFromNotes(line(4, [60, 62, 67])));
    expect(relation?.kind).toBe('repetition');
    expect(relation?.timeRatio).toBe(1);
  });

  it('names an inversion', () => {
    // Reflected about the first note: +2, +5 becomes -2, -5.
    const relation = relateMotifs(model, motifFromNotes(line(4, [60, 58, 53])));
    expect(relation?.kind).toBe('inversion');
    expect(relation?.rationale).toContain('upside down');
  });

  it('names a retrograde, rhythm included', () => {
    const uneven: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 62, startBeat: 1, durationBeat: 2 },
      { pitch: 67, startBeat: 3, durationBeat: 1 },
    ];
    const backwards: NoteEvent[] = [
      { pitch: 67, startBeat: 4, durationBeat: 2 },
      { pitch: 62, startBeat: 6, durationBeat: 1 },
      { pitch: 60, startBeat: 7, durationBeat: 1 },
    ];
    const relation = relateMotifs(motifFromNotes(uneven), motifFromNotes(backwards));
    expect(relation?.kind).toBe('retrograde');
    // The same pitches the same way round would have been a repetition.
    expect(relateMotifs(motifFromNotes(uneven), motifFromNotes(uneven))?.kind).toBe('repetition');
  });

  it('names a retrograde inversion', () => {
    // Back to front and upside down: +2, +5 becomes +5, +2.
    const relation = relateMotifs(model, motifFromNotes(line(4, [60, 65, 67])));
    expect(relation?.kind).toBe('retrogradeInversion');
  });

  it('names an augmentation and its ratio', () => {
    const relation = relateMotifs(model, motifFromNotes(line(8, [60, 62, 67], 2)));
    expect(relation?.kind).toBe('augmentation');
    expect(relation?.timeRatio).toBe(2);
    expect(relation?.rationale).toContain('2x');
  });

  it('names a diminution and its ratio', () => {
    const relation = relateMotifs(model, motifFromNotes(line(8, [60, 62, 67], 0.5)));
    expect(relation?.kind).toBe('diminution');
    expect(relation?.timeRatio).toBe(0.5);
  });

  it('keeps the pitch transformation when the note values are stretched too', () => {
    const relation = relateMotifs(model, motifFromNotes(line(8, [60, 58, 53], 2)));
    expect(relation?.kind).toBe('inversion');
    expect(relation?.timeRatio).toBe(2);
  });

  it('answers null for a figure that stands in no relation', () => {
    expect(relateMotifs(model, motifFromNotes(line(4, [60, 61, 71])))).toBeNull();
    // A different number of notes is a different figure, not a transformation.
    expect(relateMotifs(model, motifFromNotes(line(4, [60, 62])))).toBeNull();
  });
});

describe('extractMotifs', () => {
  // A four-note, two-bar cell stated three times: beats 0, 8 and 16.
  const cell = [60, 64, 67, 64];
  const melody = [...line(0, cell, 2), ...line(8, cell, 2), ...line(16, cell, 2)];

  it('finds all three statements at the right beats', () => {
    const motifs = extractMotifs(melody);
    const motif = motifs[0];
    expect(motif?.notes).toHaveLength(4);
    expect(motif?.occurrences.map((o) => o.startBeat)).toEqual([0, 8, 16]);
    expect(motif?.occurrences.map((o) => o.endBeat)).toEqual([8, 16, 24]);
    expect(motif?.occurrences.map((o) => o.noteIndex)).toEqual([0, 4, 8]);
    expect(motif?.intervals).toEqual([4, 3, -3]);
    expect(motif?.rhythm).toEqual([1, 1, 1]);
    expect(motif?.rationale).toContain('stated 3 times');
  });

  it('matches a statement transposed and one in doubled note values', () => {
    const transposed = [...line(0, cell, 2), ...line(8, [67, 71, 74, 71], 2)];
    const shifted = extractMotifs(transposed)[0];
    expect(shifted?.occurrences.map((o) => o.transpose)).toEqual([0, 7]);

    const stretched = [...line(0, cell, 2), ...line(8, cell, 4)];
    const widened = extractMotifs(stretched)[0];
    expect(widened?.occurrences.map((o) => o.timeRatio)).toEqual([1, 2]);
  });

  it('counts a repetitive figure once per statement, not once per note', () => {
    // Eight even notes of one pitch: every three-note window matches every
    // other, but only two statements can be heard without overlapping.
    const flat = line(0, [60, 60, 60, 60, 60, 60]);
    const motif = extractMotifs(flat, { maxNotes: 3 })[0];
    expect(motif?.occurrences.map((o) => o.noteIndex)).toEqual([0, 3]);
  });

  it('reports the longest recurring cell rather than every fragment of it', () => {
    const motifs = extractMotifs(melody);
    // The three-note head of the cell recurs exactly as often and sits inside
    // it, so it is not reported as a motif of its own.
    const head = motifs.find(
      (m) => m.notes.length === 3 && m.occurrences.every((o) => o.startBeat % 8 === 0),
    );
    expect(head).toBeUndefined();
  });

  it('honours the recurrence threshold and the cell-length bounds', () => {
    expect(extractMotifs(melody, { minOccurrences: 4 })).toEqual([]);
    expect(extractMotifs(melody, { minNotes: 3, maxNotes: 3 })[0]?.notes).toHaveLength(3);
    expect(extractMotifs(line(0, [60, 62, 64, 65]))).toEqual([]);
    expect(() => extractMotifs(melody, { minNotes: 5, maxNotes: 4 })).toThrow(/maxNotes/);
    expect(() => extractMotifs(melody, { minOccurrences: 1 })).toThrow(/minOccurrences/);
  });

  it('is deterministic', () => {
    expect(extractMotifs(melody)).toEqual(extractMotifs(melody));
  });

  it('relates two statements of an extracted motif', () => {
    const motif = extractMotifs(melody)[0];
    const [first, second] = motif?.occurrences ?? [];
    expect(first && second).toBeTruthy();
    const restated = motifFromNotes(
      melody.slice(second?.noteIndex ?? 0, (second?.noteIndex ?? 0) + 4),
    );
    expect(motif && relateMotifs(motif, restated)?.kind).toBe('repetition');
  });
});

describe('melodicSimilarity', () => {
  const original = line(0, [60, 62, 64, 65]);
  const nearVariant = line(0, [60, 62, 64, 67]);
  const unrelated = line(0, [72, 59, 70, 61]);

  it('scores a near variant above an unrelated phrase', () => {
    expect(melodicSimilarity(original, nearVariant)).toBeGreaterThan(
      melodicSimilarity(original, unrelated),
    );
  });

  it('scores a line against itself at 1 and stays inside 0..1', () => {
    expect(melodicSimilarity(original, original)).toBe(1);
    for (const other of [nearVariant, unrelated]) {
      const score = melodicSimilarity(original, other);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('is transposition invariant and symmetric', () => {
    const upAFifth = line(0, [67, 69, 71, 72]);
    expect(melodicSimilarity(original, upAFifth)).toBe(1);
    expect(melodicSimilarity(original, unrelated)).toBe(melodicSimilarity(unrelated, original));
  });

  it('takes a motif as readily as raw notes, and explains itself', () => {
    const comparison = compareMelodies(motifFromNotes(original), nearVariant);
    expect(comparison.similarity).toBe(melodicSimilarity(original, nearVariant));
    expect(comparison.pitchSimilarity).toBeLessThan(1);
    expect(comparison.rhythmSimilarity).toBe(1);
    expect(comparison.rationale).toContain('alike');
  });

  it('ranks a rhythmic variant below a literal restatement', () => {
    const sameNotesOtherRhythm = line(0, [60, 62, 64, 65], 0.25).map((note, i) => ({
      ...note,
      startBeat: i === 3 ? 2 : note.startBeat,
    }));
    expect(melodicSimilarity(original, sameNotesOtherRhythm)).toBeLessThan(1);
  });
});

describe('melodicContour', () => {
  it('reports the step directions', () => {
    expect(melodicContour(line(0, [60, 62, 62, 59])).directions).toEqual(['up', 'same', 'down']);
  });

  it('classifies a rising line as ascending even with one dip', () => {
    const contour = melodicContour(line(0, [60, 64, 62, 72]));
    expect(contour.shape).toBe('ascending');
    expect(contour.peakIndex).toBe(3);
    expect(contour.troughIndex).toBe(0);
    expect(contour.range).toBe(12);
    expect(contour.rationale).toContain('ascending');
  });

  it('classifies a falling line as descending', () => {
    expect(melodicContour(line(0, [72, 69, 65, 60])).shape).toBe('descending');
  });

  it('classifies a rise and fall as an arch', () => {
    const contour = melodicContour(line(0, [60, 64, 67, 64, 60]));
    expect(contour.shape).toBe('arch');
    expect(contour.peakIndex).toBe(2);
  });

  it('classifies a line that keeps turning as a wave', () => {
    expect(melodicContour(line(0, [60, 64, 60, 64, 60, 64, 60])).shape).toBe('wave');
  });

  it('classifies an unmoving line as static', () => {
    const contour = melodicContour(line(0, [60, 60, 60]));
    expect(contour.shape).toBe('static');
    expect(contour.range).toBe(0);
    expect(melodicContour(line(0, [60])).shape).toBe('static');
  });

  it('reads a motif as readily as raw notes', () => {
    expect(melodicContour(motifFromNotes(line(0, [60, 64, 67, 64, 60]))).shape).toBe('arch');
  });
});
