import { chordTimelineFromChords } from '@libraz/libcantus/analyze';
import type { KeyScale } from '@libraz/libcantus/core';
import { developMotif, type MotifCell } from '@libraz/libcantus/generate';
import { MAJOR_MASK } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

describe('developMotif reads the cell in time order', () => {
  const timeline = chordTimelineFromChords(
    [
      { rootPc: 0, quality: 'maj', startBeat: 0 },
      { rootPc: 7, quality: 'dom7', startBeat: 4 },
    ],
    8,
  );
  const notes = [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 61, startBeat: 1, durationBeat: 2 },
    { pitch: 63, startBeat: 3, durationBeat: 1 },
    { pitch: 66, startBeat: 3, durationBeat: 1 },
  ];

  it('develops any listing of the same notes into the same line', () => {
    const forwards = developMotif({ notes }, timeline, cMajor, 2, '4/4');
    const listings: MotifCell[] = [
      { notes: [...notes].reverse() },
      { notes: [notes[2], notes[0], notes[3], notes[1]].flatMap((note) => (note ? [note] : [])) },
    ];
    for (const cell of listings) {
      expect(developMotif(cell, timeline, cMajor, 2, '4/4')).toEqual(forwards);
    }
  });
});
