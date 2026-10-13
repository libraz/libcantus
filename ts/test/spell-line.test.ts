import { describe, expect, it } from 'vitest';
import { spellLine } from '../src/analyze/spelling/index.js';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import type { KeyScale, NoteEvent } from '../src/core/types.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import { majorKey, minorKey, scaleByName, spelledKeyOf } from '../src/theory/scale/index.js';
import { noteNames, spellPitch } from '../src/theory/spelling/index.js';

/** Lay pitches out as a line of quarter notes, one per beat. */
function line(pitches: number[]): NoteEvent[] {
  return pitches.map((pitch, index) => ({ pitch, startBeat: index, durationBeat: 1 }));
}

/**
 * Spell the same line note by note, the way a caller without `spellLine` has to:
 * each pitch judged from the key and its two immediate neighbours.
 */
function noteByNote(pitches: number[], key: KeyScale): string[] {
  const { tonic } = spelledKeyOf(key);
  return noteNames(
    pitches.map((pitch, index) => {
      const previous = pitches[index - 1];
      const next = pitches[index + 1];
      return spellPitch(pitch, tonic, key, {
        ...(previous === undefined ? {} : { previous }),
        ...(next === undefined ? {} : { next }),
      });
    }),
  );
}

/** The chromatic octave from middle C upward. */
const CHROMATIC_UP = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72];

describe('spellLine over a chromatic line', () => {
  it('spells a chromatic ascent with sharps', () => {
    expect(noteNames(spellLine(line(CHROMATIC_UP), null, majorKey(0)))).toEqual([
      'C4',
      'C#4',
      'D4',
      'D#4',
      'E4',
      'F4',
      'F#4',
      'G4',
      'G#4',
      'A4',
      'A#4',
      'B4',
      'C5',
    ]);
  });

  it('spells the matching descent with flats', () => {
    expect(noteNames(spellLine(line([...CHROMATIC_UP].reverse()), null, majorKey(0)))).toEqual([
      'C5',
      'B4',
      'Bb4',
      'A4',
      'Ab4',
      'G4',
      'Gb4',
      'F4',
      'E4',
      'Eb4',
      'D4',
      'Db4',
      'C4',
    ]);
  });
});

describe('spellLine under a chord', () => {
  /** One bar of Db7, as a caller placing chords by hand would give it. */
  const dFlatSeven: ChordSpan[] = [{ rootPc: 1, quality: 'dom7', startBeat: 0 }];

  it('spells the tones of a Db7 as the chord names them', () => {
    const timeline = chordTimelineFromChords(dFlatSeven, 4);
    expect(noteNames(spellLine(line([61, 65, 68, 71]), timeline, majorKey(0)))).toEqual([
      'Db4',
      'F4',
      'Ab4',
      'Cb5',
    ]);
  });

  it('spells the seventh as Cb where the note-by-note path leaves it a B', () => {
    // The pitch is a tone of C major, so the note-by-note path never respells
    // it, however clearly the chord names it as a seventh.
    expect(noteByNote([61, 65, 68, 71], majorKey(0))).toEqual(['Db4', 'F4', 'Ab4', 'B4']);
  });

  it('keeps a sharp-side chord on its own spelling', () => {
    const timeline = chordTimelineFromChords([{ rootPc: 1, quality: 'dom7', startBeat: 0 }], 4);
    const sharp = spellLine(line([61, 65, 68, 71]), timeline, majorKey(6));
    // The key is F# major, but the chord is still the one that was played.
    expect(noteNames(sharp)).toEqual(['Db4', 'F4', 'Ab4', 'Cb5']);
  });

  it('lets the chord under each note change the spelling mid-line', () => {
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 1, quality: 'dom7', startBeat: 2 },
      ],
      4,
    );
    expect(noteNames(spellLine(line([60, 64, 68, 71]), timeline, majorKey(0)))).toEqual([
      'C4',
      'E4',
      'Ab4',
      'Cb5',
    ]);
  });
});

