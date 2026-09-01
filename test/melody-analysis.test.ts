import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MotifRelationKind } from '../src/analyze/melody/index.js';
import {
  compareMelodies,
  extractMotifs,
  melodicContour,
  melodicSimilarity,
  motifFromNotes,
  relateMotifs,
} from '../src/analyze/melody/index.js';
import type { NoteEvent } from '../src/core/types.js';
import type { MotifCell, MotifContour, MotifTransform } from '../src/generate/motif/index.js';
import { generateMotif, motifToNoteEvents, transformMotif } from '../src/generate/motif/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import { unionMembers } from './support/signatures.js';

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

  it('leaves this diatonic answer unnamed without a key', () => {
    expect(relateMotifs(subject, tonalAnswer)).toBeNull();
    // The literal answer needs no key: every interval is preserved outright.
    expect(relateMotifs(subject, realAnswer)?.kind).toBe('transposition');
  });

  it('names a diatonic answer under the retrograde family when its shape fits one', () => {
    // The limit of the case above, which holds for that subject rather than in
    // general. A triad restated a degree higher swaps its two interval sizes,
    // and that is also what a retrograde inversion does to it; equal note
    // values read the same way round in both directions, so with no key to
    // offer the tonal reading the backward name is what is left.
    const triad = motifFromNotes(line(0, [60, 64, 67]));
    const answer = motifFromNotes(line(3, [62, 65, 69]));

    expect(relateMotifs(triad, answer, cMajor)?.kind).toBe('tonalTransposition');
    expect(relateMotifs(triad, answer)?.kind).toBe('retrogradeInversion');
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
    // The cell played backwards: each note keeps its own value, so what the
    // ear hears reversed is the run of note values, not the onset gaps.
    const backwards = motifToNoteEvents(transformMotif({ notes: uneven }, 'retrograde'));
    const relation = relateMotifs(motifFromNotes(uneven), motifFromNotes(backwards));
    expect(relation?.kind).toBe('retrograde');
    // The same pitches the same way round would have been a repetition.
    expect(relateMotifs(motifFromNotes(uneven), motifFromNotes(uneven))?.kind).toBe('repetition');
  });

  it.each([
    { label: 'a long note in the middle', values: [1, 2, 1] },
    { label: 'long ends around short middles', values: [2, 1, 1, 2] },
    { label: 'a palindrome of note values', values: [1, 2, 2, 1] },
  ])('names the retrograde of a cell with $label', ({ values }) => {
    // Pitches that fall then leap, so no cell here is its own retrograde.
    const pitches = [60, 64, 62, 67];
    let at = 0;
    const cell: MotifCell = {
      notes: values.map((durationBeat, index) => {
        const note = { pitch: pitches[index] ?? 60, startBeat: at, durationBeat };
        at += durationBeat;
        return note;
      }),
    };
    const model = motifFromNotes(motifToNoteEvents(cell));
    const backwards = motifFromNotes(motifToNoteEvents(transformMotif(cell, 'retrograde')));
    expect(relateMotifs(model, backwards)?.kind).toBe('retrograde');
    // And back the other way: a retrograde is its own inverse.
    expect(relateMotifs(backwards, model)?.kind).toBe('retrograde');
  });

  it('names what the retrograde transform writes, for every cell it writes', () => {
    /** Steps of a cell, which is what a relation is read from. */
    const stepsOf = (source: MotifCell) =>
      source.notes.slice(1).map((note, index) => note.pitch - (source.notes[index]?.pitch ?? 0));
    let checked = 0;
    for (const contour of ['arch', 'ascending', 'descending', 'wave'] as const) {
      for (const bars of [1, 2, 3]) {
        for (const seed of [0, 1, 2, 3]) {
          const cell = generateMotif({ key: cMajor, bars, contour, jitter: 0.5, ctx: { seed } });
          const steps = stepsOf(cell);
          const reversed = [...steps].reverse();
          // A cell symmetrical enough to answer to more than one name takes the
          // plainest of them, so those are named elsewhere: an evenly falling
          // line read backwards is its own inversion as well as its retrograde.
          const mirrored = reversed.map((step) => -step);
          if (reversed.join() === steps.join() || mirrored.join() === steps.join()) {
            continue;
          }
          const model = motifFromNotes(motifToNoteEvents(cell));
          const backwards = transformMotif(cell, 'retrograde');
          const relation = relateMotifs(model, motifFromNotes(motifToNoteEvents(backwards)));
          expect(relation?.kind, `${contour} over ${bars} bars, seed ${seed}`).toBe('retrograde');
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('refuses a figure whose note values are not the model played backwards', () => {
    const uneven: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 62, startBeat: 1, durationBeat: 2 },
      { pitch: 67, startBeat: 3, durationBeat: 1 },
    ];
    // The pitches read back to front, but the long note has moved: this is a
    // different figure, not the cell reversed.
    const other: NoteEvent[] = [
      { pitch: 67, startBeat: 4, durationBeat: 2 },
      { pitch: 62, startBeat: 6, durationBeat: 1 },
      { pitch: 60, startBeat: 7, durationBeat: 1 },
    ];
    expect(relateMotifs(motifFromNotes(uneven), motifFromNotes(other))).toBeNull();
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

  it('points at no note when the line has none', () => {
    for (const empty of [[], [{ pitch: 60, startBeat: 0, durationBeat: 0 }]]) {
      const contour = melodicContour(empty);
      expect(contour.shape).toBe('static');
      expect(contour.range).toBe(0);
      // Zero would name the first note of a line that has no first note.
      expect(contour.peakIndex).toBe(-1);
      expect(contour.troughIndex).toBe(-1);
    }
  });

  it('points at a note that is there for every line that has one', () => {
    const lines = [line(0, [60]), line(0, [60, 60, 60]), line(0, [60, 67, 62]), line(0, [72, 60])];
    for (const notes of lines) {
      const contour = melodicContour(notes);
      expect(notes[contour.peakIndex]).toBeDefined();
      expect(notes[contour.troughIndex]).toBeDefined();
    }
  });
});

describe('the contour vocabulary the generator and the analysis share', () => {
  /** Every cell length `generateMotif` can be asked for at the low end. */
  const LENGTHS = [1, 2, 3, 4, 5, 6];
  const shapeOf = (contour: MotifContour, bars: number) =>
    melodicContour(motifToNoteEvents(generateMotif({ key: cMajor, bars, contour }))).shape;

  it.each(['arch', 'ascending', 'descending'] as const)(
    'reads a generated %s back under its own name at every length',
    (contour) => {
      for (const bars of LENGTHS) {
        expect(shapeOf(contour, bars), `${contour} over ${bars} bars`).toBe(contour);
      }
    },
  );

  it('reads a generated wave back as a wave once the cell turns more than once', () => {
    for (const bars of LENGTHS.filter((bars) => bars >= 3)) {
      expect(shapeOf('wave', bars), `wave over ${bars} bars`).toBe('wave');
    }
  });

  it('reads the shorter wave cells as the arches they are', () => {
    // One and two bars give the generator three and four notes, and its wave
    // turns once inside that: the guide documents the boundary rather than
    // letting a caller discover it.
    expect(shapeOf('wave', 1)).toBe('arch');
    expect(shapeOf('wave', 2)).toBe('arch');
  });
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Rows of the guide's correspondence table, as `[transform, relations]` cells. */
function tableRows(file: string): string[][] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((row) => row.startsWith('|'))
    .map((row) =>
      row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell)))
    .slice(1);
}

/** Names written in backticks, in the order they appear. */
function quoted(text: string): string[] {
  return [...text.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((match) => match[1] as string);
}

describe('the transform / relation correspondence the guide tabulates', () => {
  const transforms = unionMembers(path.join(ROOT, 'src/generate/motif/index.ts'), 'MotifTransform');
  const kinds = unionMembers(path.join(ROOT, 'src/analyze/melody/index.ts'), 'MotifRelationKind');
  const guides = ['en', 'ja'].map((lang) => ({
    lang,
    file: path.join(ROOT, 'docs', lang, 'melody-and-motifs.md'),
  }));

  it.each(guides)('$lang tabulates every transform, in the order they are declared', ({ file }) => {
    // The two directions carry different names for the same devices, so the
    // table is the only thing tying them together; deriving both sides from the
    // sources is what stops a new member from being added on one side alone.
    expect(tableRows(file).map((cells) => quoted(cells[0] as string))).toEqual(
      transforms.map((name) => [name]),
    );
  });

  it.each(guides)('$lang names only real relations opposite them', ({ file }) => {
    const named = tableRows(file).flatMap((cells) => quoted(cells[1] as string));
    expect(named.filter((name) => !kinds.includes(name))).toEqual([]);
  });

  it.each(guides)('$lang accounts for every relation somewhere on the page', ({ file }) => {
    const prose = readFileSync(file, 'utf8').replace(/^```[\s\S]*?^```/gm, '');
    const named = new Set(quoted(prose));
    expect(kinds.filter((kind) => !named.has(kind))).toEqual([]);
  });

  // Intervals +4, -2, +5 in even note values: asymmetrical enough that each
  // transform answers to exactly one name, and even enough that the retrograde
  // reads back to front in rhythm as well as in pitch.
  const figure: MotifCell = {
    notes: [60, 64, 62, 67].map((pitch, index) => ({
      pitch,
      startBeat: index,
      durationBeat: 1,
    })),
  };
  const model = motifFromNotes(motifToNoteEvents(figure));
  const nameOf = (transform: MotifTransform, key = cMajor) =>
    relateMotifs(
      model,
      motifFromNotes(motifToNoteEvents(transformMotif(figure, transform, 2, key))),
      key,
    )?.kind ?? null;

  /** What each transform's output has to come back from the analysis as. */
  const named: Readonly<Record<string, MotifRelationKind | null>> = {
    transposeDiatonic: 'tonalTransposition',
    transposeChromatic: 'transposition',
    invert: 'inversion',
    retrograde: 'retrograde',
    augment: 'augmentation',
    diminish: 'diminution',
    // A sequence states the cell and then answers it, so its output is two
    // statements rather than one transformed one; the halves are named below.
    // Null is the answer here, not a gap.
    sequence: null,
  };

  /** The relations reached by composing transforms rather than by one of them. */
  const composed: readonly MotifRelationKind[] = ['repetition', 'retrogradeInversion'];

  it('answers for every transform the generator declares', () => {
    // Derived from the union rather than listed twice: a transform added
    // tomorrow arrives here without anybody remembering to bring it.
    expect(Object.keys(named).sort()).toEqual([...transforms].sort());
  });

  it.each(Object.entries(named))('reports %s as the table promises', (transform, kind) => {
    expect(nameOf(transform as MotifTransform)).toBe(kind);
  });

  it('accounts for every relation the analysis can report', () => {
    const reached = new Set<string>(
      [...Object.values(named), ...composed].filter((kind): kind is MotifRelationKind =>
        Boolean(kind),
      ),
    );
    expect(kinds.filter((kind) => !reached.has(kind))).toEqual([]);
  });

  it('falls back to a chromatic reading of transposeDiatonic without a key', () => {
    const shifted = transformMotif(figure, 'transposeDiatonic', 2);
    expect(relateMotifs(model, motifFromNotes(motifToNoteEvents(shifted)))?.kind).toBe(
      'transposition',
    );
  });

  it('has no relation for sequence, and names its two halves instead', () => {
    const sequenced = transformMotif(figure, 'sequence', 2, cMajor);
    expect(nameOf('sequence')).toBeNull();
    const half = sequenced.notes.length / 2;
    const relation = relateMotifs(
      motifFromNotes(sequenced.notes.slice(0, half).map((note) => ({ ...note }))),
      motifFromNotes(sequenced.notes.slice(half).map((note) => ({ ...note }))),
      cMajor,
    );
    expect(relation?.kind).toBe('tonalTransposition');
    expect(relation?.sequence).toBe(true);
  });

  it('reaches the relations no single transform produces', () => {
    // The two the list above names, reached the way it says they are, so the
    // accounting stays a measurement rather than becoming a claim.
    expect(composed).toEqual(['repetition', 'retrogradeInversion']);
    expect(relateMotifs(model, model, cMajor)?.kind).toBe('repetition');
    const turned = transformMotif(transformMotif(figure, 'retrograde'), 'invert');
    expect(relateMotifs(model, motifFromNotes(motifToNoteEvents(turned)), cMajor)?.kind).toBe(
      'retrogradeInversion',
    );
  });
});
