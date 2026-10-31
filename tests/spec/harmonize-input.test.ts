import type { NoteEvent, TimeSignature } from '@libraz/libcantus/core';
import { classifyMelodyTones, harmonizeMelody } from '@libraz/libcantus/generate';
import { resolveKey } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

const fourFour: TimeSignature = { numerator: 4, denominator: 4 };

/** Quarter notes from beat 0. */
function quarters(pitches: readonly number[]): NoteEvent[] {
  return pitches.map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
}

/** The role of each note, keyed by the note rather than by its place in the listing. */
function rolesByNote(melody: readonly NoteEvent[]): Map<NoteEvent, string> {
  const tones = classifyMelodyTones(melody, fourFour);
  return new Map(melody.map((note, index) => [note, tones[index]?.role ?? '']));
}

describe('the melody is read in onset order, whatever its listing', () => {
  const melody = quarters([60, 62, 64, 60, 65, 67, 69, 67, 65, 64, 62, 60]);
  const listings = [
    [...melody].reverse(),
    [...melody].sort((a, b) => a.pitch - b.pitch || a.startBeat - b.startBeat),
    melody.filter((_, i) => i % 2 === 0).concat(melody.filter((_, i) => i % 2 === 1)),
  ];

  it('gives every note the same role however the notes are listed', () => {
    const inOrder = rolesByNote(melody);
    expect([...inOrder.values()]).toContain('passing');
    for (const listing of listings) {
      expect(rolesByNote(listing)).toEqual(inOrder);
    }
  });

  it('harmonizes a relisted melody with the same chords', () => {
    const inOrder = harmonizeMelody({ melody, key: 'C major' });
    for (const listing of listings) {
      const relisted = harmonizeMelody({ melody: listing, key: 'C major' });
      expect(relisted.chords).toEqual(inOrder.chords);
      expect(relisted.transposeSemitones).toBe(inOrder.transposeSemitones);
    }
  });
});

describe('a zero-length note is not part of the line', () => {
  it('leaves the roles of the sounding notes as they are without it', () => {
    const sounding = quarters([60, 62, 64, 67]);
    const withSilent = [...sounding.slice(0, 2), { pitch: 70, startBeat: 1, durationBeat: 0 }];
    withSilent.push(...sounding.slice(2));
    const tones = classifyMelodyTones(withSilent, fourFour);
    const without = classifyMelodyTones(sounding, fourFour).map((tone) => tone.role);
    expect(tones.filter((_, i) => i !== 2).map((tone) => tone.role)).toEqual(without);
    expect(without[1]).toBe('passing');
    expect(tones[2]).toEqual({ noteIndex: 2, role: 'structural', ornamental: false });
  });
});

describe('transposeSearch keeps the melody in the key it reports', () => {
  it('moves a diatonic tune to a shift with every note in the key', () => {
    const tune = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 62, startBeat: 1, durationBeat: 1 },
      { pitch: 64, startBeat: 2, durationBeat: 1 },
      { pitch: 65, startBeat: 3, durationBeat: 1 },
      { pitch: 67, startBeat: 4, durationBeat: 4 },
    ];
    for (const key of ['E major', 'A major', 'Bb major', 'D minor']) {
      const result = harmonizeMelody({
        melody: tune,
        key,
        placement: { transposeSearch: true, octaveSearch: false },
      });
      const scale = resolveKey(key).scale;
      const outside = tune.filter((note) => {
        const pc = (((note.pitch + result.transposeSemitones - scale.rootPc) % 12) + 12) % 12;
        return ((scale.modeMask12 >> pc) & 1) === 0;
      });
      expect(outside, key).toEqual([]);
    }
  });
});