describe('spellLine consistency across a line', () => {
  /** A rising whole-tone figure, the shape a note-by-note path cannot hold together. */
  const WHOLE_TONE_UP = [60, 62, 64, 66, 68, 70, 72];

  it('pins the note-by-note path splitting the figure between sharps and flats', () => {
    // F# and Ab are a diminished third apart: the same rising whole step is
    // written two different ways inside one gesture.
    expect(noteByNote(WHOLE_TONE_UP, majorKey(0))).toEqual([
      'C4',
      'D4',
      'E4',
      'F#4',
      'Ab4',
      'Bb4',
      'C5',
    ]);
  });

  it('spells the whole figure as seconds throughout', () => {
    expect(noteNames(spellLine(line(WHOLE_TONE_UP), null, majorKey(0)))).toEqual([
      'C4',
      'D4',
      'E4',
      'F#4',
      'G#4',
      'A#4',
      'C5',
    ]);
  });

  it('pins a rising chromatic step the note-by-note path spells as a diminished third', () => {
    expect(noteByNote([60, 61, 63], majorKey(0))).toEqual(['C4', 'C#4', 'Eb4']);
    expect(noteNames(spellLine(line([60, 61, 63]), null, majorKey(0)))).toEqual([
      'C4',
      'C#4',
      'D#4',
    ]);
  });

  it('still spells a whole step onto a scale tone the way the key does', () => {
    // Direction alone must not turn Eb into a D# that reads as a diminished
    // third against the F above it.
    expect(noteNames(spellLine(line([60, 62, 63, 65]), null, majorKey(0)))).toEqual([
      'C4',
      'D4',
      'Eb4',
      'F4',
    ]);
  });
});

describe('spellLine in a minor key', () => {
  it('spells the raised sixth and leading tone of G# minor', () => {
    const rising = line([68, 70, 71, 73, 75, 77, 79, 80]);
    expect(noteNames(spellLine(rising, null, minorKey(8)))).toEqual([
      'G#4',
      'A#4',
      'B4',
      'C#5',
      'D#5',
      'E#5',
      'F##5',
      'G#5',
    ]);
  });

  it('keeps the leading tone of G# harmonic minor spelled F## against a falling line', () => {
    const falling = line([80, 79, 75, 73, 71, 70, 68]);
    expect(noteNames(spellLine(falling, null, scaleByName('harmonicMinor', 8)))).toEqual([
      'G#5',
      'F##5',
      'D#5',
      'C#5',
      'B4',
      'A#4',
      'G#4',
    ]);
  });

  it('spells the raised sixth of a melodic-minor ascent', () => {
    const rising = line([68, 70, 71, 73, 75, 77, 79, 80]);
    expect(noteNames(spellLine(rising, null, scaleByName('melodicMinor', 8)))).toEqual([
      'G#4',
      'A#4',
      'B4',
      'C#5',
      'D#5',
      'E#5',
      'F##5',
      'G#5',
    ]);
  });
});

describe('spellLine contract', () => {
  it('returns the same spelling for the same input every time', () => {
    const timeline = chordTimelineFromChords([{ rootPc: 1, quality: 'dom7', startBeat: 0 }], 8);
    const notes = line([60, 61, 63, 65, 66, 68, 70, 71]);
    const first = spellLine(notes, timeline, majorKey(0));
    for (let run = 0; run < 5; run += 1) {
      expect(spellLine(notes, timeline, majorKey(0))).toEqual(first);
    }
  });

  it('spells from the key alone when no timeline is given', () => {
    const notes = line([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(noteNames(spellLine(notes, null, majorKey(0)))).toEqual([
      'C4',
      'D4',
      'E4',
      'F4',
      'G4',
      'A4',
      'B4',
      'C5',
    ]);
  });

  it('spells a line the same way with a timeline that names no chord', () => {
    const empty = chordTimelineFromChords([], 8);
    const notes = line([67, 66, 65, 64, 63, 62, 61, 60]);
    expect(spellLine(notes, empty, majorKey(0))).toEqual(spellLine(notes, null, majorKey(0)));
  });

  it('takes a tonic spelling from the caller', () => {
    const notes = line([66, 68, 70]);
    expect(
      noteNames(spellLine(notes, null, majorKey(6), { tonic: { letter: 3, alter: 1 } })),
    ).toEqual(['F#4', 'G#4', 'A#4']);
    expect(noteNames(spellLine(notes, null, majorKey(6)))).toEqual(['Gb4', 'Ab4', 'Bb4']);
  });

  it('returns nothing for an empty line', () => {
    expect(spellLine([], null, majorKey(0))).toEqual([]);
  });

  it('rejects a line longer than the budget allows', () => {
    expect(() => spellLine(line([60, 61, 62]), null, majorKey(0), { budget: 2 })).toThrow();
  });
});
